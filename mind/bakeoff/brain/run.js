// Brain bake-off. Every case in cases.json goes through the real buildMessages/askBrain path, once per run,
// for each model. Scores gesture accuracy, JSON validity, latency, tokens/s and whether the model stays
// resident next to the vision model. A case may also say which tricks the eyes may show ("eyes": [names or
// null]) and which device action it expects ("action": [names or null]), and what the desk camera saw ("desk":
// a sentence, added 4 s old); cases that say nothing are counted
// when the brain moves the eyes or switches a device anyway. Run from mind/:
// npm run bakeoff:brain -- [flags]   (PEAK_BRAIN_EYES=1 and/or PEAK_BRAIN_DEVICES=1 in front to score those fields)
//   --models a,b     comma list (default: models.json)
//   --runs N         repeats per case (default 3)
//   --pair TAG       after scoring, load TAG as the eyes and check both stay on the GPU (same TAG = unified check)
//   --only PREFIX    only case ids starting with PREFIX (e.g. direct, or seq for the multi-turn sequences)
//   --no-pull        fail instead of pulling a missing model
//   --keep-loaded    do not unload candidates afterwards
//   --stream         stream replies and report how soon the gesture field is complete (time-to-gesture)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { MODEL as PRODUCTION, askBrain, buildMessages } from '../../orchestrator/brain.js';
import { gestureNames } from '../../orchestrator/gestures.js';
import { loadTricks } from '../../orchestrator/tricks.js';
import { actionNames } from '../../orchestrator/devices.js';
import { capabilities, chat, loadOptions, ps, pull, tags, thinkFlag, unload } from '../../lib/ollama.js';

const here = new URL('.', import.meta.url);
const read = f => JSON.parse(readFileSync(new URL(f, here), 'utf8'));
const { values: args } = parseArgs({
  options: {
    models: { type: 'string' }, runs: { type: 'string', default: '3' }, pair: { type: 'string' },
    only: { type: 'string' }, 'no-pull': { type: 'boolean', default: false }, 'keep-loaded': { type: 'boolean', default: false },
    stream: { type: 'boolean', default: false },
  },
});
const models = args.models ? args.models.split(',').map(s => s.trim()).filter(Boolean) : read('./models.json');
const runs = Number(args.runs);
const cases = read('./cases.json').filter(c => !args.only || c.id.startsWith(args.only));
// sequences carry history between steps, the way the orchestrator does, to catch a model that gets stuck on its last answer
const sequences = read('./sequences.json').filter(q => !args.only || q.id.startsWith(args.only));
const log = (...a) => console.error(...a);

const trickNames = Object.keys(loadTricks());
const checkExpect = (id, expect) => {
  for (const g of expect.gesture) {
    if (g !== null && !gestureNames.includes(g)) throw new Error(`${id}: expected gesture "${g}" is not in gestures.yaml`);
  }
  for (const t of expect.eyes ?? []) {
    if (t !== null && !trickNames.includes(t)) throw new Error(`${id}: expected eyes "${t}" is not a trick`);
  }
  for (const a of expect.action ?? []) {
    if (a !== null && !actionNames.includes(a)) throw new Error(`${id}: expected action "${a}" is not in devices.yaml`);
  }
};
for (const c of cases) checkExpect(c.id, c.expect);
for (const q of sequences) q.steps.forEach((st, i) => checkExpect(`${q.id}.${i + 1}`, st.expect));
const totalSteps = cases.length + sequences.reduce((n, q) => n + q.steps.length, 0);
if (!totalSteps) throw new Error('no cases selected');

const hive = () => new Map([['mech', { at: Date.now() }]]);
const probe = readFileSync(new URL('./probe.jpg', here)).toString('base64');
const gb = n => (n / 2 ** 30).toFixed(1);
const pct = (n, d) => d ? `${Math.round((100 * n) / d)}%` : '-';
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

async function ensurePulled(model) {
  if ((await tags()).includes(model)) return;
  if (args['no-pull']) throw new Error(`${model} is not installed (--no-pull)`);
  log(`[bakeoff] pulling ${model}`);
  let lastPct = -1;
  await pull(model, p => {
    if (!p.total) return;
    const n = Math.floor((100 * (p.completed ?? 0)) / p.total);
    if (n !== lastPct && n % 10 === 0) { lastPct = n; log(`[bakeoff]   ${model} ${n}%`); }
  });
}

async function resident(name) {
  const m = (await ps()).find(x => x.name === name || x.model === name);
  return m ? { size: m.size, vram: m.size_vram, ctx: m.context_length, onGpu: m.size_vram >= m.size } : null;
}

async function pairCheck(model, pair) {
  // eyes first (as vision.js would), then the brain, then look at what is loaded
  await chat({ model: pair, think: await thinkFlag(pair), options: { ...loadOptions(), num_predict: 20 },
    messages: [{ role: 'user', content: 'Describe this image in one short sentence.', images: [probe] }] });
  const brain = await askBrain({ model, messages: buildMessages([], 'mech', { heard: 'hello' }, hive()) });
  const loaded = await ps();
  const names = loaded.map(m => m.name);
  const both = names.includes(model) && names.includes(pair);
  const offloaded = loaded.filter(m => [model, pair].includes(m.name) && m.size_vram < m.size).map(m => m.name);
  const foreign = names.filter(n => n !== model && n !== pair);
  const ok = both && !offloaded.length && brain.stats.loadMs < 1000;
  return { pair, ok, both, offloaded, foreign, brainReloadMs: brain.stats.loadMs, totalGb: gb(loaded.reduce((s, m) => s + m.size, 0)), unified: model === pair };
}

async function scoreModel(model) {
  await ensurePulled(model);
  const caps = await capabilities(model);
  log(`[bakeoff] ${model}: capabilities ${caps.join(', ')}`);
  const warm = await askBrain({ model, messages: buildMessages([], 'mech', { heard: 'hello' }, hive()) });
  log(`[bakeoff] ${model}: warm ${(warm.stats.totalMs / 1000).toFixed(1)}s (load ${warm.stats.loadMs}ms)`);

  const calls = [];
  // a case's "desk" is what the desk camera saw 4 s before the event, the way the orchestrator adds it
  const score = async (id, run, event, expect, history, desk) => {
    const messages = buildMessages(history, 'mech', event, hive(), desk ? { text: desk, at: Date.now() - 4000 } : null);
    let early;
    const r = await askBrain({ model, messages, onGesture: args.stream ? g => { early = g; } : undefined });
    history.push(messages.at(-1), { role: 'assistant', content: r.content });
    const gesture = r.reply?.gesture ?? null;
    const gestureOk = r.reply !== null && expect.gesture.includes(gesture);
    const eyes = r.reply?.eyes ?? null;
    const eyesAsked = Boolean(expect.eyes);
    const eyesOk = !eyesAsked || (r.reply !== null && expect.eyes.includes(eyes));
    const action = r.reply?.action ?? null;
    const actionAsked = Boolean(expect.action);
    const actionOk = !actionAsked || (r.reply !== null && expect.action.includes(action));
    const strict = gestureOk && eyesOk && actionOk && (!expect.sayRequired || Boolean(r.reply.say)) && (!expect.silent || !r.reply.say);
    const thinkingLeak = Boolean(r.thinking) || /^\s*<think>/.test(r.content);
    const earlyMismatch = args.stream && early !== gesture;
    calls.push({ id, run, gesture, eyes, eyesAsked, eyesOk, action, actionAsked, actionOk, say: r.reply?.say ?? null, gestureOk, strict, valid: r.valid, violations: r.violations, thinkingLeak, stats: r.stats, confidence: r.confidence, gestureMs: r.gestureMs, earlyMismatch, content: r.valid ? undefined : r.content });
    log(`[bakeoff]   ${run}/${runs} ${id.padEnd(20)} ${strict ? 'ok  ' : 'FAIL'} ${String(gesture).padEnd(10)} ${String(eyes ?? '-').padEnd(9)} ${String(action ?? '-').padEnd(12)} ${(r.stats.totalMs / 1000).toFixed(1)}s${r.gestureMs != null ? ` (gesture ${r.gestureMs}ms)` : ''} p=${r.confidence?.toFixed(2) ?? '-'} ${r.reply?.say ?? ''}`);
  };
  for (let run = 1; run <= runs; run++) {
    for (const c of cases) await score(c.id, run, c.event, c.expect, [], c.desk);
    for (const q of sequences) {
      const history = [];
      for (let i = 0; i < q.steps.length; i++) await score(`${q.id}.${i + 1}`, run, q.steps[i].event, q.steps[i].expect, history);
    }
  }
  const n = calls.length;
  const times = calls.map(c => c.stats.totalMs);
  const summary = {
    model, caps, n,
    gestureAcc: calls.filter(c => c.gestureOk).length,
    strict: calls.filter(c => c.strict).length,
    jsonOk: calls.filter(c => !c.violations.invalidJson).length,
    sayTooLong: calls.filter(c => c.violations.sayTooLong).length,
    unknownGesture: calls.filter(c => c.violations.unknownGesture).length,
    thinkingLeaks: calls.filter(c => c.thinkingLeak).length,
    reloads: calls.filter(c => c.stats.loadMs > 1000).length,
    p50Ms: quantile(times, 0.5), p95Ms: quantile(times, 0.95),
    tokPerS: Math.round(calls.reduce((s, c) => s + c.stats.tokPerS, 0) / n),
    promptTokens: Math.round(calls.reduce((s, c) => s + c.stats.promptTokens, 0) / n),
    resident: await resident(model),
    pair: args.pair ? await pairCheck(model, args.pair) : null,
    gestureP50Ms: args.stream ? quantile(calls.map(c => c.gestureMs ?? 0), 0.5) : null,
    earlyMismatches: calls.filter(c => c.earlyMismatch).length,
    eyesAsked: calls.filter(c => c.eyesAsked).length,
    eyesOk: calls.filter(c => c.eyesAsked && c.eyesOk).length,
    // the eyes moved in a case that says nothing about eyes: not wrong, but a brain that does it everywhere is over-acting
    eyesUnasked: calls.filter(c => !c.eyesAsked && c.eyes !== null).length,
    actionAsked: calls.filter(c => c.actionAsked).length,
    actionOk: calls.filter(c => c.actionAsked && c.actionOk).length,
    // a device switched in a case that says nothing about devices: an arm swinging at a question, in another form
    actionUnasked: calls.filter(c => !c.actionAsked && c.action !== null).length,
    confidence: {
      ok: mean(calls.filter(c => c.gestureOk && c.confidence != null).map(c => c.confidence)),
      wrong: mean(calls.filter(c => !c.gestureOk && c.confidence != null).map(c => c.confidence)),
    },
    groups: Object.fromEntries([...new Set(calls.map(c => c.id.split('.')[0]))].map(g => {
      const cs = calls.filter(c => c.id.split('.')[0] === g);
      return [g, { n: cs.length, strict: cs.filter(c => c.strict).length }];
    })),
    failures: calls.filter(c => !c.strict).map(({ id, run, gesture, eyes, action, say, confidence, content }) => ({ id, run, gesture, eyes, action, say, confidence, content })),
    calls: calls.map(({ id, run, gesture, eyes, action, say, gestureOk, eyesOk, actionOk, strict, confidence, gestureMs, stats }) => ({ id, run, gesture, eyes, action, say, gestureOk, eyesOk, actionOk, strict, confidence, gestureMs, totalMs: stats.totalMs })),
  };
  if (!args['keep-loaded'] && model !== PRODUCTION && model !== args.pair) await unload(model);
  return summary;
}

function toMarkdown(results) {
  const head = '| Model | Gesture acc | Strict | JSON ok | say>200 | unknown | think leak | reloads | p50 s | p95 s | tok/s | prompt tok | Resident GB | Pair |';
  const sep = '|' + ' --- |'.repeat(14);
  const rows = results.map(r => {
    const res = r.resident ? `${gb(r.resident.size)}${r.resident.onGpu ? '' : ' (offloaded)'}` : '-';
    const pair = r.pair ? (r.pair.ok ? `ok${r.pair.unified ? ' (unified)' : ''}, ${r.pair.totalGb} GB` : `FAIL: ${[!r.pair.both && 'evicted', r.pair.offloaded.length && `offloaded ${r.pair.offloaded.join(',')}`, r.pair.brainReloadMs >= 1000 && `reload ${r.pair.brainReloadMs}ms`].filter(Boolean).join('; ')}`) : '-';
    return `| ${r.model} | ${pct(r.gestureAcc, r.n)} | ${pct(r.strict, r.n)} | ${pct(r.jsonOk, r.n)} | ${r.sayTooLong} | ${r.unknownGesture} | ${r.thinkingLeaks} | ${r.reloads} | ${(r.p50Ms / 1000).toFixed(1)} | ${(r.p95Ms / 1000).toFixed(1)} | ${r.tokPerS} | ${r.promptTokens} | ${res} | ${pair} |`;
  });
  const failures = results.map(r => {
    if (!r.failures.length) return `### ${r.model}\n\nNo failures.`;
    const byCase = new Map();
    for (const f of r.failures) byCase.set(f.id, [...(byCase.get(f.id) ?? []), f]);
    const lines = [...byCase].map(([id, fs]) => `- \`${id}\` (${fs.length}/${runs}): ${fs.map(f => f.content !== undefined ? `invalid ${JSON.stringify(f.content).slice(0, 80)}` : `${f.gesture}${f.eyes ? `+${f.eyes}` : ''}${f.action ? `+[${f.action}]` : ''}${f.confidence != null ? ` p=${f.confidence.toFixed(2)}` : ''} ${f.say ? JSON.stringify(f.say) : '(silent)'}`).join(' | ')}`);
    return `### ${r.model}\n\n${lines.join('\n')}`;
  });
  const groupNames = [...new Set(results.flatMap(r => Object.keys(r.groups ?? {})))];
  const groupHead = `| Model | ${groupNames.join(' | ')} |\n|${' --- |'.repeat(groupNames.length + 1)}`;
  const groupRows = results.map(r => `| ${r.model} | ${groupNames.map(g => r.groups?.[g] ? pct(r.groups[g].strict, r.groups[g].n) : '-').join(' | ')} |`);
  const extraHead = '| Model | gesture p50 s | early mismatches | confidence when right | confidence when wrong | eyes right | eyes unasked | action right | action unasked |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const extraRows = results.map(r => `| ${r.model} | ${r.gestureP50Ms != null ? (r.gestureP50Ms / 1000).toFixed(2) : '-'} | ${r.earlyMismatches ?? 0} | ${r.confidence?.ok?.toFixed(2) ?? '-'} | ${r.confidence?.wrong?.toFixed(2) ?? '-'} | ${r.eyesAsked ? `${r.eyesOk}/${r.eyesAsked}` : '-'} | ${r.eyesUnasked ?? 0} | ${r.actionAsked ? `${r.actionOk}/${r.actionAsked}` : '-'} | ${r.actionUnasked ?? 0} |`);
  const extra = `\n## Per group (strict)\n\n${groupHead}\n${groupRows.join('\n')}\n\n## Timing and confidence\n\n${extraHead}\n${extraRows.join('\n')}\n`;
  const foreign = results.map(r => r.pair?.foreign ?? []).flat();
  const note = foreign.length ? `\nOther models loaded during pair checks (not ours): ${[...new Set(foreign)].join(', ')}\n` : '';
  return `# Brain bake-off ${new Date().toISOString()}\n\n${cases.length} cases + ${totalSteps - cases.length} sequence steps, x ${runs} runs${args.only ? `, only ${args.only}` : ''}${args.pair ? `, pair ${args.pair}` : ''}\n\n${head}\n${sep}\n${rows.join('\n')}\n${note}${extra}\n## Failures\n\n${failures.join('\n\n')}\n`;
}

const results = [];
for (const model of models) {
  try { results.push(await scoreModel(model)); }
  catch (e) { log(`[bakeoff] ${model} FAILED: ${e.message}`); results.push({ model, n: 0, gestureAcc: 0, strict: 0, jsonOk: 0, sayTooLong: 0, unknownGesture: 0, thinkingLeaks: 0, reloads: 0, p50Ms: 0, p95Ms: 0, tokPerS: 0, promptTokens: 0, resident: null, pair: null, failures: [], error: e.message }); }
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = new URL('./results/', here);
mkdirSync(dir, { recursive: true });
const md = toMarkdown(results);
writeFileSync(new URL(`${stamp}.json`, dir), JSON.stringify({ args, cases: cases.map(c => c.id), sequences: sequences.map(q => q.id), results }, null, 2));
writeFileSync(new URL(`${stamp}.md`, dir), md);
console.log(md);
log(`[bakeoff] wrote bakeoff/brain/results/${stamp}.{json,md}`);
