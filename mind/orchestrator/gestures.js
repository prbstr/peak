// Gesture names come from node/gestures.yaml, the Pi's motion contract. The meaning of each gesture, as
// told to the brain, lives here: servod iterates each gesture's value as a keyframe list, so a `describe:`
// key in the YAML would change its shape and force a Pi redeploy for a wording change.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export const GESTURES_PATH = new URL('../../node/gestures.yaml', import.meta.url);

export const DESCRIBE = {
  wave: 'raise the right arm and wave it. For greetings, goodbyes, or when asked to wave.',
  nod: 'tip the head down and up. For yes, agreement, "can you hear me", or when asked to nod.',
  shrug: 'lift both shoulders. For "I don\'t know", puzzlement, or a question you cannot answer.',
  point: 'extend the right arm forward. For "point at", "show me", "where is", or when asked to point.',
  look_left: 'turn the head to your own left. For "look left", "look to your left", or something on your left.',
  look_right: 'turn the head to your own right. For "look right", "look to your right", or something on your right.',
  rest: 'return every servo to neutral. For "relax", "stand down", "rest", "go back to normal".',
};

/** Names from the YAML, checked both ways against DESCRIBE so the prompt never lists a gesture the Pi lacks. */
export function loadGestureNames(path = GESTURES_PATH, describe = DESCRIBE) {
  const names = Object.keys(parse(readFileSync(path, 'utf8')) ?? {});
  const undescribed = names.filter(n => !(n in describe));
  const orphaned = Object.keys(describe).filter(n => !names.includes(n));
  if (undescribed.length || orphaned.length) {
    throw new Error(`gestures out of sync: missing descriptions ${JSON.stringify(undescribed)}, not in gestures.yaml ${JSON.stringify(orphaned)}`);
  }
  return names;
}

export const gestureNames = loadGestureNames();
