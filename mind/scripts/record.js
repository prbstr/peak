// Mic test page: a Start/Stop button for recording the body's live audio stream on the Mac.
//   npm run record            then open http://localhost:8179
// Start: captures the UDP stream from node/audiod.sh (same bytes hearing.js gets) to a wav.
// Stop: shows duration, levels, the whisper transcript, and a player so you can hear the clip.
// Clips land in PEAK_RECORD_DIR (default ~/peak-recordings).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from '../senses/lib.js';

const PORT = Number(process.env.PEAK_RECORD_PORT ?? 8179);
const SOURCE = process.env.PEAK_AUDIO_SOURCE ?? 'udp://0.0.0.0:5001';
const WHISPER = process.env.PEAK_WHISPER_URL ?? 'http://127.0.0.1:8178';
const DIR = process.env.PEAK_RECORD_DIR ?? join(homedir(), 'peak-recordings');
mkdirSync(DIR, { recursive: true });

let rec = null; // { proc, file, startedAt }

const start = () => {
  if (rec) return rec;
  const file = join(DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.wav`);
  const proc = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', SOURCE, file]);
  proc.stderr.on('data', d => console.error('[record] ffmpeg:', String(d).trim()));
  rec = { proc, file, startedAt: Date.now() };
  console.log(`[record] started ${file}`);
  return rec;
};

const stop = async () => {
  if (!rec) return null;
  const { proc, file, startedAt } = rec;
  rec = null;
  proc.stdin?.end();
  proc.kill('SIGINT'); // lets ffmpeg finish the wav header
  await new Promise(r => proc.on('close', r));
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const vol = await run('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const mean = /mean_volume: (-?[\d.]+)/.exec(vol.stderr)?.[1] ?? '?';
  const max = /max_volume: (-?[\d.]+)/.exec(vol.stderr)?.[1] ?? '?';
  let text = '(whisper-server not reachable)';
  try {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(file)], { type: 'audio/wav' }), 'clip.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    const res = await fetch(`${WHISPER}/inference`, { method: 'POST', body: form });
    if (res.ok) text = (await res.json()).text?.trim() || '(nothing)';
  } catch {}
  console.log(`[record] stopped ${file}: ${seconds}s, mean ${mean} dB, max ${max} dB → "${text}"`);
  return { file, seconds, mean, max, text };
};

const page = () => `<!doctype html><meta charset="utf-8"><title>Peak mic test</title>
<style>
  body{font:16px/1.5 system-ui;margin:2rem auto;max-width:36rem;padding:0 1rem}
  button{font-size:1.4rem;padding:.8rem 2rem;border-radius:.6rem;border:0;color:#fff;cursor:pointer}
  #start{background:#1d9e75}#stop{background:#d85a30}button:disabled{opacity:.4;cursor:default}
  #status{margin:1rem 0;color:#555}
  .clip{border:1px solid #ddd;border-radius:.6rem;padding:1rem;margin:1rem 0}
  .clip b{font-size:1.1rem} .meta{color:#666;font-size:.9rem}
</style>
<h1>Peak mic test</h1>
<p>Stream: <code>${SOURCE}</code>. Start <code>audiod.sh</code> on the Pi first.</p>
<button id="start">Start recording</button>
<button id="stop" disabled>Stop</button>
<div id="status">Idle</div>
<div id="clips"></div>
<script>
const $=id=>document.getElementById(id);
let t0,timer;
$('start').onclick=async()=>{await fetch('/start',{method:'POST'});$('start').disabled=true;$('stop').disabled=false;t0=Date.now();
  timer=setInterval(()=>$('status').textContent='Recording… '+((Date.now()-t0)/1000).toFixed(0)+' s',200);};
$('stop').onclick=async()=>{clearInterval(timer);$('stop').disabled=true;$('status').textContent='Transcribing…';
  const r=await (await fetch('/stop',{method:'POST'})).json();
  const d=document.createElement('div');d.className='clip';
  d.innerHTML='<b>'+(r.text||'')+'</b><div class="meta">'+r.seconds+' s · mean '+r.mean+' dB · peak '+r.max+' dB</div>'
    +'<audio controls src="/clip?f='+encodeURIComponent(r.file)+'"></audio>';
  $('clips').prepend(d);$('status').textContent='Idle';$('start').disabled=false;};
</script>`;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/start') { start(); return res.end('ok'); }
  if (req.method === 'POST' && url.pathname === '/stop') {
    const r = await stop();
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(r ?? { text: 'nothing was recording', seconds: 0, mean: '?', max: '?', file: '' }));
  }
  if (url.pathname === '/clip') {
    const f = url.searchParams.get('f');
    if (!f || !f.startsWith(DIR) || !existsSync(f)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'audio/wav');
    return res.end(readFileSync(f));
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(page());
}).listen(PORT, '127.0.0.1', () => console.log(`[record] http://localhost:${PORT}  clips → ${DIR}`));
