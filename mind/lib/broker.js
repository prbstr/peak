// Where the broker is and who to log in as. Every Node part connects through here (senses/lib.js connect(), the
// orchestrator, the hand scripts), so the broker's users (docs/broker.md) are decided in one place.
//   PEAK_BROKER                 mqtt://host:port (default mqtt://localhost:1883)
//   PEAK_MQTT_USER / _PASSWORD  set per part by scripts/run-part.sh; win when present
//   PEAK_MQTT_PASSWORD_<ROLE>   in mind/.env: MIND, SENSES, VOICE (written by scripts/broker-passwords.sh)
// No password found means no login: the broker as it was before 8 Nov, anonymous, still works.
import 'dotenv/config';

/** Read when called, so a test or a caller that sets PEAK_BROKER after import is honoured. */
export const brokerUrl = () => process.env.PEAK_BROKER ?? 'mqtt://localhost:1883';
export const BROKER = brokerUrl();

/** The broker user for a Mac part: the mind and health speak for the mind, hearing, vision and presence are senses. */
export const roleOf = part => (part === 'voice' ? 'voice' : ['hearing', 'vision', 'presence'].includes(part) ? 'senses' : 'mind');

/** { username, password } for mqtt.connect, or {} when no password is set. */
export function brokerAuth(role = 'mind', env = process.env) {
  const password = env.PEAK_MQTT_PASSWORD || env[`PEAK_MQTT_PASSWORD_${role.toUpperCase()}`];
  if (!password) return {};
  return { username: env.PEAK_MQTT_USER || role, password };
}
