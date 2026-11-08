// peak mind — orchestrator
// Listens to every node's senses, asks the local model (Ollama) what the hive should do,
// and publishes commands back. Gestures are named, never raw servo angles; the eyes are moved by named tricks.
// The prompt, schema and Ollama call live in brain.js so tests and the bake-off share them.
import 'dotenv/config';
import { createHash } from 'node:crypto';
import mqtt from 'mqtt';
import { runTool } from './tools.js';
import { MODEL, TEMPERATURE, TRICKS, DEVICES, askBrain, buildMessages, trimHistory, visibleExample } from './brain.js';
import { K as EXAMPLES_K, PICK as EXAMPLES_PICK, pickExamples, warmExamples } from './examples.js';
import { createTrickPlayer } from './tricks.js';
import { createDeviceHub } from './devices.js';
import { KEEP_ALIVE, OLLAMA, formatStats, loadOptions } from '../lib/ollama.js';

const BROKER = process.env.PEAK_BROKER ?? 'mqtt://localhost:1883';

/** The mind's own presence, like a body's: retained online on connect, offline by the broker's Last Will. */
const STATUS_TOPIC = 'peak/mind/mind/status';
const client = mqtt.connect(BROKER, { will: { topic: STATUS_TOPIC, payload: 'offline', retain: true, qos: 1 } });
/** Devices in the room (the desk light): the brain's `action` field and a trick's action step go through here. */
const hub = createDeviceHub(client);
const player = createTrickPlayer(client, { tricks: TRICKS, run: name => hub.run(name) });

// with the bank picking by embedding, load that model now rather than on the first event
if (EXAMPLES_K > 0 && EXAMPLES_PICK === 'embed') warmExamples().then(() => console.log('[mind] example bank embedded'));

/** Latest sense reading per node that is online: { mech: {...}, rover: {...} } */
const hive = new Map();
/** Latest {"doing"} per node from the desk camera: { text, at }. Added to the next heard event while fresh. */
const desk = new Map();
/** Rolling conversation so the character stays coherent */
const history = [];
/** One event thinks at a time. One more may wait; a newer event replaces it, because the
 *  latest thing heard or seen is the one worth answering, not a backlog. */
let thinking = false;
let waiting = null;

// What this mind is really running with, so a log answers "was devices on?" without guessing at .env.
console.log(`[mind] settings: eyes ${Object.keys(TRICKS).length ? 'on' : 'off'}, devices ${Object.keys(DEVICES.actions).length ? 'on' : 'off'}, `
  + `examples_k ${EXAMPLES_K}${EXAMPLES_K > 0 ? ` (${EXAMPLES_PICK})` : ' (all)'}, temperature ${TEMPERATURE}, keep_alive ${KEEP_ALIVE}, `
  + `num_ctx ${loadOptions().num_ctx}, ollama ${OLLAMA}, vision model ${process.env.PEAK_VISION_MODEL ?? '(vision.js default)'}`);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { console.log(`[mind] exiting on ${sig}`); process.exit(0); });
process.on('exit', code => console.log(`[mind] exited (code ${code})`));

client.on('connect', () => {
  console.log(`[mind] connected to ${BROKER}, brain: ${MODEL}`);
  client.publish(STATUS_TOPIC, 'online', { retain: true, qos: 1 });
  client.subscribe(['peak/+/sense', 'peak/+/event', 'peak/+/status', 'peak/+/cmd', ...hub.statusTopics]);
});

client.on('message', (topic, payload) => {
  const device = hub.status(topic, payload);
  if (device) return console.log(`[mind] device ${device.device} is ${device.online ? 'online' : 'offline'}`);
  const [, node, kind] = topic.split('/');
  if (kind === 'status') {
    // retained, and set to offline by the broker's Last Will when a body drops
    const online = payload.toString() === 'online';
    console.log(`[mind] ${node} is ${online ? 'online' : 'offline'}`);
    if (!online) hive.delete(node);
    return;
  }
  const data = safeJson(payload);
  if (!data) return;
  if (kind === 'cmd') {
    // commands are ours, except an emergency stop from anyone: the trick in flight must not carry on over it
    if (data.stop) player.stop(node);
    return;
  }
  if (kind === 'sense') {
    hive.set(node, { ...data, at: Date.now() });
    return;
  }
  // what the desk camera sees the hands doing is context, not something to answer: kept for the next thing heard
  if (kind === 'event' && typeof data.doing === 'string') {
    desk.set(node, { text: data.doing, at: Date.now() });
    return console.log(`[mind] desk: ${data.doing}`);
  }
  // events are things worth thinking about: a face seen, a word heard, a bump
  // `at` is when the sense published it: kept for timing (and the age rails to come), never shown to the brain,
  // so the prompt is exactly what it was before events carried a time.
  if (kind === 'event') {
    const { at, ...event } = data;
    if (waiting) console.log(`[mind] busy, replaced the waiting event${perfKind(waiting.event)}`);
    waiting = { node, event, at: Number.isFinite(at) ? at : null, recv: Date.now() };
    drain();
  }
});

async function drain() {
  if (thinking || !waiting) return;
  thinking = true;
  const job = waiting;
  waiting = null;
  try {
    await think(job.node, job.event, job);
  } catch (e) {
    console.error('[mind] think failed:', e.message);
  } finally {
    thinking = false;
    drain();
  }
}

async function think(node, event, { at = null, recv = Date.now() } = {}) {
  const t = { start: Date.now() };
  // the examples for this event: the whole bank, or the nearest few (PEAK_EXAMPLES_K in .env; examples.js)
  const picked = await pickExamples(event, { filter: visibleExample });
  const messages = buildMessages(history, node, event, hive, desk.get(node), Date.now(), picked.examples);
  t.brain = Date.now();
  history.push(messages.at(-1));
  trimHistory(history);

  // The gesture is the first field of the reply, so it goes to the body as soon as it is complete, while the
  // spoken line is still being generated (about half the reply time; see LESSONS.md, lesson 1).
  let early = null;
  const { reply, content, stats, confidence, gestureMs } = await askBrain({
    messages,
    onGesture: (gesture, ms) => {
      early = gesture;
      if (gesture) runTool(client, node, 'gesture', { name: gesture });
      console.log(`[mind] gesture ${gesture} at ${ms}ms`);
    },
  });
  t.brainEnd = Date.now();
  history.push({ role: 'assistant', content });
  console.log(`[mind] brain ${formatStats(stats)} gesture at ${gestureMs}ms, confidence ${confidence?.toFixed(2) ?? '-'}, examples ${picked.examples.length} ${picked.how}${picked.ms ? ` ${picked.ms}ms` : ''}`);
  // a load after the first call means Ollama evicted the brain (another model took the slot)
  if (stats.loadMs > 1000) console.warn('[mind] brain was reloaded (evicted?)');
  if (!reply) return console.error('[mind] unparseable reply:', content);

  // the grammar makes the early gesture and the parsed one identical; this is the belt to that brace
  if (reply.gesture && reply.gesture !== early) await runTool(client, node, 'gesture', { name: reply.gesture });
  if (reply.say) await runTool(client, node, 'say', { text: reply.say });
  // a device action is one publish on the device's own topic; the parsed reply guarantees the name
  if (reply.action && !hub.run(reply.action)) console.warn(`[mind] no such action ${reply.action}`);
  // A trick may bring its own gesture and line. The reply's win, and with something close in front of the body
  // (a sensed event) no arm swings at all. It plays on its own time; the next event does not wait for it.
  if (reply.eyes) {
    const skip = [(reply.gesture || 'sensed' in event) && 'gesture', reply.say && 'say'].filter(Boolean);
    player.play(node, reply.eyes, { skip }).catch(e => console.error('[mind] trick failed:', e.message));
  }
  const text = [reply.gesture && `*${reply.gesture}*`, reply.eyes && `(${reply.eyes})`, reply.action && `[${reply.action}]`, reply.say].filter(Boolean).join(' ');
  if (text) client.publish('peak/brain/intent', JSON.stringify({ node, text, at: Date.now() }));
  t.done = Date.now();
  logPerf({ event, at, recv, t, stats, gestureMs, messages, content });
}

/** What the brain was last sent plus its answer: the prefix Ollama's prompt cache holds after that call. */
let lastPrefix = null;

const perfKind = event => (event ? ` ${['heard', 'see', 'sensed'].find(k => k in event) ?? 'other'}` : '');
const shortHash = s => createHash('sha1').update(s).digest('hex').slice(0, 8);

/** One line per answered event, read by scripts/perf.js (npm run perf). Milliseconds:
 *    wire    sense published -> mind received (needs `at`, so absent for a hand mosquitto_pub)
 *    queue   received -> thinking started (waiting behind the event before it)
 *    pick    choosing examples          gesture  brain start -> gesture field complete
 *    brain   the whole brain call       after    brain end -> every command published
 *    total   sense published (or received) -> done
 *  plus Ollama's own numbers: prompt tokens and prompt-eval ms (the cache tells: ~150 ms hit, ~2 s miss), load ms,
 *  output tokens; hist = history messages sent; sys = short hash of the system prompt; prefix = kept when this request
 *  begins with exactly the last request and its answer (what the cache can reuse), cut when trimming or anything
 *  else changed it, first for the first call. */
function logPerf({ event, at, recv, t, stats, gestureMs, messages, content }) {
  const before = JSON.stringify(messages.slice(0, -1));
  const prefix = lastPrefix === null ? 'first' : before === lastPrefix ? 'kept' : 'cut';
  lastPrefix = JSON.stringify([...messages, { role: 'assistant', content }]);
  const f = {
    kind: perfKind(event).trim(),
    wire: at != null ? recv - at : null,
    queue: t.start - recv,
    pick: t.brain - t.start,
    gesture: gestureMs,
    brain: t.brainEnd - t.brain,
    after: t.done - t.brainEnd,
    total: t.done - (at ?? recv),
    prompt_tok: stats.promptTokens,
    prompt_ms: stats.promptMs,
    load_ms: stats.loadMs,
    out_tok: stats.evalTokens,
    hist: messages.length - 2,
    sys: shortHash(messages[0].content),
    prefix,
  };
  console.log(`[perf] ${Object.entries(f).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(' ')}`);
}

function safeJson(buf) {
  try { return JSON.parse(buf.toString()); } catch { return null; }
}
