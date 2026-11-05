// The brain: builds the prompt, asks Ollama, parses the reply. No MQTT in here so the bake-off and
// tests can drive it exactly the way the orchestrator does.
import { chat, chatStream, loadOptions, thinkFlag } from '../lib/ollama.js';
import { DESCRIBE, gestureNames } from './gestures.js';

export const MODEL = process.env.PEAK_MODEL ?? 'huihui_ai/qwen3-vl-abliterated:8b-instruct';
export const TEMPERATURE = Number(process.env.PEAK_TEMPERATURE ?? 0.3);
/** Gestures whose token probability is below this become null. 0 = off. Useless for Qwen3-VL (wrong answers are as
 *  confident as right ones), worth about 0.6 for the 9B, whose misses sit at 0.3-0.5 (bake-off README). */
export const MIN_CONFIDENCE = Number(process.env.PEAK_MIN_CONFIDENCE ?? 0);
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
  [{ heard: 'Rho, wave at me' }, { gesture: 'wave', say: 'Hello there!' }],
  [{ heard: 'Nod if you can hear me.' }, { gesture: 'nod', say: null }],
  [{ heard: 'Look to your left' }, { gesture: 'look_left', say: null }],
  [{ heard: "What's the weather like?" }, { gesture: null, say: 'No window to the sky from in here, only this room.' }],
  [{ heard: 'Did you hear that?' }, { gesture: 'nod', say: 'Loud and clear.' }],
  [{ see: 'a person waving at the camera' }, { gesture: 'wave', say: 'I see you.' }],
  [{ see: 'an empty desk and a chair' }, { gesture: null, say: null }],
  [{ see: 'a person walking past, not looking at the camera' }, { gesture: null, say: null }],
  [{ sensed: 'movement nearby after a quiet spell' }, { gesture: null, say: 'Is someone there?' }],
  [{ sensed: 'something came close, 8 cm in front of you' }, { gesture: null, say: 'Careful, that is close.' }],
];

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

export function buildSystem(describe = DESCRIBE, examples = EXAMPLES, rules = RULES) {
  const gestureLines = Object.entries(describe).map(([name, what]) => `- ${name}: ${what}`).join('\n');
  const exampleLines = examples.map(([ev, reply]) => `${JSON.stringify(ev)} -> ${JSON.stringify(reply)}`).join('\n');
  return `You are Rho, a hive mind living in Lego bodies. Today you have one body, "mech": a Technic mech with a minifig pilot, six servos (head, waist, two shoulders, two elbows), a camera, a microphone, a speaker, a motion sensor and a distance sensor facing forward. People talk to you after saying your name; speech-to-text sometimes writes it as Row, Roe or Roll.

Each message is one event from a body. {"heard": "..."} is speech aimed at you. {"see": "..."} is what the camera noticed; it is not a request, so react only when a person is clearly addressing you, and never describe the scene back; a scene with nobody addressing you gets null and null. {"sensed": "..."} is what the body's own sensors felt: movement nearby, or something close in front of it. Nobody said it, so it is not a request either.

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
${rules}

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
