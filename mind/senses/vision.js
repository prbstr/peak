// vision — watches the node's camera through a local vision model. Two modes (PEAK_VISION_MODE):
//   desk (default since 7 Nov 2026): the camera hangs over the desk. hands.py tracks hands on every few frames; while
//     hands are in view, a crop around them is described and published as {"doing": "..."}, quiet context the brain
//     keeps for the next thing it hears. A look is cancelled and looking pauses when something is heard, so the
//     brain never waits behind a description. Evidence: bakeoff/desk/README.md.
//   scene: the camera faces the room. Only when the scene changes, the whole frame is described as {"see": "..."}.
//   PEAK_VISION_SOURCE  ffmpeg input: udp://0.0.0.0:5000 (Pi, default), "avfoundation:<n>" for a Mac camera, or an image/video file
//   PEAK_VISION_MODEL   Ollama model with vision (default huihui_ai/qwen3-vl-abliterated:8b-instruct, same as the brain)
//   PEAK_VISION_EVERY_S seconds between looks (default 3 for scene, 1 for desk: a desk look itself takes about 6 s)
//   PEAK_DESK_PAUSE_S   desk: seconds to stop looking after something is heard (default 8)
//   PEAK_DESK_PROMPT    desk: the question asked of each crop
//   PEAK_HANDS_PYTHON   desk: python with mediapipe (default senses/.venv/bin/python); hands.py lists its own settings
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { connect, publishEvent, run, sleep } from './lib.js';
import { chat, loadOptions, thinkFlag } from '../lib/ollama.js';

const MODE = process.env.PEAK_VISION_MODE ?? 'desk';

const SOURCE = process.env.PEAK_VISION_SOURCE ?? 'udp://0.0.0.0:5000';
const MODEL = process.env.PEAK_VISION_MODEL ?? 'huihui_ai/qwen3-vl-abliterated:8b-instruct';
const EVERY_MS = Number(process.env.PEAK_VISION_EVERY_S ?? (MODE === 'desk' ? 1 : 3)) * 1000;
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
  // The Pi sends bare H264 (camd.sh). Left to probe it, ffmpeg spends its full 5 s on every look; told the format
  // and given a short probe, a look takes 2 s. nobuffer yields no frame from still images, so only here.
  : SOURCE.startsWith('udp://') ? ['-fflags', 'nobuffer', '-f', 'h264', '-probesize', '200000', '-analyzeduration', '500000', '-i', SOURCE]
    : ['-i', SOURCE];

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

const describe = async (file, prompt = PROMPT, signal) => {
  // Same load-time options as the brain, so a shared brain-and-eyes model is loaded once, not reloaded per caller.
  const { message, stats } = await chat({
    signal, model: MODEL, think: await thinkFlag(MODEL), options: { ...loadOptions(), num_predict: 80 },
    messages: [{
      role: 'user',
      content: prompt,
      images: [readFileSync(file).toString('base64')],
    }],
  });
  if (stats.loadMs > 1000) console.warn('[vision] model was reloaded (evicted?)');
  return message.content.trim();
};

const DESK_PROMPT = process.env.PEAK_DESK_PROMPT
  ?? 'Overhead view of a desk with electronics parts. In one short sentence: what are the hands doing, and name any part they hold. Say only what you can see.';
const DESK_PAUSE_MS = Number(process.env.PEAK_DESK_PAUSE_S ?? 8) * 1000;
const HANDS_PYTHON = process.env.PEAK_HANDS_PYTHON ?? fileURLToPath(new URL('./.venv/bin/python', import.meta.url));

/** hands.py as a child: one request line out, one JSON line back, in order. */
const startHands = () => {
  const child = spawn(HANDS_PYTHON, ['-u', fileURLToPath(new URL('./hands.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
  // mediapipe's own start-up chatter (W0000/I0000/INFO lines) is noise; hands.py's lines start with [hands]
  createInterface({ input: child.stderr }).on('line', l => { if (!/^(W|I)0000|^INFO|^WARNING: All log/.test(l)) console.error(l); });
  const waiting = [];
  createInterface({ input: child.stdout }).on('line', l => waiting.shift()?.(JSON.parse(l)));
  child.on('exit', code => { console.error(`[vision] hands.py exited (${code})`); process.exit(1); });
  process.on('exit', () => child.kill());
  return { ask: line => new Promise(resolve => { waiting.push(resolve); child.stdin.write(`${line}\n`); }) };
};

const watchDesk = async client => {
  const hands = startHands();
  let pausedUntil = 0, inFlight = null, last = '';
  // Something heard: the brain is about to need the model. Drop the look in flight and keep out of its way.
  client.subscribe('peak/+/event');
  client.on('message', (topic, payload) => {
    let ev; try { ev = JSON.parse(payload); } catch { return; }
    if (!ev || !('heard' in ev)) return;
    pausedUntil = Date.now() + DESK_PAUSE_MS;
    if (inFlight) { inFlight.abort(); console.log('[vision] heard something: look cancelled'); }
  });
  console.log(`[vision] desk mode on ${SOURCE}, model ${MODEL}`);
  for (let n = 0; ; n++) {
    await sleep(EVERY_MS);
    if (Date.now() < pausedUntil) continue;
    const file = join(dir, `crop${n % 2}.jpg`);
    const { hands: count } = await hands.ask(`crop ${file}`);
    if (!count) { last = ''; continue; }
    inFlight = new AbortController();
    const t0 = Date.now();
    try {
      const doing = await describe(file, DESK_PROMPT, inFlight.signal);
      // the same sentence twice adds nothing for the brain
      if (doing && doing !== last) publishEvent(client, { doing });
      last = doing;
      console.log(`[vision] look took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (e) {
      if (e.name !== 'AbortError') console.error('[vision]', e.message);
    } finally {
      inFlight = null;
    }
  }
};

const watchScene = async client => {
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
};

const client = connect();
let started = false;
client.on('connect', () => {
  if (started) return; // a reconnect must not start a second loop
  started = true;
  (MODE === 'desk' && !ONCE ? watchDesk : watchScene)(client);
});
