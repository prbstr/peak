// peak mind — orchestrator
// Listens to every node's senses, asks the local model (Ollama) what the hive should do,
// and publishes commands back. Gestures are named, never raw servo angles.
// The prompt, schema and Ollama call live in brain.js so tests and the bake-off share them.
import 'dotenv/config';
import mqtt from 'mqtt';
import { runTool } from './tools.js';
import { MODEL, askBrain, buildMessages, trimHistory } from './brain.js';
import { formatStats } from '../lib/ollama.js';

const BROKER = process.env.PEAK_BROKER ?? 'mqtt://localhost:1883';

const client = mqtt.connect(BROKER);

/** Latest sense reading per node that is online: { mech: {...}, rover: {...} } */
const hive = new Map();
/** Rolling conversation so the character stays coherent */
const history = [];
/** One event thinks at a time. One more may wait; a newer event replaces it, because the
 *  latest thing heard or seen is the one worth answering, not a backlog. */
let thinking = false;
let waiting = null;

client.on('connect', () => {
  console.log(`[mind] connected to ${BROKER}, brain: ${MODEL}`);
  client.subscribe(['peak/+/sense', 'peak/+/event', 'peak/+/status']);
});

client.on('message', (topic, payload) => {
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
  if (kind === 'sense') {
    hive.set(node, { ...data, at: Date.now() });
    return;
  }
  // events are things worth thinking about: a face seen, a word heard, a bump
  if (kind === 'event') {
    if (waiting) console.log('[mind] busy, replaced the waiting event');
    waiting = { node, data };
    drain();
  }
});

async function drain() {
  if (thinking || !waiting) return;
  thinking = true;
  const { node, data } = waiting;
  waiting = null;
  try {
    await think(node, data);
  } catch (e) {
    console.error('[mind] think failed:', e.message);
  } finally {
    thinking = false;
    drain();
  }
}

async function think(node, event) {
  const messages = buildMessages(history, node, event, hive);
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
  history.push({ role: 'assistant', content });
  console.log(`[mind] brain ${formatStats(stats)} gesture at ${gestureMs}ms, confidence ${confidence?.toFixed(2) ?? '-'}`);
  // a load after the first call means Ollama evicted the brain (another model took the slot)
  if (stats.loadMs > 1000) console.warn('[mind] brain was reloaded (evicted?)');
  if (!reply) return console.error('[mind] unparseable reply:', content);

  // the grammar makes the early gesture and the parsed one identical; this is the belt to that brace
  if (reply.gesture && reply.gesture !== early) await runTool(client, node, 'gesture', { name: reply.gesture });
  if (reply.say) await runTool(client, node, 'say', { text: reply.say });
  const text = [reply.gesture && `*${reply.gesture}*`, reply.say].filter(Boolean).join(' ');
  if (text) client.publish('peak/brain/intent', JSON.stringify({ node, text, at: Date.now() }));
}

function safeJson(buf) {
  try { return JSON.parse(buf.toString()); } catch { return null; }
}
