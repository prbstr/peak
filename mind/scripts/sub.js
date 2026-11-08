// Watch everything on the hive bus. Usage: node scripts/sub.js
import 'dotenv/config';
import mqtt from 'mqtt';
import { BROKER, brokerAuth } from '../lib/broker.js';
const c = mqtt.connect(BROKER, brokerAuth('mind'));
c.on('connect', () => { c.subscribe('peak/#'); console.log('listening on peak/#'); });
c.on('message', (t, m) => console.log(t, m.toString()));
