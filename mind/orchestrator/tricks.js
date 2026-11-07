// Tricks: named sequences the hive can play on a body: eye moves, a gesture, a line, pauses. They are data
// (tricks/tricks.yaml), so a new trick is a new entry, not new code. A second file, tricks/learned.yaml, is
// for tricks added while the mind runs: nothing writes it yet, but appendTrick() is the door for teaching by
// voice and for Lupin later. Both files pass the same check, against the body's own command contract. A step may
// also switch a device (an action from devices/devices.yaml), so a trick can turn the room's light off.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { gestureNames } from './gestures.js';
import { actionNames } from './devices.js';

export const TRICKS_PATH = new URL('../tricks/tricks.yaml', import.meta.url);
export const LEARNED_PATH = new URL('../tricks/learned.yaml', import.meta.url);
const CONTRACT = JSON.parse(readFileSync(new URL('../../contracts/cmd.schema.json', import.meta.url), 'utf8'));
const EYES = CONTRACT.$defs.eyes.properties;
const SAY_MAX = CONTRACT.oneOf.find(c => c.required.includes('say')).properties.say.maxLength;

export const MAX_STEPS = 16;
export const MAX_MS = 30000;
export const MAX_DESCRIBE = 160;
const NAME = /^[a-z][a-z0-9_]{1,23}$/;

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Why a value does not fit a piece of the contract, or null. Covers the few schema words the eyes use. */
function misfit(spec, v) {
  if (spec.enum) return spec.enum.includes(v) ? null : `must be one of ${spec.enum.join(', ')}`;
  if ('const' in spec) return v === spec.const ? null : `must be ${spec.const}`;
  if (spec.type === 'boolean') return typeof v === 'boolean' ? null : 'must be true or false';
  if (spec.type === 'integer') {
    return Number.isInteger(v) && v >= spec.minimum && v <= spec.maximum ? null : `must be a whole number from ${spec.minimum} to ${spec.maximum}`;
  }
  if (!isObject(v) || !Object.keys(v).length) return 'needs at least one key';
  for (const [k, inner] of Object.entries(v)) {
    if (!spec.properties[k]) return `has no "${k}"`;
    const bad = misfit(spec.properties[k], inner);
    if (bad) return `${k} ${bad}`;
  }
  return null;
}

function stepProblem(step, gestures, actions) {
  if (!isObject(step) || Object.keys(step).length !== 1) return 'must have exactly one of eyes, gesture, say, wait, action';
  const [[kind, v]] = Object.entries(step);
  switch (kind) {
    case 'eyes': { const bad = misfit({ properties: EYES }, v); return bad && `eyes ${bad}`; }
    case 'gesture': return gestures.includes(v) ? null : `gesture "${v}" is not in gestures.yaml`;
    case 'action': return actions.includes(v) ? null : `action "${v}" is not in devices.yaml`;
    case 'say': return typeof v === 'string' && v.trim() && v.length <= SAY_MAX ? null : `say must be 1 to ${SAY_MAX} characters`;
    case 'wait': return Number.isInteger(v) && v >= 1 && v <= MAX_MS ? null : `wait must be 1 to ${MAX_MS} ms`;
    default: return `unknown step "${kind}"`;
  }
}

/** Why a trick cannot be used, or null. */
export function trickProblem(name, trick, gestures = gestureNames, actions = actionNames) {
  if (!NAME.test(name)) return 'name must be 2 to 24 of a-z, 0-9 and _, starting with a letter';
  if (gestures.includes(name)) return 'name is already a gesture';
  if (actions.includes(name)) return 'name is already a device action';
  if (!isObject(trick)) return 'must have describe and steps';
  const { describe, steps } = trick;
  if (typeof describe !== 'string' || !describe.trim() || describe.length > MAX_DESCRIBE || describe.includes('\n')) {
    return `describe must be one line of at most ${MAX_DESCRIBE} characters`;
  }
  if (!Array.isArray(steps) || !steps.length || steps.length > MAX_STEPS) return `needs 1 to ${MAX_STEPS} steps`;
  for (const [i, step] of steps.entries()) {
    const bad = stepProblem(step, gestures, actions);
    if (bad) return `step ${i + 1}: ${bad}`;
  }
  const waits = steps.reduce((ms, s) => ms + (s.wait ?? 0), 0);
  return waits > MAX_MS ? `waits add up to more than ${MAX_MS} ms` : null;
}

function readYaml(path) {
  return existsSync(path) ? parse(readFileSync(path, 'utf8')) ?? {} : {};
}

/** { name: { describe, steps, learned } }. A bad built-in trick is our mistake and throws; a bad learned one is
 *  left out with a warning, because a mind must still start with a damaged memory. Built-ins win a name clash. */
export function loadTricks({ builtin = TRICKS_PATH, learned = LEARNED_PATH, gestures = gestureNames, actions = actionNames, warn = console.warn } = {}) {
  const tricks = {};
  for (const [name, trick] of Object.entries(readYaml(builtin))) {
    const bad = trickProblem(name, trick, gestures, actions);
    if (bad) throw new Error(`tricks.yaml: ${name}: ${bad}`);
    tricks[name] = { describe: trick.describe, steps: trick.steps, learned: false };
  }
  let remembered = {};
  try { remembered = readYaml(learned); } catch (e) { warn(`[tricks] learned.yaml unreadable, ignored: ${e.message}`); }
  for (const [name, trick] of Object.entries(isObject(remembered) ? remembered : {})) {
    const bad = name in tricks ? 'a built-in trick has that name' : trickProblem(name, trick, gestures, actions);
    if (bad) { warn(`[tricks] learned trick ${name} ignored: ${bad}`); continue; }
    tricks[name] = { describe: trick.describe, steps: trick.steps, learned: true };
  }
  return tricks;
}

/** Remember a new trick: checked, then appended to learned.yaml. Returns why not, or null when it is saved.
 *  The caller reloads with loadTricks(). */
export function appendTrick(name, describe, steps, { learned = LEARNED_PATH, builtin = TRICKS_PATH, gestures = gestureNames, actions = actionNames } = {}) {
  const bad = trickProblem(name, { describe, steps }, gestures, actions);
  if (bad) return bad;
  if (name in loadTricks({ builtin, learned, gestures, actions, warn: () => {} })) return 'a trick has that name already';
  appendFileSync(learned, stringify({ [name]: { describe, steps } }));
  return null;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Plays tricks on bodies, one per body at a time: a newer trick or a stop takes the body from the one running.
 *  `run(action)` is the device hub's; without it an action step is skipped. */
export function createTrickPlayer(client, { tricks = loadTricks(), sleep = pause, run = null } = {}) {
  const running = new Map();
  const publish = (node, cmd) => client.publish(`peak/${node}/cmd`, JSON.stringify(cmd));
  return {
    tricks,
    /** Resolves true when the trick ran to its end. `skip` leaves out step kinds, e.g. ['gesture', 'say']. */
    async play(node, name, { skip = [] } = {}) {
      const trick = tricks[name];
      if (!trick) return false;
      const turn = {};
      running.set(node, turn);
      for (const step of trick.steps) {
        if (running.get(node) !== turn) return false;
        const [[kind, value]] = Object.entries(step);
        if (kind === 'wait') await sleep(value);
        else if (skip.includes(kind)) continue;
        else if (kind === 'action') run?.(value);
        else publish(node, { [kind]: value });
      }
      if (running.get(node) !== turn) return false;
      running.delete(node);
      return true;
    },
    /** Drop whatever is playing on a body and give its eyes back to its reflexes. */
    stop(node) {
      running.delete(node);
      publish(node, { eyes: { release: true } });
    },
  };
}
