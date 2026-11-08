// Shared bits for the senses. Senses publish events only, never raw frames or audio.
import 'dotenv/config';
import mqtt from 'mqtt';
import { spawn } from 'node:child_process';

export const NODE = process.env.PEAK_NODE ?? 'mech';
export { OLLAMA } from '../lib/ollama.js';

export const connect = () => {
  const client = mqtt.connect(process.env.PEAK_BROKER ?? 'mqtt://localhost:1883');
  client.on('error', e => console.error('[senses] mqtt:', e.message));
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
