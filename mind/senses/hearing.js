// hearing — records short chunks, skips silence, transcribes with whisper, publishes {"heard": "..."}.
//   PEAK_AUDIO_DEVICE   avfoundation audio index on the Mac (default 0; list: ffmpeg -f avfoundation -list_devices true -i "")
//   PEAK_AUDIO_FILE     transcribe this file once instead of the mic (for testing)
//   PEAK_WHISPER_MODEL  default small (cached in ~/.cache/whisper)
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, publishEvent, run, sleep } from './lib.js';

const DEVICE = process.env.PEAK_AUDIO_DEVICE ?? '0';
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
    '--output_format', 'txt', '--output_dir', dir, '--verbose', 'False']);
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

const client = connect();
client.on('connect', async () => {
  if (process.env.PEAK_AUDIO_FILE) {
    await handle(client, process.env.PEAK_AUDIO_FILE);
    return client.end();
  }
  console.log(`[hearing] listening on audio device ${DEVICE}, whisper ${MODEL}`);
  for (let i = 0; ; i++) {
    const file = join(dir, `chunk${i}.wav`);
    const rec = await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'avfoundation', '-i', `:${DEVICE}`,
      '-t', String(CHUNK_S), '-ar', '16000', '-ac', '1', file]);
    if (rec.code !== 0) { console.error('[hearing] mic capture failed (permission?):', rec.stderr.slice(-200)); await sleep(5000); continue; }
    await handle(client, file); // sequential: a transcription delays the next chunk rather than piling up
  }
});
