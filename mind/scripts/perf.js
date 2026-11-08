// npm run perf [log ...]   p50 / p95 / max of each stage in the mind's [perf] lines (orchestrator/index.js logPerf),
// per event kind, and how often the prompt cache missed (prompt eval over 500 ms). Default log: run/mind.log.
//   --last N   only the last N [perf] lines
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const lastAt = args.indexOf('--last');
const last = lastAt >= 0 ? Number(args.splice(lastAt, 2)[1]) : 0;
const files = args.length ? args : [new URL('../run/mind.log', import.meta.url).pathname];

const STAGES = ['wire', 'queue', 'pick', 'gesture', 'brain', 'after', 'total', 'prompt_ms', 'load_ms', 'prompt_tok', 'out_tok'];
const MISS_MS = 500;

let rows = [];
for (const f of files) {
  if (!existsSync(f)) { console.error(`no such log: ${f}`); continue; }
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('[perf] ')) continue;
    const row = Object.fromEntries(line.slice(7).split(' ').map(kv => kv.split('=')));
    rows.push(row);
  }
}
if (last) rows = rows.slice(-last);
if (!rows.length) { console.log('no [perf] lines yet'); process.exit(0); }

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
function table(title, rs) {
  console.log(`\n${title}: ${rs.length} events`);
  console.log('| stage | n | p50 | p95 | max |\n| --- | --- | --- | --- | --- |');
  for (const s of STAGES) {
    const xs = rs.map(r => Number(r[s])).filter(Number.isFinite).sort((a, b) => a - b);
    if (xs.length) console.log(`| ${s} | ${xs.length} | ${pct(xs, 0.5)} | ${pct(xs, 0.95)} | ${xs.at(-1)} |`);
  }
  const prompts = rs.map(r => Number(r.prompt_ms)).filter(Number.isFinite);
  const misses = prompts.filter(ms => ms > MISS_MS).length;
  const prefixes = {};
  for (const r of rs) prefixes[r.prefix ?? '?'] = (prefixes[r.prefix ?? '?'] ?? 0) + 1;
  const missBy = {};
  for (const r of rs) if (Number(r.prompt_ms) > MISS_MS) missBy[r.prefix ?? '?'] = (missBy[r.prefix ?? '?'] ?? 0) + 1;
  console.log(`prompt eval over ${MISS_MS} ms: ${misses} of ${prompts.length} (${prompts.length ? Math.round(100 * misses / prompts.length) : 0}%)`);
  console.log(`prefix: ${Object.entries(prefixes).map(([k, v]) => `${k} ${v}`).join(', ')}; slow calls by prefix: ${Object.entries(missBy).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  const systems = new Set(rs.map(r => r.sys).filter(Boolean));
  console.log(`system prompts seen: ${systems.size}`);
}

table('all', rows);
for (const kind of [...new Set(rows.map(r => r.kind))]) {
  const rs = rows.filter(r => r.kind === kind);
  if (rs.length !== rows.length) table(kind, rs);
}
