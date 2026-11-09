import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WAITING, SHORT_MS, next, push } from './utteranceQueue.js';

let seq = 0;
const u = ms => ({ ms, seq: seq++ });
const fill = items => {
  let q = []; const dropped = [];
  for (const it of items) { const r = push(q, it); q = r.queue; if (r.dropped) dropped.push(r.dropped); }
  return { q, dropped };
};

test('the defaults: three wait, 1.5 s or less counts as short', () => {
  assert.equal(MAX_WAITING, 3);
  assert.equal(SHORT_MS, 1500);
});

test('five long echoes and one short stop arriving while busy: the stop is next and is never dropped', () => {
  for (let at = 0; at < 6; at++) {
    const items = [u(6000), u(7000), u(5000), u(8000), u(4000)];
    const stop = u(700);
    items.splice(at, 0, stop);
    const { q, dropped } = fill(items);
    assert.equal(q.length, 3);
    assert.ok(!dropped.includes(stop), `stop at position ${at} dropped`);
    assert.ok(dropped.every(d => d.ms > SHORT_MS), 'only long ones dropped');
    assert.equal(next(q).item, stop, `stop at position ${at} not next`);
  }
});

test('when full, the longest goes, the newcomer included', () => {
  const [a, b, c] = [u(2000), u(9000), u(3000)];
  let r = push([a, b, c], u(4000));
  assert.equal(r.dropped, b);
  r = push([a, c, u(2500)], u(12000));
  assert.equal(r.dropped.ms, 12000, 'a new longest one is the one dropped');
});

test('short ones first in arrival order, then long ones in arrival order', () => {
  const [l1, s1, l2, s2] = [u(5000), u(800), u(4000), u(1500)];
  let q = [l1, s1, l2, s2]; const order = [];
  while (q.length) { const r = next(q); order.push(r.item); q = r.queue; }
  assert.deepEqual(order, [s1, s2, l1, l2]);
});

test('all short and full: the longest short one goes; empty queue gives null', () => {
  const r = push([u(600), u(1400), u(900)], u(700));
  assert.equal(r.dropped.ms, 1400);
  assert.deepEqual(next([]), { item: null, queue: [] });
});

test('push and next never change the queue they are given', () => {
  const q = [u(5000), u(6000), u(7000)];
  const copy = [...q];
  push(q, u(500)); next(q);
  assert.deepEqual(q, copy);
});
