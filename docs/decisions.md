# Decisions and why, in full

`CLAUDE.md` lists each decision in a line. This file keeps the evidence: what was compared, the numbers, and what was
ruled out. Bake-off tables are in `mind/bakeoff/README.md` (speech-to-text) and `mind/bakeoff/brain/README.md` (brain
and eyes). Change a row when a decision changes; do not delete the old reason, say what replaced it.

| Decision | Why |
| --- | --- |
| Mosquitto, not RabbitMQ or embedded aedes | Retained messages and Last Will give body presence for free; ESP32 bodies speak MQTT natively. aedes was removed. |
| All AI on the Mac, Pi stays thin | Pi 3B is too slow for whisper or vision. It runs only servod, camd, audiod. |
| Local Ollama brain, not Anthropic | Owner's choice. Abliterated only. |
| One model for brain and eyes: `huihui_ai/qwen3-vl-abliterated:8b-instruct` (since 2 Nov 2026 evening) | Bake-off (`mind/bakeoff/brain`, 52 cases + 20 sequence steps, 5 runs; table in its README): the old split "8B brain + `qwen2.5vl:3b`" was 93% strict at 0.5 s but **16 GB resident** (the 3B eyes are 10.4 GB loaded), so the other program's `qwen3:14b` evicted it constantly. Qwen3-VL unified: 94-96% strict, 0.5 s p50, 7 GB for everything, and the only model of three that did not invent a person in an empty street photo. `huihui_ai/qwen3.5-abliterated:9b` scored highest as a brain (98% unified) but takes 1.3 s per reply, 8.5 GB, and hallucinated a person; it stays installed as the accuracy option (`PEAK_MODEL`, one line). 14B abliterated: 84%, shrugs at everything. Gemma 4 12B: cannot load on Ollama 0.24.0. `gemma4:26b` (19 GB) and `moondream` (garbage descriptions) were ruled out earlier. |
| Ollama 0.40.13 kept (owner decision, 3 Nov 2026) | Needed to load Gemma 4, which then lost the bake-off (94% strict at 3.0 s). The new engine gives the brain 0.4 s and 5.3 GB instead of 0.5 s and 7 GB, at the cost of photo descriptions taking 5.6 s instead of 1.8 s. Accepted: the eyes loop is change-triggered with a 10 s cooldown, so a slower description only delays the `{see}` event. Downgrading would need `brew extract` of the 0.24.0 formula. |
| Prompt carries gesture meanings and examples, temperature 0.3, no sense noise | The first prompt listed bare gesture names and appended uptime/servo angles/temperature every turn; the 8B answered "wave at me" with look_right. With `brain.js`'s prompt the same 8B went to 93% strict. Descriptions live in `mind/orchestrator/gestures.js` because `servod` iterates the YAML values as keyframes. |
| Nine narrow rules in the prompt, tuned one failure at a time, with held-out case groups | Lesson from TypeSafe's System One models (`mind/orchestrator/LESSONS.md`): small models fail on narrow decisions hidden inside the wide one. v1 → v5 took Qwen3-VL from 94% to 100% strict; two intermediate versions each fixed a case and broke another, so every prompt change gets a full bake-off run and a held-out group written before tuning. Examples carry a rule better than the rule alone. |
| Gesture fires from the streamed reply, before the spoken line | The gesture is the first JSON field; `askBrain({ onGesture })` fires at 0.24 s instead of 0.4 s, 0 mismatches with the parsed reply in 485 calls. Confidence from logprobs is logged but not acted on: Qwen3-VL is as sure when wrong as when right; `PEAK_MIN_CONFIDENCE` exists for the 9B. |
| Voice: macOS `say` on the Mac, streamed to the HomePod mini over AirPlay (5 Nov 2026) | The body has no speaker yet and the owner asked for the HomePod. `mind/voice/homepod.py` (Python, own venv, `pyatv`) synthesises each line to a WAV and streams it; the Mac's sound output is never changed. Costs about 2.5 s from reply to first sound, 2 s of it AirPlay's own buffer. Piper and a speaker on the body stay the plan for a voice that travels with the mech. |
| Pi mic streams to the Mac | whisper `small` runs on the Mac; `hearing.js` reads UDP :5001. |
| whisper.cpp server, not the openai-whisper CLI | The CLI cold-started per 5 s chunk (torch load, about 15 s speech-to-reaction). `whisper-server` (Homebrew `whisper.cpp`, Metal) stays resident; `hearing.js` cuts utterances at pauses and POSTs them. |
| Power: undecided between three layouts | Parts ordered: UBEC 5A, UBEC 3A (5.25V ±0.5V, in 5.5-26V), Mini560 5V Pro x5 (needs about 7V in). Concept A (SHOPPING.md): UBEC 5A servos, Mini560 Pi. B: swapped. C (leaning): both UBECs, Mini560 spare. Decide after measuring outputs with a multimeter. |
| OLED face: a Python port of FluxGarage RoboEyes, and the repo is GPL-3 (owner decision, 5 Nov 2026) | The owner chose the RoboEyes look over a Doom-style head and a helmet tried the same evening. RoboEyes is Arduino C++ and cannot run on the Pi, so `node/eyes.py` is a port; it is GPL-3-or-later (C) Dennis Hoelscher, `servod` imports it, and the repo is public, so the whole repo carries `LICENSE` (GPL-3) and the port keeps his copyright line plus a dated note of what changed. Eyes fill the screen with no text: spoken lines go to the HomePod, power shows as tired eyes and sweat. |
| Deploy by rsync | `scripts/deploy-node.sh`. |
| Python venv on the Pi at `~/peak/.venv` | Raspberry Pi OS (Debian 13, trixie, on mech) blocks system pip. |

## Added 5 Nov 2026, from a read of every past session

| Decision | Why |
| --- | --- |
| Hostname equals node name (`mech`); the user stays `lupin` | Less confusion once there are three bodies. |
| RabbitMQ only if the mind grows into several backend services, and then bridged behind Mosquitto | Mosquitto fits flaky Wi-Fi and 1 GB devices; a bridge keeps the bodies unchanged. |
| Anonymous broker on `0.0.0.0` | Accepted for the home LAN (2 Nov). A username and password come before any guest network or second site. |
| The systemd unit reaches the Mac by mDNS name | The first unit had a fixed IP on the wrong subnet, and `Restart=always` would have looped forever. |
| JSON reply shape instead of tool calls | The first 14B model failed with "does not support tools" (2 Nov). `look_at` was dropped then because the shape has no numeric fields. |
| Servo output through `node/pca9685.py`, a direct smbus2 driver | `adafruit_servokit` needs Blinka, which does not build on the Pi 3B. Unit-tested only; with no chip wired, non-sim `servod` exits on the first I2C write, which is expected. |
| Sensors and the OLED live in `servod`, not a separate `sensord.py` (the owner's handover planned one) | One daemon, one status, and the distance reading sits where the Stage B obstacle stop needs it. Split it out if the outputs make `servod` unwieldy. |
| Jev (TypeSafe, hosted) not used as brain or helper; only its design lessons | Hosted, closed weights, not abliterated, and no latency win from South Africa. `jevai.net` is an unofficial reseller. The owner raised Jev on 1 and 3 Nov. |
| faster-whisper, mlx-whisper, sherpa and Vosk ruled out on research | faster-whisper is CPU-only on a Mac; mlx-whisper needs a Python server and gains nothing at this model size; sherpa and Vosk are no more accurate. |
| 27B ceiling test skipped (owner's choice) | 17 GB does not fit the GPU budget. |
| Brain bake-off written in Node | It imports the real prompt code (`buildMessages`, `askBrain`) rather than a copy. |
| Few-shot examples inside the system text | Keeps the prompt prefix cacheable. |
| The eyes are their own reply field, not entries in the gesture enum | Old cases score as before, a wave and an expression can go together, and a wrong pick is only cosmetic. |
| Reflexes on the body first, the brain's field second, no native tool calling for the face | Tools pay off only where they return information (`look_at`, a sensor read, Lupin). |
| No third-party art in the public repo | The Doom-style head was drawn fresh; a helmet that was recognisably Marvel's was discarded uncommitted. |
| Eyes prompt v1 rather than v3 | A missing wave is less odd than an arm swinging at a question. |
| NeoPixel on SPI (GPIO10), not PWM (GPIO18) | No root needed and no clash with onboard audio. |
| Only the character was renamed Rho | The owner asked for the name (5 Nov); keeping the project, topics and `PEAK_` settings avoided a rename of everything else. |
| Mech Suit as the first body | Chosen over Big Fig, Scout Rover and Quad Walker in the "4 Build Concepts" Claude doc. The drone is deferred: Tello is discontinued. |

## Added 7 Nov 2026

| Decision | Why |
| --- | --- |
| Every device in the room (light, projector, screen) is a hive node on the same broker, declared as data in `mind/devices/devices.yaml`, not a Home Assistant behind the mind | The hive design already gives presence by Last Will and one command path; a second controller for three devices would be a second place to configure each. Each device keeps its own firmware's topics; the YAML is the adapter. |
| The desk light runs lightbar2mqtt unchanged on an ESP32-C3, not an ESPHome component or the Pi | The only ESPHome bar component is for the 1S (02YL). lightbar2mqtt (Arduino, MIT, 156 stars) supports exactly the MJGJD01YL, speaks MQTT, and its config takes any SPI pins. The Pi route (lamperez, Python) would tie the light to the mech and take the SPI pins the NeoPixel wants. |
| The brain's device actions are a fourth flat enum field, `action`, with absolute presets (bright, dim, warm, cool) | Same shape as `eyes`: old cases score as before, a gesture and a switch can go together, and the 8B handles a short enum. The firmware takes absolute levels, so relative "brighter" is a preset. |
| Action prompt v2 ships in code with the switch off; the owner turns it on | Gate "no old group below the baseline" cleared; 99% strict, 0 unasked switches; but 72% on the fresh group (a permission read as a request, an example's words copied back). Same precedent as the eyes field. |
| The prompt's examples are data (`mind/examples/examples.yaml` plus taught lessons in `learned.yaml`), shown whole; nearest-K retrieval is built but off | Measured 7 Nov 2026 late: all 23 examples 98% strict with no old group lower and the seven held-out `bank` cases 100%; the nearest 6 by embedding 95% with four old groups lower, p50 1.3 s (no prompt cache, a third model fighting for Ollama's two slots); the nearest 6 by words 98% but `bank` 90%. Teaching by appending beat fine-tuning for now: 99% was already there, and a lesson lands in seconds, not a training run. Revisit retrieval when the bank is too big to show whole. Ruled out for now: QLoRA on the 8B (mlx-vlm / Unsloth, then a GGUF import of doubtful Qwen3-VL support). |

## How a model, prompt or speech engine gets changed

The method the owner asked for on 2 Nov and that every change since has followed:

1. Trace how the current choice came about.
2. Research the approaches on the web and table the candidates with sources.
3. Ask the owner the scope questions and get the plan approved.
4. Build the harness on the production code, not a copy.
5. Write the cases before tuning, and a fresh held-out group after tuning stops.
6. Run each case several times and read the per-group table.
7. Apply a gate set beforehand (for the brain: highest strict pass with p95 under 3 s and both models staying resident).
8. Check memory with `ollama ps`.
9. Test on real inputs: Pi-mic clips, the owner's photos.
10. Run end to end over MQTT, then a 60 s live window with the owner.
11. Record the result, including what did not work, then commit locally and ask before pushing.


## Added 8 Nov 2026

| Decision | Why |
| --- | --- |
| Desk rig: one printed carrier on the arm's VESA plate, leaning so the shelf is level while the head rests on its face-down stop; the camera in a flat pod under the shelf; the sonar on an outrigger on an 8 mm grid; Rho on a glued real plate on top; the mic on a bar (8 Nov 2026) | Three designs were judged (a one-piece shelf on a vertical plate, a Technic-pitch pegboard, a stop-seated pod on a carrier). The stop-seated one won on mechanics (84 vs 79 vs 71): its pitch is a gravity well, not friction, and the pod is printed face-down so every pocket floor is parallel to the datum. The pegboard's 8 mm grid, fit coupon, pinned Rho and PIR visor were grafted in; the one-piece lost on print orientation (100 mm walls, a ring in mid-air). The push-pull trim screws of the winner were replaced by shim washers: fewer inserts, and the GY-521 is the level anyway. Full story in `docs/log.md`, Desk rig. |
| Nothing printed carries brick clutch; real plates glue into printed pockets and real pins go into coupon-tuned Ø4.9 holes | Shop FDM is ±0.1-0.2 mm, the whole clutch budget, and cannot be re-tuned per print; Brickset found printed clutch "nowhere near" real. |
| Keep the HC-SR04+ for height, temperature-corrected with a DS18B20 in free air; no time-of-flight sensor | ±3-5 mm expected against ±20-25 mm by the VL53L1X datasheet, which is also marginal on a dark desk; the sonar is wired already. |
| 2 kg of ballast at the arm's head: strap weights now, a laser-cut steel plate later | The arm's gas spring lifts at least 2 kg; the head carries 0.2 kg today and floats to its top stop, so no height can be set. |
| Keep the Trust Mantis in a rigid foam-lined ring | 4.5 % word errors already; omnidirectional, so no orientation gain; no thread to mount by. A band shock mount only if thumps show. |
| OpenSCAD, one parametric file, rendered by a script; STLs committed | Text, diff-able, every measured dimension a named parameter; the owner edits a number and re-renders rather than opening a GUI CAD. |
