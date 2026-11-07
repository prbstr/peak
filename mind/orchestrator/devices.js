// Devices: things in the room the hive can switch, each a node on the broker like a body but with no senses and
// no gestures: the desk light now, a projector and its screen later. They are data (devices/devices.yaml): a
// device names the topics its own firmware listens on and the actions the brain may ask for, each with the exact
// payload to send, so a new device is a new entry, not new code. Action names share one namespace with gestures
// and tricks, because the brain's reply names any of them in one word.
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { gestureNames } from './gestures.js';

export const DEVICES_PATH = new URL('../devices/devices.yaml', import.meta.url);
export const MAX_DESCRIBE = 160;
export const MAX_PAYLOAD = 512;
const NAME = /^[a-z][a-z0-9_]{1,23}$/;
/** A topic to publish on: no wildcards, no spaces, no empty levels. */
const TOPIC = /^[^#+\s/]+(\/[^#+\s/]+)*$/;

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const oneLine = (s, max) => typeof s === 'string' && Boolean(s.trim()) && s.length <= max && !s.includes('\n');
const encode = payload => (typeof payload === 'string' ? payload : JSON.stringify(payload));

function actionProblem(name, action, taken) {
  if (!NAME.test(name)) return 'name must be 2 to 24 of a-z, 0-9 and _, starting with a letter';
  if (taken.includes(name)) return 'name is already a gesture or another action';
  if (!isObject(action)) return 'must have describe, topic and payload';
  if (!oneLine(action.describe, MAX_DESCRIBE)) return `describe must be one line of at most ${MAX_DESCRIBE} characters`;
  if (typeof action.topic !== 'string' || !TOPIC.test(action.topic)) return 'topic must be a path under the device\'s base, without wildcards';
  if (!(typeof action.payload === 'string' || isObject(action.payload))) return 'payload must be a string or an object';
  if (encode(action.payload).length > MAX_PAYLOAD) return `payload must be at most ${MAX_PAYLOAD} characters`;
  return null;
}

/** Why a device cannot be used, or null. `taken` holds the names its actions may not reuse. */
export function deviceProblem(name, device, taken = gestureNames) {
  if (!NAME.test(name)) return 'name must be 2 to 24 of a-z, 0-9 and _, starting with a letter';
  if (!isObject(device)) return 'must have describe, base and actions';
  const { describe, base, status = 'status', actions } = device;
  if (!oneLine(describe, MAX_DESCRIBE)) return `describe must be one line of at most ${MAX_DESCRIBE} characters`;
  if (typeof base !== 'string' || !TOPIC.test(base)) return 'base must be a topic prefix without wildcards';
  if (typeof status !== 'string' || !TOPIC.test(status)) return 'status must be a topic under base';
  if (!isObject(actions) || !Object.keys(actions).length) return 'needs at least one action';
  const seen = [...taken];
  for (const [actionName, action] of Object.entries(actions)) {
    const bad = actionProblem(actionName, action, seen);
    if (bad) return `action ${actionName}: ${bad}`;
    seen.push(actionName);
  }
  return null;
}

/** { devices: { name: { describe, base, status, actions: [names] } }, actions: { name: { device, describe, topic,
 *  payload } } }, every topic absolute and every payload encoded, ready to publish. No file means no devices. A
 *  bad entry is our mistake and throws, as a bad built-in trick does. */
export function loadDevices({ path = DEVICES_PATH, gestures = gestureNames } = {}) {
  const devices = {}, actions = {};
  const raw = existsSync(path) ? parse(readFileSync(path, 'utf8')) ?? {} : {};
  for (const [name, device] of Object.entries(isObject(raw) ? raw : {})) {
    const bad = deviceProblem(name, device, [...gestures, ...Object.keys(actions)]);
    if (bad) throw new Error(`devices.yaml: ${name}: ${bad}`);
    const status = device.status ?? 'status';
    devices[name] = { describe: device.describe, base: device.base, status: `${device.base}/${status}`, actions: Object.keys(device.actions) };
    for (const [actionName, action] of Object.entries(device.actions)) {
      actions[actionName] = { device: name, describe: action.describe, topic: `${device.base}/${action.topic}`, payload: encode(action.payload) };
    }
  }
  return { devices, actions };
}

export const DEVICES = loadDevices();
export const actionNames = Object.keys(DEVICES.actions);

/** Runs actions on devices and keeps track of which are online, from their status topics. */
export function createDeviceHub(client, { devices = DEVICES, log = console.log } = {}) {
  const online = new Set();
  const byStatus = new Map(Object.entries(devices.devices).map(([name, d]) => [d.status, name]));
  return {
    ...devices,
    online,
    /** Topics to subscribe to for presence; a device's firmware sets its own, so peak/+/status does not cover them. */
    statusTopics: [...byStatus.keys()],
    /** { device, online } when the message is a device's status, else null. */
    status(topic, payload) {
      const device = byStatus.get(topic);
      if (!device) return null;
      const up = payload.toString() === 'online';
      if (up) online.add(device); else online.delete(device);
      return { device, online: up };
    },
    /** Publish an action's payload on its topic. False for an unknown action, or for a device that is not online:
     *  nothing is queued for it on purpose, because a switch replayed minutes late is a real switch (the light bar
     *  only understands "flip"), and the mind is told so it can say so. */
    run(name) {
      const action = devices.actions[name];
      if (!action) return false;
      if (!online.has(action.device)) { log(`[devices] ${action.device} is offline; ${name} not sent`); return false; }
      client.publish(action.topic, action.payload);
      return true;
    },
  };
}
