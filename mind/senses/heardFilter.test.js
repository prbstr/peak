// Run: node --test senses/
// The cases are real transcripts from the 2 Nov 2026 mic test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeardFilter } from './heardFilter.js';

const clock = () => { let t = 0; return { now: () => t, tick: ms => { t += ms; } }; };
const fresh = (opts = {}) => { const c = clock(); return { f: createHeardFilter({ now: c.now, windowMs: 8000, ...opts }), c }; };

test('the wake phrase itself passes, even alone', () => {
  const { f } = fresh();
  assert.equal(f.consider('Hey Peak.').text, 'Hey Peak.');
});

test('whisper mishearings of Peak still wake it', () => {
  const { f } = fresh();
  for (const t of ['Hey Peek, wave at me please.', 'Hey Pete, can you wave at me?', 'hey peak where are we']) {
    assert.equal(f.consider(t).text, t, t);
  }
});

test('sound tags are dropped whether bracketed or starred', () => {
  const { f } = fresh();
  assert.equal(f.consider('[BURP]').text, null);
  assert.equal(f.consider('*burp*').text, null);
  assert.equal(f.consider('(laughs)').text, null);
  assert.equal(f.consider('[Music]').text, null);
});

test('a lone interjection is not a request', () => {
  const { f } = fresh();
  for (const t of ['Hey.', 'Oh.', 'Yo.', 'Hmm', 'What?']) assert.equal(f.consider(t).text, null, t);
});

test('known hallucinations are dropped', () => {
  const { f } = fresh();
  for (const t of ['Thanks for watching.', 'Thank you.', 'you', '...']) assert.equal(f.consider(t).text, null, t);
});

test('fluent sentences without the wake word are dropped when nobody woke it', () => {
  const { f } = fresh();
  for (const t of ["I'm a bitch.", 'The Redbird page returns.', 'I wish we were born in this town.']) {
    assert.equal(f.consider(t).why, 'no wake word', t);
  }
});

test('after the wake word, a follow-up sentence passes inside the window', () => {
  const { f, c } = fresh();
  f.consider('Hey Peak.');
  c.tick(3000);
  assert.equal(f.consider('wave at me').text, 'wave at me');
  c.tick(6000); // 9 s after the wake word
  assert.equal(f.consider('wave at me').why, 'no wake word');
});

test('a wake word inside a sentence also opens the window', () => {
  const { f, c } = fresh();
  assert.equal(f.consider('Can you hear me, Peak?').why, 'wake word');
  c.tick(1000);
  assert.equal(f.consider('nod if you can').text, 'nod if you can');
});

test('a tag mixed into real words is stripped, not fatal', () => {
  const { f } = fresh();
  assert.equal(f.consider('[cough] Hey Peak, [sigh] wave.').text, 'Hey Peak, wave.');
});

test('with the gate off every clean utterance passes', () => {
  const { f } = fresh({ gate: false });
  assert.equal(f.consider('The Redbird page returns.').text, 'The Redbird page returns.');
  assert.equal(f.consider('[BURP]').text, null);
});
