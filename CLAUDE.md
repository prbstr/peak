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
2. See what is running before you start anything: `pgrep -fl "orchestrator/index.js|senses/|voice/|whisper-server"` on the Mac, `mosquitto_sub -t peak/mech/status -C 1 -W 3` for the body. Two minds answer every event twice.
3. Since 7 Nov evening the Mac processes are started detached by `npm run up` (pids and logs in `mind/run/`) and outlive any session; `npm run status` shows them. Since lane A (8 Nov, `docs/supervision.md`) `npm run up` loads them as LaunchAgents `sh.peak.<part>` instead, logging to `~/Library/Logs/peak/`; until the cutover after that branch is merged the running parts may still be the old nohup copies. A part launchd runs comes back by itself after a kill, so stop one with `npm run down -- <part>`, never `kill`. A session may still have started one by hand as its own background task. Do not stop a process another session started unless the owner says so in this chat; `npm run down` stops them all, so use it only on his word.
4. A faked `heard` event is spoken aloud while the voice process runs: on the Mac mini's speaker since 8 Nov (Kokoro), on the HomePod in the bedroom when `PEAK_VOICE_BACKEND=homepod`. Mind the hour.

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
| example bank / lesson | The `{event} -> {reply}` examples in the brain's prompt: the built-ins in `mind/examples/examples.yaml` plus the lessons in `mind/examples/learned.yaml`. A lesson is one taught example (`npm run teach`), live on the mind's next event. |
| device / action | A node with no senses and no gestures that the hive can switch (the desk light; a projector and screen later), declared in `mind/devices/devices.yaml`. An action is one named switch on it (`light_off`), with the topic and payload its firmware wants. |
| bake-off | Scoring candidates (models, prompts, speech engines) on fixed cases. Held-out groups are cases written after tuning stops. |
| rig | The printed carrier on the monitor arm that holds the body over the desk, `hardware/desk-rig/`. Not a body: it has no node of its own. |
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
                                  voice/local.py (Kokoro) --> Mac mini speaker (speaks every {"say"} on peak/+/cmd)
                                  voice/homepod.py -- AirPlay --> HomePod mini (the other backend, PEAK_VOICE_BACKEND=homepod)
```

- **Broker.** One Mosquitto on the Mac (brew service, `*:1883`). Logins required since 8 Nov 09:58 (`scripts/broker-auth.sh on`; `off` goes back to anonymous): six users (mind, senses, voice, mech, desk-light, owner), each held to its topics by `broker/peak.acl` (`docs/broker.md`). Bodies are clients only.
- **Topics.** `peak/<node>/cmd`, `/sense`, `/event`, `/status` (retained online/offline, set by Last Will), and `peak/brain/intent`. Schemas in `contracts/`.
- **Senses publish events only**, never raw frames or audio. The orchestrator thinks on one event at a time; one more may wait and a newer one replaces it. Bodies that go offline leave the hive map.
- **Brain.** Replies in JSON enforced by Ollama structured outputs, built in `mind/orchestrator/brain.js`: `{gesture, say}`, plus `eyes` when `PEAK_BRAIN_EYES=1` (on in `mind/.env`, off in code) and `action` when `PEAK_BRAIN_DEVICES=1` (on in `mind/.env` since 7 Nov evening, off in code). `eyes` names a trick or is null; `action` names a device action or is null. The gesture is the first field and is sent the moment it streams in, before the spoken line. The brain never moves servos or eyes directly. Its examples are the example bank, `mind/examples/examples.yaml` plus the lessons in `mind/examples/learned.yaml`, all shown and checked like a reply (`mind/orchestrator/examples.js`); `PEAK_EXAMPLES_K=N` would show only the N nearest, measured worse on 7 Nov and off. A `sensed` event gets one line and no gesture, so no arm swings at something 5 cm away. The conversation history is cut back to the last 10 messages once it passes 20, never a turn per event, so Ollama's prompt cache holds (8 Nov). Events carry `at`, the time the sense published them (`contracts/event.schema.json`); the mind strips it before the brain and logs one `[perf]` line per reply (`npm run perf`). Since 8 Nov 12:30 the brain runs on an Ollama of its own, LaunchAgent `sh.peak.ollama-brain` on 127.0.0.1:11435 (`PEAK_BRAIN_HOST` in `mind/.env`; one model slot, kept loaded for ever), so the desk camera's 4B, the embedder and OpenClaw's models on Homebrew's :11434 can never evict it.
- **Fast lane.** `mind/orchestrator/fastlane.js` (8 Nov) answers a `heard` event without the brain when the whole request, wake word and "please" stripped, is one of 78 exact phrases: stop ("stop", "freeze"), a gesture by name, an eye trick, the six light actions. It acts in about 1 ms, even while the brain is busy, under the same rails, and its turn goes into history. A stop sends `{"stop":true}`, stops the trick, drops the waiting event and drops the reply the brain is thinking. Anything else ("don't turn the light off", "kill the lights, I'm heading out") goes to the brain. The lane says nothing aloud. `PEAK_FAST_LANE=0` turns it off.
- **Devices.** `mind/devices/devices.yaml` declares each device the hive can switch: a `describe` line, the topic prefix its firmware uses, its online/offline topic, and its actions with the exact topic and payload each sends. `mind/orchestrator/devices.js` checks the file at load (like tricks) and publishes; the brain's `action`, a trick's `action` step and `npm run device -- <action>` all go through it. Firmware and wiring per device under `devices/<name>/` at the repo root. First device: the desk light (six actions, absolute presets, because lightbar2mqtt takes levels not steps).
- **Rails.** `mind/orchestrator/policy.js` (8 Nov, lane B) sits outside the brain: an event older than 5 s (`PEAK_EVENT_MAX_AGE_MS`) is dropped before the brain, one without `at` counts as fresh; a device `action` passes only for a `heard` event and only within 8 s of its `at` (`PEAK_ACTION_MAX_AGE_MS`); a `sensed` event gets no gesture, the early streamed gesture included. Each veto logs `[mind] veto ...`. The prompt is untouched: bake-off 98% strict, the same table as 7 Nov run 4.
- **`servod`** runs one motion at a time with a one-deep queue; `say` runs beside it; `{"stop": true}` aborts the move and releases the servos. It also owns the GPIO sensors and adds `distance_cm`, `motion`, `temp` and `throttled` to `sense` twice a second. `PEAK_SIM=1` simulates the servos only: sensors and the OLED stay real. Since 8 Nov (lane B) `node/cmdcheck.py` `validate_cmd` checks every servo and gesture command first (known servo, finite `deg`, `ms` 20-5000, known gesture); a bad one is dropped with one log line, the motion worker logs any error and carries on, and `sense` carries `motion_alive`. On the Pi since 8 Nov 09:20: `{"servo":"nope"}` and a non-numeric `deg` were dropped with one line each and the next wave played. **Dead-man switch** since 9 Nov (`node/deadman.py`): the mind's retained `peak/mind/mind/status` turning `offline` (its Last Will) or the body losing the broker cancels the move and the waiting one and the servos **hold** (no release), one `[servod] deadman: hold (...)` line; nothing replays, and hand commands still run while the mind is down. No silence timer: one legal move lasts 5 s. MQTT keepalive 5 s (`PEAK_KEEPALIVE_S`, was 60). Each queued move carries the count of cancels before it, which closed the stop race of 8 Nov. Live on the Pi 9 Nov 06:59: `kill -9` of the mind 1.5 s into a 5 s head move stopped it at 108° of 170° and the queued wave never started.
- **Eyes.** `servod` draws them with no help from the mind. Reflexes, highest claim first: broker offline or the mind offline = shut; something closer than 30 cm = wide eyes once; `look_left` / `look_right` = eyes held to that side; a spoken line = eyes pulsing, starting `talk_delay_s` after the command; bad power or heat = tired lids and sweat (`strain: false` in `node/config.yaml` switches that off); otherwise wander and blink.
- **`eyes` command.** The mind can take the eyes over on `peak/<node>/cmd` (`contracts/cmd.schema.json`, `$defs.eyes`): `mood`, `look`, `anim`, `open`, `curious`, `shape`, `ms`. When `ms` runs out, or on `{"eyes":{"release":true}}` or a stop, the reflexes have them back. Unknown fields are ignored, never an error.
- **Tricks.** `mind/orchestrator/tricks.js` checks every trick against the command contract and `gestures.yaml` (at most 16 steps and 30 s) and plays the steps over MQTT; a newer trick or a stop takes over. Built in: happy, angry, sleepy, confused, laugh, surprised, wink, peekaboo. `mind/tricks/learned.yaml` is merged in at load and `appendTrick()` writes to it; nothing calls that yet. It is the door for teaching by voice and for Lupin.
- **Voice.** Two backends, picked by `PEAK_VOICE_BACKEND` in `mind/.env` (`homepod` in code, `kokoro` in `.env` since 8 Nov): `mind/voice/local.py` speaks each `say` with Kokoro 82M on the GPU through mlx-audio, out of the Mac mini's own speaker, first sound 0.21 s median; `mind/voice/homepod.py` uses macOS `say` streamed to the HomePod mini over AirPlay, about 2.5 s after the command. `talk_delay_s` in `node/config.yaml` must match the backend (0.3 for kokoro, 2.5 for homepod) or the eyes pulse out of step. Details in `mind/voice/README.md`.
- **Supervision.** Each Mac part is a LaunchAgent `sh.peak.<part>` (`mind/launchd/`, written by `scripts/install-agents.sh`) that runs `scripts/run-part.sh <part>`: `.env` loaded, then `exec` the part. launchd restarts it after any exit but a clean one, at most every 10 s, and appends its output to `~/Library/Logs/peak/<part>.log`. Each part holds a retained `peak/mind/<part>/status` (`online` on connect, `offline` by Last Will; `connect(part)` in `senses/lib.js`, set by `PEAK_PART`) and retries the broker with backoff 1-30 s. `orchestrator/health.js` (agent `sh.peak.health`) publishes a retained `peak/mind/health` every 30 s and whisper's status from an HTTP probe. On the Pi, systemd units `peak-servod`, `peak-camd`, `peak-audiod` (installed by the owner, `scripts/deploy-node.sh`). The whole picture: `docs/supervision.md`.

The aim for the eyes and tricks is a set that grows over time: the robot can be taught new tricks and skills, and later learns new things on its own.

## Where things stand (9 Nov 2026, 07:05)

| Area | State | Not yet checked |
| --- | --- | --- |
| Repo | https://github.com/prbstr/peak, `main`, GPL-3. 89 mind tests and 87 node tests pass (8 Nov, after lanes A and B merged). | |
| Mind, broker, body | Working end to end, Mac and Pi. The broker requires a login per role since 8 Nov (`docs/broker.md`); `mosquitto_sub`/`_pub` on the Mac log in as `owner` from `~/.config`. On the Pi `servod` runs with `PEAK_SIM=1`, started by hand. | |
| Hearing | Pi USB mic, whisper.cpp `medium.en` on the Mac, wake word "Rho"; for 8 s after it, sentences pass without the name (`PEAK_WAKE_WINDOW_MS`). Transcript 0.4-0.6 s after speech ends. Owner, 5 Nov: "working excellently". Silero VAD inside whisper since 8 Nov 12:46 (`PEAK_WHISPER_VAD=1`, 300 ms padding): same 4.5% word errors on the phrase clips, noise back empty. | "Bro wave at me" (name run into the request) is missed, except for a stop since 8 Nov 20:49 ("Bro stop" passed live 20:51). Rho's own voice is dropped by words since 21:16 (`senses/halfDuplex.js`) |
| Brain | `huihui_ai/qwen3-vl-abliterated:8b-instruct` for brain and eyes. Every bake-off group at 100% bar one known miss ("can you not your head"). Live 8 Nov (`npm run perf`, faked `heard` events through the running mind): on a prompt-cache hit, five events in six, gesture out 0.31-0.34 s and reply 0.8-1.2 s; the sixth, after a history cut, 1.1 s to the gesture. Before that day's trim fix every event after the tenth re-read the whole history: gesture 2.0 s, reply 2.6-3.0 s, which is where the 4.5 s live median of 7 Nov came from. Picks tricks since the late restart on 5 Nov. Action field built 7 Nov: 99% strict with it on, 0 unasked switches; on in `mind/.env`. Example bank built 7 Nov late: the examples are data in `mind/examples/`, five lessons taught by `npm run teach`, 98% strict over 212 cases with the seven held-out bank cases 100% and no old group lower (in-sample: the lessons were written from those groups' misses; an honest held-out group comes in session 6 of the 8 Nov plan). Live in the mind since 8 Nov 07:23. | A trick asked for by voice. A spoken paraphrase of a lesson. With the Mac short of memory, Ollama evicts the brain for OpenClaw's models or for the 4B vision model: 5.7-9 s reloads (8 Nov). |
| Desk light (device) | **Working on the glass and by voice since 7 Nov evening** on the ESP32-C6 under ESPHome with the `xiaomi_lightbar` component (`devices/desk-light/light.yaml`): on, off, dim, bright, warm, cool by hand, "Bro, lights off" and "lights on" by voice. Relative steps, state kept across reboots, the puck heard, no firmware patches. The C3 route (lightbar2mqtt, four flash-time patches) is retired; its lessons are in `devices/desk-light/README.md`. Powered from the Mac mini's USB-C for now. | A USB charger of its own. The C3 SuperMini is spare: the next blank ESPHome node. |
| Vision | Pi camera over the desk on the spare monitor arm (camera turned 90°) since 7 Nov evening. Desk mode built into `vision.js` 7 Nov late: a hand tracker gates the looks, a crop around the hands is described and published as a quiet `doing` event the brain keeps for the next thing heard (13 of 19 busy moments right in the desk bake-off). Since 8 Nov the crops go to `qwen3-vl:4b-instruct` beside the brain, not the brain's own model: with 145 looks running during 20 replies, gesture out 0.33-0.44 s once both models were loaded. | Brain and 4B need about 9 GiB together; on 8 Nov they evicted each other for 2 minutes while the Mac was short (replies 13-20 s). A brighter room; a held-out recording. Vision was down 7 Nov 22:09 to 8 Nov 07:19 with no line in its log; every part now logs how it exits. |
| Sensors | Distance and PIR in every `sense`; `presence.js` turns arrivals and close approaches into `sensed` events. | MPU6050 (shares the OLED's pins until a breadboard arrives) |
| Eyes (OLED) | RoboEyes port, reflexes, `eyes` command and eight tricks running on the Pi at 14 frames a second. The tired-and-sweating strain should be gone since the new supply (7 Nov); `throttled` reads 0x0 in every sense. | The owner has not watched them on the glass |
| Voice | Kokoro on the Mac mini's speaker since 8 Nov (`PEAK_VOICE_BACKEND=kokoro`): first sound 0.21 s median live against about 2.5 s on the HomePod, which stays as the other backend. Pi on `talk_delay_s: 0.3` since 12:05; the owner heard it from the Mac with the eyes in step (window 12:06: five utterances answered in 0.69-0.72 s). | Slower while the 4B describes frames (shared GPU). |
| Servos, PCA9685, battery | Ordered on AliExpress, due early to mid December 2026. Nothing wired; `node/pca9685.py` has never met the real chip. | Everything |
| Pi power | Fixed 7 Nov by the official 5.1 V 2.5 A micro-USB supply: `throttled=0x0` after a reboot, 0 undervoltage samples in 30 s with camera, mic, `servod`, a wave and an eyes trick running, CPU 700-1200 MHz, 47 °C. | Hours-long run |
| Persistence | **Mac on launchd since 8 Nov 09:05, Pi on systemd since 09:20** (`peak-servod` with `PEAK_SIM=1`, `peak-camd`, `peak-audiod`, all enabled; one servod; servod logs to `~/peak/servod.log`): LaunchAgents for the seven Mac parts (eight since the brain's Ollama joined at 12:30) with appended logs, Last Wills, broker backoff and `health.js`; systemd units for servod, camd and audiod. Tested on a throwaway agent and a private broker (`docs/log.md`, Supervision). On the Mac a crash or `kill -9` is back in about 1 s with its log kept (vision, 09:06); a Mac reboot not yet tried. A Pi reboot (09:25) brought the body online 43 s after the kernel started, one servod, both streams reaching the Mac, no `npm run up`. The Mac parts all died once on 7 Nov evening between 19:46 and 20:35, cause unknown (logs were overwritten by the restart). | A Mac reboot (FileVault password once). |
| Desk rig (printed) | **Designed 8 Nov 2026, nothing printed yet.** `hardware/desk-rig/rig.scad`: a carrier on the arm's VESA plate that leans 30° so the shelf is level while the head rests on its face-down stop (gravity sets pitch, the parallelogram keeps it through the lift), a pod under the shelf for the camera, GY-521 and a vial, the sonar on an outrigger on an 8 mm grid, Rho on a glued real 4x8 plate up top, the mic in a ring on a 150 mm bar, two horns to lift by. 8 parts, about 330 g PETG, STLs and renders committed. Guide: "peak — Desk rig guide". Needs 2 kg of ballast at the head (the arm's gas spring lifts 2 kg minimum; today's 0.2 kg head is why the arm floats to its top). | The arm's stop angle and repeatability (`STOP_DEG`), the X-plate span, the mic's neck, the OLED and sonar variants: all measured before printing. The coupon fit. A live run. |

## Next steps

0. **The merged review plan, 8 Nov 2026.** One order for ARCH's review, the reliability plan and the strategy review, with Monday's corrections; the plan file is `~/.claude/plans/ok-a-review-has-buzzing-fern.md` on the owner's Mac. Session 1 done 8 Nov morning (perf line, history-trim fix, vision on the 4B, exit lines, docs). Lupin's write gate, fail-closed profile and backups run in a session in `../lupin`. Lupin's five fixes and its daily backup committed 8 Nov (lupin `9de538e`..`8075b49`; the owner's `chmod -R go-rwx ~/.lupin` left). Lanes A (supervision) and B (safety rails) built in parallel worktrees and merged into `main` 8 Nov. The Mac side was cut over to launchd 8 Nov 09:05 with the rails live, the Pi units and servod's command check at 09:20, newsyslog and lupin's `chmod` done. The Pi survived a reboot (online 43 s after boot). A spoken window passed at 09:28 (five requests heard, answered in 0.7-2.3 s; the owner saw the light go off and on, and it ended at full after "brighter"). Broker logins on since 8 Nov 09:58 (`docs/broker.md`): anonymous clients refused, every part, the body and the light logged in; persistence on. Kokoro voice merged and switched on 8 Nov 11:50, the Pi on the matching eye delay at 12:05, voice and eyes in step by the owner's ear and eye. Session 6 built 8 Nov 12:08-12:48: `held1` (brain 92-93% held out, below the 95% gate on two brain misses), the fast lane with a spoken stop (147/147 right), the brain on its own Ollama (no reloads under load), Silero VAD; the voice stops on a stop. Its spoken window ran 8 Nov 20:45: wave, sums, lights all right (the lane at 0-1 ms), but "Bro stop" was dropped by the wake gate for want of a comma; fixed 20:49 (a stop word beside the name always wakes); at 20:51 "Bro stop" cut a story 10 s in, 4 ms after it was heard. The same window showed Rho answering its own voice; half-duplex hearing fixed that at 21:16 (live 21:17: no self-replies, the bare "Stop!" cut a story in 7 ms). Dead-man hold built and live on the Pi 9 Nov 06:59 (a killed mind stopped a head move mid-way; `servod` updated by rsync and a kill of its pid, systemd's `Restart=always` brought it back, no sudo). Next, in order: whisper right after Rho speaks (item 9); recovery (runbook, UPS); a Mac reboot (the owner verifies it another time). Frozen until the servos land: projector, NeoPixel, rig software, teach-by-voice.
1. **Pi power.** Done 7 Nov 2026 with the official 5.1 V 2.5 A micro-USB supply (`docs/log.md`, Pi power).
2. **Owner watches the eyes** (60 s): idle and blinks, a hand inside 30 cm, "Rho, give me a wink", `npm run trick -- peekaboo`.
3. **Teaching.** By hand since 7 Nov late: `npm run teach -- "text" --gesture wave --eyes sleepy --say "..."` appends a lesson to `mind/examples/learned.yaml` and a running mind uses it on its next event; measured in `mind/bakeoff/brain/README.md`. Left: the live test once the mind is restarted (60 s, a paraphrase of a lesson); teaching by voice ("Rho, when I say X, do Y" becomes a brain reply that defines a lesson or a trick, saved with `appendExample()` or `appendTrick()`); learning on its own waits for Lupin (Stage C).
4. **Eyes prompt.** The goodnight wave came back with the bed lesson (7 Nov late, `fresh.night` 3 of 3); v1 still nods while answering "two plus two". Try a lesson before a rule; full bake-off each time.
5. **Survive a reboot.** Built 8 Nov (lane A): LaunchAgents on the Mac, units for servod (with `PEAK_SIM=1`), camd and audiod on the Pi. Left: the cutover (`npm run down`, then `npm run up`, on the owner's word), the owner's two sudo steps in `docs/supervision.md`, then a reboot of each machine and a 60 s live window.
6. **When the servos arrive.** Measure UBEC and Mini560 outputs with a multimeter, decide the power layout (`docs/decisions.md`), wire the PCA9685 (V+ from the buck, never the Pi), tune `node/config.yaml` ranges, drop `PEAK_SIM`.
7. **Rest of the body's I/O.** MPU6050 pose in `sense`; NeoPixel ring and vibrator motor as commands. Needs a breadboard, M/F jumpers and a soldering iron; the NeoPixel also needs SPI on, `core_freq=250` and the neopixel-spi package.
8. **Desk camera.** Build the bake-off's winner into the senses: MediaPipe hand gate, 1080p stream, hand crop, "desk" prompt, a quiet `doing` event that the brain keeps as context instead of answering. Score again on a held-out recording in a lit room.
9. **Hearing.** Silero VAD on in whisper since 8 Nov (noise back empty in 30 ms); `PEAK_MIN_DB` stays -30 (at -45 the mic's idle never ends a segment). Half-duplex since 8 Nov 21:16 (`senses/halfDuplex.js`): Rho's own words heard during a line or 2 s after are dropped, a stop always passes; live, 6 echoes dropped and every request of the owner's heard. A request said the instant a line ends is one utterance with Rho's echo in front ("Throw away that meat", "Hello there Bro lights off"; measured 9 Nov, `docs/log.md`); three software fixes scored no better on 144 real-audio mixes. Next: hardware echo cancellation, a USB mic array with AEC on chip that Kokoro plays through (also lets the owner talk over Rho), on the Mac now and on the body later; the owner decides the part. An adaptive floor for `PEAK_MIN_DB`. Tune the Rho wake rule from real transcripts.
10. **Brain.** Add `look_at` back (native tool calling is possible now). Decide whether an arrival gets a wave once servos are real. Obstacle stop on the Pi itself (Stage B).
11. **Housekeeping.** Makefile: `m0` uses plain `python3` and `BROKER_IP` reads `en0` (the Mac is on `en1`). `mind/bakeoff/brain/models.json` still lists removed models. `mind/senses/README.md` still names `gemma4:26b`, `ggml-small.bin` and an unwired voice. `dtparam=i2c_arm_baudrate=400000` for smoother eyes (`sudo`). A router DHCP reservation for the Pi. A broker password before any guest network.
12. **Parts list.** `SHOPPING.md` is behind: its AliExpress ticks came from the owner's word and differ from the order pages read on 2 Nov (`docs/log.md`, Servos), it shows power layout A as settled, and it lists a USB mic he now has. Reconcile it against the order pages with him.
13. **Still to buy.** **The echo-cancelling mic (picked 9 Nov):** Seeed reSpeaker XVF3800 USB 4-Mic Array with Case (XMOS XVF3800, AEC on the chip; US$54.90-59.90 on seeedstudio.com, in stock 9 Nov; not at PiShop or Communica) plus Seeed's Mono Enclosed Speaker 4R 5W (US$7.49) on its speaker connector. Kokoro plays through it and hearing reads it, on the Mac now and on the body later; it replaces the Pi USB mic for hearing. Import: shipping and duty on top. Half-size breadboard, 40 M/F jumpers, M/M jumpers, soldering iron, speaker for the body, multimeter, a longer camera cable if 200 mm does not reach from head to backpack, and the Technic parts for the mech itself.
14. **Desk light as a hand.** Done 7 Nov on the ESP32-C6 under ESPHome (guide: "peak — Desk light guide", https://claude.ai/artifact/DyDc26DcX2hw1SPUigdvbJ; notes in `devices/desk-light/README.md`). Left: a USB charger for the C6 so it no longer hangs off the Mac mini; a 10 µF capacitor across the radio's VCC and GND when the breadboard order comes; the C3 SuperMini as the next blank ESPHome node (`devices/blank-node/`); a `movie_night`-style trick once the projector exists. Next devices on the same pattern: the projector (model decides LAN/PJLink vs IR) and its screen (relay or 433 MHz), each a new ESPHome node and a block in `devices.yaml`.
15. **Desk rig.** Designed 8 Nov (`hardware/desk-rig/`, guide "peak — Desk rig guide"). In order: (a) the owner measures the head's face-down stop with a phone level, five tries, and runs the arm bottom to top with the level on the plate; (b) the other measurements in `hardware/desk-rig/README.md`, into `rig.scad`, `./render.sh`; (c) the coupon at Taito, read it, set `pin_hole`; (d) the rest of the print, the PiShop and Builders lots, the Trojan straps as ballast; (e) build, then the software that follows: `height_mm` with temperature correction and `settled` in `servod`, pitch and roll from the GY-521, the presence "near" rule as a height drop, `PEAK_DESK_ROTATE=none` plus a desk re-score, the ChArUco calibration and `mm/px = height / 818`, the hearing gate for Rho's own voice. The steel ballast (`ballast.dxf`) replaces the straps when a laser shop has cut it.

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
| Start all of Rho | `npm run up` (whisper, mind, hearing, vision, presence, voice, health as LaunchAgents `sh.peak.<part>`, writing a missing plist first; refuses a part already running outside launchd; starts a Pi daemon over ssh only if its systemd unit is not enabled; `-- mind voice` for some parts). `npm run status` shows launchd state, restarts, MQTT status and last log line per part, the bodies, `peak/mind/health` and the mind's settings line; `npm run down` boots the Mac parts out (and stops old nohup copies by their `run/` pid files), `-- body` the Pi's hand-started daemons too. Since 8 Nov (lane A). |
| Logs of the Mac parts | `~/Library/Logs/peak/<part>.log`, appended; each start adds a `[run-part] ... starting` line. Rotated by newsyslog once the owner installs `/etc/newsyslog.d/peak.conf` (`docs/supervision.md`) |
| Write, print or remove the LaunchAgents | `sh scripts/install-agents.sh` (all eight; again after a node upgrade under nvm), `--dry-run`, `--uninstall <part>`, `--selftest x` (a throwaway agent that exits 3 every 20 s, to prove KeepAlive), `--newsyslog` (the rotation rules, for `sudo tee`) |
| Run one part in the foreground as its agent would | `sh scripts/run-part.sh <part>` (`PEAK_ENV_FILE` picks another settings file, `PEAK_LOGS` the pid-file folder) |
| Restart one Mac part now | `launchctl kickstart -k gui/$(id -u)/sh.peak.<part>` |
| Run the mind alone, in the foreground | `npm start` |
| Whisper server (hearing needs it) | `npm run whisper` (port 8178, `~/.cache/whisper.cpp/ggml-medium.en.bin`; `PEAK_WHISPER_GGML` picks another model) |
| Hearing, Pi mic | Pi: `PEAK_MIND=192.168.0.139 ~/peak/node/audiod.sh`; Mac: `PEAK_AUDIO_SOURCE=udp://0.0.0.0:5001 npm run hearing` |
| Hearing, Mac mic | `npm run hearing` |
| Vision, Pi camera | Pi: `PEAK_MIND=192.168.0.139 ~/peak/node/camd.sh`; Mac: `npm run vision` |
| Vision, one frame from a file | `PEAK_VISION_ONCE=1 PEAK_VISION_SOURCE=<image> npm run vision` |
| Presence (PIR and distance into events) | `npm run presence` |
| Voice | `npm run voice` runs the backend `PEAK_VOICE_BACKEND` names (first time, from `mind/`: `python3.13 -m venv voice/.venv-kokoro && voice/.venv-kokoro/bin/pip install -r voice/requirements-kokoro.txt` for kokoro, `voice/.venv` with `voice/requirements.txt` for homepod). `voice/.venv-kokoro/bin/python voice/kokoro_bench.py --play` times first sound |
| Mind tests | `npm test` |
| Node tests | `cd node && ../.venv/bin/python -m unittest test_eyes test_oled test_screen test_pca9685 test_cmdcheck test_deadman` (on the Pi: `~/peak/.venv/bin/python`) |
| Time each stage of the mind's replies | `npm run perf` reads the `[perf]` lines in `run/mind.log` (or the logs named): p50/p95 per stage, cache misses, whether the prefix was kept (`--last N` for the latest N) |
| Brain bake-off | `npm run bakeoff:brain -- --stream --models huihui_ai/qwen3-vl-abliterated:8b-instruct --no-pull` (`PEAK_BRAIN_EYES=1` and `PEAK_BRAIN_DEVICES=1` in front score those fields, `PEAK_EXAMPLES_K=6` scores nearest-example retrieval; flags in `mind/bakeoff/brain/README.md`) |
| Eyes comparison on photos | `node bakeoff/brain/eyes.js --models a,b --images x.jpg,y.jpg` |
| Play a trick without the brain | `npm run trick` lists them; `npm run trick -- wink [node]` plays one |
| Teach Rho by example, without the brain | `npm run teach` lists the lessons; `npm run teach -- "Off to bed" --gesture wave --eyes sleepy --say "Sleep well."` adds one (`--see`/`--sensed TEXT` for other events, `--action light_on`, `--note`); the mind uses it on its next event |
| Switch a device without the brain | `npm run device` lists the actions and which devices are online; `npm run device -- light_off` sends one |
| Mic test page | `npm run record`, then http://localhost:8179 (needs `audiod.sh` and `npm run whisper`) |
| Body on the Pi, no servos wired | On the Pi: `PEAK_SIM=1 PEAK_BROKER=twentyones-Mac-mini.local ~/peak/.venv/bin/python -u ~/peak/node/servod.py` |
| Start a Pi daemon over ssh | `ssh lupin@mech.local 'PEAK_MIND=192.168.0.139 setsid nohup ~/peak/node/camd.sh > ~/peak/camd.log 2>&1 < /dev/null &'` (one plain command, no `cd &&`). Pids in `~/peak/*.pid`. |
| Copy `node/` to the Pi without the service | `rsync -a --delete --exclude __pycache__ node/ lupin@mech.local:~/peak/node/` |
| Deploy with the systemd units | `scripts/deploy-node.sh [host]`: copies `node/`, stops hand-started daemons, installs and restarts `peak-servod`, `peak-camd`, `peak-audiod` and `/etc/logrotate.d/peak`. The owner runs it (`sudo` on the Pi). Pi logs stay in `~/peak/<daemon>.log`, appended |
| Broker logins | `scripts/broker-passwords.sh` (the owner, in his terminal: writes every password), then `scripts/broker-auth.sh on`, `off` to go back, `status`. Users, topics and the order of steps: `docs/broker.md` |
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
| Render the desk rig's printed parts | `hardware/desk-rig/render.sh` (OpenSCAD nightly; writes `stl/`, `png/`, `ballast.dxf` in two seconds). Measured sizes are the parameters at the top of `rig.scad` |

Settings live in `mind/.env` (gitignored; `.env.example` is the template). The ones that matter: `PEAK_MODEL` (the brain) and `PEAK_VISION_MODEL` (`qwen3-vl:4b-instruct` since 8 Nov, so a look never holds the brain's runner), `PEAK_BRAIN_EYES` (1 since 5 Nov), `PEAK_BRAIN_DEVICES` (1 since 7 Nov), `PEAK_VOICE_BACKEND` (`kokoro` since 8 Nov; `homepod` uses `PEAK_SPEAKER`), `PEAK_SPEAKER` (`Bedroom`), `PEAK_SPEAKER_HOST`, `PEAK_VOICE` (Daniel), `PEAK_MIN_DB` (-30), `PEAK_MIN_CONFIDENCE` (0 = off; 0.6 suits the 9B), `PEAK_EXAMPLES_K` (0 = every example in the prompt, the measured default; N = the N nearest by `PEAK_EXAMPLES_PICK`, embed or lexical). For tests: `PEAK_WAKE=off` passes every clean utterance, `PEAK_DEBUG=1` logs dropped ones, `PEAK_DUMP_DIR=<dir>` saves each utterance as a WAV. Presence thresholds: `PEAK_QUIET_S` (60), `PEAK_NEAR_CM` (30), `PEAK_NEAR_COOLDOWN_S` (10). The head of each sense file lists the rest.

## Environment facts

- **Mac.** Mac mini, Apple M4 Pro, 24 GB, macOS 26.2 (the README and the owner's handover say M5; `sysctl` says M4). LAN address `192.168.0.139` on `en1`, not `en0`. mDNS name `twentyones-Mac-mini.local`. Mac venv at `.venv` is Python 3.9, so `node/` code must run on 3.9; the Pi has 3.13. OpenSCAD 2026.10.11 (the nightly) in `~/Applications`, `openscad` on the Homebrew PATH, since 8 Nov; the stable `openscad` cask is disabled by Homebrew, and the nightly needs `--appdir=$HOME/Applications` or it asks for sudo.
- **Pi.** Pi 3B Rev 1.2, 64 GB microSD. `lupin@mech.local` (192.168.0.226 at last check), key login. Raspberry Pi OS on Debian 13 (trixie), Python 3.13.5. **`sudo` needs a password**, so ask the owner to run `sudo` lines. Venv at `~/peak/.venv`, built with `--system-site-packages`. `i2cdetect` is `/usr/sbin/i2cdetect` over ssh. `scripts/pi-firstboot.sh` sets up a new body (I2C, watchdog, apt packages, venv); it was run on mech on 2 Nov.
- **Wired to the Pi** (physical pins, F/F jumpers): OLED at I2C `0x3c` on 1, 9, 3, 5; PIR (HC-SR501) on 2, 6, 11 (GPIO17); HC-SR04+ on 17, 20, 16 (GPIO23 trig), 18 (GPIO24 echo); Camera Module 3 Wide; USB mic. The MPU6050 (`0x68`) passed its bench test but takes turns with the OLED. Planned: fan on 4 and 14, vibrator through a BC337 from pin 13 (GPIO27), NeoPixel DIN on pin 19 (GPIO10, SPI), PCA9685 at `0x40`. The 18650 cells are unprotected: keep them bagged until holder, BMS and buck are here.
- **Claude docs.** Wiring: "peak — Bench wiring guide", https://claude.ai/artifact/VFhBowXNv9TeSvXViN2TWc (tabs "Connect now" and "After the next order"). Design: "Lego Hive Robot — 4 Build Concepts", https://claude.ai/artifact/REqQJMByHZpRAc2ny6526S (Mech Suit build plan with Technic part numbers and milestones M0 to M6; the Mech Suit was chosen over Big Fig, Scout Rover and Quad Walker). Desk light: "peak — Desk light guide", https://claude.ai/artifact/DyDc26DcX2hw1SPUigdvbJ (how it works, wiring, flashing, the mind's side). Owner's cheat sheet: "Rho cheat sheet", https://claude.ai/artifact/MHRTSxpUd4AUsesBhSeYtw (what to say, what Rho does, how to watch it, hand commands, quirks); update it when the vocabulary changes. Projector: "peak — Projector guide", https://claude.ai/artifact/2ceuTf27CChxYjjLEGzby8 (BenQ W1070+ over IR from the sensor kit's KY-005 and KY-022 on an ESP32-C6 with ESPHome; RS-232 and the 12V trigger for later). Desk rig: "peak — Desk rig guide", https://claude.ai/artifact/2jPGNSnvv7B5P2AWg2asQY (the printed carrier for the monitor arm: drawings, what to measure first, the parts, the buy list, assembly, Rho's brick body, the mic).
- **Owner's handover.** He keeps a second handover in his claude.ai Project and pastes it in. It has been well behind this repo each time. Trust this file for the software; take hardware news and his plans from the pasted one.
- **HomePod mini.** AirPlay name **Bedroom**, `192.168.0.191`, open to the network, no pairing. The first-gen HomePod does not show up on AirPlay.
- **Ollama.** Homebrew service, 0.40.13. Config in `~/Library/LaunchAgents/sh.brew.ollama.plist` (`OLLAMA_MAX_LOADED_MODELS=2`, keep-alive 30m). Live log: `/opt/homebrew/var/log/ollama.log`. The GPU gets about 17.8 GB. A second Ollama, the brain's own, runs from the same binary and `~/.ollama` as `sh.peak.ollama-brain` on 127.0.0.1:11435 (`OLLAMA_MAX_LOADED_MODELS=1`, keep-alive -1, `OLLAMA_NOPRUNE=1`), log `~/Library/Logs/peak/ollama-brain.log`; `OLLAMA_HOST=127.0.0.1:11435 ollama ps` shows what it holds.
- **Models.** peak owns `huihui_ai/qwen3-vl-abliterated:8b-instruct` (the brain, 5.7 GB loaded), `qwen3-vl:4b-instruct` (the desk camera, 3.4 GB loaded), `qwen3-embedding:0.6b` (nearest-example picking, off) and `huihui_ai/qwen3.5-abliterated:9b` (slower accuracy option). `qwen2.5-coder:7b-instruct`, `nomic-embed-text` and `llama3.1:8b` belong to OpenClaw (`qwen3:14b` is gone since 7 Nov): never remove them or stop what loads them.
- **Memory.** On 8 Nov at 07:30 the Mac had 17.6 of 18.4 GB swap in use and 15% free. Besides Ollama the biggest footprints were a 4.2 GB Virtualization.framework VM (running since 7 Nov 14:24, owner not identified) and OpenClaw's gateway (2.5 GB). Ollama evicts by free system memory (`system_limited=true` in its log), so this, not the two-slot limit, decides whether the brain stays loaded.
- **Whisper.** whisper.cpp `whisper-server` on 127.0.0.1:8178, models in `~/.cache/whisper.cpp`.
- **Speech-to-text bake-off.** Own venv at `mind/bakeoff/.venv` (python3.13).
- **Parts.** Shops and delivery times are in `CLAUDE.local.md`. Never buy cells, LiPos or microSD cards on AliExpress.

## Rules learned the hard way

One line each. The story and the numbers are in `docs/gotchas.md`.

Pi and ssh
- Never `pkill -f` on the Pi with a pattern that is in your own ssh command line. For `pgrep`, bracket a letter: `pgrep -f "[r]picam-vid"`.
- The bracket trick is not enough when the same ssh command also starts the program: `pgrep -f "[s]ervod.py" || start servod.py` matches itself and never starts anything. Judge the Pi daemons by their pid files (`kill -0 $(cat ~/peak/servod.pid)`), as `up.sh` does.
- `servod` died silently once on 7 Nov evening (log ended mid-chat, no error, Pi up 6 h, power fine); the mic's ffmpeg survived it. Cause unknown; `npm run up` brings it back.
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

Desk light and ESP32
- The ESP32-C3 SuperMini joins Wi-Fi only with `WiFi.setTxPower(WIFI_POWER_8_5dBm)`; at full power it retries forever. Build with `CDCOnBoot=cdc` or the USB serial monitor stays blank.
- The light bar in standby does not listen on nRF24 channel 68 alone: send the burst over 6, 15, 43 and 68, or it switches off and never on.
- The firmware prints the puck's serial unpadded (`0x8D722` for `0x08D722`) and uses it lowercase in topics (`0x8d722`).
- A command published while the ESP is reconnecting to the broker is lost; watch `availability` if a switch is missed.

Hearing
- `-ac 1` must be an output option in `audiod.sh`, or the stream is stereo and whisper hears garbage.
- Never pass `--prompt` with the wake word to whisper-server: it strips the name from the transcript.
- Never put `-fflags nobuffer` on the audio UDP input.
- The Pi USB mic rejects 16 kHz: capture at 48 kHz and resample. Select it by name, not card number.
- Whisper invents sentences on quiet audio. The wake-word gate in `heardFilter.js` is the defence; do not weaken it with drop lists.
- `PEAK_MIN_DB` has no good fixed value on this mic. At -45 the idle noise never ends a segment and hearing sends 12 s chunks back to back (8 Nov); -30 stays.
- whisper's Silero VAD with its default 30 ms padding cuts the wake word off the front of an utterance; run it with `-vp 300`.
- Rho sounds like row, roe, roll and, most of the time on 7 Nov evening, "bro": the owner let "bro" wake it that night (it counts only where a name stands, start of the utterance before a comma). "Roar!" and "Rome" are still dropped; a pause after the name helps, and a request inside the 8 s window after a good wake passes without the name.
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
- OpenClaw loads `qwen2.5-coder:7b-instruct` and `nomic-embed-text` at times; with the Mac short of memory that evicts the brain (8 Nov 07:20, a 5.7 s reload on the next reply). Do not stop it; rerun timing tests afterwards.
- `think:false` may only be sent to models that have the thinking capability.
- An aborted request cancels the model load it started, and Ollama answered 503 after enough of them. Load a model with no timeout (`warm()` in `examples.js`), then put timeouts on the calls that use it.
- Since the brain moved to its own Ollama (8 Nov), the fights on Homebrew's are between the 4B and OpenClaw's models: on 8 Nov the coder evicted the 4B and the 4B evicted the coder while the camera described back to back. The brain is out of reach either way.
- Before 8 Nov 12:30, two model slots: the brain and the desk camera's vision model fill them. A third model (the embedder) evicts one; nothing else may load a model while the camera runs. Free memory is the tighter limit: brain (6.3 GiB) and 4B (2.7 GiB) evicted each other every 8 s for 2 min on 8 Nov.
- Trim the brain's history in one cut, never a turn per event. llama-server reuses only the unchanged prefix, so a moved first turn re-reads everything after the system prompt: prompt eval 1.9 s against 0.16 s.
- A system prompt that differs per event loses the prompt cache: prompt eval 133 ms fixed, 309-714 ms varying. Fewer tokens were slower.

Brain prompt
- Never ship a prompt edit without a full `npm run bakeoff:brain -- --stream` and a look at the per-group table.
- Rules and examples interact. Change one example per run, and write the held-out cases before tuning.
- An example teaches more than it was written for: the model copies its gesture and even its words.
- Keep `cases.json` and `sequences.json` at indent 2 when a script rewrites them.
- Teach with `npm run teach` (a lesson in `learned.yaml`), not by editing `examples.yaml`. A bake-off scores the lessons too, so list them before calling a run a baseline.

OLED
- An SSD1306 can be dark while every write succeeds. `servod` re-checks the status byte; do not run another OLED script while `servod` is up.
- Never send whole frames for animation: 4 frames a second against 14 with changed bytes only.

Voice
- pyatv needs `srptools<2`, and a scan limited to `Protocol.RAOP`, or the HomePod refuses the connection.
- Kokoro's venv must hold spaCy's `en_core_web_sm` (pinned in `requirements-kokoro.txt`); left to download at the voice's first start, a GitHub 504 kills the voice.
- Switching the voice backend means changing `talk_delay_s` on the Pi too (0.3 kokoro, 2.5 homepod).

Supervision
- A LaunchAgent with `KeepAlive {SuccessfulExit false}` restarts a crash or a kill, never an exit 0: a part that should come back must not exit 0 on its own.
- newsyslog cannot copy-and-truncate. The rotation rules send signal 31 so launchd restarts the part on a fresh log; without it the part keeps writing into `.0`.
- launchd's PATH is `/usr/bin:/bin:/usr/sbin:/sbin`, and node lives under nvm: the plists carry node's directory, so rerun `install-agents.sh` after a node upgrade.

Tests and the shell
- `node --test <dir>` runs `orchestrator/index.js` and hangs on MQTT. `npm test` names the files; keep it so.
- One Ollama call in 750 can drop (`fetch failed`) and once ended a bake-off at call 220; `run.js` retries a call three times.
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
| Examples are data, shown whole; nearest-K retrieval built but off; lessons over fine-tuning | All 23: 98% strict, held-out bank 100%, no group lower. Nearest 6 by embedding: 95%, four groups lower, p50 1.3 s. A lesson lands in seconds |
| Jev not used, only its lessons | Hosted, closed and not abliterated |
| whisper.cpp server with `medium.en` | Stays loaded; as accurate as anything tried on the real mic |
| Voice through the HomePod mini for now | The body has no speaker; Piper on the body is the plan |
| Kokoro on the Mac speaker is the voice, the HomePod a backend kept beside it | First sound 0.21 s against 2.5 s; local, Apache-2.0, 313 MB on the GPU (8 Nov) |
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
