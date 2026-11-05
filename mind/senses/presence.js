// presence — watches every body's sense readings (PIR, ultrasonic) and publishes {"sensed": "..."} when someone
// arrives or something comes close. The thresholds live in presenceFilter.js.
//   PEAK_QUIET_S          seconds without movement before the next movement counts as an arrival (default 60)
//   PEAK_NEAR_CM          nothing farther than this is ever "close" (default 30)
//   PEAK_NEAR_COOLDOWN_S  seconds between two "close" events (default 10)
import { connect } from './lib.js';
import { createPresenceFilter } from './presenceFilter.js';

const filters = new Map(); // one per body: each has its own room and its own wall

const client = connect();
client.on('connect', () => {
  console.log('[presence] watching peak/+/sense');
  client.subscribe('peak/+/sense');
});
client.on('message', (topic, payload) => {
  const node = topic.split('/')[1];
  let sense;
  try { sense = JSON.parse(payload.toString()); } catch { return; }
  if (!filters.has(node)) filters.set(node, createPresenceFilter());
  for (const sensed of filters.get(node).consider(sense)) {
    client.publish(`peak/${node}/event`, JSON.stringify({ sensed }));
    console.log(`[presence] ${node} → ${JSON.stringify({ sensed })}`);
  }
});
