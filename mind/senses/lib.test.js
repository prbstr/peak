import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs, connect } from './lib.js';

test('backoff doubles from the floor and stops at the cap', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(n => backoffMs(n)), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(backoffMs(0), 1000);
  assert.equal(backoffMs(3, 50, 150), 150);
});

test('a broker that refuses is retried with growing waits, not given up on', async () => {
  const saved = process.env.PEAK_BROKER;
  process.env.PEAK_BROKER = 'mqtt://127.0.0.1:1'; // nothing listens on port 1: every attempt is refused at once
  const client = connect(undefined, { minMs: 40, maxMs: 160 });
  assert.equal(typeof client._clearReconnect, 'function', 'mqtt.js no longer has _clearReconnect: fix connect()');
  assert.equal(typeof client._setupReconnect, 'function', 'mqtt.js no longer has _setupReconnect: fix connect()');
  const at = [];
  await new Promise(resolve => client.on('reconnect', () => { at.push(Date.now()); if (at.length === 5) resolve(); }));
  client.end(true);
  process.env.PEAK_BROKER = saved;
  const gaps = at.slice(1).map((t, i) => t - at[i]);
  // expected 80, 160, 160, 160 (the first wait is the floor, before any attempt); timers run late, never early
  assert.ok(gaps[0] >= 75 && gaps[0] < 140, `second gap ${gaps}`);
  assert.ok(gaps[1] >= 155 && gaps[2] >= 155 && gaps[3] >= 155, `later gaps ${gaps}`);
  assert.ok(gaps.every(g => g < 400), `capped ${gaps}`);
});
