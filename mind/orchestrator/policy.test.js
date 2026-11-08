import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_MAX_AGE_MS, DOING_MAX, EVENT_MAX_AGE_MS, allowed, apply, capDoing, kindOf, stale } from './policy.js';

const NOW = 1_800_000_000_000;
const heard = { heard: 'Rho, lights off' };
const lightsOff = { gesture: 'nod', eyes: null, action: 'light_off', say: 'Done.' };

test('the defaults are the owner\'s: events 5 s, actions 8 s', () => {
  assert.equal(EVENT_MAX_AGE_MS, 5000);
  assert.equal(ACTION_MAX_AGE_MS, 8000);
});

test('stale: older than 5 s is dropped, no `at` or a bad one counts as fresh', () => {
  assert.equal(stale(heard, NOW - 4999, NOW), false);
  assert.equal(stale(heard, NOW - 5000, NOW), false);
  assert.equal(stale(heard, NOW - 5001, NOW), true);
  assert.equal(stale(heard, NOW - 10_000, NOW), true);
  assert.equal(stale(heard, null, NOW), false, 'a hand mosquitto_pub carries no at');
  assert.equal(stale(heard, undefined, NOW), false);
  assert.equal(stale(heard, NaN, NOW), false);
  assert.equal(stale(heard, NOW + 2000, NOW), false, 'a clock a little ahead is not stale');
  assert.equal(stale({ see: 'a cup' }, NOW - 6000, NOW), true, 'every kind of event ages');
  assert.equal(stale(heard, NOW - 6000, NOW, 10_000), false, 'the limit can be raised');
});

test('a fresh heard reply passes whole', () => {
  assert.deepEqual(allowed(heard, NOW - 1500, lightsOff, NOW), []);
  assert.deepEqual(allowed(heard, null, lightsOff, NOW), [], 'no at: the action is allowed (hand-sent)');
});

test('action: vetoed when the brain answers more than 8 s after the words', () => {
  assert.deepEqual(allowed(heard, NOW - 8000, lightsOff, NOW), []);
  const v = allowed(heard, NOW - 8001, lightsOff, NOW);
  assert.deepEqual(v.map(x => x.field), ['action']);
  assert.match(v[0].why, /light_off 8\.0 s after the words/);
  assert.deepEqual(allowed(heard, NOW - 9000, lightsOff, NOW, { actionMaxAge: 10_000 }), []);
});

test('action: only a heard event may switch a device', () => {
  for (const event of [{ see: 'a dark room' }, { sensed: 'something 5 cm away' }, { doing: 'typing' }, { other: 1 }]) {
    const v = allowed(event, NOW - 100, lightsOff, NOW);
    assert.ok(v.some(x => x.field === 'action'), JSON.stringify(event));
  }
  assert.match(allowed({ see: 'a dark room' }, NOW, lightsOff, NOW)[0].why, /from a see event/);
});

test('gesture: none for a sensed event; other kinds keep theirs', () => {
  const sensed = { sensed: 'something 5 cm in front' };
  const v = allowed(sensed, NOW, { gesture: 'wave', eyes: null, action: null, say: 'Whoa.' }, NOW);
  assert.deepEqual(v.map(x => x.field), ['gesture']);
  assert.deepEqual(allowed(sensed, NOW, { gesture: null, say: 'Hi.' }, NOW), [], 'no gesture, nothing to veto');
  assert.deepEqual(allowed({ see: 'a person' }, NOW, { gesture: 'wave' }, NOW), []);
  assert.deepEqual(allowed(heard, NOW, { gesture: 'wave' }, NOW), []);
});

test('the early path checks the gesture alone, as index.js does before the reply is parsed', () => {
  assert.deepEqual(allowed({ sensed: 'close' }, null, { gesture: 'point' }, NOW).map(x => x.field), ['gesture']);
  assert.deepEqual(allowed({ sensed: 'close' }, null, { gesture: null }, NOW), []);
});

test('a sensed event with an action loses both', () => {
  const v = allowed({ sensed: 'close' }, NOW, { gesture: 'wave', action: 'light_on', say: 'Hi', eyes: 'happy' }, NOW);
  assert.deepEqual(v.map(x => x.field).sort(), ['action', 'gesture']);
  assert.deepEqual(apply({ gesture: 'wave', action: 'light_on', say: 'Hi', eyes: 'happy' }, v),
    { gesture: null, action: null, say: 'Hi', eyes: 'happy' });
});

test('apply leaves the reply alone when nothing is vetoed, and never changes the original', () => {
  const r = { ...lightsOff };
  assert.deepEqual(apply(r, []), lightsOff);
  apply(r, [{ field: 'action', why: 'x' }]);
  assert.deepEqual(r, lightsOff);
});

test('kindOf names the event', () => {
  assert.equal(kindOf(heard), 'heard');
  assert.equal(kindOf({ see: 'x' }), 'see');
  assert.equal(kindOf({ sensed: 'x' }), 'sensed');
  assert.equal(kindOf({ bump: 1 }), 'other');
});

test('doing text is cut to 200 characters', () => {
  assert.equal(DOING_MAX, 200);
  assert.equal(capDoing('typing').length, 6);
  assert.equal(capDoing('x'.repeat(5000)).length, 200);
});
