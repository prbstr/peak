# Desk light

The owner's Xiaomi Mi Computer Monitor Light Bar (MJGJD01YL), driven by an ESP32-C3 with an nRF24L01+ that acts as
the bar's own 2.4 GHz puck remote. The firmware is [lightbar2mqtt](https://github.com/ebinf/lightbar2mqtt) (Arduino,
MIT), used unchanged: only `config.h` is ours. The step-by-step guide with the wiring drawing is the Claude doc
"peak — Desk light guide" (link in `CLAUDE.md`). The mind's side is `mind/devices/devices.yaml`.

| File | What |
| --- | --- |
| `config.h.example` | Our `config.h` without the Wi-Fi password: pins, broker, root topic, discovery off. Copy to `config.h` beside the sketch and fill in the two blanks. `config.h` is gitignored. |
| `Lightbar/` | A clone of the firmware, made at flash time (`git clone https://github.com/ebinf/lightbar2mqtt`), not committed. |

## Wiring, nRF24L01+ to ESP32-C3

| Radio pin | Board pin |
| --- | --- |
| 1 GND | GND |
| 2 VCC | **3V3**, never 5V |
| 3 CE | GPIO10 |
| 4 CSN | GPIO7 |
| 5 SCK | GPIO4 |
| 6 MOSI | GPIO6 |
| 7 MISO | GPIO5 |
| 8 IRQ | not connected |

The GPIO numbers are the ones in `config.h.example`; they avoid the C3's boot pins (2, 8, 9) and USB (18, 19). Confirm
them against the board's silkscreen before plugging in.

## Build and flash (Mac mini)

```sh
brew install arduino-cli
arduino-cli config init
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index && arduino-cli core install esp32:esp32        # about 1.5 GB
arduino-cli lib install "Arduino_JSON@0.2.0" "CRC@1.0.3" "PubSubClient@2.8" "RF24@1.4.10"
git clone https://github.com/ebinf/lightbar2mqtt devices/desk-light/Lightbar   # the folder must be named after Lightbar.ino
cp devices/desk-light/config.h.example devices/desk-light/Lightbar/config.h   # then fill in WIFI_SSID and WIFI_PASSWORD
arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc devices/desk-light/Lightbar   # CDCOnBoot=cdc, or Serial goes to UART0 and the USB monitor stays blank
arduino-cli upload -p /dev/cu.usbmodem* --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc devices/desk-light/Lightbar
arduino-cli monitor -p /dev/cu.usbmodem* -c baudrate=115200
```

First boot prints `Root Topic: peak/desk-light/l2m_<MAC>`; a press of the puck prints `unknown serial: 0x<hex>`. Both
go into `config.h` (`REMOTES` and `LIGHTBARS`, the same serial) and into `mind/devices/devices.yaml` (`base` and the
action topics), then flash again. The firmware prints the serial unpadded and uses it lowercase in topics: the owner's
puck is `0x08D722` in `config.h` and `0x8d722` in the topics. The board is `l2m_E8F60A4E22A8`.

## Two patches to the sketch, made at flash time (7 Nov 2026)

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
