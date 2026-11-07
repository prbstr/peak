// Ask Qwen3-VL what the hands are doing at chosen moments of a desk recording, two ways:
//   full: the whole frame scaled to 1280 wide
//   crop: the region around the hands (from gate.py's boxes, padded 2x, at least 640 px) at full resolution
//   node bakeoff/desk/describe.js <video> <gate.jsonl> <every_s> > describe.jsonl
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { chat, loadOptions, thinkFlag } from '../../lib/ollama.js';

const MODEL = process.env.PEAK_VISION_MODEL ?? 'huihui_ai/qwen3-vl-abliterated:8b-instruct';
const PROMPT = process.env.PEAK_DESK_PROMPT ?? 'Overhead view of a workbench. In one short sentence: what are the hands doing, and name any part or tool they hold.';
const [video, gateFile, everyS = '5'] = process.argv.slice(2);
// The camera hangs turned 90 degrees on the arm; transpose=1 puts the person at the top, the desk below.
const TURN = process.env.PEAK_DESK_VF ?? 'transpose=1';
const MODES = (process.env.PEAK_DESK_MODES ?? 'full,crop').split(',');
const gate = readFileSync(gateFile, 'utf8').split('\n').filter(l => l.startsWith('{')).map(JSON.parse);
const tmp = mkdtempSync(join(tmpdir(), 'desk-describe-'));
const [W, H] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video])
  .toString().trim().split(',').map(Number);

const frameAt = (t, vf, name) => {
  const out = join(tmp, name);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', `${vf}${TURN ? `,${TURN}` : ''},format=yuvj420p`, out]);
  return readFileSync(out).toString('base64');
};

const handCrop = hands => {
  if (!hands.length) return null;
  const x0 = Math.min(...hands.map(h => h.box[0])) * W, y0 = Math.min(...hands.map(h => h.box[1])) * H;
  const x1 = Math.max(...hands.map(h => h.box[2])) * W, y1 = Math.max(...hands.map(h => h.box[3])) * H;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = Math.min(W, Math.max(640, (x1 - x0) * 2)), h = Math.min(H, Math.max(480, (y1 - y0) * 2));
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), W - w)), y = Math.round(Math.min(Math.max(0, cy - h / 2), H - h));
  return `crop=${Math.round(w)}:${Math.round(h)}:${x}:${y}`;
};

const think = await thinkFlag(MODEL);
const ask = async image => {
  const { message, stats } = await chat({ model: MODEL, think, options: { ...loadOptions(), num_predict: 60 },
    messages: [{ role: 'user', content: PROMPT, images: [image] }] });
  return { say: message.content.trim(), s: +(stats.totalMs / 1000).toFixed(2), tok: stats.promptTokens };
};

let next = 0;
for (const g of gate) {
  if (g.t < next) continue;
  next = g.t + Number(everyS);
  const row = { t: g.t, hands: g.hands.length };
  if (MODES.includes('full')) row.full = await ask(frameAt(g.t, 'scale=1280:-2', `full-${g.t}.jpg`));
  const crop = handCrop(g.hands);
  if (crop && MODES.includes('crop')) row.crop = { ...(await ask(frameAt(g.t, crop, `crop-${g.t}.jpg`))), region: crop };
  console.log(JSON.stringify(row));
}
