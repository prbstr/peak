// Play a trick on a body, without the brain. Usage:
//   npm run trick                      lists the tricks
//   npm run trick -- peekaboo [node]   plays one (node defaults to mech)
import 'dotenv/config';
import mqtt from 'mqtt';
import { createTrickPlayer, loadTricks } from '../orchestrator/tricks.js';

const [name, node = 'mech'] = process.argv.slice(2);
const tricks = loadTricks();
if (!name || !tricks[name]) {
  if (name) console.error(`no trick called ${name}`);
  for (const [n, t] of Object.entries(tricks)) console.log(`${n.padEnd(12)} ${t.describe}${t.learned ? ' (learned)' : ''}`);
  process.exit(name ? 1 : 0);
}
const c = mqtt.connect(process.env.PEAK_BROKER ?? 'mqtt://localhost:1883');
c.on('connect', async () => {
  const logged = { publish: (topic, payload) => { console.log(`→ ${topic} ${payload}`); c.publish(topic, payload); } };
  await createTrickPlayer(logged, { tricks }).play(node, name);
  c.end();
});
