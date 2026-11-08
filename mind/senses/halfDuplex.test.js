import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHalfDuplex, share } from './halfDuplex.js';
import { isStop } from './heardFilter.js';

const at = () => { let t = 0; return { now: () => t, set: ms => { t = ms; } }; };
const line = (h, c, from, to, text) => { c.set(from); if (text) h.said(text); h.speaking(true); c.set(to); h.speaking(false); };

test('the echoes heard live on 8 Nov are Rho\'s own words', () => {
  assert.ok(share('Is someone there?', 'Is someone there?') >= 0.5);
  assert.ok(share("Don't wave at me.", 'Hello there. Rho, wave at me.') >= 0.5);
  assert.ok(share('I can hear myself', 'Rho here. I am testing whether I can hear myself, one more time.') >= 0.5);
  assert.ok(share('Almost touching, be gentle. Row here.', 'Rho here. I am testing whether I can hear myself.') < 0.5);
});

test('an echo in the line or its tail is dropped; the owner answering straight after is not', () => {
  const c = at(); const h = createHalfDuplex({ now: c.now, tailMs: 2000 });
  line(h, c, 1000, 2000, 'Four.');
  c.set(4000);
  assert.equal(h.judge(1200, 2300, 'Four.').echo, true);
  assert.equal(h.judge(2200, 3600, 'Bro, wave at me!').echo, false, 'the 21:11 miss');
});

test('an echo of words in a line said long ago, heard now, is not dropped', () => {
  const c = at(); const h = createHalfDuplex({ now: c.now, tailMs: 2000 });
  line(h, c, 0, 1000, 'Is someone there?');
  c.set(10000);
  assert.equal(h.judge(8000, 9000, 'Is someone there?').echo, false);
});

test('the text may come before or after the speaking flag', () => {
  const c = at(); const h = createHalfDuplex({ now: c.now, tailMs: 2000 });
  c.set(0); h.speaking(true); h.said('Once upon a time there was a robot.'); c.set(3000); h.speaking(false);
  assert.equal(h.judge(500, 2500, 'Once upon a time...').echo, true);
});

test('with no line text the time decides: wholly inside is an echo, past the tail is not', () => {
  const c = at(); const h = createHalfDuplex({ now: c.now, tailMs: 800 });
  line(h, c, 0, 3000, null);
  c.set(9000);
  assert.equal(h.judge(500, 3500, 'anything').echo, true);
  assert.equal(h.judge(3000, 4500, 'anything').echo, false);
});

test('a stale true stops counting; a voice gone offline closes the line', () => {
  const c = at(); const h = createHalfDuplex({ now: c.now, tailMs: 0, maxMs: 30000 });
  c.set(0); h.said('Is someone there?'); h.speaking(true);
  c.set(100000);
  assert.equal(h.judge(90000, 95000, 'Is someone there?').echo, false);
  const c2 = at(); const h2 = createHalfDuplex({ now: c2.now, tailMs: 0 });
  c2.set(0); h2.said('Hi.'); h2.speaking(true); c2.set(1000); h2.voiceGone(); c2.set(5000);
  assert.equal(h2.judge(2000, 4000, 'Hi.').echo, false);
});

test('isStop: a stop with or without the name, nothing else', () => {
  for (const t of ['Bro stop.', 'Rho, stop!', 'Stop.', 'Stop, stop!', 'Freeze!', 'Stop it.', 'Stop, Bro!']) assert.equal(isStop(t), true, t);
  for (const t of ['Once there was a robot.', 'Stop the car.', 'and solve puzzles.', 'Bro stop being so dramatic.']) assert.equal(isStop(t), false, t);
});
