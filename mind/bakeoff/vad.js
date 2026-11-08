// Replays saved utterances (wav files cut by hearing.js) through whisper-server, the way hearing.js sends them, on
// one or more servers, to compare a plain server with one started with Silero VAD (--vad --vad-model).
//   node bakeoff/vad.js <url,url,...> <dir> [phrases.txt]
// With phrases.txt the files are scored against it in order (01.wav = line 1): words wrong, as in bakeoff.py's WER.
// Without it the files are noise: every word that comes back is an invention, and "would pass" counts the ones the
// wake-word filter would let through with its gate off (heardFilter.js), i.e. what reaches the brain inside an
// attention window.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHeardFilter } from '../senses/heardFilter.js';

const [urls, dir, phrasesFile] = process.argv.slice(2);
const files = readdirSync(dir).filter(f => f.endsWith('.wav')).sort();
const phrases = phrasesFile ? readFileSync(phrasesFile, 'utf8').split('\n').filter(Boolean) : null;
const norm = s => s.toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ').replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
// the wake word was Peak when the phrase clips were recorded; spellings the gate took then are not errors
const PEAK = new Set(['peak', 'peek', 'pete', 'pique', 'peke']);
const wordErrors = (ref, hyp) => {
  const a = norm(ref).map(w => (PEAK.has(w) ? 'peak' : w)), b = norm(hyp).map(w => (PEAK.has(w) ? 'peak' : w));
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return { errors: d[a.length][b.length], words: a.length };
};

const transcribe = async (url, buf) => {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/wav' }), 'utterance.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const t0 = performance.now();
  const res = await fetch(`${url}/inference`, { method: 'POST', body: form });
  const text = res.ok ? ((await res.json()).text ?? '').trim() : `ERROR ${res.status}`;
  return { text, ms: Math.round(performance.now() - t0) };
};

const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
for (const url of urls.split(',')) {
  const filter = createHeardFilter({ gate: false });
  let errors = 0, words = 0, exact = 0, invented = 0, passed = 0;
  const times = [];
  for (const [i, f] of files.entries()) {
    const { text, ms } = await transcribe(url, readFileSync(join(dir, f)));
    times.push(ms);
    if (phrases) {
      const w = wordErrors(phrases[i] ?? '', text);
      errors += w.errors; words += w.words; if (!w.errors) exact++;
      console.error(`${url} ${f} ${ms}ms ${w.errors ? `${w.errors} wrong` : 'ok'} "${text}"`);
    } else {
      const n = norm(text).length;
      invented += n;
      const ok = filter.consider(text).text;
      if (ok) passed++;
      console.error(`${url} ${f} ${ms}ms ${n} words${ok ? ' PASSES' : ''} "${text}"`);
    }
  }
  console.log(phrases
    ? `| ${url} | ${files.length} | ${(100 * errors / words).toFixed(1)}% | ${exact}/${files.length} | ${median(times)} | ${Math.max(...times)} |`
    : `| ${url} | ${files.length} | ${invented} | ${passed} | ${median(times)} | ${Math.max(...times)} |`);
}
