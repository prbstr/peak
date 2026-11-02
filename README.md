# peak

A hive-mind robot. One mind (Mac mini M5 Pro), many bodies. First body: **Mech Suit** — a Lego Technic mech with a minifig pilot, six GeekServos, and a Raspberry Pi 3B in the backpack.

```
peak/
  mind/            Node.js — runs on the Mac
    orchestrator/  MQTT in → local model via Ollama → MQTT out
    senses/        camera frames → local vision; mic → speech-to-text
    voice/         text-to-speech → node speaker
  node/            Python — runs on the Pi
    servod.py      subscribes peak/<node>/cmd, drives PCA9685 with eased moves
    config.yaml    channel map, ranges, rest angles
    gestures.yaml  named keyframe sequences (wave, point, nod, shrug)
    camd.sh        rpicam-vid → UDP stream to the mind
  contracts/       JSON schemas for every MQTT topic
```

The Pi 3B runs only `servod` and `camd`. All AI (orchestrator, vision, speech) stays on the Mac.

## MQTT topics

| Topic | Direction | Payload |
| --- | --- | --- |
| `peak/<node>/cmd` | mind → node | `{"servo":"head","deg":120,"ms":500}` or `{"gesture":"wave"}` or `{"say":"hello"}` |
| `peak/<node>/sense` | node → mind | `{"uptime":123,"temp":48.2,"battery":4.9,"distance_cm":42}` |
| `peak/<node>/frame` | node → mind | JPEG snapshot (binary) on request |
| `peak/brain/intent` | mind → all | what the mind decided, for coherence across bodies |

## Quick start

Mac:
```sh
brew install mosquitto
brew services start mosquitto
cd mind && npm install && cp .env.example .env   # PEAK_MODEL is an Ollama model, e.g. huihui_ai/qwen3-abliterated:8b
npm start
```

Pi (Raspberry Pi OS Lite 64-bit, I²C enabled via raspi-config):
```sh
sudo apt install -y python3-pip i2c-tools mosquitto-clients rpicam-apps
pip install -r node/requirements.txt --break-system-packages
PEAK_BROKER=<mac-ip> PEAK_NODE=mech python3 node/servod.py
```

Bench test from the Mac:
```sh
mosquitto_pub -t peak/mech/cmd -m '{"servo":"head","deg":120,"ms":500}'
mosquitto_pub -t peak/mech/cmd -m '{"gesture":"wave"}'
```
