// Time Qwen3-VL on desk frames: one frame vs several, at several sizes. Same load options as the brain
// (lib/ollama.js), so the shared model is not reloaded.
//   node bakeoff/desk/time.js <dir with f1.jpg f2.jpg f3.jpg> [runs]
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { chat, loadOptions, thinkFlag, formatStats } from '../../lib/ollama.js';

const MODEL = process.env.PEAK_VISION_MODEL ?? 'huihui_ai/qwen3-vl-abliterated:8b-instruct';
const [dir, runs = '3'] = process.argv.slice(2);
const tmp = mkdtempSync(join(tmpdir(), 'desk-time-'));
// run shifts the crop by a few pixels so every request is a new image: Ollama would otherwise reuse the cached prompt.
const sized = (f, w, run = 0) => {
  const out = join(tmp, `${w}-${run}-${f}`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, f), '-vf', `crop=iw-${2 * run + 2}:ih-${2 * run + 2},scale=${w}:-2,format=yuvj420p`, out]);
  return readFileSync(out).toString('base64');
};
const PROMPT1 = 'This is an overhead view of a desk. In one short sentence, what is the person doing with their hands?';
const PROMPTN = 'These are frames one second apart from an overhead view of a desk. In one short sentence, what is the person doing with their hands?';
const cases = [
  ['1 frame 640', ['f3.jpg'], 640], ['1 frame 960', ['f3.jpg'], 960], ['1 frame 1280', ['f3.jpg'], 1280],
  ['1 frame 1920', ['f3.jpg'], 1920], ['3 frames 640', ['f1.jpg', 'f2.jpg', 'f3.jpg'], 640],
  ['3 frames 960', ['f1.jpg', 'f2.jpg', 'f3.jpg'], 960],
];
const think = await thinkFlag(MODEL);
for (const [name, files, w] of cases) {
  const times = [];
  for (let i = 0; i < Number(runs); i++) {
    const images = files.map(f => sized(f, w, i));
    try {
      const { message, stats } = await chat({ model: MODEL, think, options: { ...loadOptions(), num_predict: 60 },
        messages: [{ role: 'user', content: files.length > 1 ? PROMPTN : PROMPT1, images }] });
      times.push(stats.totalMs);
      if (i === Number(runs) - 1) console.log(`${name.padEnd(14)} ${formatStats(stats)}\n   -> ${message.content.trim()}`);
    } catch (e) { console.log(`${name}: ${e.message}`); break; }
  }
  if (times.length) console.log(`   median ${(times.sort((a, b) => a - b)[times.length >> 1] / 1000).toFixed(2)} s over ${times.length}`);
}
