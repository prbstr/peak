// hearing — records short chunks, skips silence, transcribes with whisper, publishes {"heard": "..."}.
//   PEAK_AUDIO_SOURCE   udp://0.0.0.0:5001 for the Pi mic (node/audiod.sh); unset to use the Mac mic
//   PEAK_AUDIO_DEVICE   avfoundation audio index for the Mac mic (default 0; list: ffmpeg -f avfoundation -list_devices true -i "")
//   PEAK_AUDIO_FILE     transcribe this file once instead of the mic (for testing)
//   PEAK_WHISPER_MODEL  default small (cached in ~/.cache/whisper)
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, publishEvent, run, sleep } from './lib.js';

const DEVICE = process.env.PEAK_AUDIO_DEVICE ?? '0';
const SOURCE = process.env.PEAK_AUDIO_SOURCE;
const MAX_BACKLOG = 2; // chunks waiting for whisper; older ones are dropped so we stay near real time
const MODEL = process.env.PEAK_WHISPER_MODEL ?? 'small';
const CHUNK_S = Number(process.env.PEAK_CHUNK_S ?? 5);
const MIN_DB = Number(process.env.PEAK_MIN_DB ?? -45); // mean volume below this counts as silence
// Whisper invents these on near-silence
const HALLUCINATIONS = /^(thanks? for watching|thank you\.?|you|bye\.?|\.+)$/i;

const dir = mkdtempSync(join(tmpdir(), 'peak-hearing-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

const meanVolume = async file => {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = /mean_volume: (-?[\d.]+) dB/.exec(stderr);
  return m ? Number(m[1]) : -91;
};

const transcribe = async file => {
  const { code, stderr } = await run('whisper', [file, '--model', MODEL, '--language', 'en', '--fp16', 'False',
    '--initial_prompt', 'Hey Peak, wave at me. Peak is a robot.', '--output_format', 'txt', '--output_dir', dir, '--verbose', 'False']);
  if (code !== 0) { console.error('[hearing] whisper failed:', stderr.slice(-300)); return ''; }
  const base = file.split('/').pop().replace(/\.[^.]+$/, '');
  return readFileSync(join(dir, `${base}.txt`), 'utf8').trim();
};

const handle = async (client, file) => {
  const db = await meanVolume(file);
  if (db < MIN_DB) return;
  const text = await transcribe(file);
  if (text && !HALLUCINATIONS.test(text)) publishEvent(client, { heard: text });
};

const inputArgs = SOURCE
  ? ['-f', 's16le', '-ar', '16000', '-ac', '1', '-i', SOURCE]
  : ['-f', 'avfoundation', '-i', `:${DEVICE}`];

/** One long-running ffmpeg cuts the stream into CHUNK_S wav files, so no audio is lost between chunks. */
const startRecorder = () => {
  const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...inputArgs, '-ar', '16000', '-ac', '1',
    '-f', 'segment', '-segment_time', String(CHUNK_S), '-reset_timestamps', '1', join(dir, 'chunk%05d.wav')]);
  p.stderr.on('data', d => console.error('[hearing] ffmpeg:', String(d).trim().slice(-200)));
  p.on('close', code => { console.error(`[hearing] recorder exited (${code}); mic permission or stream?`); process.exit(1); });
  return p;
};

const client = connect();
client.on('connect', async () => {
  if (process.env.PEAK_AUDIO_FILE) {
    await handle(client, process.env.PEAK_AUDIO_FILE);
    return client.end();
  }
  console.log(`[hearing] listening on ${SOURCE ?? `Mac audio device ${DEVICE}`}, whisper ${MODEL}`);
  startRecorder();
  // The newest file is still being written; every older one is complete.
  for (;;) {
    await sleep(500);
    const ready = readdirSync(dir).filter(f => f.startsWith('chunk')).sort().slice(0, -1);
    for (const stale of ready.slice(0, -MAX_BACKLOG)) rmSync(join(dir, stale), { force: true });
    for (const name of ready.slice(-MAX_BACKLOG)) {
      const file = join(dir, name);
      await handle(client, file);
      rmSync(file, { force: true });
    }
  }
});
