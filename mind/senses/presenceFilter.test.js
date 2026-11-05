// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceFilter } from './presenceFilter.js';

const clock = () => { let t = 0; return { now: () => t, tick: ms => { t += ms; } }; };
const fresh = (opts = {}) => { const c = clock(); return { f: createPresenceFilter({ now: c.now, quietMs: 60_000, nearCm: 30, cooldownMs: 10_000, ...opts }), c }; };
/** Feed readings half a second apart, as servod sends them; returns every event text. */
const feed = (f, c, readings) => readings.flatMap(r => { c.tick(500); return f.consider(r); });
const far = n => Array.from({ length: n }, () => ({ distance_cm: 80, motion: false }));

test('the first movement seen is an arrival', () => {
  const { f, c } = fresh();
  assert.deepEqual(feed(f, c, [{ motion: false }, { motion: true }]), ['movement nearby after a quiet spell']);
});

test('someone fidgeting at the desk is not announced again', () => {
  const { f, c } = fresh();
  const out = feed(f, c, [{ motion: true }, { motion: true }, { motion: false }, { motion: false }, { motion: true }]);
  assert.equal(out.length, 1);
});

test('movement after a quiet minute is a new arrival', () => {
  const { f, c } = fresh();
  feed(f, c, [{ motion: true }]);
  c.tick(61_000);
  assert.equal(feed(f, c, [{ motion: true }]).length, 1);
});

test('a hand coming close is one event, with the distance', () => {
  const { f, c } = fresh();
  const out = feed(f, c, [...far(5), { distance_cm: 6.2 }, { distance_cm: 5.8 }, { distance_cm: 5.9 }]);
  assert.deepEqual(out, ['something came close, 6 cm in front of you']);
});

test('one bad echo is not an approach', () => {
  const { f, c } = fresh();
  assert.deepEqual(feed(f, c, [...far(5), { distance_cm: 4 }, ...far(3)]), []);
});

test('a sensor resting near a wall is not being approached, but a hand in front of it is', () => {
  const { f, c } = fresh();
  const wall = Array.from({ length: 8 }, () => ({ distance_cm: 8 }));
  assert.deepEqual(feed(f, c, wall), []);
  assert.deepEqual(feed(f, c, [{ distance_cm: 3 }, { distance_cm: 3 }]), ['something came close, 3 cm in front of you']);
});

test('nothing in range, then something close', () => {
  const { f, c } = fresh();
  assert.deepEqual(feed(f, c, [{}, {}, {}, { distance_cm: 12 }, { distance_cm: 12 }]), ['something came close, 12 cm in front of you']);
});

test('poking it repeatedly is held to one event per cooldown', () => {
  const { f, c } = fresh();
  const poke = [{ distance_cm: 5 }, { distance_cm: 5 }, ...far(2)];
  assert.equal(feed(f, c, [...far(5), ...poke, ...poke]).length, 1);
  c.tick(10_000);
  assert.equal(feed(f, c, poke).length, 1);
});

test('something left close for half a minute becomes the new normal', () => {
  const { f, c } = fresh();
  const parked = Array.from({ length: 70 }, () => ({ distance_cm: 10 }));
  assert.equal(feed(f, c, [...far(5), ...parked]).length, 1);
  assert.deepEqual(feed(f, c, [{ distance_cm: 4 }, { distance_cm: 4 }]), ['something came close, 4 cm in front of you']);
});
