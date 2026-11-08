import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './health.js';

const up = { ok: true, ms: 3 };
const parts = ['whisper', 'mind', 'hearing'];

test('all parts online and Ollama up is ok', () => {
  const statuses = new Map([['peak/mind/mind/status', 'online'], ['peak/mind/hearing/status', 'online'], ['peak/mech/status', 'online']]);
  const h = summarize({ statuses, probes: { whisper: up, ollama: { ...up, models: 7 } }, now: 1, parts });
  assert.equal(h.ok, true);
  assert.deepEqual(h.down, []);
  assert.deepEqual(h.parts, { whisper: 'online', mind: 'online', hearing: 'online' });
  assert.deepEqual(h.bodies, { mech: 'online' });
  assert.equal(h.at, 1);
});

test('a part offline by its Last Will, one never seen and Ollama down are each named', () => {
  const statuses = new Map([['peak/mind/mind/status', 'offline'], ['peak/desk-light/status', 'offline']]);
  const h = summarize({ statuses, probes: { whisper: up, ollama: { ok: false, ms: 5000, error: 'ECONNREFUSED' } }, now: 2, parts });
  assert.equal(h.ok, false);
  assert.deepEqual(h.down, ['mind', 'hearing', 'ollama']);
  assert.equal(h.parts.hearing, 'unknown');
  assert.deepEqual(h.bodies, { 'desk-light': 'offline' });
});

test('whisper is judged by its HTTP probe, not a topic', () => {
  const statuses = new Map([['peak/mind/whisper/status', 'online'], ['peak/mind/mind/status', 'online'], ['peak/mind/hearing/status', 'online']]);
  const h = summarize({ statuses, probes: { whisper: { ok: false, error: 'ECONNREFUSED' }, ollama: up }, now: 3, parts });
  assert.deepEqual(h.down, ['whisper']);
});

test('the mind and the health process itself are parts, never bodies', () => {
  const statuses = new Map([['peak/mind/health/status', 'online'], ['peak/mind/mind/status', 'online']]);
  const h = summarize({ statuses, probes: { whisper: up, ollama: up }, now: 4, parts: ['mind'] });
  assert.deepEqual(h.bodies, {});
  assert.equal(h.ok, true);
});
