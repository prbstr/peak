# peak

Hobby project: an AI-guided robot with a hive-mind design. One mind on the owner's Mac mini, many Lego bodies talking over MQTT. The character is called **Rho**. First body: **mech**, a Lego Technic mech suit with a minifig pilot, six GeekServos and a Raspberry Pi 3B in the backpack. Later bodies: rover, drone.

This file is what every new chat starts from: how to work here and what is true now. The history lives in other files; read the one you need, not all of them.

| File | Holds |
| --- | --- |
| `docs/log.md` | Dated record of every test and measurement, by area |
| `docs/gotchas.md` | Each trap in full: what happened and what was measured. Also the wiring advice for parts not yet arrived |
| `docs/decisions.md` | Each decision with its evidence and what was ruled out, and the method for changing a model or prompt |
| `docs/architecture.md` | Exact behaviour: thresholds, timings, the order the eyes' reflexes win |
| `docs/environment.md` | Versions, dates and what was checked when, on the Mac, the Pi and the HomePod |
| `mind/bakeoff/README.md`, `mind/bakeoff/brain/README.md` | Speech-to-text and brain bake-off tables |
| `mind/orchestrator/LESSONS.md` | Prompt-design lessons taken from TypeSafe's Jev |
| `README.md`, `SHOPPING.md` | Layout and quick start; parts, orders, power wiring |
| `CLAUDE.local.md` (gitignored, owner's Mac only) | Private notes about the owner: how he likes to work on this project, shops, his other projects |
| `~/.claude/CLAUDE.md` (owner's Mac only) | His general working rules, for every project |

## Working here

This repo is public. Nothing personal about the owner goes in a tracked file: it goes in `CLAUDE.local.md`. The two private files above load beside this one on his Mac. These are the project's own rules.

| Rule | Why |
| --- | --- |
| The brain is a local, abliterated Ollama model. No cloud model in the mind. | Owner's choice |
| Research and measure before changing a model, a prompt or a speech engine. The eleven steps are at the end of `docs/decisions.md`. | A session that went straight to code had to be redone |
| A fix is done after a live test on the real body, never after unit tests or a stand-in. | A result was once reported with the mic not connected |
| A live test that needs the owner to speak or watch: 60 seconds at most, several short windows rather than one long one. Get everything ready first, then tell him what to do before the window opens. | Two windows passed before he spoke |
| Commit locally. Push only on the owner's word; each push needs its own. Never commit `.env` or keys; he types keys into `mind/.env` himself. | Public repo |
| Log placed orders in `SHOPPING.md` from the order page, not from memory. Keep addresses, phone numbers and email out. | Ticks made from memory were wrong |
| Wiring help: drawings and photos with physical pin numbers, limited to parts on hand. | A wrong pin costs a part |
| The Pi user is `lupin`, never `pi`. | |

## Starting and ending a session

Several Claude sessions work in this checkout, sometimes at the same moment, and the robot is usually left running between them.

Start:

1. `git status` and `git log -5`. Another session may have committed since this file was loaded into your context; re-read a file before you edit it, and commit only your own files.
2. See what is running before you start anything: `pgrep -fl "orchestrator/index.js|senses/|voice/homepod|whisper-server"` on the Mac, `mosquitto_sub -t peak/mech/status -C 1 -W 3` for the body. Two minds answer every event twice.
3. The Mac processes are background tasks of whichever session started them and stop when that session closes. Do not stop a process another session started unless the owner says so in this chat.
4. A faked `heard` event is spoken aloud on the HomePod in the bedroom while the voice process runs. Mind the hour.

End, when anything changed:

1. Update the tables in this file: "Where things stand", "Next steps", and one line for any new rule or decision. Anything about the owner himself goes in `CLAUDE.local.md` instead.
2. Put the dated detail (what was tested, the numbers) in `docs/log.md`, and the full story of a new trap in `docs/gotchas.md`.
3. Ask whether to leave the robot running. On 2 Nov the answer was "kill all the services"; on 5 Nov it was left up. Stop only what you started, by pid, never by a pattern that also matches another session's processes, and say what is still running.
4. Commit locally and ask before pushing.

## Vocabulary

| Term | Meaning |
| --- | --- |
| mind | Mac side, `mind/`: Node.js. Orchestrator plus senses, tricks and voice. |
| node / body | A robot. Pi code lives in `node/`. |
| mech | First body. Pi hostname **and** MQTT node name (`peak/mech/...`). |
| hive | All bodies share one mind and one broker. |
| Rho | The character's name and wake word since 5 Nov 2026 (it was Peak; the owner asked for the change). Only the character was renamed: the project, repo, MQTT topics and `PEAK_` settings are still peak. |
| sense / event | A body publishes raw readings on `sense`. A sense program on the Mac turns readings, audio or frames into an `event` worth a thought: `{"heard"}`, `{"see"}`, `{"sensed"}`. |
| gesture | A named servo move from `node/gestures.yaml`: wave, point, nod, shrug, rest, look_left, look_right. |
| trick | A named sequence of eye moves, gestures, words, device actions and waits, kept as data in `mind/tricks/tricks.yaml`. |
| device / action | A node with no senses and no gestures that the hive can switch (the desk light; a projector and screen later), declared in `mind/devices/devices.yaml`. An action is one named switch on it (`light_off`), with the topic and payload its firmware wants. |
| bake-off | Scoring candidates (models, prompts, speech engines) on fixed cases. Held-out groups are cases written after tuning stops. |
| lupin | Three things: the login user on the Pi; a separate project in `../lupin`, a personal context engine over MCP; and the name of the owner's sidebar group and claude.ai Project that hold these chats. |

## Architecture

```
Pi (mech)                         Mac (mind)
 servod.py  <-- peak/mech/cmd --  orchestrator  <-- Ollama (brain)
 servod.py  -- peak/mech/sense -> orchestrator
 audiod.sh  -- UDP :5001 PCM ---> senses/hearing.js (whisper) -- peak/mech/event -> orchestrator
 camd.sh    -- UDP :5000 H264 --> senses/vision.js (Ollama vision) -- peak/mech/event ->
 servod.py  -- peak/mech/sense -> senses/presence.js (PIR, distance) -- peak/mech/event ->
 OLED       <-- servod.py draws two eyes (eyes.py, a port of RoboEyes) and moves them by reflex (screen.py)
                                  voice/homepod.py -- AirPlay --> HomePod mini (speaks every {"say"} on peak/+/cmd)
```

- **Broker.** One Mosquitto on the Mac (brew service, `*:1883`, anonymous). Bodies are clients only.
- **Topics.** `peak/<node>/cmd`, `/sense`, `/event`, `/status` (retained online/offline, set by Last Will), and `peak/brain/intent`. Schemas in `contracts/`.
- **Senses publish events only**, never raw frames or audio. The orchestrator thinks on one event at a time; one more may wait and a newer one replaces it. Bodies that go offline leave the hive map.
- **Brain.** Replies in JSON enforced by Ollama structured outputs, built in `mind/orchestrator/brain.js`: `{gesture, say}`, plus `eyes` when `PEAK_BRAIN_EYES=1` (on in `mind/.env`, off in code) and `action` when `PEAK_BRAIN_DEVICES=1` (off in both, 7 Nov; the owner's call). `eyes` names a trick or is null; `action` names a device action or is null. The gesture is the first field and is sent the moment it streams in, before the spoken line. The brain never moves servos or eyes directly. A `sensed` event gets one line and no gesture, so no arm swings at something 5 cm away.
- **Devices.** `mind/devices/devices.yaml` declares each device the hive can switch: a `describe` line, the topic prefix its firmware uses, its online/offline topic, and its actions with the exact topic and payload each sends. `mind/orchestrator/devices.js` checks the file at load (like tricks) and publishes; the brain's `action`, a trick's `action` step and `npm run device -- <action>` all go through it. Firmware and wiring per device under `devices/<name>/` at the repo root. First device: the desk light (six actions, absolute presets, because lightbar2mqtt takes levels not steps).
- **`servod`** runs one motion at a time with a one-deep queue; `say` runs beside it; `{"stop": true}` aborts the move and releases the servos. It also owns the GPIO sensors and adds `distance_cm`, `motion`, `temp` and `throttled` to `sense` twice a second. `PEAK_SIM=1` simulates the servos only: sensors and the OLED stay real.
- **Eyes.** `servod` draws them with no help from the mind. Reflexes, highest claim first: broker offline = shut; something closer than 30 cm = wide eyes once; `look_left` / `look_right` = eyes held to that side; a spoken line = eyes pulsing, starting `talk_delay_s` after the command; bad power or heat = tired lids and sweat (`strain: false` in `node/config.yaml` switches that off); otherwise wander and blink.
- **`eyes` command.** The mind can take the eyes over on `peak/<node>/cmd` (`contracts/cmd.schema.json`, `$defs.eyes`): `mood`, `look`, `anim`, `open`, `curious`, `shape`, `ms`. When `ms` runs out, or on `{"eyes":{"release":true}}` or a stop, the reflexes have them back. Unknown fields are ignored, never an error.
- **Tricks.** `mind/orchestrator/tricks.js` checks every trick against the command contract and `gestures.yaml` (at most 16 steps and 30 s) and plays the steps over MQTT; a newer trick or a stop takes over. Built in: happy, angry, sleepy, confused, laugh, surprised, wink, peekaboo. `mind/tricks/learned.yaml` is merged in at load and `appendTrick()` writes to it; nothing calls that yet. It is the door for teaching by voice and for Lupin.
- **Voice.** `mind/voice/homepod.py` speaks each `say` with macOS `say`, streamed to the HomePod mini over AirPlay, about 2.5 s after the command.

The aim for the eyes and tricks is a set that grows over time: the robot can be taught new tricks and skills, and later learns new things on its own.

## Where things stand (7 Nov 2026, 15:30)

| Area | State | Not yet checked |
| --- | --- | --- |
| Repo | https://github.com/prbstr/peak, `main`, GPL-3. 50 mind tests and 75 node tests pass. | |
| Mind, broker, body | Working end to end, Mac and Pi. On the Pi `servod` runs with `PEAK_SIM=1`, started by hand. | |
| Hearing | Pi USB mic, whisper.cpp `medium.en` on the Mac, wake word "Rho"; for 8 s after it, sentences pass without the name (`PEAK_WAKE_WINDOW_MS`). Transcript 0.4-0.6 s after speech ends. Owner, 5 Nov: "working excellently". | "Bro wave at me" (name run into the request) is missed |
| Brain | `huihui_ai/qwen3-vl-abliterated:8b-instruct` for brain and eyes. Every bake-off group at 100% bar one known miss ("can you not your head"). Gesture out at 0.25 s, reply 0.4-0.9 s. Picks tricks since the late restart on 5 Nov. Action field built 7 Nov: 99% strict with it on, 0 unasked switches, 72% on the fresh device cases; off until the owner sets `PEAK_BRAIN_DEVICES=1`. | A trick asked for by voice. Replies took 2-7 s when a photo description was in the queue. |
| Desk light (device) | Mind side done 7 Nov: `devices.yaml`, `devices.js`, the `action` field, a `device` trick step, `npm run device`. Checked end to end over MQTT with faked events (right payload on the light's topic 0.6-1.0 s after each). ESP32-C3 and nRF24L01+ on the desk, unwired; firmware notes and `config.h.example` in `devices/desk-light/`. | Everything on the hardware side: the bar's label, the board's silkscreen, wiring, flashing, the puck's serial, the light moving. The `base` and `0x` serial in `devices.yaml` are placeholders until the ESP boots. |
| Vision | Pi camera, 640x480 at 15 fps, described by the same model in 5.6 s, change-triggered. | A person in frame. The camera is loose on the desk. |
| Sensors | Distance and PIR in every `sense`; `presence.js` turns arrivals and close approaches into `sensed` events. | MPU6050 (shares the OLED's pins until a breadboard arrives) |
| Eyes (OLED) | RoboEyes port, reflexes, `eyes` command and eight tricks running on the Pi at 14 frames a second. The tired-and-sweating strain should be gone since the new supply (7 Nov); `throttled` reads 0x0 in every sense. | The owner has not watched them on the glass |
| Voice | Speaks through the HomePod mini "Bedroom". | |
| Servos, PCA9685, battery | Ordered on AliExpress, due early to mid December 2026. Nothing wired; `node/pca9685.py` has never met the real chip. | Everything |
| Pi power | Fixed 7 Nov by the official 5.1 V 2.5 A micro-USB supply: `throttled=0x0` after a reboot, 0 undervoltage samples in 30 s with camera, mic, `servod`, a wave and an eyes trick running, CPU 700-1200 MHz, 47 °C. | Hours-long run |
| Persistence | Nothing survives a reboot. Pi: `servod`, `camd.sh`, `audiod.sh` started by hand; `peak-servod.service` not installed. Mac: mind, senses, voice and whisper run as tasks of Claude sessions. | |

## Next steps

1. **Pi power.** Done 7 Nov 2026 with the official 5.1 V 2.5 A micro-USB supply (`docs/log.md`, Pi power).
2. **Owner watches the eyes** (60 s): idle and blinks, a hand inside 30 cm, "Rho, give me a wink", `npm run trick -- peekaboo`.
3. **Teaching by voice.** A brain reply that defines a trick from the existing step kinds, saved with `appendTrick()`. The loader, check and merge exist. Learning on its own waits for Lupin (Stage C).
4. **Eyes prompt.** v1 loses the wave on "night night" 2 times in 3 and nods while answering "two plus two". Try a goodnight example with a null gesture, or a rule; full bake-off each time.
5. **Survive a reboot.** Units for `camd.sh` and `audiod.sh`; `peak-servod.service` needs `Environment=PEAK_SIM=1` until the PCA9685 is wired. All need the owner's `sudo`.
6. **When the servos arrive.** Measure UBEC and Mini560 outputs with a multimeter, decide the power layout (`docs/decisions.md`), wire the PCA9685 (V+ from the buck, never the Pi), tune `node/config.yaml` ranges, drop `PEAK_SIM`.
7. **Rest of the body's I/O.** MPU6050 pose in `sense`; NeoPixel ring and vibrator motor as commands. Needs a breadboard, M/F jumpers and a soldering iron; the NeoPixel also needs SPI on, `core_freq=250` and the neopixel-spi package.
8. **Camera.** Mount it, test with a person in frame.
9. **Hearing.** Replace the `PEAK_MIN_DB` gate with whisper.cpp's Silero VAD or an adaptive floor. Tune the Rho wake rule from real transcripts.
10. **Brain.** Add `look_at` back (native tool calling is possible now). Decide whether an arrival gets a wave once servos are real. Obstacle stop on the Pi itself (Stage B).
11. **Housekeeping.** Makefile: `m0` uses plain `python3` and `BROKER_IP` reads `en0` (the Mac is on `en1`). `mind/bakeoff/brain/models.json` still lists removed models. `mind/senses/README.md` still names `gemma4:26b`, `ggml-small.bin` and an unwired voice. `dtparam=i2c_arm_baudrate=400000` for smoother eyes (`sudo`). A router DHCP reservation for the Pi. A broker password before any guest network.
12. **Parts list.** `SHOPPING.md` is behind: its AliExpress ticks came from the owner's word and differ from the order pages read on 2 Nov (`docs/log.md`, Servos), it shows power layout A as settled, and it lists a USB mic he now has. Reconcile it against the order pages with him.
13. **Still to buy.** Half-size breadboard, 40 M/F jumpers, M/M jumpers, soldering iron, speaker for the body, multimeter, a longer camera cable if 200 mm does not reach from head to backpack, and the Technic parts for the mech itself.
14. **Desk light as a hand (side quest).** Mind side done 7 Nov (see Devices above and the Brain row). Hardware next, in the order of the guide "peak — Desk light guide", https://claude.ai/artifact/DyDc26DcX2hw1SPUigdvbJ: the owner checks the label under the bar's clamp (MJGJD01YL; the 02YL has wifi and this radio cannot drive it), sends a photo of the ESP32-C3's silkscreen, wires the nRF24L01+ (pins in `devices/desk-light/README.md`; VCC to 3V3), plugs the board into the Mac mini on a USB-C data cable; then the Mac installs `arduino-cli` and the ESP32 core (about 1.5 GB, say so first), flashes [lightbar2mqtt](https://github.com/ebinf/lightbar2mqtt) with `devices/desk-light/config.h.example` filled in, reads the root topic and the puck's serial off the serial monitor into `config.h` and `mind/devices/devices.yaml`, and the live test is `npm run device -- light_off` on the glass. The ESP32-C6 is kept for the projector or screen. Owner's call: `PEAK_BRAIN_DEVICES=1` in `mind/.env`.

## Roadmap stages

| Stage | What | When |
| --- | --- | --- |
| A, today | One Mac mind, thin Pi body over MQTT | Working, servos simulated |
| B | Reflex layer on the Pi (obstacle stop, finish gestures if Wi-Fi drops, servo limits) | Once servos are wired |
| C | Hive: Lupin memory (`../lupin`, MCP) plus more bodies (ESP32 rover, drone later) | After A and B are solid |

## Commands

Mac commands run from `mind/` unless they start with `scripts/` or `mosquitto_`.

| Task | Command |
| --- | --- |
| Run the mind | `npm start` |
| Whisper server (hearing needs it) | `npm run whisper` (port 8178, `~/.cache/whisper.cpp/ggml-medium.en.bin`; `PEAK_WHISPER_GGML` picks another model) |
| Hearing, Pi mic | Pi: `PEAK_MIND=192.168.0.139 ~/peak/node/audiod.sh`; Mac: `PEAK_AUDIO_SOURCE=udp://0.0.0.0:5001 npm run hearing` |
| Hearing, Mac mic | `npm run hearing` |
| Vision, Pi camera | Pi: `PEAK_MIND=192.168.0.139 ~/peak/node/camd.sh`; Mac: `npm run vision` |
| Vision, one frame from a file | `PEAK_VISION_ONCE=1 PEAK_VISION_SOURCE=<image> npm run vision` |
| Presence (PIR and distance into events) | `npm run presence` |
| Voice on the HomePod | `npm run voice` (first time: `python3.13 -m venv voice/.venv && voice/.venv/bin/pip install -r voice/requirements.txt`) |
| Mind tests | `npm test` |
| Node tests | `cd node && ../.venv/bin/python -m unittest test_eyes test_oled test_screen test_pca9685` (on the Pi: `~/peak/.venv/bin/python`) |
| Brain bake-off | `npm run bakeoff:brain -- --stream --models huihui_ai/qwen3-vl-abliterated:8b-instruct --no-pull` (`PEAK_BRAIN_EYES=1` and `PEAK_BRAIN_DEVICES=1` in front score those fields; flags in `mind/bakeoff/brain/README.md`) |
| Eyes comparison on photos | `node bakeoff/brain/eyes.js --models a,b --images x.jpg,y.jpg` |
| Play a trick without the brain | `npm run trick` lists them; `npm run trick -- wink [node]` plays one |
| Switch a device without the brain | `npm run device` lists the actions and which devices are online; `npm run device -- light_off` sends one |
| Mic test page | `npm run record`, then http://localhost:8179 (needs `audiod.sh` and `npm run whisper`) |
| Body on the Pi, no servos wired | On the Pi: `PEAK_SIM=1 PEAK_BROKER=twentyones-Mac-mini.local ~/peak/.venv/bin/python -u ~/peak/node/servod.py` |
| Start a Pi daemon over ssh | `ssh lupin@mech.local 'PEAK_MIND=192.168.0.139 setsid nohup ~/peak/node/camd.sh > ~/peak/camd.log 2>&1 < /dev/null &'` (one plain command, no `cd &&`). Pids in `~/peak/*.pid`. |
| Copy `node/` to the Pi without the service | `rsync -a --delete --exclude __pycache__ node/ lupin@mech.local:~/peak/node/` |
| Deploy with the systemd unit | `scripts/deploy-node.sh [host]` (needs `sudo` on the Pi) |
| Watch what the Pi sends | `mosquitto_sub -t 'peak/mech/#' -v` |
| Send a command | `mosquitto_pub -t peak/mech/cmd -m '{"gesture":"wave"}'` |
| Move the eyes by hand | `mosquitto_pub -t peak/mech/cmd -m '{"eyes":{"mood":"happy","look":"ne","ms":3000}}'` |
| Fake an event | `mosquitto_pub -t peak/mech/event -m '{"heard":"hey rho, wave at me"}'` |
| Emergency stop | `mosquitto_pub -t peak/mech/cmd -m '{"stop":true}'` |
| See what the OLED was last sent | `ssh lupin@mech.local 'kill -USR1 "$(cat ~/peak/servod.pid)"' && scp lupin@mech.local:peak/oled.png .` (what was sent, not proof the glass is lit) |
| See the eyes without the Pi | `cd node && ../.venv/bin/python eyes_preview.py` writes `eyes_preview.png` and `.gif` |
| Watch the Pi camera live | `ffplay -fflags nobuffer -flags low_delay -f h264 -probesize 200000 -analyzeduration 500000 udp://0.0.0.0:5000` (stop `npm run vision` first) |
| Pi power over a window | On the Pi: `~/peak/node/powerwatch.sh 30` (read `undervoltage_now`; `kernel_dips` counts only new dips, so it reads 0 while the Pi is under the whole time) |
| What drawing the eyes costs | Start `servod` with `PEAK_FACE_STATS=1` (`full` sends whole frames, to compare) |

Settings live in `mind/.env` (gitignored; `.env.example` is the template). The ones that matter: `PEAK_MODEL` and `PEAK_VISION_MODEL` (the same tag, so Ollama loads it once), `PEAK_BRAIN_EYES`, `PEAK_BRAIN_DEVICES`, `PEAK_SPEAKER` (`Bedroom`), `PEAK_SPEAKER_HOST`, `PEAK_VOICE` (Daniel), `PEAK_MIN_DB` (-30), `PEAK_MIN_CONFIDENCE` (0 = off; 0.6 suits the 9B). For tests: `PEAK_WAKE=off` passes every clean utterance, `PEAK_DEBUG=1` logs dropped ones, `PEAK_DUMP_DIR=<dir>` saves each utterance as a WAV. Presence thresholds: `PEAK_QUIET_S` (60), `PEAK_NEAR_CM` (30), `PEAK_NEAR_COOLDOWN_S` (10). The head of each sense file lists the rest.

## Environment facts

- **Mac.** Mac mini, Apple M4 Pro, 24 GB, macOS 26.2 (the README and the owner's handover say M5; `sysctl` says M4). LAN address `192.168.0.139` on `en1`, not `en0`. mDNS name `twentyones-Mac-mini.local`. Mac venv at `.venv` is Python 3.9, so `node/` code must run on 3.9; the Pi has 3.13.
- **Pi.** Pi 3B Rev 1.2, 64 GB microSD. `lupin@mech.local` (192.168.0.226 at last check), key login. Raspberry Pi OS on Debian 13 (trixie), Python 3.13.5. **`sudo` needs a password**, so ask the owner to run `sudo` lines. Venv at `~/peak/.venv`, built with `--system-site-packages`. `i2cdetect` is `/usr/sbin/i2cdetect` over ssh. `scripts/pi-firstboot.sh` sets up a new body (I2C, watchdog, apt packages, venv); it was run on mech on 2 Nov.
- **Wired to the Pi** (physical pins, F/F jumpers): OLED at I2C `0x3c` on 1, 9, 3, 5; PIR (HC-SR501) on 2, 6, 11 (GPIO17); HC-SR04+ on 17, 20, 16 (GPIO23 trig), 18 (GPIO24 echo); Camera Module 3 Wide; USB mic. The MPU6050 (`0x68`) passed its bench test but takes turns with the OLED. Planned: fan on 4 and 14, vibrator through a BC337 from pin 13 (GPIO27), NeoPixel DIN on pin 19 (GPIO10, SPI), PCA9685 at `0x40`. The 18650 cells are unprotected: keep them bagged until holder, BMS and buck are here.
- **Claude docs.** Wiring: "peak — Bench wiring guide", https://claude.ai/artifact/VFhBowXNv9TeSvXViN2TWc (tabs "Connect now" and "After the next order"). Design: "Lego Hive Robot — 4 Build Concepts", https://claude.ai/artifact/REqQJMByHZpRAc2ny6526S (Mech Suit build plan with Technic part numbers and milestones M0 to M6; the Mech Suit was chosen over Big Fig, Scout Rover and Quad Walker). Desk light: "peak — Desk light guide", https://claude.ai/artifact/DyDc26DcX2hw1SPUigdvbJ (how it works, wiring, flashing, the mind's side).
- **Owner's handover.** He keeps a second handover in his claude.ai Project and pastes it in. It has been well behind this repo each time. Trust this file for the software; take hardware news and his plans from the pasted one.
- **HomePod mini.** AirPlay name **Bedroom**, `192.168.0.191`, open to the network, no pairing. The first-gen HomePod does not show up on AirPlay.
- **Ollama.** Homebrew service, 0.40.13. Config in `~/Library/LaunchAgents/sh.brew.ollama.plist` (`OLLAMA_MAX_LOADED_MODELS=2`, keep-alive 30m). Live log: `/opt/homebrew/var/log/ollama.log`. The GPU gets about 17.8 GB.
- **Models.** peak owns `huihui_ai/qwen3-vl-abliterated:8b-instruct` (brain and eyes, 5.3 GB loaded) and `huihui_ai/qwen3.5-abliterated:9b` (slower accuracy option). `qwen3:14b`, `qwen2.5-coder:7b-instruct`, `nomic-embed-text` and `llama3.1:8b` belong to OpenClaw: never remove them or stop what loads them.
- **Whisper.** whisper.cpp `whisper-server` on 127.0.0.1:8178, models in `~/.cache/whisper.cpp`.
- **Speech-to-text bake-off.** Own venv at `mind/bakeoff/.venv` (python3.13).
- **Parts.** Shops and delivery times are in `CLAUDE.local.md`. Never buy cells, LiPos or microSD cards on AliExpress.

## Rules learned the hard way

One line each. The story and the numbers are in `docs/gotchas.md`.

Pi and ssh
- Never `pkill -f` on the Pi with a pattern that is in your own ssh command line. For `pgrep`, bracket a letter: `pgrep -f "[r]picam-vid"`.
- Background one plain command over ssh; `cd dir && VAR=x nohup cmd &` hangs the call.
- The Pi is undervolted and has hung under load. Watch `throttled` in every sense message.
- `say` on the Pi goes to `espeak-ng` as an argv entry, never through a shell.
- Stop commands over ssh hang when the Pi is down. Check `peak/mech/status` first.
- Run Python with `-u` on the Pi, or the log stays empty.

Power and parts (before anything from the AliExpress order is wired)
- A Mini560 comes in 3.3, 5, 9 and 12 V versions, and the 5V and PRO 5V boards have `OUT+` on opposite sides. Measure it before it meets the Pi.
- The 3 A UBEC is 5.25 V ±0.5 V, so it can reach 5.75 V. It feeds the Pi only if it measures under about 5.4 V.
- GeekServos are rated about 4.8 to 6 V; six can pull 3 A or more. Bench-test each one before building it in.
- The 2S charger board must be the 8.4 V version. Treat 7.0 V on the battery as low.
- The 16-LED ring draws about 1 A at full white: servo rail, low brightness, never the Pi's 5 V pin.

Hearing
- `-ac 1` must be an output option in `audiod.sh`, or the stream is stereo and whisper hears garbage.
- Never pass `--prompt` with the wake word to whisper-server: it strips the name from the transcript.
- Never put `-fflags nobuffer` on the audio UDP input.
- The Pi USB mic rejects 16 kHz: capture at 48 kHz and resample. Select it by name, not card number.
- Whisper invents sentences on quiet audio. The wake-word gate in `heardFilter.js` is the defence; do not weaken it with drop lists.
- `PEAK_MIN_DB` has no good fixed value on this mic.
- Rho sounds like row, roe and roll. The homophones wake it only where a name would stand; "bro" is deliberately not one.
- `hearing.js` must SIGKILL its ffmpeg on exit, or UDP :5001 stays bound.
- Test speech engines on real Pi-mic clips. Synthetic `say` clips scored 1.1% word errors against 4.5 to 5.6% on real ones.

Vision
- Only one program on the Mac can read UDP :5000. Stop `npm run vision` before opening a viewer.
- A raw H264 stream needs `-f h264 -probesize 200000 -analyzeduration 500000`, or every open costs 5 s.
- ffmpeg single-image input breaks with `-fflags nobuffer`; the JPEG encoder needs `format=yuvj420p`.

Ollama and models
- Reload Ollama with `launchctl bootout` and `bootstrap`, not `brew services restart`, which rewrites the plist.
- Judge a model's memory by `ollama ps`, not `ollama list`; vision models load far bigger than they download.
- Call Ollama only through `mind/lib/ollama.js`. It sends the same load-time options every time; a caller with different ones makes Ollama reload the model the brain and eyes share.
- OpenClaw loads `qwen3:14b` at times and evicts our model. Do not stop it; rerun timing tests afterwards.
- `think:false` may only be sent to models that have the thinking capability.

Brain prompt
- Never ship a prompt edit without a full `npm run bakeoff:brain -- --stream` and a look at the per-group table.
- Rules and examples interact. Change one example per run, and write the held-out cases before tuning.
- An example teaches more than it was written for: the model copies its gesture and even its words.
- Keep `cases.json` and `sequences.json` at indent 2 when a script rewrites them.

OLED
- An SSD1306 can be dark while every write succeeds. `servod` re-checks the status byte; do not run another OLED script while `servod` is up.
- Never send whole frames for animation: 4 frames a second against 14 with changed bytes only.

Voice
- pyatv needs `srptools<2`, and a scan limited to `Protocol.RAOP`, or the HomePod refuses the connection.

Tests and the shell
- `node --test <dir>` runs `orchestrator/index.js` and hangs on MQTT. `npm test` names the files; keep it so.
- The shell's working directory drifts between calls. Use absolute paths.
- `grep` in a pipeline buffers; use `--line-buffered` when timing a live stream.
- ffmpeg output to `/tmp` fails unreliably from the shell tool; use a `mktemp -d` directory.
- Homebrew Mosquitto ignores `conf.d`; the listener lines are in the main conf.

## Decisions

One line each. Evidence in `docs/decisions.md`.

| Decision | Why |
| --- | --- |
| Mosquitto, one broker on the Mac | Retained messages and Last Will give body presence for free; ESP32 bodies speak MQTT natively |
| All AI on the Mac, the Pi stays thin | A Pi 3B is too slow for whisper or vision |
| Local abliterated Ollama brain | Owner's choice |
| One model for brain and eyes, Qwen3-VL 8B | Best of the bake-off for its size and speed, and the only one that did not invent a person in an empty photo |
| Ollama 0.40.13 kept | Faster, smaller brain; slower photo descriptions accepted |
| Narrow prompt rules with examples, temperature 0.3 | Took the same model from 94% to 100% |
| Gesture sent from the streamed reply | 0.24 s instead of 0.4 s |
| The eyes are a separate reply field, not more gestures | Old cases score as before; a wave and an expression can go together |
| Eyes prompt v1, on by the owner's word | It missed the strict gate by one case; a missing wave is less odd than a stray one |
| Devices are hive nodes declared in `devices.yaml`, no Home Assistant; the desk light runs lightbar2mqtt unchanged on an ESP32-C3 | Presence and one command path come free from the broker; the only ESPHome bar component is for the wrong model |
| Device actions are a fourth flat enum field, `action`; prompt v2 in code, switch off | Same shape as `eyes`; gate cleared (no old group lower), 99% strict, 0 unasked switches, but 72% on the fresh cases |
| Jev not used, only its lessons | Hosted, closed and not abliterated |
| whisper.cpp server with `medium.en` | Stays loaded; as accurate as anything tried on the real mic |
| Voice through the HomePod mini for now | The body has no speaker; Piper on the body is the plan |
| Sensors and OLED inside `servod` | One daemon, one status, and the distance reading sits where the obstacle stop needs it |
| Servos through `node/pca9685.py`, not `adafruit_servokit` | Blinka does not build on the Pi 3B. Without `PEAK_SIM=1` and with no chip wired, `servod` exits on its first I2C write |
| RoboEyes port, repo GPL-3, no third-party art | Owner chose the look; the licence follows the library |
| NeoPixel on SPI (GPIO10) | No root, no clash with onboard audio |
| Power layout undecided between three | Decide after measuring the regulators (`SHOPPING.md`) |
| Deploy by rsync; Python venv on the Pi | Simple; Raspberry Pi OS blocks system pip |

## Neighbouring projects

The detail is in `CLAUDE.local.md`. What peak itself needs to know:

| Name | Where | What it is to peak |
| --- | --- | --- |
| lupin | `../lupin` | A context engine over MCP: the planned Stage C memory for the hive. Nothing in peak uses it yet. Its instructions do not load in a peak chat: read `../lupin/CLAUDE.md` before working on the link. |
| OpenClaw | `~/.openclaw` | Another program on this Mac that shares Ollama with peak. Do not touch its config or models, and never print `openclaw.json`: it holds tokens. |
