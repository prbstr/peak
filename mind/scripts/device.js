// Run a device action without the brain. Usage:
//   npm run device                 lists the actions and which devices are online
//   npm run device -- light_off    publishes one
import 'dotenv/config';
import mqtt from 'mqtt';
import { DEVICES, createDeviceHub } from '../orchestrator/devices.js';

const [name] = process.argv.slice(2);
if (name && !DEVICES.actions[name]) { console.error(`no action called ${name}`); process.exit(1); }
const c = mqtt.connect(process.env.PEAK_BROKER ?? 'mqtt://localhost:1883');
const hub = createDeviceHub(c);
c.on('connect', () => {
  if (!hub.statusTopics.length) return finish();
  c.subscribe(hub.statusTopics);
  // retained status arrives at once; give the broker a moment, then act
  setTimeout(finish, 500);
});
c.on('message', (topic, payload) => hub.status(topic, payload));
function finish() {
  if (!name) {
    for (const [device, d] of Object.entries(DEVICES.devices)) {
      console.log(`${device} (${hub.online.has(device) ? 'online' : 'offline'}): ${d.describe}`);
      for (const action of d.actions) console.log(`  ${action.padEnd(14)} ${DEVICES.actions[action].describe}`);
    }
    return c.end();
  }
  const { topic, payload } = DEVICES.actions[name];
  c.publish(topic, payload, { qos: 1 }, () => { console.log(`→ ${topic} ${payload}`); c.end(); });
}
