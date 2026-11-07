// How long does the brain take to answer while the desk camera is describing? Runs real brain calls (the
// orchestrator's buildMessages/askBrain path, a desk question with desk context) at random moments, first with
// nothing else running, then while a loop describes real hand crops back to back, the way vision.js does.
// Stop `npm run vision` first, or it adds its own looks.
//   node bakeoff/desk/contend.js <dir of crop .jpg files> [probes per phase]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { askBrain, buildMessages } from '../../orchestrator/brain.js';
import { chat, loadOptions, thinkFlag } from '../../lib/ollama.js';

const MODEL = process.env.PEAK_VISION_MODEL ?? 'huihui_ai/qwen3-vl-abliterated:8b-instruct';
const PROMPT = 'Overhead view of a desk with electronics parts. In one short sentence: what are the hands doing, and name any part they hold. Say only what you can see.';
const [dir, probesArg = '10'] = process.argv.slice(2);
const crops = readdirSync(dir).filter(f => f.endsWith('.jpg')).map(f => readFileSync(join(dir, f)).toString('base64'));
const PROBES = Number(probesArg);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hive = new Map([['mech', {}]]);
const think = await thinkFlag(MODEL);

const probe = async () => {
  const messages = buildMessages([], 'mech', { heard: 'Rho, what am I holding?' }, hive,
    { text: 'The hands are holding a small circuit board with a yellow wire.', at: Date.now() - 3000 });
  const t0 = performance.now();
  let gestureMs = null;
  const r = await askBrain({ messages, onGesture: () => { gestureMs ??= Math.round(performance.now() - t0); } });
  return { gestureMs, totalMs: Math.round(performance.now() - t0), promptMs: r.stats.promptMs, say: r.reply?.say };
};

let looking = false, looks = 0;
const lookLoop = async () => {
  for (let i = 0; looking; i++) {
    await chat({ model: MODEL, think, options: { ...loadOptions(), num_predict: 80 },
      messages: [{ role: 'user', content: PROMPT, images: [crops[i % crops.length]] }] });
    looks++;
  }
};

const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const phase = async name => {
  const rows = [];
  for (let i = 0; i < PROBES; i++) {
    await sleep(2000 + Math.random() * 5000); // a random point inside a look
    rows.push(await probe());
  }
  const g = rows.map(r => r.gestureMs), t = rows.map(r => r.totalMs), p = rows.map(r => r.promptMs);
  console.log(`${name.padEnd(22)} gesture median ${median(g)} ms, max ${Math.max(...g)} | reply median ${median(t)} ms, max ${Math.max(...t)} | prompt eval median ${median(p)} ms`);
  console.log(`   say: ${rows.at(-1).say}`);
  return rows;
};

await probe(); // warm
await phase('quiet');
looking = true;
const loop = lookLoop();
await phase('during looks');
looking = false;
await loop;
console.log(`(${looks} looks ran during the second phase)`);
