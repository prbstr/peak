// peak mind — embedded MQTT broker (aedes). Replaces mosquitto; nothing to brew.
// Run on the Mac: npm run broker   (listens on 0.0.0.0:1883 so the Pi can reach it)
import Aedes from 'aedes';
import { createServer } from 'node:net';

const PORT = Number(process.env.PEAK_BROKER_PORT ?? 1883);
const aedes = new Aedes();
const server = createServer(aedes.handle);

aedes.on('client', c => console.log(`[broker] + ${c.id}`));
aedes.on('clientDisconnect', c => console.log(`[broker] - ${c.id}`));
aedes.on('publish', (pkt, client) => {
  if (client && !pkt.topic.startsWith('$SYS')) {
    const body = pkt.payload.length > 120 ? `${pkt.payload.length} bytes` : pkt.payload.toString();
    console.log(`[broker] ${client.id} → ${pkt.topic} ${body}`);
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`[broker] peak MQTT broker on :${PORT}`));
