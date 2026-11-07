# Desk light

The owner's Xiaomi Mi Computer Monitor Light Bar (MJGJD01YL), driven by an **ESP32-C6-WROOM-1 devkit** with an
nRF24L01+ that speaks the bar's own 2.4 GHz puck protocol. Since the evening of 7 Nov 2026 the firmware is
**ESPHome** with the `xiaomi_lightbar` external component (juancase, via the kriodoxis fork; MIT): relative steps,
state that survives a reboot, the puck's presses heard, non-blocking sends, ESPHome's own MQTT with birth and will.
The mind's side is `mind/devices/devices.yaml`. The step-by-step guide is the Claude doc "peak — Desk light guide"
(link in `CLAUDE.md`).

| File | What |
| --- | --- |
| `light.yaml` | The ESPHome node: Wi-Fi, OTA, MQTT-only (`peak/desk-light/status` birth/will, no `api:`), SPI pins, the light with the puck's serial, the puck as an event. |
| `secrets.yaml` | Wi-Fi name and password, the OTA phrase. Gitignored; template in `../c6/secrets.yaml.example`. |
| `.esphome/` | Build output and the downloaded component. Gitignored. |
| `config.h.example`, `Lightbar/` | The retired lightbar2mqtt route (Arduino), kept for its lessons below. `Lightbar/` is a clone, gitignored. |

## Wiring, nRF24L01+ to the ESP32-C6 (top row, one run of holes beside 3V3 and GND)

| Radio pin | C6 pin |
| --- | --- |
| 1 GND | GND (beside 3V3) |
| 2 VCC | **3V3**, never 5V |
| 3 CE | 10 |
| 4 CSN | 1 |
| 5 SCK | 6 |
| 6 MOSI | 7 |
| 7 MISO | 0 |
| 8 IRQ | not connected |

Avoided: 4, 5, 8, 9, 15 (boot strapping), 12 and 13 (USB), RX/TX. The component's README asks for a 10 µF capacitor
across the module's VCC and GND; it worked without one on 7 Nov. Use the C6's **USB** socket, not COM.

## Build and flash (Mac mini, from `devices/`)

```sh
.venv/bin/esphome run desk-light/light.yaml --device /dev/cu.usbmodem31101   # first time, over USB (the ESP-IDF toolchain downloads, about 1.5 GB)
.venv/bin/esphome run desk-light/light.yaml --device desk-light.local         # afterwards, over the air
```

`esphome` lives in `devices/.venv` (python3.13). The node's log goes to MQTT: `mosquitto_sub -t peak/desk-light/debug`.

## Topics (ESPHome's own)

| Topic | Payload |
| --- | --- |
| `peak/desk-light/status` | `online` / `offline`, retained, Last Will: the hive's convention |
| `peak/desk-light/light/bar/command` | JSON: `{"state":"ON"}`, `{"state":"ON","brightness":51}` (0 to 255), `{"state":"ON","color_temp":370}` (mireds, 154 cool to 370 warm) |
| `peak/desk-light/light/bar/state` | retained JSON with the same fields |
| `peak/desk-light/button/calibrate_on/command`, `.../calibrate_off/command` | `PRESS`: tell the node the bar is on or off without touching it (the bar only hears "flip", so the node keeps a memory) |
| `peak/desk-light/button/resend/command` | `PRESS`: set brightness and colour again absolutely |
| `peak/desk-light/debug` | the node's log |

The first level change after a reboot is absolute (dim to the floor, climb to the target); every one after that is a
relative step, like the puck.

## What was learned on the retired route (lightbar2mqtt on the ESP32-C3 SuperMini, 7 Nov 2026)

| Patch | Why |
| --- | --- |
| In `Lightbar.ino`, after `WiFi.begin(...)`: `WiFi.mode(WIFI_STA);` before it and `WiFi.setTxPower(WIFI_POWER_8_5dBm);` after it | The ESP32-C3 SuperMini's antenna is mismatched; at full power it never associated (a dot a second for minutes). With 8.5 dBm it joined in 2 s. |
| Build with `CDCOnBoot=cdc` | Without it the serial monitor over USB shows nothing: `Serial` is UART0 on pins 20/21. |
| In `Lightbar.ino`: `WiFi.setSleep(false)` | The radio burst knocked the C3 off the broker, and a whole voice window's commands were lost while it reconnected (the mind saw it offline for a minute). No modem sleep made the drops rarer. |
| Clean session, QoS 0 (the firmware's defaults, after a detour through a persistent QoS 1 session) and the mind refuses to publish to a device that is offline | The persistent session replayed the on/off commands published during an outage, minutes late, each a real toggle of the bar: the light flipped on and off by itself ("choppy"). A lost command is better than a replayed one for a device that only hears "flip"; the mind logs `desk_light is offline; light_on not sent` instead. |
| In `mqtt.cpp` `loop()`: publish `availability` = `online` (retained) every 10 s | When the ESP reconnects under the same client id, the broker publishes the old session's will, `offline`, after the new birth, so the retained value lied for as long as the next reconnect. The heartbeat corrects it within 10 s. |
| Wi-Fi TX power stays at 8.5 dBm | 11 dBm joined but dropped on its own 18 s later. The C3 SuperMini's Wi-Fi is the weak link; the light moves to the ESP32-C6 next. |
| Radio power stays at `RF24_PA_MAX` (the firmware's default; `setPALevel` is written out in `setup()` so nobody lowers it again) | Tried LOW and HIGH to spare the Wi-Fi: at both, on→off still landed but off→on and the level pairs did not. At MAX with the hopping, on, dim and off all showed on the glass. |
| In `mqtt.cpp`: subscribe to `+/state` and adopt the retained value at (re)connect; no state publish at connect | The bar only ever hears "flip", so the firmware's memory of on/off must be right. It used to assume ON at every boot, so after a reflash "off" turned the bar on. Now the broker's retained state is the truth. If they drift (the puck's button), publish anything to `.../0x8d722/toggle_internal` to flip the firmware's idea without touching the bar, or set the retained `.../state` to `{"state":"OFF"}` before a reflash. |
| `mind/devices/devices.yaml`: the level actions send `{"state":"ON", ...}` | A brightness or colour change on a bar that is off showed nothing; now "dim the light" turns it on dim. |
| In `radio.cpp`, `sendCommand()`: the 20 writes hop over channels 6, 15, 43 and 68 (five each), then the channel goes back to 68 for listening | Sent on 68 alone, the bar switched off but never back on: in standby it does not listen on that channel. The original puck hops over these four (lamperez's notes); lamperez's own driver uses 6. With the hop, off-on-off-on worked four of four on the glass. Worth offering upstream. |

Seen on the first live run, and not since the hopping patch (three runs, 11 commands, no drop): the MQTT link
dropped for a moment during a radio burst (`Sending command` → `connection lost!` → reconnect in about a second,
availability flapping on the broker). A command published while the link is down is lost. If it comes back, lower the
nRF24's PA level (`radio.setPALevel(RF24_PA_LOW)` in `radio.cpp`'s `setup()`, what lamperez uses from close by) or
move the module a wire's length further from the board's antenna.

## Topics the firmware uses

| Topic | Payload |
| --- | --- |
| `peak/desk-light/l2m_<MAC>/availability` | `online` / `offline`, retained, Last Will |
| `peak/desk-light/l2m_<MAC>/0x<serial>/command` | JSON: `{"state":"ON"|"OFF"}`, `{"brightness":0..15}`, `{"color_temp":153..370}` (mireds) |
| `peak/desk-light/l2m_<MAC>/0x<serial>/state` | retained `{"state":"ON"}` as the firmware believes it |
| `peak/desk-light/l2m_<MAC>/0x<serial>/toggle_internal` | anything: flip the firmware's idea of on/off without touching the bar |

The bar's own on/off is a toggle, so the firmware tracks the state; the puck's button can put the two out of step.
