// The example bank: the "{event} -> {reply}" lines the brain's prompt shows. Built-ins live in examples/examples.yaml;
// what Rho is taught is appended to examples/learned.yaml (npm run teach now, by voice later) and is picked up the
// moment the file changes, with no restart. Both pass the same check as the brain's own reply: a known gesture, trick
// and action, a line under the Pi's limit.
//
// With PEAK_EXAMPLES_K unset or 0 every example goes in the prompt, as it always has. With K > 0 only the K nearest
// to the event go in, same kind of event first (heard, see, sensed): by embedding (PEAK_EXAMPLES_PICK=embed, the
// default, qwen3-embedding:0.6b through Ollama) or by word overlap (lexical), which is also what happens when the
// embedding call fails or takes longer than PEAK_EMBED_TIMEOUT_MS, so a slow Ollama never costs an event.
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { gestureNames } from './gestures.js';
import { actionNames } from './devices.js';
import { loadTricks } from './tricks.js';
import { embed as ollamaEmbed } from '../lib/ollama.js';

export const EXAMPLES_PATH = new URL('../examples/examples.yaml', import.meta.url);
export const LEARNED_PATH = new URL('../examples/learned.yaml', import.meta.url);
export const K = Number(process.env.PEAK_EXAMPLES_K ?? 0);
export const PICK = process.env.PEAK_EXAMPLES_PICK ?? 'embed';
export const EMBED_MODEL = process.env.PEAK_EMBED_MODEL ?? 'qwen3-embedding:0.6b';
export const EMBED_TIMEOUT_MS = Number(process.env.PEAK_EMBED_TIMEOUT_MS ?? 400);
export const KINDS = ['heard', 'see', 'sensed'];
export const EVENT_MAX = 200;
const CONTRACT = JSON.parse(readFileSync(new URL('../../contracts/cmd.schema.json', import.meta.url), 'utf8'));
export const SAY_MAX = CONTRACT.oneOf.find(c => c.required.includes('say')).properties.say.maxLength;

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const oneLine = (s, max) => typeof s === 'string' && s.trim() && s.length <= max && !s.includes('\n');

/** Which of heard, see or sensed an event is, or null. */
export const kindOf = event => (isObject(event) && KINDS.find(k => k in event)) || null;

/** The text an example or event is matched on: "heard: Rho, wave at me". */
export const textOf = event => {
  const kind = kindOf(event);
  return kind ? `${kind}: ${event[kind]}` : JSON.stringify(event);
};

/** Why an example does not fit, or null. `reply` may leave eyes and action out (shown whatever the brain can do)
 *  or say null (teaches "nothing there"); gesture and say are always present. */
export function exampleProblem(example, { gestures = gestureNames, tricks = trickNames(), actions = actionNames } = {}) {
  if (!isObject(example)) return 'must be a map with event and reply';
  const { event, reply } = example;
  if (!isObject(event) || Object.keys(event).length !== 1) return `event must have exactly one of ${KINDS.join(', ')}`;
  const kind = kindOf(event);
  if (!kind) return `event must be one of ${KINDS.join(', ')}`;
  if (!oneLine(event[kind], EVENT_MAX)) return `${kind} must be one line of at most ${EVENT_MAX} characters`;
  if (!isObject(reply)) return 'reply must be a map';
  const extra = Object.keys(reply).filter(k => !['gesture', 'eyes', 'action', 'say'].includes(k));
  if (extra.length) return `reply has unknown fields: ${extra.join(', ')}`;
  if (!('gesture' in reply) || !('say' in reply)) return 'reply needs gesture and say (null is fine)';
  if (reply.gesture !== null && !gestures.includes(reply.gesture)) return `gesture must be one of ${gestures.join(', ')} or null`;
  if ('eyes' in reply && reply.eyes !== null && !tricks.includes(reply.eyes)) return `eyes must be one of ${tricks.join(', ')} or null`;
  if ('action' in reply && reply.action !== null && !actions.includes(reply.action)) return `action must be one of ${actions.join(', ')} or null`;
  if (reply.say !== null && !oneLine(reply.say, SAY_MAX)) return `say must be one line of at most ${SAY_MAX} characters, or null`;
  return null;
}

let tricksCache = null;
function trickNames() {
  tricksCache ??= Object.keys(loadTricks({ warn: () => {} }));
  return tricksCache;
}

function readYaml(path) {
  return existsSync(path) ? parse(readFileSync(path, 'utf8')) ?? [] : [];
}

/** [{ event, reply, learned, taught, note }]. A bad built-in example is our mistake and throws; a bad taught one is
 *  left out with a warning, because the mind must still start with a damaged memory. */
export function loadExamples({ builtin = EXAMPLES_PATH, learned = LEARNED_PATH, warn = console.warn, ...names } = {}) {
  const out = [];
  const built = readYaml(builtin);
  if (!Array.isArray(built)) throw new Error('examples.yaml: must be a list');
  built.forEach((ex, i) => {
    const bad = exampleProblem(ex, names);
    if (bad) throw new Error(`examples.yaml: example ${i + 1}: ${bad}`);
    out.push({ event: ex.event, reply: ex.reply, learned: false });
  });
  let taught = [];
  try { taught = readYaml(learned); } catch (e) { warn(`[examples] learned.yaml unreadable, ignored: ${e.message}`); }
  (Array.isArray(taught) ? taught : []).forEach((ex, i) => {
    const bad = exampleProblem(ex, names);
    if (bad) { warn(`[examples] learned example ${i + 1} ignored: ${bad}`); return; }
    out.push({ event: ex.event, reply: ex.reply, learned: true, taught: ex.taught ?? null, note: ex.note ?? null });
  });
  return out;
}

/** Remember an example: checked, then appended to learned.yaml. Returns why not, or null when it is saved. The same
 *  event text taught twice is refused: edit learned.yaml to change a lesson. */
export function appendExample(event, reply, { note = null, learned = LEARNED_PATH, builtin = EXAMPLES_PATH, now = () => new Date(), ...names } = {}) {
  const bad = exampleProblem({ event, reply }, names);
  if (bad) return bad;
  const known = loadExamples({ builtin, learned, warn: () => {}, ...names });
  const text = textOf(event);
  if (known.some(ex => textOf(ex.event) === text)) return `already in the bank: ${text}`;
  const entry = { event, reply, taught: now().toISOString().slice(0, 19) + 'Z', ...(note ? { note } : {}) };
  appendFileSync(learned, stringify([entry]));
  return null;
}

const STOP = new Set(['a', 'an', 'the', 'to', 'me', 'you', 'your', 'it', 'is', 'at', 'on', 'in', 'and', 'of', 'i', 'my', 'that', 'this', 'please', 'rho', 'row', 'roe', 'roll']);
export const words = s => new Set(s.toLowerCase().replace(/^(heard|see|sensed):\s*/, '').split(/[^a-z']+/).filter(w => w && !STOP.has(w)));

/** Word overlap (Jaccard) between two texts, 0 to 1. No model, no network. */
export function lexicalScore(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** The k best examples for an event, in bank order: same kind of event first, then by score, then bank order. */
export function nearest(examples, event, scores, k) {
  const kind = kindOf(event);
  const order = examples.map((ex, i) => i)
    .sort((i, j) => (Number(kindOf(examples[j].event) === kind) - Number(kindOf(examples[i].event) === kind)) || (scores[j] - scores[i]) || (i - j));
  return order.slice(0, k).sort((a, b) => a - b).map(i => examples[i]);
}

/** A bank that reloads learned.yaml when it changes and remembers the vectors it has computed. `embed(texts,
 *  { timeoutMs })` returns one vector per text; the default goes to Ollama. The first call loads the embedding model
 *  (0.8 s measured), longer than a pick may wait, and an aborted call stops the load, so warm() embeds the whole
 *  bank with no timeout: at start-up, and again in the background after any pick that had to fall back. */
export function createBank({ builtin = EXAMPLES_PATH, learned = LEARNED_PATH, embed = defaultEmbed, warn = console.warn, ...names } = {}) {
  let examples = null, stamp = null;
  const vectors = new Map();
  const mtime = () => (existsSync(learned) ? statSync(learned).mtimeMs : 0);
  const reload = () => {
    const m = mtime();
    if (examples && m === stamp) return examples;
    examples = loadExamples({ builtin, learned, warn, ...names });
    stamp = m;
    return examples;
  };
  let warming = null;
  function warm() {
    if (warming) return warming;
    const missing = [...new Set(reload().map(ex => textOf(ex.event)))].filter(t => !vectors.has(t));
    if (!missing.length) return Promise.resolve();
    warming = embed(missing, { timeoutMs: 0 })
      .then(vs => { if (vs.length === missing.length) missing.forEach((t, i) => vectors.set(t, vs[i])); })
      .catch(e => warn(`[examples] embedding the bank failed (${e.message})`))
      .finally(() => { warming = null; });
    return warming;
  }
  async function pick(event, { k = K, pick = PICK, filter = () => true } = {}) {
    const all = reload().filter(ex => filter(ex));
    if (!k || k >= all.length) return { examples: all, how: 'all', ms: 0 };
    const t0 = performance.now();
    const text = textOf(event);
    const texts = all.map(ex => textOf(ex.event));
    let scores = null, how = 'lexical';
    if (pick === 'embed') {
      try {
        const missing = [text, ...texts].filter((t, i, a) => !vectors.has(t) && a.indexOf(t) === i);
        if (missing.length) {
          const vs = await embed(missing, { timeoutMs: EMBED_TIMEOUT_MS });
          if (vs.length !== missing.length) throw new Error(`got ${vs.length} vectors for ${missing.length} texts`);
          missing.forEach((t, i) => vectors.set(t, vs[i]));
        }
        const q = vectors.get(text);
        scores = texts.map(t => cosine(q, vectors.get(t)));
        how = 'embed';
      } catch (e) {
        warn(`[examples] embedding failed (${e.message}), picked by words`);
        warm();
      }
    }
    scores ??= texts.map(t => lexicalScore(text, t));
    return { examples: nearest(all, event, scores, k), how, ms: Math.round(performance.now() - t0) };
  }
  return { get examples() { return reload(); }, pick, warm, vectors };
}

async function defaultEmbed(texts, { timeoutMs = EMBED_TIMEOUT_MS } = {}) {
  return ollamaEmbed({ model: EMBED_MODEL, input: texts, signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined });
}

export const bank = createBank();
/** The examples for this event: all of them with K=0, else the K nearest. { examples, how: all|embed|lexical, ms } */
export const pickExamples = (event, opts) => bank.pick(event, opts);
/** Embed the whole bank now (no timeout), so the first event does not wait for the embedding model to load. */
export const warmExamples = () => bank.warm();
