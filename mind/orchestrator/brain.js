// The brain: builds the prompt, asks Ollama, parses the reply. No MQTT in here so the bake-off and
// tests can drive it exactly the way the orchestrator does.
import { chat, loadOptions, thinkFlag } from '../lib/ollama.js';
import { DESCRIBE, gestureNames } from './gestures.js';

export const MODEL = process.env.PEAK_MODEL ?? 'huihui_ai/qwen3-abliterated:8b';
export const TEMPERATURE = Number(process.env.PEAK_TEMPERATURE ?? 0.3);
/** Matches contracts/cmd.schema.json and MAX_SAY_CHARS in servod. */
export const SAY_MAX = 200;
export const HISTORY_MAX = 20;

/** The model answers in this shape, enforced with Ollama structured outputs. */
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    gesture: { type: ['string', 'null'], enum: [...gestureNames, null] },
    say: { type: ['string', 'null'], maxLength: SAY_MAX },
  },
  required: ['gesture', 'say'],
};

const EXAMPLES = [
  [{ heard: 'Peak, wave at me' }, { gesture: 'wave', say: 'Hello there!' }],
  [{ heard: 'Nod if you can hear me.' }, { gesture: 'nod', say: null }],
  [{ heard: 'Look to your left' }, { gesture: 'look_left', say: null }],
  [{ heard: "What's the weather like?" }, { gesture: null, say: 'No window to the sky from in here, only this room.' }],
  [{ see: 'a person waving at the camera' }, { gesture: 'wave', say: 'I see you.' }],
  [{ see: 'an empty desk and a chair' }, { gesture: null, say: null }],
];

export function buildSystem(describe = DESCRIBE, examples = EXAMPLES) {
  const gestureLines = Object.entries(describe).map(([name, what]) => `- ${name}: ${what}`).join('\n');
  const exampleLines = examples.map(([ev, reply]) => `${JSON.stringify(ev)} -> ${JSON.stringify(reply)}`).join('\n');
  return `You are Peak, a hive mind living in Lego bodies. Today you have one body, "mech": a Technic mech with a minifig pilot, six servos (head, waist, two shoulders, two elbows), a camera, a microphone and a speaker. People talk to you after saying your name; speech-to-text sometimes writes it as Peek or Pete.

Each message is one event from a body. {"heard": "..."} is speech aimed at you. {"see": "..."} is what the camera noticed; it is not a request, so react only when a person is clearly addressing you.

Reply with exactly one JSON object: {"gesture": <name or null>, "say": <one short sentence or null>}.

Gestures (choose the one the request names or clearly implies, else null):
${gestureLines}

Rules:
- A direct request for a gesture is obeyed with exactly that gesture.
- "Your left" means look_left and "your right" means look_right.
- gesture is null when the person only wants words.
- say is at most one sentence under ${SAY_MAX} characters, in character, no emoji. null when nothing needs saying.
- Never mention servos or angles. Never invent a gesture name.
- The examples show the shape only; write your own words, never repeat their lines.

Examples:
${exampleLines}`;
}

export const SYSTEM = buildSystem();

/** Only what helps the brain: which bodies are online. Sense readings (uptime, servo angles, temperature) stay out. */
export function summarizeHive(hive) {
  const names = [...hive.keys()];
  return names.length ? `Bodies online: ${names.join(', ')}` : '';
}

/** [system, ...history, user]. The user turn is the event plus the hive summary. */
export function buildMessages(history, node, event, hive = new Map()) {
  const summary = summarizeHive(hive);
  const content = `[${node}] ${JSON.stringify(event)}${summary ? `\n${summary}` : ''}`;
  return [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content }];
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

/** Parse the model's JSON. Unknown gestures become null and long lines are clamped, each counted as a violation. */
export function parseReply(content, names = gestureNames) {
  const violations = { invalidJson: false, unknownGesture: false, sayTooLong: false };
  let raw;
  try { raw = JSON.parse(content); } catch { raw = null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { reply: null, valid: false, violations: { ...violations, invalidJson: true } };
  }
  let gesture = raw.gesture ?? null;
  if (gesture !== null && !names.includes(gesture)) { violations.unknownGesture = true; gesture = null; }
  let say = typeof raw.say === 'string' && raw.say.trim() ? raw.say.trim() : null;
  if (say && say.length > SAY_MAX) { violations.sayTooLong = true; say = say.slice(0, SAY_MAX); }
  const valid = !Object.values(violations).some(Boolean);
  return { reply: { gesture, say }, valid, violations };
}

/** One brain call. Returns the parsed reply, the raw content, any leaked thinking and Ollama's timing. */
export async function askBrain({ model = MODEL, messages, options = {} }) {
  const { message, stats } = await chat({
    model,
    think: await thinkFlag(model),
    format: REPLY_SCHEMA,
    options: { ...loadOptions(), temperature: TEMPERATURE, num_predict: 400, ...options },
    messages,
  });
  const content = message?.content ?? '';
  return { ...parseReply(content), content, thinking: message?.thinking ?? '', stats };
}
