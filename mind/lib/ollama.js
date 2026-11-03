// Shared Ollama client for the mind: orchestrator, senses and the brain bake-off all go through here.
// One place owns the load-time options (num_ctx, keep_alive). If two callers load the same tag with
// different load-time options Ollama reloads it each time, which is exactly what we want to avoid when
// the brain and the eyes are one model.
import 'dotenv/config';

export const OLLAMA = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
export const KEEP_ALIVE = process.env.PEAK_KEEP_ALIVE ?? '30m';
export const loadOptions = () => ({ num_ctx: Number(process.env.PEAK_NUM_CTX ?? 4096) });

const toMs = ns => Math.round((ns ?? 0) / 1e6);

/** Ollama reports durations in nanoseconds; keep milliseconds and tokens/s. */
export const statsOf = r => {
  const evalMs = toMs(r.eval_duration);
  const evalTokens = r.eval_count ?? 0;
  return {
    totalMs: toMs(r.total_duration),
    loadMs: toMs(r.load_duration),
    promptTokens: r.prompt_eval_count ?? 0,
    promptMs: toMs(r.prompt_eval_duration),
    evalTokens,
    evalMs,
    tokPerS: evalMs ? Math.round(evalTokens / (evalMs / 1000)) : 0,
  };
};

export const formatStats = s =>
  `${(s.totalMs / 1000).toFixed(1)}s (load ${s.loadMs}ms, prompt ${s.promptTokens} tok ${s.promptMs}ms, out ${s.evalTokens} tok ${s.evalMs}ms, ${s.tokPerS} tok/s)`;

async function post(path, body) {
  const res = await fetch(`${OLLAMA}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return res;
}

async function get(path) {
  const res = await fetch(`${OLLAMA}${path}`);
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return res.json();
}

/** POST /api/chat without streaming. Returns the message, timing stats and token logprobs when asked for. */
export async function chat(body) {
  const r = await (await post('/api/chat', { stream: false, keep_alive: KEEP_ALIVE, ...body })).json();
  return { message: r.message, stats: statsOf(r), logprobs: r.logprobs ?? r.message?.logprobs ?? null };
}

/** POST /api/chat streaming. onChunk(contentSoFar, msSinceStart) runs per NDJSON line so a caller can act on
 *  the first field of a JSON reply before the rest is generated. Resolves to the same shape as chat(). */
export async function chatStream(body, onChunk = () => {}) {
  const t0 = performance.now();
  const res = await post('/api/chat', { keep_alive: KEEP_ALIVE, ...body, stream: true });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', content = '', thinking = '', logprobs = [], last = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (r.error) throw new Error(`ollama: ${r.error}`);
      content += r.message?.content ?? '';
      thinking += r.message?.thinking ?? '';
      const lp = r.logprobs ?? r.message?.logprobs;
      if (lp) logprobs = logprobs.concat(lp);
      last = r;
      onChunk(content, Math.round(performance.now() - t0));
    }
  }
  return { message: { role: 'assistant', content, thinking }, stats: statsOf(last ?? {}), logprobs: logprobs.length ? logprobs : null };
}

/** Loaded models: [{ name, size, size_vram, context_length, expires_at }] */
export async function ps() {
  return (await get('/api/ps')).models ?? [];
}

/** Installed model names. */
export async function tags() {
  return ((await get('/api/tags')).models ?? []).map(m => m.name);
}

export async function show(model) {
  return (await post('/api/show', { model })).json();
}

const capsCache = new Map();
export async function capabilities(model) {
  if (!capsCache.has(model)) capsCache.set(model, (await show(model)).capabilities ?? []);
  return capsCache.get(model);
}

/** Ollama rejects a `think` field on models without the thinking capability, so only send it where it applies. */
export async function thinkFlag(model) {
  return (await capabilities(model)).includes('thinking') ? false : undefined;
}

/** Pull a model, calling onProgress({ status, completed, total }) per NDJSON line. */
export async function pull(model, onProgress = () => {}) {
  const res = await post('/api/pull', { model, stream: true });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const p = JSON.parse(line);
      if (p.error) throw new Error(`pull ${model}: ${p.error}`);
      onProgress(p);
    }
  }
}

/** Evict a model now. */
export async function unload(model) {
  await post('/api/generate', { model, keep_alive: 0 });
}
