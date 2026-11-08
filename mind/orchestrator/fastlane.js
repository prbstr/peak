// Fast lane: a few exact spoken commands answered without the brain, in about a millisecond, even while the brain
// is busy with something else. Merged review plan, session 6 (8 Nov 2026).
//
// Only whole-utterance templates, never a fuzzy match, because everything here moves or switches something:
//   - stop ("stop", "rho stop", "freeze"): {"stop":true} to the body and the trick player; the spoken emergency stop
//   - a gesture by name ("wave", "nod", "look left"), an eye trick ("wink", "look sleepy", "peekaboo")
//   - the six desk-light actions ("lights off", "turn on the light", "dim the lights", "warmer")
// The wake word, a greeting before it, and "please" / "can you" / "now" around the request are stripped first.
// Anything else ("wave at the postman", "don't turn the light off", "lights off in an hour") is left to the brain.
// PEAK_FAST_LANE=0 turns it off.

export const FAST_LANE = (process.env.PEAK_FAST_LANE ?? '1') !== '0';

const WAKE = 'rho|row|roe|ro|roh|rowe|roll|bro|road'; // the sound-alikes senses/heardFilter.js wakes on
const LEAD = new RegExp(`^(?:(?:hey|hi|hello|okay|ok|yo)[\\s,!.]+)?(?:${WAKE})(?:[\\s,.!?]+|$)`, 'i');
const TAIL = new RegExp(`[\\s,]+(?:${WAKE})[\\s.!?]*$`, 'i');
const TAGS = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;
const POLITE_HEAD = /^(?:please|can you|could you|will you|would you|just|now|okay|ok)\s+/;
const POLITE_TAIL = /\s+(?:please|now|for me|thanks|thank you)$/;
/** Words that turn a command into its opposite or into something else; no template may contain one but stop's. */
export const NEGATION = /\b(?:don'?t|do not|not|never|no|leave|without|until|after|in|later|again)\b/;

/** Lower case, wake word and politeness gone, punctuation gone: "Bro, lights off please." -> "lights off". */
export function normalize(text) {
  let s = String(text).replace(TAGS, ' ').replace(/[‘’]/g, "'").trim();
  s = s.replace(LEAD, '').replace(TAIL, '');
  s = s.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let before = ''; before !== s;) {
    before = s;
    s = s.replace(POLITE_HEAD, '').replace(POLITE_TAIL, '').trim();
  }
  return s;
}

const lights = (verbs, ends) => verbs.flatMap(v => ['light', 'lights'].flatMap(l => ends.map(e => e(v, l))));
const switchPhrases = word => [
  `lights ${word}`, `light ${word}`,
  ...lights(['turn', 'switch'], [(v, l) => `${v} ${word} the ${l}`, (v, l) => `${v} the ${l} ${word}`]),
];

/** Every template, phrase -> what it does. Gestures, tricks and actions appear only when the mind has them. */
export function buildTemplates({ gestures = [], tricks = [], actions = [] } = {}) {
  const t = new Map();
  const add = (phrases, kind, name) => { for (const p of phrases) t.set(p, { kind, name }); };
  add(['stop', 'stop it', 'stop that', 'stop stop', 'freeze', 'halt', 'emergency stop'], 'stop', 'stop');
  const g = {
    wave: ['wave', 'wave at me', 'wave to me', 'wave hello'],
    nod: ['nod', 'nod your head', 'nod at me'],
    shrug: ['shrug'],
    point: ['point'],
    look_left: ['look left', 'look to the left', 'look to your left'],
    look_right: ['look right', 'look to the right', 'look to your right'],
    rest: ['rest'],
  };
  for (const [name, phrases] of Object.entries(g)) if (gestures.includes(name)) add(phrases, 'gesture', name);
  const k = {
    happy: ['look happy', 'smile'], angry: ['look angry'], sleepy: ['look sleepy'], confused: ['look confused'],
    surprised: ['look surprised'], laugh: ['laugh'], wink: ['wink', 'wink at me', 'give me a wink'],
    peekaboo: ['peekaboo', 'peek a boo', 'play peekaboo', "let's play peekaboo"],
  };
  for (const [name, phrases] of Object.entries(k)) if (tricks.includes(name)) add(phrases, 'trick', name);
  const a = {
    light_on: switchPhrases('on'),
    light_off: switchPhrases('off'),
    light_bright: ['brighter', 'lights brighter', 'light brighter', 'make it brighter', 'make the light brighter', 'make the lights brighter'],
    light_dim: ['dim the light', 'dim the lights', 'dim the lamp', 'lights dim', 'dimmer', 'dim it'],
    light_warm: ['warmer', 'warmer light', 'warm light', 'make it warmer', 'make the light warmer'],
    light_cool: ['cooler light', 'cool light', 'make the light cooler', 'make it cooler'],
  };
  for (const [name, phrases] of Object.entries(a)) if (actions.includes(name)) add(phrases, 'action', name);
  return t;
}

/** The reply the brain would have given, in its field order, so it can go into history and be scored the same way. */
export function laneReply({ kind, name }, { eyes = true, devices = true } = {}) {
  return {
    gesture: kind === 'gesture' ? name : null,
    ...(eyes ? { eyes: kind === 'trick' ? name : null } : {}),
    ...(devices ? { action: kind === 'action' ? name : null } : {}),
    say: null,
  };
}

/** match(text) -> { kind, name, phrase, reply } or null. */
export function createFastLane({ gestures = [], tricks = [], actions = [], enabled = FAST_LANE } = {}) {
  const templates = buildTemplates({ gestures, tricks, actions });
  const fields = { eyes: tricks.length > 0, devices: actions.length > 0 };
  const match = text => {
    if (!enabled || typeof text !== 'string') return null;
    const phrase = normalize(text);
    const hit = templates.get(phrase);
    if (!hit) return null;
    if (hit.kind !== 'stop' && NEGATION.test(phrase)) return null;
    return { ...hit, phrase, reply: laneReply(hit, fields) };
  };
  return { match, templates, enabled };
}
