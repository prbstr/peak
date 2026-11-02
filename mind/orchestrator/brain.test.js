// Run: node --test orchestrator/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { DESCRIBE, GESTURES_PATH, gestureNames, loadGestureNames } from './gestures.js';
import { REPLY_SCHEMA, SAY_MAX, SYSTEM, buildMessages, parseReply, summarizeHive, trimHistory } from './brain.js';

test('gesture names are exactly the keys of node/gestures.yaml', () => {
  assert.deepEqual(gestureNames, Object.keys(parse(readFileSync(GESTURES_PATH, 'utf8'))));
});

test('every gesture is described and every description has a gesture', () => {
  assert.deepEqual(new Set(Object.keys(DESCRIBE)), new Set(gestureNames));
  assert.throws(() => loadGestureNames(GESTURES_PATH, { ...DESCRIBE, moonwalk: 'nope' }), /not in gestures.yaml \["moonwalk"\]/);
  const { wave, ...missing } = DESCRIBE;
  assert.throws(() => loadGestureNames(GESTURES_PATH, missing), /missing descriptions \["wave"\]/);
});

test('the reply schema allows every gesture or null and caps say at the Pi limit', () => {
  assert.deepEqual(REPLY_SCHEMA.properties.gesture.enum, [...gestureNames, null]);
  assert.equal(REPLY_SCHEMA.properties.say.maxLength, 200);
  assert.equal(SAY_MAX, 200);
});

test('the system prompt explains every gesture and shows examples', () => {
  for (const name of gestureNames) assert.match(SYSTEM, new RegExp(`^- ${name}: `, 'm'), name);
  assert.match(SYSTEM, /Examples:\n\{"heard"/);
  assert.doesNotMatch(SYSTEM, /tools/);
});

test('buildMessages puts the system first, the event last, and only names online bodies', () => {
  const hive = new Map([['mech', { uptime: 123.4, pos: { head: 90 }, temp: 48.2, at: 1700000000000 }]]);
  const history = [{ role: 'user', content: 'old' }, { role: 'assistant', content: '{}' }];
  const msgs = buildMessages(history, 'mech', { heard: 'wave at me' }, hive);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[0].content, SYSTEM);
  assert.deepEqual(msgs.slice(1, 3), history);
  assert.equal(msgs.at(-1).content, '[mech] {"heard":"wave at me"}\nBodies online: mech');
  assert.doesNotMatch(msgs.at(-1).content, /uptime|pos|temp|1700000000000/);
});

test('an empty hive adds no state line', () => {
  assert.equal(summarizeHive(new Map()), '');
  assert.equal(buildMessages([], 'mech', { see: 'a cat' }).at(-1).content, '[mech] {"see":"a cat"}');
});

test('parseReply rejects bad JSON', () => {
  const r = parseReply('<think>hm</think>{"gesture":"wave","say":null}');
  assert.equal(r.reply, null);
  assert.equal(r.valid, false);
  assert.equal(r.violations.invalidJson, true);
  assert.equal(parseReply('[1,2]').reply, null);
});

test('parseReply accepts a good reply', () => {
  const r = parseReply('{"gesture":"nod","say":"Yes."}');
  assert.deepEqual(r.reply, { gesture: 'nod', say: 'Yes.' });
  assert.equal(r.valid, true);
});

test('parseReply nulls an unknown gesture and counts it', () => {
  const r = parseReply('{"gesture":"moonwalk","say":null}');
  assert.deepEqual(r.reply, { gesture: null, say: null });
  assert.equal(r.valid, false);
  assert.equal(r.violations.unknownGesture, true);
});

test('parseReply clamps a long line and treats blank say as null', () => {
  const r = parseReply(JSON.stringify({ gesture: null, say: 'x'.repeat(300) }));
  assert.equal(r.reply.say.length, 200);
  assert.equal(r.violations.sayTooLong, true);
  assert.equal(parseReply('{"gesture":null,"say":"   "}').reply.say, null);
});

test('trimHistory drops whole turns and never splits a user/assistant pair', () => {
  const history = [];
  for (let i = 0; i < 15; i++) history.push({ role: 'user', content: `u${i}` }, { role: 'assistant', content: `a${i}` });
  trimHistory(history, 20);
  assert.ok(history.length <= 20);
  assert.equal(history[0].role, 'user');
  for (let i = 0; i < history.length; i += 2) {
    assert.equal(history[i].role, 'user');
    assert.equal(history[i + 1].role, 'assistant');
  }
});
