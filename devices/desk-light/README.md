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

Seen on the first live run: the MQTT link drops for a moment during each radio burst (`Sending command` →
`connection lost!` → reconnect in about a second, availability flapping offline/online on the broker). The command
had already gone out over the radio. If it bothers the mind, lower the nRF24's PA level (`radio.setPALevel(RF24_PA_LOW)`
in `radio.cpp`'s `setup()`) or move the module a wire's length further from the board's antenna.

## Topics the firmware uses

| Topic | Payload |
| --- | --- |
| `peak/desk-light/l2m_<MAC>/availability` | `online` / `offline`, retained, Last Will |
| `peak/desk-light/l2m_<MAC>/0x<serial>/command` | JSON: `{"state":"ON"|"OFF"}`, `{"brightness":0..15}`, `{"color_temp":153..370}` (mireds) |
| `peak/desk-light/l2m_<MAC>/0x<serial>/state` | retained `{"state":"ON"}` as the firmware believes it |
| `peak/desk-light/l2m_<MAC>/0x<serial>/toggle_internal` | anything: flip the firmware's idea of on/off without touching the bar |

The bar's own on/off is a toggle, so the firmware tracks the state; the puck's button can put the two out of step.
