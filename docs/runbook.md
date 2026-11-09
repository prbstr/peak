# Runbook: getting Rho back

What to do when something is lost: a power cut, a wiped Mac, a dead SD card. Written 9 Nov 2026 from the machines as
they were that day (`docs/environment.md` has the versions). Every step names the machine it runs on. Lines marked
**owner** need a password or a secret and are never run by a session.

```
power cut ──> Pi: back by itself in ~45 s
          └─> Mac: boots by itself (autorestart 1), STOPS at the FileVault password
                  └─ owner types it, logs in ──> launchd starts all eight parts ──> Rho up
wiped Mac ──> section 3 (about an hour, ~17 GB of downloads)
dead SD   ──> section 4 (about 40 minutes)
```

## 1. What is not in git, and where it comes back from

Everything else is in the repo (`git clone https://github.com/prbstr/peak`).

| Thing | Where it lives | How it comes back |
| --- | --- | --- |
| Broker passwords (six users) | `mind/.env` (mind, senses, voice), the Pi's `~/peak/peak.env` (mech), `devices/desk-light/secrets.yaml`, `~/.config/mosquitto_sub` and `_pub` (owner), the hash in `/opt/homebrew/etc/mosquitto/passwd` | **Owner:** `scripts/broker-passwords.sh` writes all of them again, with new passwords if the old ones are gone |
| The rest of `mind/.env` | Mac | `cp mind/.env.example mind/.env`, then set the values in the table in section 3 step 6 |
| Wi-Fi name and password for the ESP32 nodes | `devices/*/secrets.yaml` | **Owner** types them (template: `devices/blank-node/secrets.yaml.example`; the light's keys are in `devices/desk-light/README.md`) |
| Ollama's settings | `~/Library/LaunchAgents/sh.brew.ollama.plist` (Homebrew's file, edited by hand) | Section 3 step 3 |
| Models | `~/.ollama` (peak's three: 6.1 + 3.3 + 0.6 GB), `~/.cache/whisper.cpp` (medium.en 1.5 GB, Silero VAD), Hugging Face cache (Kokoro 313 MB), `mind/senses/models/hand_landmarker.task` | Downloaded again, section 3 |
| Python environments | `.venv` (node tests, Python 3.9), `mind/voice/.venv-kokoro`, `mind/voice/.venv`, `mind/senses/.venv`, `devices/.venv`, `mind/bakeoff/.venv`, the Pi's `~/peak/.venv` | Rebuilt, sections 3 and 4 |
| Taught lessons and tricks | `mind/examples/learned.yaml`, `mind/tricks/learned.yaml` | In git, **if committed**: commit after every `npm run teach` |
| Logs | `~/Library/Logs/peak/`, the Pi's `~/peak/*.log` | Not restored; nothing depends on them |

A Time Machine backup of the Mac covers every row. Without one, the passwords are the only thing that cannot be
downloaded, and new ones work as well as the old.

## 2. After a power cut

1. **Pi:** nothing. On 8 Nov a reboot had the body online 43 s after the kernel started, with all three units up.
2. **Mac:** it starts by itself (`pmset -g` shows `autorestart 1`, checked 9 Nov), but FileVault is on, so it waits at
   the password screen. The LaunchAgents are per-login, so **Rho stays down until the owner types the password and
   logs in.** Then all eight parts start within about a minute: the brain's Ollama loads the 8B model before the mind
   answers its first event.
3. **Mac, check:** `cd ~/.openclaw/dev/peak/mind && npm run status`. Every part `running` and `online`, `mech` and
   `desk-light` online, health `ok`.
4. **The desk light** reconnects by itself (ESPHome retries Wi-Fi and the broker).

The router has to come back too: the Pi and the light find the broker over Wi-Fi. A UPS keeps all of this up through
a short cut (section 6).

## 3. A wiped Mac

All on the Mac. About 17 GB of downloads (Ollama models 10 GB, whisper 1.6 GB, Python packages 3-4 GB, Homebrew).

1. **Homebrew**, then the tools (in a terminal):

   ```bash
   brew install mosquitto ollama ffmpeg whisper.cpp python@3.13
   ```

2. **Node** through nvm (the LaunchAgents carry node's folder, so install it before the agents):

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   ```

   then, in a new terminal: `nvm install 24`.

3. **Ollama**, Homebrew's service with peak's four settings. Start it once so the plist exists:

   ```bash
   brew services start ollama
   ```

   Then add to `~/Library/LaunchAgents/sh.brew.ollama.plist`, under `EnvironmentVariables`:
   `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_KEEP_ALIVE=30m`.
   Reload with `launchctl bootout gui/$(id -u)/sh.brew.ollama` and `launchctl bootstrap gui/$(id -u)
   ~/Library/LaunchAgents/sh.brew.ollama.plist` (the label on 9 Nov; `launchctl list | grep -i ollama` shows it). Never
   `brew services restart`, which rewrites the plist. Pull peak's models:

   ```bash
   ollama pull huihui_ai/qwen3-vl-abliterated:8b-instruct && ollama pull qwen3-vl:4b-instruct && ollama pull qwen3-embedding:0.6b
   ```

   OpenClaw's models (`qwen2.5-coder:7b-instruct`, `nomic-embed-text`, `llama3.1:8b`) are OpenClaw's to restore.

4. **The repo and the mind's packages:**

   ```bash
   mkdir -p ~/.openclaw/dev && cd ~/.openclaw/dev && git clone https://github.com/prbstr/peak && cd peak/mind && npm install
   ```

5. **Whisper's models:**

   ```bash
   mkdir -p ~/.cache/whisper.cpp && curl -L -o ~/.cache/whisper.cpp/ggml-medium.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin
   ```

   ```bash
   curl -L -o ~/.cache/whisper.cpp/ggml-silero-v5.1.2.bin https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin
   ```

6. **Settings:** `cp .env.example .env` (in `mind/`), then set these, which differ from the template:

   | Key | Value |
   | --- | --- |
   | `PEAK_VOICE_BACKEND` | `kokoro` |
   | `PEAK_BRAIN_EYES` | `1` |
   | `PEAK_BRAIN_DEVICES` | `1` |
   | `PEAK_WHISPER_VAD` | `1` |
   | `PEAK_BRAIN_HOST` | `http://127.0.0.1:11435` |
   | `PEAK_SPEAKER` | `Bedroom` (only for the HomePod backend) |

   The `PEAK_MQTT_PASSWORD_*` lines stay empty until step 10.

7. **Python environments**, from `mind/` (the Kokoro one is about 1.5 GB):

   ```bash
   python3.13 -m venv voice/.venv-kokoro && voice/.venv-kokoro/bin/pip install -r voice/requirements-kokoro.txt
   ```

   ```bash
   python3.13 -m venv senses/.venv && senses/.venv/bin/pip install mediapipe opencv-contrib-python numpy
   ```

   ```bash
   mkdir -p senses/models && curl -L -o senses/models/hand_landmarker.task https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task
   ```

   From the repo root, the Mac's copy of the node tests' environment (Python 3.9, as on 8 Nov):
   `python3 -m venv .venv && .venv/bin/pip install -r node/requirements.txt`. Optional: `voice/.venv` with
   `voice/requirements.txt` for the HomePod backend, `devices/.venv` with `esphome` to re-flash a light.

8. **The broker:** `brew services start mosquitto`. It starts anonymous, which every part accepts.

9. **The LaunchAgents**, from `mind/`: `npm run up` writes the eight plists and starts them. `npm run status`.

10. **Logins (owner)**, from the repo root, in the order in `docs/broker.md`: `scripts/broker-passwords.sh`, restart
    the Mac parts (`npm run down && npm run up`), `scripts/deploy-node.sh` for the Pi, re-flash the light, then
    `scripts/broker-auth.sh on`.

11. **Log rotation (owner):** `sh scripts/install-agents.sh --newsyslog | sudo tee /etc/newsyslog.d/peak.conf` (from
    `mind/`).

12. **The Mac's address.** The Pi sends the camera and mic to `192.168.0.139`. If the router hands the Mac another
    address, put `PEAK_MIND=<new address>` in the Pi's `~/peak/peak.env` and restart the two units; better, a DHCP
    reservation on the router (`ipconfig getifaddr en1` gives the address, `en1` not `en0`).

13. **Check:** `npm test` (mind), the node tests (`cd node && ../.venv/bin/python -m unittest test_eyes test_oled
    test_screen test_pca9685 test_cmdcheck test_deadman`), `npm run status`, then a 60 s spoken window: "Rho, wave at
    me", "Rho, lights off", "Rho, lights on".

## 4. A dead SD card on the Pi

1. **Mac, owner:** Raspberry Pi Imager, Raspberry Pi OS Lite (64-bit, Debian 13 "trixie"), and in its settings:
   hostname `mech`, user **`lupin`** (never `pi`), the Mac's ssh public key, Wi-Fi, time zone. Write a 64 GB card and
   boot the Pi.
2. **Mac:** copy the body's code across:

   ```bash
   ssh lupin@mech.local 'mkdir -p ~/peak/node' && rsync -a --exclude __pycache__ node/ scripts/pi-firstboot.sh lupin@mech.local:~/peak/node/
   ```

3. **Pi, owner** (asks the `lupin` password for sudo): `bash ~/peak/node/pi-firstboot.sh mech`, then `sudo reboot`.
   It names the host, turns on I2C and the hardware watchdog, installs the apt packages and builds `~/peak/.venv` from
   `node/requirements.txt` with the system's gpiozero and lgpio.
4. **Mac, owner:** `scripts/deploy-node.sh` installs and starts `peak-servod`, `peak-camd` and `peak-audiod` with log
   rotation. Then `scripts/broker-passwords.sh` again for the `mech` user alone, or the old password into
   `~/peak/peak.env` as `PEAK_MQTT_USER=mech` and `PEAK_MQTT_PASSWORD=...`, and `sudo systemctl restart peak-servod`.
5. **Mac, check:** `mosquitto_sub -t peak/mech/status -C 1` says `online`; `npm run status` shows the body; the eyes
   are on the OLED.

The wiring does not change with the card: the physical pins are in `CLAUDE.md`, Environment facts.

## 5. One part misbehaving

| Symptom | First move |
| --- | --- |
| A Mac part down or restarting | `npm run status`, then its log `~/Library/Logs/peak/<part>.log`. `launchctl kickstart -k gui/$(id -u)/sh.peak.<part>` restarts it |
| Rho deaf | Is the Pi streaming (`peak-audiod` active)? Is UDP :5001 free of a second listener (`lsof -nP -iUDP:5001`)? whisper up? |
| Rho slow to answer | `npm run perf`; `OLLAMA_HOST=127.0.0.1:11435 ollama ps` shows the brain loaded |
| The body offline | `mosquitto_sub -t peak/mech/status -C 1`; `ssh lupin@mech.local systemctl status peak-servod` |
| The light ignores commands | `npm run device` shows whether it is online; it may be reconnecting |
| Everything stuck | `npm run down`, then `npm run up` |

The traps behind each of these are in `docs/gotchas.md`.

## 6. Power: the UPS

Rho needs four things powered through a cut: the Mac mini (5 W idle by Apple's figure, under 140 W at most), the Pi
(about 5 W), the router, and the light's ESP32 (USB from the Mac). Picked 9 Nov: a **Mecer ME-1000-VU, 1000 VA / 600 W**,
R1,099-1,440 at South African shops (not ordered). Plug the Mac, the Pi's supply and the router into its battery
outlets. Once it is here: pull the wall plug for five minutes with Rho running and check that the Mac stays on (some
desktop supplies dislike a stepped-sine UPS on battery), then note the runtime here.

## Not tested

This runbook has not been run end to end: no machine was wiped to write it. Sections 2 and 5 are from tests already
in `docs/log.md`; sections 3 and 4 are each step checked against the running machines on 9 Nov (the commands, paths,
model names, settings and packages exist as written), not replayed on a blank one. `pi-firstboot.sh` was corrected the
same day to match the Pi as it runs and has not run on a fresh card since.
