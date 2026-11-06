# peak

A hive-mind robot whose character is called Rho. One mind (Mac mini M4 Pro), many bodies. First body: **Mech Suit** — a Lego Technic mech with a minifig pilot, six GeekServos, and a Raspberry Pi 3B in the backpack.

```
peak/
  mind/            Node.js — runs on the Mac
    orchestrator/  MQTT in → local model via Ollama → MQTT out
    senses/        camera frames → local vision; mic → speech-to-text; PIR and distance → presence
    tricks/        tricks.yaml: named sequences of eye moves, gestures and words the hive can play on a body
    voice/         text-to-speech → node speaker
  node/            Python — runs on the Pi
    servod.py      subscribes peak/<node>/cmd, drives PCA9685 with eased moves; reads PIR and ultrasonic, draws the OLED
    eyes.py        the OLED's eyes: a Python port of FluxGarage RoboEyes
    screen.py      the reflexes that move the eyes: asleep, startled, looking, talking, strained, wandering
    oled.py        packs a frame for the SSD1306 and sends only the bytes that changed
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
| `peak/<node>/sense` | node → mind | `{"uptime":123,"temp":48.2,"distance_cm":42,"motion":false,"throttled":"0x0"}` twice a second |
| `peak/<node>/frame` | node → mind | JPEG snapshot (binary) on request |
| `peak/brain/intent` | mind → all | what the mind decided, for coherence across bodies |

## Quick start

Mac (broker and mind):
```sh
brew install mosquitto ollama ffmpeg whisper.cpp
brew services start mosquitto        # add `listener 1883 0.0.0.0` and `allow_anonymous true` to mosquitto.conf, then restart
ollama pull huihui_ai/qwen3-vl-abliterated:8b-instruct   # brain and eyes in one model
mkdir -p ~/.cache/whisper.cpp && curl -L -o ~/.cache/whisper.cpp/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
cd mind && npm install && cp .env.example .env
npm start                            # plus `npm run whisper` and `npm run hearing` in their own terminals
```

Pi (Raspberry Pi OS Lite 64-bit, user `lupin`, hostname = node name):
```sh
scripts/deploy-node.sh mech.local    # after running scripts/pi-firstboot.sh mech on the Pi
```

Bench test from the Mac:
```sh
mosquitto_pub -t peak/mech/cmd -m '{"gesture":"wave"}'
mosquitto_pub -t peak/mech/event -m '{"heard":"hey rho, wave at me"}'
```

See CLAUDE.md for architecture decisions, environment facts, gotchas and current status. SHOPPING.md tracks parts.

## Licence and credit

peak is free software under the GNU General Public License, version 3 or later (see `LICENSE`).

The eyes on the OLED (`node/eyes.py`) are a Python port of [FluxGarage RoboEyes](https://github.com/FluxGarage/RoboEyes)
V 1.1.1, Copyright (C) 2024-2025 Dennis Hoelscher, also GPL-3-or-later. The file's header says what was changed.
