// Does the brain stay fast and loaded when other models are busy? Real brain calls (askBrain, which goes to
// PEAK_BRAIN_HOST or the shared Ollama) at random moments in three phases:
//   quiet      nothing else asked of Ollama
//   looks      the desk camera's model describes a photo back to back on the shared Ollama, as vision.js does
//   openclaw   as looks, after OpenClaw's coder model is loaded on the shared Ollama (it expires after 3 min)
// Prints gesture and reply p50/p95 per phase, brain reloads (load > 1 s), and what each Ollama holds after.
//   node bakeoff/brainhost.js [probes per phase]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { askBrain, buildMessages, MODEL as BRAIN } from '../orchestrator/brain.js';
import { BRAIN_HOST, OLLAMA, chat, loadOptions, ps, thinkFlag } from '../lib/ollama.js';

const PROBES = Number(process.argv[2] ?? 20);
const VISION = process.env.PEAK_VISION_MODEL ?? 'qwen3-vl:4b-instruct';
const OTHER = 'qwen2.5-coder:7b-instruct';
const photo = readFileSync(new URL('./brain/probe.jpg', import.meta.url)).toString('base64');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = (xs, f) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(f * xs.length))];
const hive = new Map([['mech', {}]]);

const probe = async () => {
  const messages = buildMessages([], 'mech', { heard: 'Rho, wave at me' }, hive);
  const r = await askBrain({ messages, onGesture: () => {} });
  return { gestureMs: r.gestureMs, totalMs: r.stats.totalMs, loadMs: r.stats.loadMs };
};

let looking = false, looks = 0;
const lookLoop = async () => {
  const think = await thinkFlag(VISION);
  while (looking) {
    await chat({ model: VISION, think, options: { ...loadOptions(), num_predict: 80 },
      messages: [{ role: 'user', content: 'In one short sentence: what is in this photo?', images: [photo] }] });
    looks++;
  }
};

const held = async host => (await ps(host)).map(m => `${m.name} ${(m.size / 2 ** 30).toFixed(1)}G`).join(', ') || 'nothing';
const freePct = () => execFileSync('memory_pressure', { encoding: 'utf8' }).match(/free percentage: (\d+)%/)?.[1];

const phase = async name => {
  const rows = [];
  for (let i = 0; i < PROBES; i++) { await sleep(1000 + Math.random() * 3000); rows.push(await probe()); }
  const g = rows.map(r => r.gestureMs), t = rows.map(r => r.totalMs);
  console.log(`| ${BRAIN_HOST === OLLAMA ? 'shared' : 'own'} | ${name} | ${q(g, 0.5)} | ${q(g, 0.95)} | ${q(t, 0.5)} | ${q(t, 0.95)} | ${rows.filter(r => r.loadMs > 1000).length} | ${freePct()}% | ${await held(OLLAMA)}${BRAIN_HOST === OLLAMA ? '' : ` / own: ${await held(BRAIN_HOST)}`} |`);
};

console.log(`brain ${BRAIN} on ${BRAIN_HOST}; vision ${VISION} and ${OTHER} on ${OLLAMA}; ${PROBES} probes per phase`);
console.log('| brain | phase | gesture p50 ms | gesture p95 | reply p50 | reply p95 | reloads | free | loaded |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
await probe(); // warm
await phase('quiet');
looking = true;
const loop = lookLoop();
await phase('looks');
await chat({ model: OTHER, keep_alive: '3m', options: { num_predict: 1 }, messages: [{ role: 'user', content: 'hi' }] });
await phase('openclaw');
looking = false;
await loop;
console.log(`(${looks} looks)`);
