# peak

Hobby project: an AI-guided robot with a hive-mind design. One mind on Sharad's Mac mini (24 GB), many Lego bodies talking over MQTT. First body: **mech**, a Lego Technic mech with a minifig pilot, 6 GeekServos and a Raspberry Pi 3B in the backpack. Later bodies: rover, drone. See README.md for layout and quick start, SHOPPING.md for parts and orders.

Keep this file current. When state, a decision or a gotcha changes, update the matching section before ending the session.

## Vocabulary

| Term | Meaning |
| --- | --- |
| mind | Mac side, `mind/`: Node.js. Orchestrator plus senses. |
| node / body | A robot. Pi code lives in `node/`. |
| mech | First body. Pi hostname **and** MQTT node name (`peak/mech/...`). |
| lupin | Login user on the Pi. Not `pi`. (Also a separate project, `../lupin`, a context engine; unrelated to this repo.) |
| hive | All bodies share one mind and one broker. |

## Architecture

```
Pi (mech)                         Mac (mind)
 servod.py  <-- peak/mech/cmd --  orchestrator  <-- Ollama (brain)
 servod.py  -- peak/mech/sense -> orchestrator
 audiod.sh  -- UDP :5001 PCM ---> senses/hearing.js (whisper) -- peak/mech/event -> orchestrator
 camd.sh    -- UDP :5000 H264 --> senses/vision.js (Ollama vision) -- peak/mech/event ->
```

- One Mosquitto broker on the Mac (brew service, `*:1883`, anonymous). Bodies are clients only.
- Topics: `peak/<node>/cmd`, `peak/<node>/sense`, `peak/<node>/event`, `peak/brain/intent`. Schemas in `contracts/`.
- Senses publish **events only**, never raw frames or audio. The orchestrator thinks on events.
- The brain never moves servos directly. It replies with `{gesture, say}` JSON (enforced with Ollama structured outputs); gestures are named in `node/gestures.yaml`.
- The brain model has no native tool calling in its template, hence the JSON reply shape. `look_at` is therefore not exposed right now.
- The orchestrator handles events one at a time and drops events when 2 are already queued (`MAX_PENDING`).

## Decisions and why

| Decision | Why |
| --- | --- |
| Mosquitto, not RabbitMQ or embedded aedes | Retained messages and Last Will give body presence for free; ESP32 bodies speak MQTT natively. aedes was removed. |
| All AI on the Mac, Pi stays thin | Pi 3B is too slow for whisper or vision. It runs only servod, camd, audiod. |
| Local Ollama brain, not Anthropic | Owner's choice. Default `huihui_ai/qwen3-abliterated:8b`. |
| 8B brain + `qwen2.5vl:3b` vision | 24 GB Mac: the 14B brain plus any decent vision model evicts each other. `gemma4:26b` (19 GB) and 14B were too big; `moondream` fits but its descriptions are garbage. |
| Pi mic streams to the Mac | whisper `small` runs on the Mac; `hearing.js` reads UDP :5001. |
| Power: undecided between three layouts | Parts ordered: UBEC 5A, UBEC 3A (5.25V ±0.5V, in 5.5-26V), Mini560 5V Pro x5 (needs about 7V in). Concept A (SHOPPING.md): UBEC 5A servos, Mini560 Pi. B: swapped. C (leaning): both UBECs, Mini560 spare. Decide after measuring outputs with a multimeter. |
| Deploy by rsync | `scripts/deploy-node.sh`. |
| Python venv on the Pi at `~/peak/.venv` | Bookworm blocks system pip. |

## Roadmap stages

| Stage | What | When |
| --- | --- | --- |
| A, today | One Mac mind, thin Pi body over MQTT | Working in sim |
| B | Reflex layer on the Pi (obstacle stop, finish gestures if Wi-Fi drops, servo limits) | Once servos are wired |
| C | Hive: Lupin memory (`../lupin`, MCP) plus more bodies (ESP32 rover, drone later) | After A and B are solid |

## Commands

| Task | Command |
| --- | --- |
| Run the mind | `cd mind && npm start` (or `make mind`) |
| Hearing, Mac mic | `cd mind && npm run hearing` |
| Hearing, Pi mic | Pi: `PEAK_MIND=<mac-ip> ./audiod.sh`; Mac: `PEAK_AUDIO_SOURCE=udp://0.0.0.0:5001 npm run hearing` |
| Vision, one frame from a file | `PEAK_VISION_ONCE=1 PEAK_VISION_SOURCE=<image> npm run vision` |
| Servo daemon in sim | `PEAK_SIM=1 PEAK_BROKER=<mac-ip> ~/peak/.venv/bin/python -u node/servod.py` (Mac: use `.venv/bin/python`) |
| Send a command | `mosquitto_pub -t peak/mech/cmd -m '{"gesture":"wave"}'` |
| Fake an event | `mosquitto_pub -t peak/mech/event -m '{"heard":"hey peak, wave at me"}'` |
| Deploy to the Pi | `scripts/deploy-node.sh [host]` (installs and restarts the systemd unit; for sim testing use plain rsync instead) |

Config is in `mind/.env` (gitignored; `.env.example` is the template): `PEAK_BROKER`, `PEAK_MODEL`, `PEAK_VISION_MODEL`, `PEAK_MIN_DB`.

## Environment facts

- Mac: Mac mini, 24 GB unified memory. Mac IP on the LAN is `192.168.0.139` (interface `en1`, not `en0`; `ipconfig getifaddr en1`).
- Pi: `lupin@mech.local` (192.168.0.226 at last check), key login works, **`sudo` needs a password** so Claude cannot install packages. Ask the owner to run `sudo` lines.
- Ollama: Homebrew service, config in `~/Library/LaunchAgents/sh.brew.ollama.plist` (flash attention, q8 KV cache, `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_KEEP_ALIVE=30m`). Reload with `launchctl bootout/bootstrap`, not `brew services restart` (it rewrites the plist). Another program also loads `qwen3:14b` into Ollama at times; do not stop it.
- The shell tool cannot write to `/tmp` for ffmpeg outputs reliably; use `mktemp -d` dirs.
- Whisper: openai-whisper CLI, `small` model cached in `~/.cache/whisper`.

## Gotchas learned the hard way

- ffmpeg single-image input breaks with `-fflags nobuffer`; apply it only to `udp://`. The JPEG encoder needs `format=yuvj420p`.
- The Pi USB mic rejects 16 kHz in ffmpeg: `audiod.sh` captures at 48 kHz and resamples. Select it by name (`plughw:CARD=Device,DEV=0`); USB card numbers change after reboots.
- Whisper hallucinates "Thanks for watching." on quiet audio and echoes its prompt. Mitigations: `PEAK_MIN_DB=-30` (the Pi mic idles around -36 dB) and a filter regex in `hearing.js`.
- `hearing.js` kills its ffmpeg child on exit; an orphan keeps UDP :5001 bound.
- Do not `pkill -f` on the Pi over ssh with a pattern that appears in the ssh command line itself; it kills the session.
- `say` on the Pi goes to `espeak-ng` as an argv entry, never through a shell (injection fix). Keep it that way.
- The Pi shows **undervoltage** (`vcgencmd get_throttled` = `0x50005`) and has hung or rebooted under load. Use a proper 5V 2.5A supply until the UBEC or Mini560 path is verified.
- Mini560 comes in 3.3/5/9/12 V fixed variants; check the SKU says 5V, then measure with a multimeter before connecting the Pi.

## Status

| Area | State |
| --- | --- |
| Repo | https://github.com/prbstr/peak, branch `main`. |
| Broker, orchestrator, `servod` in sim | Working, tested end to end Mac <-> Pi. |
| Hearing | Working from the Pi mic. whisper `small` mishears sometimes. |
| Vision | Working from an image file. **Not tested** with the Pi camera: no camera module yet. |
| Servos / PCA9685 / battery | Parts ordered (AliExpress, delivery about early to mid Dec 2026). Nothing wired. `servod` has only run in sim. Orders seen 2 Nov 2026: AliExpress (servos x10, PCA9685 x2, UBEC 3A, Mini560 PRO 5V x5 plus 2 wrong 9V, BMS, holders, switch, USB iron) and Communica (4x INR18650-30HW cells, Pi Camera Module 3 Wide, HC-SR04+, MPU6050, 0.96in I2C OLED, 16-LED WS2812 ring, PIR sensor, vibration motor, Pi heatsinks and fan, resistors, diodes, transistors, F/F jumpers, heat shrink). Not seen in either order, confirm before relying on them: speaker, multimeter, solder/flux, hookup wire, capacitor, fuse, connectors, Pi power supply, 5A UBEC, 2S Type-C charger. |
| Pi service | `peak-servod.service` exists but is not installed on the Pi. |
| Pi power | Unstable (undervoltage). Needs a better supply. |
| Voice (text-to-speech) | `say` uses placeholder espeak-ng. Piper plan is in `mind/voice/README.md`. |

## Next steps

1. Fix Pi power; recheck `vcgencmd get_throttled` reads `0x0`.
2. When parts arrive: measure UBEC and Mini560 outputs, wire PCA9685, tune `node/config.yaml` ranges on the bench, install `peak-servod.service`.
3. Camera module and speaker; test `camd.sh` into `vision.js`.
4. Makefile `m0` target uses plain `python3` (fails on the Mac without PyYAML); point it at `.venv/bin/python`.
5. `scripts/pi-firstboot.sh` has not been run on the current Pi (hardware watchdog, apt deps). Run it before adding the next body.
6. Add `look_at` back to the brain's reply shape.

## Working with the owner

- Prefers tables and actionable breakdowns over prose. Short answers, no padding.
- Wants Claude to run things, not hand over commands; where `sudo` or purchases are needed, say exactly what to run or buy.
- Commits are local first; ask before pushing. Never put API keys or `.env` in commits.
- Do not assume the user is `pi`; it is `lupin`.
