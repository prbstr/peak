// The brain: builds the prompt, asks Ollama, parses the reply. No MQTT in here so the bake-off and
// tests can drive it exactly the way the orchestrator does.
import { chat, chatStream, loadOptions, thinkFlag } from '../lib/ollama.js';
import { DESCRIBE, gestureNames } from './gestures.js';
import { loadTricks } from './tricks.js';
import { DEVICES as KNOWN_DEVICES } from './devices.js';
import { loadExamples } from './examples.js';

export const MODEL = process.env.PEAK_MODEL ?? 'huihui_ai/qwen3-vl-abliterated:8b-instruct';
export const TEMPERATURE = Number(process.env.PEAK_TEMPERATURE ?? 0.3);
/** Gestures whose token probability is below this become null. 0 = off. Useless for Qwen3-VL (wrong answers are as
 *  confident as right ones), worth about 0.6 for the 9B, whose misses sit at 0.3-0.5 (bake-off README). */
export const MIN_CONFIDENCE = Number(process.env.PEAK_MIN_CONFIDENCE ?? 0);
/** Matches contracts/cmd.schema.json and MAX_SAY_CHARS in servod. */
export const SAY_MAX = 200;
export const HISTORY_MAX = 20;
/** With PEAK_BRAIN_EYES=1 the brain may also pick a trick for the eyes (tricks/tricks.yaml). Off by default: two
 *  versions of the eyes prompt each cost an old bake-off case (bakeoff/brain/README.md, 5 Nov 2026). Without it
 *  the prompt and the reply shape are exactly what they were before the eyes existed. */
export const TRICKS = process.env.PEAK_BRAIN_EYES === '1' ? loadTricks() : {};
export const trickNames = Object.keys(TRICKS);
/** With PEAK_BRAIN_DEVICES=1 the brain may also switch a device in the room (devices/devices.yaml): the reply gains
 *  an `action` field naming one of their actions or null. Off by default for the same reason as the eyes: a new
 *  field costs old cases until the bake-off says otherwise. */
export const DEVICES = process.env.PEAK_BRAIN_DEVICES === '1' ? KNOWN_DEVICES : { devices: {}, actions: {} };
export const actionNames = Object.keys(DEVICES.actions);

/** The model answers in this shape, enforced with Ollama structured outputs. gesture stays the first field:
 *  the orchestrator sends it to the body the moment it is complete. */
export function buildSchema(tricks = trickNames, actions = actionNames) {
  const eyes = tricks.length ? { eyes: { type: ['string', 'null'], enum: [...tricks, null] } } : {};
  const action = actions.length ? { action: { type: ['string', 'null'], enum: [...actions, null] } } : {};
  return {
    type: 'object',
    properties: {
      gesture: { type: ['string', 'null'], enum: [...gestureNames, null] },
      ...eyes,
      ...action,
      say: { type: ['string', 'null'], maxLength: SAY_MAX },
    },
    required: ['gesture', ...Object.keys(eyes), ...Object.keys(action), 'say'],
  };
}
export const REPLY_SCHEMA = buildSchema();

/** The example bank: examples/examples.yaml plus what was taught in examples/learned.yaml, [{ event, reply }]. */
export const EXAMPLES = loadExamples();

/** Whether an example belongs in the prompt: one with an eyes field only when the brain has eyes, one with an
 *  action field only when it has devices and knows that action. */
export function visibleExample({ reply }, tricks = TRICKS, devices = DEVICES) {
  const eyes = Object.keys(tricks).length > 0;
  const switches = Object.keys(devices.actions).length > 0;
  return (eyes || !('eyes' in reply)) && (!('action' in reply) || (switches && (reply.action === null || reply.action in devices.actions)));
}

/** Narrow decisions the model got wrong when left to the one wide one. Each line fixed a systematic miss in the
 *  bake-off (see LESSONS.md, lesson 3, and the README's tuning table); drop one only with the bake-off to prove it. */
export const RULES = `- A negated or cancelled request ("don't wave", "not now", "never mind", "stop") gets no gesture; never perform the gesture that was negated.
- "Stay still" or "don't move" means no gesture at all, whatever else is asked in the same breath.
- Thinking aloud ("hmm", "let me think", "uh") with no request in it: gesture null, say null.
- Greetings and goodbyes in any wording (hello, hi, cheers, see you, bye) get a wave and a short line.
- A question is answered in words. point only when asked to point or to show where something is. shrug when you do not know.
- You do not know where rooms or things are unless the camera reported them: say so or shrug, never guess a direction.
- When your answer is yes, or you agree, nod while you say it.
- Speech-to-text noise: "not" where "nod" makes sense means nod; Row, Roe or Roll where a name would stand mean Rho.
- A "sensed" event gets one short line and no gesture: with something close in front of you, an arm must not swing.`;

/** Narrow decisions about the eyes, kept apart so the prompt without eyes is untouched. */
export const EYES_RULES = `- eyes is null in most replies. Choose a name only when that look or trick is asked for, or for thanks, praise, a joke, or goodnight.
- A look or trick that is negated or cancelled ("don't look angry", "stop laughing") gets eyes null.
- Looking left or right is a gesture, never eyes. A "see" or "sensed" event gets eyes null.`;

/** Narrow decisions about devices, kept apart so the prompt without them is untouched. */
export const DEVICE_RULES = `- action is null unless the person asks for a device to change, or complains about it ("too dark", "too bright").
- A device request that is negated or cancelled ("don't turn it off", "leave the light") gets action null.
- A question about a device is answered in words with action null. A "see" or "sensed" event gets action null.`;

export function buildSystem(describe = DESCRIBE, examples = EXAMPLES, rules = RULES, tricks = TRICKS, devices = DEVICES) {
  const eyes = Object.keys(tricks).length > 0;
  const switches = Object.keys(devices.actions).length > 0;
  const gestureLines = Object.entries(describe).map(([name, what]) => `- ${name}: ${what}`).join('\n');
  const trickLines = Object.entries(tricks).map(([name, trick]) => `- ${name}: ${trick.describe}`).join('\n');
  const deviceLines = Object.entries(devices.devices)
    .map(([name, d]) => [`- ${name}: ${d.describe}`, ...d.actions.map(a => `  - ${a}: ${devices.actions[a].describe}`)].join('\n')).join('\n');
  const shown = ({ gesture, eyes: look = null, action: act = null, say }) =>
    ({ gesture, ...(eyes ? { eyes: look } : {}), ...(switches ? { action: act } : {}), say });
  const exampleLines = examples
    .filter(ex => visibleExample(ex, tricks, devices))
    .map(({ event, reply }) => `${JSON.stringify(event)} -> ${JSON.stringify(shown(reply))}`).join('\n');
  return `You are Rho, a hive mind living in Lego bodies. Today you have one body, "mech": a Technic mech with a minifig pilot, six servos (head, waist, two shoulders, two elbows), a camera, a microphone, a speaker, a motion sensor and a distance sensor facing forward. People talk to you after saying your name; speech-to-text sometimes writes it as Row, Roe or Roll.

Each message is one event from a body. {"heard": "..."} is speech aimed at you. {"see": "..."} is what the camera noticed; it is not a request, so react only when a person is clearly addressing you, and never describe the scene back; a scene with nobody addressing you gets null and null. {"sensed": "..."} is what the body's own sensors felt: movement nearby, or something close in front of it. Nobody said it, so it is not a request either.

Reply with exactly one JSON object: {"gesture": <name or null>, ${eyes ? '"eyes": <name or null>, ' : ''}${switches ? '"action": <name or null>, ' : ''}"say": <one short sentence or null>}.

Gestures (choose the one the request names or clearly implies, else null):
${gestureLines}
${eyes ? `\nEyes (your face is two eyes on a small screen; a look or a trick for them, else null):\n${trickLines}\n` : ''}${switches ? `\nDevices (things in the room you can switch; the action the request names or clearly implies, else null):\n${deviceLines}\n` : ''}
Rules:
- A direct request for a gesture is obeyed with exactly that gesture.
- "Your left" means look_left and "your right" means look_right.
- gesture is null when the person only wants words.
- say is at most one sentence under ${SAY_MAX} characters, in character, no emoji. null when nothing needs saying.
- Never mention servos or angles. Never invent a gesture name.
- The examples show the shape only; write your own words, never repeat their lines.
${rules}${eyes ? `\n${EYES_RULES}` : ''}${switches ? `\n${DEVICE_RULES}` : ''}

Examples:
${exampleLines}`;
}

export const SYSTEM = buildSystem();

/** Only what helps the brain: which bodies are online. Sense readings (uptime, servo angles, temperature) stay out. */
export function summarizeHive(hive) {
  const names = [...hive.keys()];
  return names.length ? `Bodies online: ${names.join(', ')}` : '';
}

/** How long what the desk camera saw stays worth telling the brain. */
export const DESK_FRESH_MS = Number(process.env.PEAK_DESK_FRESH_S ?? 30) * 1000;

/** What the desk camera last saw, as a line for something heard: "Your desk camera, 4 s ago: ...". Only for speech
 *  (it answers "what am I holding?"), only while fresh, and empty otherwise, so every other prompt is unchanged. */
export function deskLine(event, seen, now = Date.now(), fresh = DESK_FRESH_MS) {
  if (!seen || !('heard' in event)) return '';
  const age = now - seen.at;
  if (age < 0 || age > fresh) return '';
  return `Your desk camera, ${Math.round(age / 1000)} s ago: ${seen.text}`;
}

/** [system, ...history, user]. The user turn is the event, what the desk camera saw if it matters, and the hive
 *  summary. `examples` is the subset of the bank to show (pickExamples in examples.js); the whole bank gives the
 *  prompt the mind has always sent. */
export function buildMessages(history, node, event, hive = new Map(), seen = null, now = Date.now(), examples = EXAMPLES) {
  const lines = [`[${node}] ${JSON.stringify(event)}`, deskLine(event, seen, now), summarizeHive(hive)].filter(Boolean);
  const system = examples === EXAMPLES ? SYSTEM : buildSystem(DESCRIBE, examples);
  return [{ role: 'system', content: system }, ...history, { role: 'user', content: lines.join('\n') }];
}

/** Drop whole turns from the front so a user turn is never separated from its answer. */
export function trimHistory(history, max = HISTORY_MAX) {
  while (history.length > max) {
    const next = history.findIndex((m, i) => i > 0 && m.role === 'user');
    if (next === -1) break;
    history.splice(0, next);
  }
  return history;
}

/** Parse the model's JSON. Unknown gestures, tricks and actions become null and long lines are clamped, each
 *  counted as a violation. */
export function parseReply(content, names = gestureNames, tricks = trickNames, actions = actionNames) {
  const violations = { invalidJson: false, unknownGesture: false, unknownEyes: false, unknownAction: false, sayTooLong: false };
  let raw;
  try { raw = JSON.parse(content); } catch { raw = null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { reply: null, valid: false, violations: { ...violations, invalidJson: true } };
  }
  let gesture = raw.gesture ?? null;
  if (gesture !== null && !names.includes(gesture)) { violations.unknownGesture = true; gesture = null; }
  let eyes = raw.eyes ?? null;
  if (eyes !== null && !tricks.includes(eyes)) { violations.unknownEyes = true; eyes = null; }
  let action = raw.action ?? null;
  if (action !== null && !actions.includes(action)) { violations.unknownAction = true; action = null; }
  let say = typeof raw.say === 'string' && raw.say.trim() ? raw.say.trim() : null;
  if (say && say.length > SAY_MAX) { violations.sayTooLong = true; say = say.slice(0, SAY_MAX); }
  const valid = !Object.values(violations).some(Boolean);
  return { reply: { gesture, eyes, action, say }, valid, violations };
}

/** The first field of the reply, as soon as it is complete in a partial JSON string: {"gesture": "wave" or null.
 *  Returns undefined until it can be read. */
export function earlyGesture(partial) {
  const m = /^\s*\{\s*"gesture"\s*:\s*(null|"([^"]*)")\s*[,}]/.exec(partial);
  if (!m) return undefined;
  return m[2] ?? null;
}

/** Joint probability of the tokens that spell the gesture value, from Ollama's logprobs. null when unavailable. */
export function gestureConfidence(content, logprobs) {
  if (!logprobs?.length) return null;
  const m = /"gesture"\s*:\s*(null|"[^"]*")/.exec(content);
  if (!m) return null;
  let start = m.index + m[0].length - m[1].length, end = start + m[1].length;
  if (m[1] !== 'null') { start += 1; end -= 1; }
  let pos = 0, sum = 0, hit = false;
  for (const t of logprobs) {
    const tok = t.token ?? '';
    const a = pos, b = pos + tok.length;
    pos = b;
    if (b <= start || a >= end) continue;
    sum += t.logprob ?? 0;
    hit = true;
  }
  return hit ? Math.exp(sum) : null;
}

/** One brain call. Returns the parsed reply, the raw content, any leaked thinking, Ollama's timing, and the
 *  gesture's confidence. With onGesture(gesture, ms) the reply is streamed and the callback fires the moment the
 *  gesture field is complete, before the spoken line is generated. */
export async function askBrain({ model = MODEL, messages, options = {}, onGesture }) {
  const body = {
    model,
    think: await thinkFlag(model),
    format: REPLY_SCHEMA,
    logprobs: true,
    options: { ...loadOptions(), temperature: TEMPERATURE, num_predict: 400, ...options },
    messages,
  };
  let gestureMs = null, fired = false;
  const r = onGesture
    ? await chatStream(body, (partial, ms) => {
      if (fired) return;
      const g = earlyGesture(partial);
      if (g === undefined) return;
      fired = true; gestureMs = ms;
      onGesture(g, ms);
    })
    : await chat(body);
  const content = r.message?.content ?? '';
  const parsed = parseReply(content);
  const confidence = gestureConfidence(content, r.logprobs);
  let vetoed = false;
  if (parsed.reply?.gesture && confidence != null && confidence < MIN_CONFIDENCE) { parsed.reply.gesture = null; vetoed = true; }
  return { ...parsed, content, thinking: r.message?.thinking ?? '', stats: r.stats, confidence, gestureMs, vetoed };
}
