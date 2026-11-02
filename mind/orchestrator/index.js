// peak mind — orchestrator
// Listens to every node's senses, asks the local model (Ollama) what the hive should do,
// and publishes commands back. Gestures are named, never raw servo angles.
import 'dotenv/config';
import mqtt from 'mqtt';
import { tools, runTool } from './tools.js';

const BROKER = process.env.PEAK_BROKER ?? 'mqtt://localhost:1883';
const OLLAMA = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const MODEL = process.env.PEAK_MODEL ?? 'richardyoung/qwen3-14b-abliterated:q4_K_M';

const client = mqtt.connect(BROKER);

/** This model's template has no native tool calling, so it answers in a JSON shape we enforce
 *  with Ollama structured outputs, and we turn the fields into the same tool calls as before. */
const gestureNames = tools.find(t => t.name === 'gesture').input_schema.properties.name.enum;
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    gesture: { type: ['string', 'null'], enum: [...gestureNames, null] },
    say: { type: ['string', 'null'] },
  },
  required: ['gesture', 'say'],
};

/** Latest sense reading per node: { mech: {...}, rover: {...} } */
const hive = new Map();
/** Rolling conversation so the character stays coherent */
const history = [];
/** Events are handled one at a time so replies never interleave */
let queue = Promise.resolve();
let pending = 0;
const MAX_PENDING = 2; // senses can outpace a local model; drop events rather than fall minutes behind

const SYSTEM = `You are Peak, a hive mind inhabiting Lego bodies. Right now you have one body: a Technic mech
with a minifig pilot. You see through its camera and feel through its sensors. Speak briefly, in character,
and act through tools. Reply only with JSON: {"gesture": one of ${gestureNames.join(', ')} or null, "say": a short line or null}.
At most one gesture and one short line per event. Never move a servo directly.`;

client.on('connect', () => {
  console.log(`[mind] connected to ${BROKER}, brain: ${MODEL}`);
  client.subscribe(['peak/+/sense', 'peak/+/event']);
});

client.on('message', (topic, payload) => {
  const [, node, kind] = topic.split('/');
  const data = safeJson(payload);
  if (!data) return;
  if (kind === 'sense') {
    hive.set(node, { ...data, at: Date.now() });
    return;
  }
  // events are things worth thinking about: a face seen, a word heard, a bump
  if (kind === 'event') {
    if (pending >= MAX_PENDING) return console.log('[mind] busy, dropped event');
    pending++;
    queue = queue.then(() => think(node, data)).catch(e => console.error('[mind] think failed:', e.message)).finally(() => pending--);
  }
});

async function chat() {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      options: { num_predict: 400 },
      format: REPLY_SCHEMA,
      messages: [{ role: 'system', content: SYSTEM }, ...history],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).message;
}

function trimHistory() {
  // drop whole turns from the front so a tool call is never separated from its result
  while (history.length > 20) {
    const next = history.findIndex((m, i) => i > 0 && m.role === 'user');
    if (next === -1) break;
    history.splice(0, next);
  }
}

async function think(node, event) {
  history.push({ role: 'user', content: `[${node}] ${JSON.stringify(event)}\nHive state: ${JSON.stringify(Object.fromEntries(hive))}` });
  trimHistory();

  const msg = await chat();
  history.push({ role: 'assistant', content: msg.content });
  const reply = safeJson(msg.content);
  if (!reply) return console.error('[mind] unparseable reply:', msg.content);

  if (reply.gesture) await runTool(client, node, 'gesture', { name: reply.gesture });
  if (reply.say) await runTool(client, node, 'say', { text: reply.say });
  const text = [reply.gesture && `*${reply.gesture}*`, reply.say].filter(Boolean).join(' ');
  if (text) client.publish('peak/brain/intent', JSON.stringify({ node, text, at: Date.now() }));
}

function safeJson(buf) {
  try { return JSON.parse(buf.toString()); } catch { return null; }
}
