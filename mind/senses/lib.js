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

export const publishEvent = (client, event) => {
  client.publish(`peak/${NODE}/event`, JSON.stringify(event));
  console.log(`[senses] → ${JSON.stringify(event)}`);
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
