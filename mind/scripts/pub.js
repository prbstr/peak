// Publish a command to a node. Usage:
//   node scripts/pub.js mech '{"gesture":"wave"}'
//   node scripts/pub.js mech '{"servo":"head","deg":120,"ms":500}'
import 'dotenv/config';
import mqtt from 'mqtt';
const [node, payload] = process.argv.slice(2);
if (!node || !payload) { console.error('usage: node scripts/pub.js <node> <json>'); process.exit(1); }
const c = mqtt.connect(process.env.PEAK_BROKER ?? 'mqtt://localhost:1883');
c.on('connect', () => c.publish(`peak/${node}/cmd`, payload, () => { console.log(`→ peak/${node}/cmd ${payload}`); c.end(); }));
