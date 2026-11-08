// hearing — listens to a PCM stream, cuts it into utterances at pauses, sends each to a resident
// whisper.cpp server, publishes {"heard": "..."}.
//   PEAK_AUDIO_SOURCE   udp://0.0.0.0:5001 for the Pi mic (node/audiod.sh); unset to use the Mac mic
//   PEAK_AUDIO_DEVICE   avfoundation audio index for the Mac mic (default 0; list: ffmpeg -f avfoundation -list_devices true -i "")
//   PEAK_AUDIO_FILE     transcribe this file once instead of the mic (for testing)
//   PEAK_WHISPER_URL    whisper-server (default http://127.0.0.1:8178); start it with `npm run whisper`
//   PEAK_MIN_DB         a 100 ms frame louder than this is speech (default -45; the Pi mic idles around -36)
//   PEAK_SILENCE_MS     this much quiet after speech ends the utterance (default 700)
//   PEAK_DEBUG          log every utterance whisper returns, including the ones filtered out
//   PEAK_DUMP_DIR       also save each utterance as a wav here (for mind/bakeoff)
//   PEAK_WAKE           off = publish every clean utterance; default on = only after "Rho" (heardFilter.js)
//   PEAK_WAKE_WINDOW_MS how long after the wake word follow-up sentences still pass (default 8000)
//   PEAK_HALF_DUPLEX    0 = also hear Rho's own voice; default on = drop Rho's own words while it speaks and just after (halfDuplex.js)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, logExits, publishEvent, run } from './lib.js';
import { createHeardFilter, isStop } from './heardFilter.js';
import { createHalfDuplex } from './halfDuplex.js';

const DEVICE = process.env.PEAK_AUDIO_DEVICE ?? '0';
const SOURCE = process.env.PEAK_AUDIO_SOURCE;
const WHISPER = process.env.PEAK_WHISPER_URL ?? 'http://127.0.0.1:8178';
const MIN_DB = Number(process.env.PEAK_MIN_DB ?? -45);
const SILENCE_MS = Number(process.env.PEAK_SILENCE_MS ?? 700);
const DUMP = process.env.PEAK_DUMP_DIR;
if (DUMP) mkdirSync(DUMP, { recursive: true });
const RATE = 16000;
const FRAME_MS = 100;
const FRAME_BYTES = (RATE * FRAME_MS) / 1000 * 2; // s16le mono
const PREROLL_FRAMES = 3; // kept from before speech starts so the first syllable is not clipped
const MIN_SPEECH_MS = 300; // shorter bursts are clicks and bumps, not words
const MAX_UTTERANCE_MS = 12000; // flush mid-sentence rather than wait for a pause that never comes
const heard = createHeardFilter(); // wake-word gate and noise filter; see heardFilter.js
const HALF_DUPLEX = (process.env.PEAK_HALF_DUPLEX ?? '1') !== '0';
const self = createHalfDuplex(); // when Rho itself was speaking

logExits('hearing');

const frameDb = frame => {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 2) { const s = frame.readInt16LE(i); sum += s * s; }
  const rms = Math.sqrt(sum / (frame.length / 2));
  return rms ? 20 * Math.log10(rms / 32768) : -91;
};

const wav = pcm => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};

const transcribe = async pcm => {
  const form = new FormData();
  form.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'utterance.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  try {
    const res = await fetch(`${WHISPER}/inference`, { method: 'POST', body: form });
    if (!res.ok) { console.error(`[hearing] whisper-server ${res.status}: ${(await res.text()).slice(0, 200)}`); return ''; }
    return (await res.json()).text?.trim() ?? '';
  } catch (e) {
    console.error(`[hearing] whisper-server unreachable at ${WHISPER} (${e.cause?.code ?? e.message}); start it with: cd mind && npm run whisper`);
    return '';
  }
};

// One transcription at a time; while one runs at most one utterance waits and a newer one replaces it.
let busy = false, waiting = null;
const handle = async (client, pcm, endedAt, loud = { from: endedAt - pcm.length / 2 / RATE * 1000, to: endedAt }) => {
  if (busy) { waiting = { pcm, endedAt, loud }; return; }

  busy = true;
  if (DUMP) writeFileSync(join(DUMP, `${new Date(endedAt).toISOString().replace(/[:.]/g, '-')}.wav`), wav(pcm));
  const text = await transcribe(pcm);
  if (process.env.PEAK_DEBUG) console.log(`[hearing] ${(pcm.length / RATE / 2).toFixed(1)}s utterance → "${text}"`);
  const latency = ((Date.now() - endedAt) / 1000).toFixed(1);
  // a stop is always heard, with or without the name, even over Rho's own voice; otherwise Rho's own words are dropped
  const self_ = text && HALF_DUPLEX ? self.judge(loud.from, loud.to, text) : { echo: false };
  if (text && isStop(text) && self_.why) {
    console.log(`[hearing] ${latency}s after speech ended (a stop while Rho spoke)`); publishEvent(client, { heard: text });
  } else if (self_.echo) {
    console.log(`[hearing] dropped "${text}" (Rho's own voice: ${self_.why})`);
  } else if (text) {
    const { text: clean, why } = heard.consider(text);
    const near = self_.why ? `; near Rho's line, ${self_.why}` : '';
    if (clean) { console.log(`[hearing] ${latency}s after speech ended (${why}${near})`); publishEvent(client, { heard: clean }); }
    else console.log(`[hearing] dropped "${text}" (${why})`);
  }
  busy = false;
  if (waiting) { const w = waiting; waiting = null; handle(client, w.pcm, w.endedAt, w.loud); }
};

/** Feed 100 ms frames; calls onUtterance(pcm) at each pause after speech. */
const segmenter = onUtterance => {
  // loudFrom/loudTo: when the first and last loud frame arrived, for the half-duplex check (a frame covers the
  // FRAME_MS before its arrival)
  let pending = Buffer.alloc(0), preroll = [], speech = [], speechMs = 0, quietMs = 0, loudFrom = 0, loudTo = 0;
  const flush = () => {
    if (speechMs >= MIN_SPEECH_MS) onUtterance(Buffer.concat([...preroll, ...speech]), { from: loudFrom - FRAME_MS, to: loudTo });
    preroll = []; speech = []; speechMs = 0; quietMs = 0;
  };
  return chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= FRAME_BYTES) {
      const frame = pending.subarray(0, FRAME_BYTES); pending = pending.subarray(FRAME_BYTES);
      const loud = frameDb(frame) >= MIN_DB;
      if (speech.length === 0 && !loud) { preroll.push(frame); if (preroll.length > PREROLL_FRAMES) preroll.shift(); continue; }
      speech.push(frame);
      if (loud) { if (!speechMs) loudFrom = Date.now(); loudTo = Date.now(); speechMs += FRAME_MS; quietMs = 0; } else quietMs += FRAME_MS;
      if (quietMs >= SILENCE_MS || speech.length * FRAME_MS >= MAX_UTTERANCE_MS) flush();
    }
  };
};

const inputArgs = SOURCE
  ? ['-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', SOURCE]
  : ['-f', 'avfoundation', '-i', `:${DEVICE}`];

/** One long-running ffmpeg writes 16 kHz mono PCM to stdout. */
const startRecorder = onData => {
  // No `-fflags nobuffer` here: it drops the audio ffmpeg reads while probing, which ate the first sentence.
  const p = spawn('ffmpeg', ['-loglevel', 'error', '-probesize', '32', '-analyzeduration', '0', ...inputArgs, '-ar', String(RATE), '-ac', '1', '-f', 's16le', 'pipe:1']);
  process.on('exit', () => p.kill('SIGKILL')); // SIGTERM lets ffmpeg linger and keep the UDP port bound past a quick restart
  p.stdout.on('data', onData);
  p.stderr.on('data', d => console.error('[hearing] ffmpeg:', String(d).trim().slice(-200)));
  p.on('close', code => { console.error(`[hearing] recorder exited (${code}); mic permission or stream?`); process.exit(1); });
  return p;
};

const client = connect();
// the voice's speaking flag, and its status so a voice that died mid-line does not leave hearing deaf
client.on('message', (topic, payload) => {
  if (topic === 'peak/mind/speaking') self.speaking(String(payload) === 'true');
  else if (topic === 'peak/mind/said') self.said(String(payload));
  else if (topic === 'peak/mind/voice/status' && String(payload) === 'offline') self.voiceGone();
});
client.on('connect', async () => {
  if (HALF_DUPLEX) client.subscribe(['peak/mind/speaking', 'peak/mind/said', 'peak/mind/voice/status']);
  if (process.env.PEAK_AUDIO_FILE) {
    const { stdout } = await run('ffmpeg', ['-loglevel', 'error', '-i', process.env.PEAK_AUDIO_FILE, '-ar', String(RATE), '-ac', '1', '-f', 's16le', 'pipe:1']);
    const text = await transcribe(stdout);
    const { text: clean, why } = heard.consider(text);
    if (clean) publishEvent(client, { heard: clean }); else console.log(`[hearing] dropped "${text}" (${why})`);
    return client.end();
  }
  console.log(`[hearing] listening on ${SOURCE ?? `Mac audio device ${DEVICE}`}, whisper at ${WHISPER}, speech above ${MIN_DB} dB, ${HALF_DUPLEX ? 'Rho\'s own words dropped' : 'half-duplex off'}`);
  startRecorder(segmenter((pcm, loud) => handle(client, pcm, Date.now(), loud)));
});
