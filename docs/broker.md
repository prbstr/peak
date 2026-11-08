# The broker's logins

Since 8 Nov 2026 every client of Rho's Mosquitto broker can log in, and `scripts/broker-auth.sh on` makes the broker
require it. Until then it stays anonymous on every interface, as it has been since 2 Nov.

## Users

One user per role, each limited to its topics by `broker/peak.acl`. A publish outside its lines is dropped by the
broker with no error to the client, so a new topic needs a line there first.

| User | Who | Writes | Reads | Password lives in |
| --- | --- | --- | --- | --- |
| `mind` | orchestrator, health, `npm run trick/device/pub/sub` | `peak/#` | `peak/#` | `mind/.env` `PEAK_MQTT_PASSWORD_MIND` |
| `senses` | hearing, vision, presence | `peak/+/event`, `peak/mind/+/status` | `peak/+/event`, `peak/+/sense`, `peak/mind/speaking`, `peak/mind/said` | `mind/.env` `PEAK_MQTT_PASSWORD_SENSES` |
| `voice` | `homepod.py`, the Kokoro backend | `peak/mind/voice/status`, `peak/mind/speaking`, `peak/mind/said` | `peak/+/cmd` | `mind/.env` `PEAK_MQTT_PASSWORD_VOICE` |
| `mech` | `servod.py` on the Pi | `peak/mech/sense`, `peak/mech/status` | `peak/mech/cmd`, `peak/mind/+/status` | Pi `~/peak/peak.env` |
| `desk-light` | the ESP32-C6 (ESPHome) | `peak/desk-light/#` | `peak/desk-light/#` | `devices/desk-light/secrets.yaml` `mqtt_password` |
| `owner` | your `mosquitto_sub` / `mosquitto_pub` | `peak/#` | `peak/#`, `$SYS/#` | `~/.config/mosquitto_sub`, `~/.config/mosquitto_pub` |

The Node parts get their login from `mind/lib/broker.js`; `scripts/run-part.sh` sets `PEAK_MQTT_USER` and
`PEAK_MQTT_PASSWORD` per part for the LaunchAgents. No password set means no login, which the anonymous broker accepts,
so the code can go everywhere before the switch. The blank ESPHome node (`devices/blank-node/`) has no user yet.

## Turning logins on, in this order

1. **Mac, the owner, in his own terminal, from the repo root:** `scripts/broker-passwords.sh`. It asks for each of
   the six passwords, typed hidden (Enter makes a random one; letters, digits, `. _ -` only) and writes each where its
   client reads it, plus the hashed `/opt/homebrew/etc/mosquitto/passwd`. It restarts nothing.
2. **Mac:** restart the Mac parts so they log in: `cd mind && npm run down && npm run up`. Still anonymous, so nothing
   is refused.
3. **Mac, the owner (asks the Pi's sudo password):** `scripts/deploy-node.sh`, so servod logs in as `mech`.
4. **Mac:** re-flash the light over the air: `cd devices && .venv/bin/esphome run desk-light/light.yaml --device desk-light.local`.
5. **Mac:** `scripts/broker-auth.sh on`. It installs `broker/mosquitto.conf` and `broker/peak.acl`, keeps the old
   config as `mosquitto.conf.before-auth`, turns on persistence (retained messages survive a broker restart), restarts
   the broker and checks that an anonymous client is refused. Then `npm run status`: every part, `mech` and
   `desk-light` online.

The way back: `scripts/broker-auth.sh off`.

## Tested 8 Nov 2026, on private brokers (ports 1884 and 1885), never the live one

| Check | Result |
| --- | --- |
| Anonymous broker, a client that sends a login | accepted |
| Logins on: no login / a wrong password | refused / refused |
| `senses` to `peak/mech/event` / to `peak/mech/cmd` | delivered / dropped |
| `mind` to `peak/mech/cmd` and to the light's command topic | delivered |
| `mech` to `peak/mech/sense` / to `peak/mech/event` | delivered / dropped |
| `voice` to `peak/mind/speaking` / to `peak/mech/cmd` | delivered / dropped |
| `run-part.sh presence` with a `senses` password | logged in, `peak/mind/presence/status` online |
| `mosquitto_sub` with / without `~/.config/mosquitto_sub` | in / "not authorised" |
| Python (paho) as `voice` | logged in |

## Switched on, 8 Nov 2026 09:58

The owner ran `scripts/broker-passwords.sh` (six users in the hashed file; each password checked in place by key name
only), the Mac parts were restarted (each started as its user: mind and health `mind`, hearing, vision and presence
`senses`, voice `voice`), the light was re-flashed over the air (7 s upload, back online with its state), the owner ran
`scripts/deploy-node.sh` (servod with the login code, one servod), then `scripts/broker-auth.sh on`.

| Check, live | Result |
| --- | --- |
| Anonymous client | refused: Not authorized |
| Every Mac part, `mech`, `desk-light` | back online within seconds (health: "broker back after 1 attempt") |
| `npm run trick -- wink` (as `mind`) | eyes command delivered |
| `mosquitto_pub` a nod (as `owner`, from `~/.config/mosquitto_pub`) | 30 simulated servo steps on the Pi |
| `npm run device -- light_bright` (as `mind`) | published; the light reports on at 255 |

One gap found and fixed: health published whisper's retained status only when it changed, so the broker restart left it
empty; it now publishes again after every reconnect.

