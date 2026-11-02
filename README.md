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
mosquitto_pub -t peak/mech/event -m '{"heard":"hey peak, wave at me"}'
```

See CLAUDE.md for architecture decisions, environment facts, gotchas and current status. SHOPPING.md tracks parts.
