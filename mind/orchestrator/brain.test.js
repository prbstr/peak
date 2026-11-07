// Run: node --test orchestrator/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { DESCRIBE, GESTURES_PATH, gestureNames, loadGestureNames } from './gestures.js';
import { DEVICE_RULES, EYES_RULES, REPLY_SCHEMA, RULES, SAY_MAX, SYSTEM, TRICKS, DEVICES, buildMessages, deskLine, DESK_FRESH_MS, buildSchema, buildSystem, parseReply, summarizeHive, trimHistory, earlyGesture, gestureConfidence } from './brain.js';
import { DEVICES as KNOWN_DEVICES } from './devices.js';
import { loadTricks } from './tricks.js';

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
  assert.deepEqual(r.reply, { gesture: 'nod', eyes: null, action: null, say: 'Yes.' });
  assert.equal(r.valid, true);
});

test('parseReply nulls an unknown gesture and counts it', () => {
  const r = parseReply('{"gesture":"moonwalk","say":null}');
  assert.deepEqual(r.reply, { gesture: null, eyes: null, action: null, say: null });
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

test('earlyGesture reads the first field as soon as it closes, and not before', () => {
  assert.equal(earlyGesture('{"gest'), undefined);
  assert.equal(earlyGesture('{"gesture": "wa'), undefined);
  assert.equal(earlyGesture('{"gesture": "wave"'), undefined);
  assert.equal(earlyGesture('{"gesture": "wave",'), 'wave');
  assert.equal(earlyGesture('{ "gesture" : null , "say"'), null);
  assert.equal(earlyGesture('{"gesture": "nod"}'), 'nod');
});

test('gestureConfidence multiplies the probabilities of the tokens that spell the gesture', () => {
  const content = '{"gesture": "look_left", "say": null}';
  const toks = ['{"', 'gesture', '": "', 'look', '_left', '", "say', '": null}'];
  const logprobs = toks.map(token => ({ token, logprob: token === 'look' ? Math.log(0.5) : token === '_left' ? Math.log(0.8) : 0 }));
  assert.ok(Math.abs(gestureConfidence(content, logprobs) - 0.4) < 1e-9);
  assert.equal(gestureConfidence(content, null), null);
  assert.equal(gestureConfidence('not json', logprobs), null);
});

test('the system prompt carries every tuning rule and the yes-answer example', () => {
  for (const line of RULES.split('\n')) assert.ok(SYSTEM.includes(line), line);
  assert.ok(SYSTEM.includes('"Did you hear that?"'));
});

// The eyes field is off unless PEAK_BRAIN_EYES=1, so these build the prompt and schema with the tricks handed in.
const tricks = loadTricks();
const names = Object.keys(tricks);
const noDevices = { devices: {}, actions: {} };
const withEyes = buildSystem(undefined, undefined, undefined, tricks, noDevices);

test('with tricks the brain can pick one for the eyes, after the gesture and before the words', () => {
  const schema = buildSchema(names, []);
  assert.deepEqual(Object.keys(schema.properties), ['gesture', 'eyes', 'say']);
  assert.deepEqual(schema.properties.eyes.enum, [...names, null]);
  assert.deepEqual(schema.required, ['gesture', 'eyes', 'say']);
  assert.ok(names.includes('peekaboo'));
});

test('with tricks the system prompt explains each one, carries the eyes rules and shows eyes in every example', () => {
  for (const [name, trick] of Object.entries(tricks)) assert.ok(withEyes.includes(`- ${name}: ${trick.describe}`), name);
  for (const line of EYES_RULES.split('\n')) assert.ok(withEyes.includes(line), line);
  assert.match(withEyes, /\{"gesture": <name or null>, "eyes": <name or null>, "say": <one short sentence or null>\}/);
  const examples = withEyes.split('Examples:\n')[1].split('\n');
  assert.ok(examples.length >= 12);
  for (const line of examples) assert.match(line, /-> \{"gesture":("[a-z_]+"|null),"eyes":("[a-z_]+"|null),"say":/, line);
  assert.ok(examples.filter(line => line.includes('"eyes":null')).length > examples.length / 2, 'eyes is null in most examples');
});

test('without tricks, the default, the prompt and the reply shape have no eyes in them', () => {
  if (process.env.PEAK_BRAIN_EYES !== '1' && process.env.PEAK_BRAIN_DEVICES !== '1') {
    assert.deepEqual(TRICKS, {});
    assert.equal(SYSTEM, buildSystem(undefined, undefined, undefined, {}, noDevices));
    assert.deepEqual(REPLY_SCHEMA, buildSchema([], []));
  }
  const plain = buildSystem(undefined, undefined, undefined, {}, noDevices);
  assert.doesNotMatch(plain, /eyes|Eyes|wink|peekaboo/);
  assert.match(plain, /\{"gesture": <name or null>, "say": <one short sentence or null>\}/);
  assert.deepEqual(Object.keys(buildSchema([], []).properties), ['gesture', 'say']);
  assert.deepEqual(buildSchema([], []).required, ['gesture', 'say']);
});

test('parseReply keeps a known trick and nulls an unknown one, counted', () => {
  const good = parseReply('{"gesture":"nod","eyes":"wink","say":null}', undefined, names);
  assert.deepEqual(good.reply, { gesture: 'nod', eyes: 'wink', action: null, say: null });
  assert.equal(good.valid, true);
  const bad = parseReply('{"gesture":null,"eyes":"moonwalk","say":"Hi."}', undefined, names);
  assert.deepEqual(bad.reply, { gesture: null, eyes: null, action: null, say: 'Hi.' });
  assert.equal(bad.violations.unknownEyes, true);
  assert.equal(bad.valid, false);
  assert.equal(parseReply('{"gesture":"wave","say":"Hi."}', undefined, names).reply.eyes, null);
});

test('the gesture is still read early with eyes after it', () => {
  assert.equal(earlyGesture('{"gesture":"wave","eyes":'), 'wave');
  assert.equal(earlyGesture('{"gesture": null, "eyes": "happy"'), null);
  assert.equal(earlyGesture('{"gesture":"wa'), undefined);
});

// The action field is off unless PEAK_BRAIN_DEVICES=1, so these build the prompt and schema with the devices handed in.
const actions = Object.keys(KNOWN_DEVICES.actions);
const withDevices = buildSystem(undefined, undefined, undefined, {}, KNOWN_DEVICES);
const withBoth = buildSystem(undefined, undefined, undefined, tricks, KNOWN_DEVICES);

test('with devices the brain can name an action, after the eyes and before the words', () => {
  assert.deepEqual(Object.keys(buildSchema([], actions).properties), ['gesture', 'action', 'say']);
  assert.deepEqual(Object.keys(buildSchema(names, actions).properties), ['gesture', 'eyes', 'action', 'say']);
  assert.deepEqual(buildSchema(names, actions).properties.action.enum, [...actions, null]);
  assert.deepEqual(buildSchema(names, actions).required, ['gesture', 'eyes', 'action', 'say']);
  assert.ok(actions.includes('light_off'));
});

test('with devices the system prompt lists each device and its actions, carries the device rules and shows action in every example', () => {
  for (const [name, device] of Object.entries(KNOWN_DEVICES.devices)) assert.ok(withDevices.includes(`- ${name}: ${device.describe}`), name);
  for (const [name, action] of Object.entries(KNOWN_DEVICES.actions)) assert.ok(withDevices.includes(`  - ${name}: ${action.describe}`), name);
  for (const line of DEVICE_RULES.split('\n')) assert.ok(withDevices.includes(line), line);
  assert.match(withDevices, /\{"gesture": <name or null>, "action": <name or null>, "say": <one short sentence or null>\}/);
  assert.match(withBoth, /\{"gesture": <name or null>, "eyes": <name or null>, "action": <name or null>, "say": <one short sentence or null>\}/);
  const examples = withDevices.split('Examples:\n')[1].split('\n');
  for (const line of examples) assert.match(line, /-> \{"gesture":("[a-z_]+"|null),"action":("[a-z_]+"|null),"say":/, line);
  assert.ok(examples.some(line => line.includes('"action":"light_on"')));
  assert.ok(examples.filter(line => line.includes('"action":null')).length > examples.length / 2, 'action is null in most examples');
  for (const line of withBoth.split('Examples:\n')[1].split('\n')) assert.match(line, /"eyes":("[a-z_]+"|null),"action":("[a-z_]+"|null),"say":/, line);
});

test('a device example is shown only when its action exists', () => {
  const lamp = { devices: { lamp: { describe: 'a lamp.', base: 'peak/lamp', status: 'peak/lamp/status', actions: ['lamp_on'] } }, actions: { lamp_on: { device: 'lamp', describe: 'on.', topic: 'peak/lamp/cmd', payload: '1' } } };
  const prompt = buildSystem(undefined, undefined, undefined, {}, lamp);
  assert.doesNotMatch(prompt, /light_on|light_dim/);
  assert.match(prompt, /"Don't touch the light"/);
});

test('without devices, the default, the prompt and the reply shape have no action in them', () => {
  if (process.env.PEAK_BRAIN_DEVICES !== '1') {
    assert.deepEqual(DEVICES, { devices: {}, actions: {} });
    assert.ok(!('action' in REPLY_SCHEMA.properties));
  }
  const plain = buildSystem(undefined, undefined, undefined, {}, { devices: {}, actions: {} });
  assert.doesNotMatch(plain, /action|Devices|light/);
  assert.doesNotMatch(withEyes, /action|Devices/);
});

test('parseReply keeps a known action and nulls an unknown one, counted', () => {
  const good = parseReply('{"gesture":null,"eyes":null,"action":"light_off","say":null}', undefined, names, actions);
  assert.deepEqual(good.reply, { gesture: null, eyes: null, action: 'light_off', say: null });
  assert.equal(good.valid, true);
  const bad = parseReply('{"gesture":null,"action":"warp_drive","say":"Hi."}', undefined, names, actions);
  assert.deepEqual(bad.reply, { gesture: null, eyes: null, action: null, say: 'Hi.' });
  assert.equal(bad.violations.unknownAction, true);
  assert.equal(bad.valid, false);
});

test('what the desk camera saw goes only with speech, only while fresh', () => {
  const seen = { text: 'The hands are holding a small circuit board.', at: 1_000_000 };
  assert.equal(deskLine({ heard: 'what am I holding?' }, seen, 1_004_000), 'Your desk camera, 4 s ago: The hands are holding a small circuit board.');
  assert.equal(deskLine({ heard: 'hi' }, seen, 1_000_000 + DESK_FRESH_MS + 1), '');
  assert.equal(deskLine({ see: 'a desk' }, seen, 1_001_000), '');
  assert.equal(deskLine({ sensed: 'movement' }, seen, 1_001_000), '');
  assert.equal(deskLine({ heard: 'hi' }, null, 1_001_000), '');
});

test('a prompt without a desk sighting is exactly what it was before', () => {
  const hive = new Map([['mech', {}]]);
  const plain = buildMessages([], 'mech', { heard: 'wave' }, hive);
  assert.equal(plain.at(-1).content, '[mech] {"heard":"wave"}\nBodies online: mech');
  const stale = buildMessages([], 'mech', { heard: 'wave' }, hive, { text: 'x', at: 0 }, DESK_FRESH_MS + 1);
  assert.deepEqual(stale, plain);
  const fresh = buildMessages([], 'mech', { heard: 'wave' }, hive, { text: 'Typing.', at: 0 }, 2000);
  assert.equal(fresh.at(-1).content, '[mech] {"heard":"wave"}\nYour desk camera, 2 s ago: Typing.\nBodies online: mech');
});
