// Shared bits for the senses. Senses publish events only, never raw frames or audio.
import 'dotenv/config';
import mqtt from 'mqtt';
import { spawn } from 'node:child_process';

export const NODE = process.env.PEAK_NODE ?? 'mech';
export { OLLAMA } from '../lib/ollama.js';

/** Wait before reconnect attempt n (1, 2, ...): doubles from minMs, capped at maxMs. */
export const backoffMs = (n, minMs = 1000, maxMs = 30_000) => Math.min(maxMs, minMs * 2 ** Math.max(0, n - 1));

/** Connect to the broker. A long-running part names itself (`part`, or PEAK_PART, which run-part.sh sets): it then
 *  owns the retained topic peak/mind/<part>/status, "online" on every connect and "offline" by the broker's Last Will
 *  when the process dies, the same shape as a body's (node/servod.py). One-shot tools and hand runs pass no part and
 *  leave the topic alone, so a test run never flips a running part's status. A broker that is down or goes away is
 *  retried with backoff (1 s doubling to 30 s by default), never a reason to exit. */
export const connect = (part = process.env.PEAK_PART, { minMs = 1000, maxMs = 30_000 } = {}) => {
  const topic = part ? `peak/mind/${part}/status` : null;
  const client = mqtt.connect(process.env.PEAK_BROKER ?? 'mqtt://localhost:1883', {
    reconnectPeriod: minMs,
    ...(topic && { will: { topic, payload: 'offline', retain: true, qos: 1 } }),
  });
  let attempt = 0;
  client.on('connect', () => {
    if (attempt) console.log(`[${part ?? 'senses'}] broker back after ${attempt} attempt${attempt > 1 ? 's' : ''}`);
    attempt = 0;
    client.options.reconnectPeriod = minMs;
    if (topic) client.publish(topic, 'online', { retain: true, qos: 1 });
  });
  // mqtt.js retries on a fixed interval; widen it after each failed attempt. _clearReconnect and _setupReconnect
  // are mqtt.js 5's own (lib.test.js checks they still exist and that the waits grow).
  client.on('reconnect', () => {
    attempt += 1;
    const next = backoffMs(attempt + 1, minMs, maxMs);
    if (next !== client.options.reconnectPeriod) {
      client.options.reconnectPeriod = next;
      client._clearReconnect();
      client._setupReconnect();
    }
  });
  let lastError = '';
  client.on('error', e => {
    // the same refusal every attempt would fill the log; say it once per outage
    if (e.message !== lastError) console.error(`[${part ?? 'senses'}] mqtt:`, e.message);
    lastError = e.message;
  });
  client.on('connect', () => { lastError = ''; });
  return client;
};

/** Publish an event for a body (this sense's own by default). Every event carries `at`, the Unix time in ms it was
 *  published, so the mind can tell a fresh event from a stale one and time each stage (contracts/event.schema.json). */
export const publishEvent = (client, event, node = NODE) => {
  const stamped = { ...event, at: event.at ?? Date.now() };
  client.publish(`peak/${node}/event`, JSON.stringify(stamped));
  console.log(`[senses] ${node} → ${JSON.stringify(stamped)}`);
};

/** Log how a sense ends, so a silent death leaves a line in its log. */
export const logExits = name => {
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { console.log(`[${name}] exiting on ${sig}`); process.exit(0); });
  process.on('exit', code => console.log(`[${name}] exited (code ${code})`));
};

/** Run a command, resolve with { code, stdout, stderr } (stdout as Buffer). Never rejects on non-zero exit. */
export const run = (cmd, args) =>
  new Promise(resolve => {
    const p = spawn(cmd, args);
    const out = [], err = [];
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => err.push(d));
    p.on('error', e => resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(e) }));
    p.on('close', code => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }));
  });

export const sleep = ms => new Promise(r => setTimeout(r, ms));
