// vision — watches the node's camera, and only when the scene changes asks a local vision model what it sees,
// then publishes {"see": "..."}.
//   PEAK_VISION_SOURCE  ffmpeg input: udp://0.0.0.0:5000 (Pi, default), "avfoundation:<n>" for a Mac camera, or an image/video file
//   PEAK_VISION_MODEL   Ollama model with vision (default huihui_ai/qwen3-vl-abliterated:8b-instruct, same as the brain)
//   PEAK_VISION_EVERY_S seconds between looks (default 3)
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, publishEvent, run, sleep } from './lib.js';
import { chat, loadOptions, thinkFlag } from '../lib/ollama.js';

const SOURCE = process.env.PEAK_VISION_SOURCE ?? 'udp://0.0.0.0:5000';
const MODEL = process.env.PEAK_VISION_MODEL ?? 'huihui_ai/qwen3-vl-abliterated:8b-instruct';
const EVERY_MS = Number(process.env.PEAK_VISION_EVERY_S ?? 3) * 1000;
const CHANGE_THRESHOLD = Number(process.env.PEAK_CHANGE ?? 12); // mean 0-255 difference on a 16x16 grayscale thumbnail
const COOLDOWN_MS = Number(process.env.PEAK_VISION_COOLDOWN_S ?? 10) * 1000;
// Kept short on purpose: moondream returns nothing for longer role prompts.
const PROMPT = process.env.PEAK_VISION_PROMPT ?? 'Describe this image in one short sentence, mentioning any people and what they are doing.';
const ONCE = process.env.PEAK_VISION_ONCE === '1'; // describe one frame and exit (testing)

const dir = mkdtempSync(join(tmpdir(), 'peak-vision-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

const inputArgs = SOURCE.startsWith('avfoundation:')
  ? ['-f', 'avfoundation', '-framerate', '30', '-i', SOURCE.split(':')[1]]
  : SOURCE.startsWith('udp://') ? ['-fflags', 'nobuffer', '-i', SOURCE] : ['-i', SOURCE]; // nobuffer yields no frame from still images

const grabFrame = async n => {
  const file = join(dir, `frame${n}.jpg`);
  const { code } = await run('ffmpeg', ['-y', '-loglevel', 'error', ...inputArgs, '-frames:v', '1', '-update', '1', '-vf', 'scale=640:-2,format=yuvj420p', file]);
  return code === 0 ? file : null;
};

const thumbnail = async file => {
  const { stdout } = await run('ffmpeg', ['-loglevel', 'error', '-i', file, '-vf', 'scale=16:16,format=gray', '-f', 'rawvideo', '-']);
  return stdout;
};

const difference = (a, b) => {
  if (!a || a.length !== b.length || !a.length) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

const describe = async file => {
  // Same load-time options as the brain, so a shared brain-and-eyes model is loaded once, not reloaded per caller.
  const { message, stats } = await chat({
    model: MODEL, think: await thinkFlag(MODEL), options: { ...loadOptions(), num_predict: 80 },
    messages: [{
      role: 'user',
      content: PROMPT,
      images: [readFileSync(file).toString('base64')],
    }],
  });
  if (stats.loadMs > 1000) console.warn('[vision] model was reloaded (evicted?)');
  return message.content.trim();
};

const client = connect();
client.on('connect', async () => {
  console.log(`[vision] watching ${SOURCE}, model ${MODEL}`);
  let last = null, lastAt = 0;
  for (let n = 0; ; n++) {
    const frame = await grabFrame(n);
    if (frame) {
      const thumb = await thumbnail(frame);
      const changed = difference(last, thumb) >= CHANGE_THRESHOLD;
      if (ONCE || (changed && Date.now() - lastAt >= COOLDOWN_MS)) {
        last = thumb; lastAt = Date.now();
        try {
          const see = await describe(frame);
          if (see) publishEvent(client, { see }); else console.error('[vision] model returned nothing');
        }
        catch (e) { console.error('[vision]', e.message); }
        if (ONCE) return client.end();
      }
    } else {
      console.error('[vision] no frame from source');
    }
    await sleep(EVERY_MS);
  }
});
