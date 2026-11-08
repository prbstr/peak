// Rho's health, its own process (LaunchAgent sh.peak.health): one retained summary on peak/mind/health every 30 s.
// It listens to every part's retained status (peak/mind/<part>/status, set offline by each part's Last Will) and to
// every body's and device's (peak/<node>/status), and probes what has no MQTT of its own: whisper-server over HTTP,
// and Ollama's /api/tags. whisper-server's result is also published as the retained peak/mind/whisper/status, so
// every Mac part has a status topic; when health itself dies its Last Will says so on peak/mind/health/status.
//   PEAK_HEALTH_EVERY_S   seconds between summaries (default 30)
//   PEAK_HEALTH_PARTS     the parts that must be online for "ok" (default whisper mind hearing vision presence voice)
//   PEAK_WHISPER_URL      whisper-server (default http://127.0.0.1:8178)
import { pathToFileURL } from 'node:url';
import { connect, logExits } from '../senses/lib.js';
import { tags } from '../lib/ollama.js';

export const PARTS = (process.env.PEAK_HEALTH_PARTS ?? 'whisper mind hearing vision presence voice').split(/[\s,]+/).filter(Boolean);
const EVERY_MS = Number(process.env.PEAK_HEALTH_EVERY_S ?? 30) * 1000;
const WHISPER = process.env.PEAK_WHISPER_URL ?? 'http://127.0.0.1:8178';
const PROBE_MS = 5000;

/** The retained summary. `statuses` maps topic to payload; `probes` holds whisper's and Ollama's results. */
export const summarize = ({ statuses, probes, now, parts = PARTS }) => {
  const partState = {};
  for (const p of parts) partState[p] = statuses.get(`peak/mind/${p}/status`) ?? 'unknown';
  if (parts.includes('whisper')) partState.whisper = probes.whisper.ok ? 'online' : 'offline';
  const bodies = {};
  for (const [topic, payload] of statuses) {
    const m = /^peak\/([^/]+)\/status$/.exec(topic);
    if (m && m[1] !== 'mind') bodies[m[1]] = payload;
  }
  const down = Object.entries(partState).filter(([, s]) => s !== 'online').map(([p]) => p);
  if (!probes.ollama.ok) down.push('ollama');
  return { at: now, ok: down.length === 0, down, parts: partState, bodies, ollama: probes.ollama, whisper: probes.whisper };
};

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms))]);

/** { ok, ms, ... } for one probe; never throws. */
const probe = async (fn, extra = () => ({})) => {
  const t0 = Date.now();
  try {
    const r = await withTimeout(fn(), PROBE_MS);
    return { ok: true, ms: Date.now() - t0, ...extra(r) };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e.cause?.code ?? e.message };
  }
};

const probeWhisper = () => probe(async () => {
  // any HTTP answer means the server is up; the root serves its own test page
  const res = await fetch(WHISPER, { signal: AbortSignal.timeout(PROBE_MS) });
  await res.arrayBuffer();
  return res.status;
});

// /api/tags lists models and loads none, so it never disturbs the brain
const probeOllama = () => probe(tags, models => ({ models: models.length }));

const main = () => {
  logExits('health');
  const client = connect('health');
  const statuses = new Map();
  let lastLine = '', lastWhisper = '';
  client.on('connect', () => {
    // a broker restart loses whisper's retained status, so the next tick publishes it again
    lastWhisper = '';
    client.subscribe(['peak/mind/+/status', 'peak/+/status']);
  });
  client.on('message', (topic, payload) => statuses.set(topic, String(payload)));

  const tick = async () => {
    const [whisper, ollama] = await Promise.all([probeWhisper(), probeOllama()]);
    const health = summarize({ statuses, probes: { whisper, ollama }, now: Date.now() });
    if (!client.connected) return; // the broker is down: nothing to publish to, and nobody to tell
    const w = health.parts.whisper;
    if (w && w !== lastWhisper) client.publish('peak/mind/whisper/status', w, { retain: true, qos: 1 });
    lastWhisper = w ?? '';
    client.publish('peak/mind/health', JSON.stringify(health), { retain: true, qos: 1 });
    // one log line per change, not one per tick
    const line = health.ok ? 'ok' : `down: ${health.down.join(', ')}${ollama.ok ? '' : ` (ollama: ${ollama.error})`}`;
    if (line !== lastLine) console.log(`[health] ${line}`);
    lastLine = line;
  };
  // the first summary waits for the retained statuses to arrive
  setTimeout(() => { tick(); setInterval(tick, EVERY_MS); }, 3000);
  console.log(`[health] every ${EVERY_MS / 1000} s on peak/mind/health; parts ${PARTS.join(' ')}`);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
