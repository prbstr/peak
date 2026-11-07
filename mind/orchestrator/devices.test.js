import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gestureNames } from './gestures.js';
import { DEVICES, actionNames, createDeviceHub, deviceProblem, loadDevices } from './devices.js';
import { createTrickPlayer, loadTricks, trickProblem } from './tricks.js';

const lamp = {
  describe: 'a lamp.',
  base: 'peak/lamp/l2m_1',
  status: 'availability',
  actions: { lamp_on: { describe: 'on.', topic: 'cmd', payload: { state: 'ON' } }, lamp_off: { describe: 'off.', topic: 'cmd', payload: 'OFF' } },
};
const scratch = () => join(mkdtempSync(join(tmpdir(), 'peak-devices-')), 'devices.yaml');
const fakeClient = () => {
  const sent = [];
  return { sent, publish: (topic, payload) => sent.push([topic, payload]) };
};

test('the shipped devices load: six light actions on the desk light, none named like a gesture', () => {
  assert.deepEqual(Object.keys(DEVICES.devices), ['desk_light']);
  assert.deepEqual(actionNames, ['light_on', 'light_off', 'light_bright', 'light_dim', 'light_warm', 'light_cool']);
  for (const name of actionNames) assert.ok(!gestureNames.includes(name));
  assert.equal(DEVICES.devices.desk_light.status, 'peak/desk-light/status');
  assert.equal(DEVICES.actions.light_off.topic, 'peak/desk-light/light/bar/command');
  assert.deepEqual(JSON.parse(DEVICES.actions.light_off.payload), { state: 'OFF' });
});

test('a device is checked: names, one-line descriptions, topics without wildcards, payloads', () => {
  assert.equal(deviceProblem('lamp', lamp), null);
  const withActions = actions => ({ ...lamp, actions });
  const bad = [
    ['Lamp', lamp, /name must be/],
    ['lamp', null, /must have describe, base and actions/],
    ['lamp', { ...lamp, describe: 'two\nlines' }, /describe must be/],
    ['lamp', { ...lamp, base: 'peak/+/x' }, /base must be/],
    ['lamp', { ...lamp, base: '/peak/lamp' }, /base must be/],
    ['lamp', { ...lamp, status: 'a b' }, /status must be/],
    ['lamp', withActions({}), /needs at least one action/],
    ['lamp', withActions({ On: lamp.actions.lamp_on }), /action On: name must be/],
    ['lamp', withActions({ wave: lamp.actions.lamp_on }), /action wave: name is already a gesture/],
    ['lamp', withActions({ lamp_on: 'on' }), /action lamp_on: must have describe/],
    ['lamp', withActions({ lamp_on: { ...lamp.actions.lamp_on, describe: '' } }), /describe must be/],
    ['lamp', withActions({ lamp_on: { ...lamp.actions.lamp_on, topic: 'a/#' } }), /topic must be/],
    ['lamp', withActions({ lamp_on: { ...lamp.actions.lamp_on, payload: 3 } }), /payload must be a string or an object/],
    ['lamp', withActions({ lamp_on: { ...lamp.actions.lamp_on, payload: 'x'.repeat(513) } }), /payload must be at most 512/],
  ];
  for (const [name, device, why] of bad) assert.match(deviceProblem(name, device) ?? 'no problem found', why, JSON.stringify(device));
  assert.match(deviceProblem('lamp', lamp, [...gestureNames, 'lamp_on']), /lamp_on: name is already/);
});

test('loadDevices makes topics absolute, encodes payloads, and refuses an action name used twice', () => {
  const path = scratch();
  writeFileSync(path, [
    'lamp:', '  describe: a lamp.', '  base: peak/lamp', '  actions:', '    lamp_on: { describe: on., topic: cmd, payload: { state: ON } }',
    'fan:', '  describe: a fan.', '  base: peak/fan', '  status: alive', '  actions:', '    fan_on: { describe: on., topic: set, payload: "1" }',
  ].join('\n'));
  const { devices, actions } = loadDevices({ path });
  assert.deepEqual(devices.lamp, { describe: 'a lamp.', base: 'peak/lamp', status: 'peak/lamp/status', actions: ['lamp_on'] });
  assert.equal(devices.fan.status, 'peak/fan/alive');
  assert.deepEqual(actions.lamp_on, { device: 'lamp', describe: 'on.', topic: 'peak/lamp/cmd', payload: '{"state":"ON"}' });
  assert.deepEqual(actions.fan_on, { device: 'fan', describe: 'on.', topic: 'peak/fan/set', payload: '1' });
  writeFileSync(path, [
    'lamp:', '  describe: a lamp.', '  base: peak/lamp', '  actions:', '    lamp_on: { describe: on., topic: cmd, payload: "1" }',
    'fan:', '  describe: a fan.', '  base: peak/fan', '  actions:', '    lamp_on: { describe: on., topic: cmd, payload: "1" }',
  ].join('\n'));
  assert.throws(() => loadDevices({ path }), /devices.yaml: fan: action lamp_on: name is already/);
  assert.deepEqual(loadDevices({ path: join(tmpdir(), 'nope', 'devices.yaml') }), { devices: {}, actions: {} });
});

test('the hub publishes an action on its own topic and follows the device\'s status topic', () => {
  const client = fakeClient();
  const logged = [];
  const hub = createDeviceHub(client, { devices: loadDevices({ path: write(lamp) }), log: m => logged.push(m) });
  assert.deepEqual(hub.statusTopics, ['peak/lamp/l2m_1/availability']);
  assert.equal(hub.status('peak/mech/status', Buffer.from('online')), null);
  assert.deepEqual(hub.status('peak/lamp/l2m_1/availability', Buffer.from('online')), { device: 'lamp', online: true });
  assert.ok(hub.online.has('lamp'));
  assert.equal(hub.run('lamp_on'), true);
  assert.equal(hub.run('lamp_off'), true);
  assert.equal(hub.run('moonwalk'), false);
  assert.deepEqual(client.sent, [['peak/lamp/l2m_1/cmd', '{"state":"ON"}'], ['peak/lamp/l2m_1/cmd', 'OFF']]);
  assert.equal(logged.length, 0);
  hub.status('peak/lamp/l2m_1/availability', Buffer.from('offline'));
  assert.equal(hub.run('lamp_on'), false);
  assert.equal(client.sent.length, 2);
  assert.match(logged[0], /lamp is offline; lamp_on not sent/);
});

test('a trick may switch a device: the step is checked against the actions and played through the hub', async () => {
  const actions = ['lamp_on', 'lamp_off'];
  const steps = [{ action: 'lamp_off' }, { eyes: { mood: 'tired' } }, { say: 'Lights out.' }];
  assert.equal(trickProblem('lights_out', { describe: 'off.', steps }, gestureNames, actions), null);
  assert.match(trickProblem('lights_out', { describe: 'off.', steps: [{ action: 'moonwalk' }] }, gestureNames, actions), /action "moonwalk" is not in devices.yaml/);
  assert.match(trickProblem('lamp_on', { describe: 'x.', steps }, gestureNames, actions), /already a device action/);
  const learned = join(mkdtempSync(join(tmpdir(), 'peak-tricks-')), 'learned.yaml');
  writeFileSync(learned, 'lights_out:\n  describe: "off."\n  steps: [{ action: lamp_off }, { eyes: { mood: tired } }]\n');
  const tricks = loadTricks({ learned, actions });
  assert.deepEqual(tricks.lights_out.steps, [{ action: 'lamp_off' }, { eyes: { mood: 'tired' } }]);
  const client = { sent: [], publish(topic, payload) { this.sent.push([topic, payload]); } };
  const ran = [];
  const player = createTrickPlayer(client, { tricks, sleep: async () => {}, run: name => ran.push(name) });
  assert.equal(await player.play('mech', 'lights_out'), true);
  assert.deepEqual(ran, ['lamp_off']);
  assert.deepEqual(client.sent, [['peak/mech/cmd', '{"eyes":{"mood":"tired"}}']]);
  // a trick with an action step is refused when the device is not configured
  const warnings = [];
  assert.ok(!('lights_out' in loadTricks({ learned, actions: [], warn: w => warnings.push(w) })));
  assert.match(warnings[0], /not in devices.yaml/);
});

function write(device) {
  const path = scratch();
  writeFileSync(path, JSON.stringify({ lamp: device }));
  return path;
}
