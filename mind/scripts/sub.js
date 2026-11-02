// Watch everything on the hive bus. Usage: node scripts/sub.js
import 'dotenv/config';
import mqtt from 'mqtt';
const c = mqtt.connect(process.env.PEAK_BROKER ?? 'mqtt://localhost:1883');
c.on('connect', () => { c.subscribe('peak/#'); console.log('listening on peak/#'); });
c.on('message', (t, m) => console.log(t, m.toString()));
