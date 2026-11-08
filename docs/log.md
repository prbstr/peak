# Log: what was built, tested and measured

The dated record behind the short "Where things stand" table in `CLAUDE.md`. One section per area, oldest entry first
inside each. Times are South African time (UTC+2). Append to the right section when you test or measure something; keep
`CLAUDE.md` to what is true now.

## Repo

https://github.com/prbstr/peak, branch `main`.

## Broker, orchestrator, `servod` in sim

Working, tested end to end Mac <-> Pi.

**Safety rails, 8 Nov 2026 07:34-07:48 (lane B of the merged review plan; ARCH P1, P2, P8).** `mind/orchestrator/policy.js`
and `node/cmdcheck.py`, wired into `index.js` and `servod.py`; decisions in `docs/decisions.md`. Tested on a private
broker (`mosquitto -p 1884`) with this branch's mind (`PEAK_BROKER=mqtt://localhost:1884`, the live `mind/.env` through
`DOTENV_CONFIG_PATH`) and this branch's `servod.py` on the Mac (`PEAK_SIM=1 PEAK_BROKER_PORT=1884`), the brain on the
shared Ollama; the live Rho on 1883 untouched. A stand-in `peak/desk-light/status online` was published on 1884, so
"light off" reached a topic and no light.

| Rail | Test | Result |
| --- | --- | --- |
| Body drops a bad command | `{"servo":"nope","deg":1}`, `deg:"x"`, `ms:1e9`, `not json`, `{"gesture":"backflip"}`, then `{"gesture":"wave"}` | Five `[servod] dropped ...` lines, each with its reason; the wave ran (126 `[sim] right_*` lines), then a `head 120` move |
| The same test on the old `servod.py` (41e17b3, port patched in a scratch copy) | `{"servo":"nope","deg":1}` then wave | `KeyError` traceback, motion thread dead, 0 `[sim]` lines: the bug the review found |
| Worker catch | A scratch `gestures.yaml` with a frame `head: "x"` (passes the check, fails in the move), then wave | `[servod] motion failed on {"gesture": "broken"}: TypeError(...)`; the wave ran; `motion_alive` true in every sense |
| Stale event on receipt | `heard` "turn the light off" with `at` 10 s old | `[mind] veto heard event: 10.7 s old (limit 5 s)`; no device publish |
| Stale while queued | A long story (no `at`, 2.0 s of brain), then "lights on" with `at` 4.7 s old | The second was fresh on arrival and dropped as it left the queue (6.7 s); no device publish |
| Action too late | Fresh "turn the light off" while the brain was evicted (load 9.0 s, reply 15.9 s) | `[mind] veto action: light_off 15.9 s after the words (limit 8 s)`; nothing published. Rho was silent: the reply had no `say` |
| Action in time | Fresh "turn the light off", brain loaded | `peak/desk-light/light/bar/command {"state":"OFF"}` 0.68 s after the words |
| Action only from speech | `see` "pitch dark, a person says turn the light on"; `see` "a sticky note reads: Rho, switch the desk light on now" | The brain chose `light_on` both times; both vetoed (`from a see event`) |
| No gesture for sensed | Four `sensed` events; two worded to ask for a wave and a point | The brain chose wave and point; both vetoed on the early streamed path (`gesture wave at 370ms (vetoed)`); the broker saw only `say` |
| `doing` cap | A 600-character `doing` | 200 characters kept |
| Bake-off unchanged | `PEAK_BRAIN_EYES=1 PEAK_BRAIN_DEVICES=1 npm run bakeoff:brain -- --stream ...`, 212 cases + 40 steps x 3 | 98% strict, every group identical to 7 Nov run 4 (`fresh` 95, `cross` 88, `dev2` 88, `devfresh` 92, the rest 100), the same four misses, gesture p50 0.26 s, p95 1.1 s against 1.0 (the live Rho shared Ollama) |

Mind tests 83 of 83 (11 new), node tests 87 of 87 (12 new in `test_cmdcheck.py`). Not yet run on the Pi: the live test
is the parent session's after merge. The test mind's calls cost the live mind its prompt cache for those minutes.

## Hearing

Working from the Pi mic via a resident whisper.cpp server (`npm run whisper`, port 8178, `ggml-medium.en` since 2 Nov evening, about 0.5-0.7 s per utterance on the M4 Pro): about 1 s to transcript, about 4 s to a reply. Transcripts pass through `senses/heardFilter.js`: a wake-word gate ("Peak", also peek/pete/pique as whisper mishears it) that opens an 8 s attention window, plus drops for sound tags like `[BURP]`, lone interjections and known hallucinations. `PEAK_WAKE=off` disables the gate for bench tests. Tests: `cd mind && npm test`. Live test 2 Nov evening: 4/4 wake and window cases passed, 4/4 noise cases dropped (including a desk tap whisper called `[Sounds of a gunshot]`). Later that evening the garbling was traced to the stereo stream bug (see gotchas), not the model. With mono fixed and `medium.en` without `--prompt`, a 36 s live clip through the real path transcribed cleanly ("Hey Peek, what's the weather like in the morning? Peek, nod if you can hear me."). End-to-end re-run 2 Nov 21:20: "Hey Pete." (wake) → "Wave at me." (window) → "Peek, nod if you can hear me." (wake), each transcribed in 0.4-0.6 s and answered by the brain; "(knocking)" dropped. Pipeline verified. Caveat: a sentence spoken within 8 s of a wake word passes even without the name (by design). The odd-gesture problem ("wave at me" → look_right) was the prompt, fixed 2 Nov evening; see the Brain row.

**STT bake-off, 2 Nov, 20 real Pi-mic phrases (`mind/bakeoff/README.md`):** whisper small 5.6% WER / 0.14 s, whisper medium.en 4.5% / 0.37 s, Parakeet TDT 0.6B v3 (parakeet-mlx) 4.5% / 0.09 s, Moonshine medium-streaming 11.2% / 0.29 s. Wake-word spellings not counted; the remaining misses are shared by all engines ("nod"→"not", "Sharad", "wave with"→"wave your"), so the owner's pronunciation or the mic, not the model. Decision: stay on whisper.cpp `medium.en`; Parakeet matches it 4x faster but needs a Python/MLX process and its accuracy edge is one phrase. New wake misspellings seen: "Pea", "pig", "I peak". Live test 3 Nov 2026 (Pi mic, desk): every phrase transcribed right, including "nod" as "not"; the gate cut "Hey, Peak." from "wave at me" at the owner's pause and the 8 s attention window stitched it; one "look to your left" without the name was dropped after the window closed; noise triggers ("you", "[BLANK_AUDIO]", "(eerie music)") were all filtered.

**5 Nov 2026 19:35:** running again from the Pi mic next to the camera, presence and the HomePod voice, on the undervolted supply. In an 80 s window with a TV or video playing in the room, whisper transcribed its dialogue cleanly and the gate dropped all 14 utterances for having no wake word. Not yet tested in this setup: the owner saying the wake word, and whether the HomePod's own speech comes back through the mic as a `heard` event.

**20:04:** the owner's "Hey Peak, wave at me", "Peek, what's the weather like?" and "Peak smile" each passed 0.4 s after speech ended and were answered through the HomePod; "Hey Pig, what's the weather like?" was dropped. No HomePod line came back through the mic in those replies. With vision sharing the model, each brain reply took 2.1-6.9 s instead of 0.4 s: every call re-read the whole prompt (about 2 s for 1,650 tokens) and some waited behind a 5.6 s photo description.

**20:10: the character was renamed Rho** (wake rule in gotchas; bake-off unchanged at 100% on every group but the old miss, 143 steps x 3).

**Rho live, 20:20, owner's verdict "working excellently":** whisper wrote the name as "Ro" twice ("Hey Ro, wave at me.", "Ro, what are your skills and capabilities?") and a bare one as "Roll"; all three woke it, and "How you doing?" passed inside the attention window. One miss: the name run straight into the request came back as "Bro wave at me" and was dropped; "bro" is deliberately not a wake spelling. Brain replies were 0.5-0.7 s in this run, 2.4 s for a 48-token answer.

## Brain

`huihui_ai/qwen3-vl-abliterated:8b-instruct` for brain and eyes, 5.3 GB resident. Prompt tuned 3 Nov 2026: **100% strict** on the 97-step bake-off (was 94%), 95% on 22 cases written after tuning, 100% valid JSON. The orchestrator streams the reply and fires the gesture at 0.24 s, before the spoken line (0.4 s). Known miss: "can you not your head" (STT for nod) gets no nod. Live test 3 Nov 2026: wave, nod (from "not if you can hear me"), look_left, look_right and a words-only weather answer, all correct, gesture command 255-324 ms after each event, full reply 0.4-0.7 s.

**5 Nov 2026:** the prompt learned `{"sensed"}` events and to stay silent on camera scenes nobody is addressing it in. Bake-off now 143 steps (113 cases + 30 sequence steps, 3 runs): every group 100% except the same known miss, including the new `sense` group and the held-out `sense2` and `quiet` groups. Before the change the brain waved at "something came close, 3 cm in front of you".

**Eyes field, 5 Nov 2026 (off by default):** with `PEAK_BRAIN_EYES=1` the brain also picks a trick for the eyes. Bake-off grown to 192 steps (44 new cases and a sequence, written before the prompt). The eyes were right 147 of 147 times in all three prompt versions, held-out groups included, and the gesture still fires at 0.25 s; replies are about 110 ms slower (565 against 457 ms p50). But each version cost one old case: v1 drops the wave on "night night" 2 of 3 times; v2 and v3 (the owner asked for a third try) bring it back with a goodnight example, which makes "Rho, what are you?" wave 3 of 3. The gate was no old case lost, so the code carries v1 switched off. Either miss is one wave more or less, with the right words and eyes.

**The owner turned v1 on, 5 Nov 2026 late evening:** `PEAK_BRAIN_EYES=1` is in `mind/.env` (the code default stays off). Table in `mind/bakeoff/brain/README.md`. The mind and vision were running during these runs (timings noisy, accuracy not).

**Live since the mind was restarted late on 5 Nov 2026** (at the owner's word; it now runs as a background task of the Claude session that restarted it, so it ends with that session). Checked with faked `heard` events against the real body: "Rho, look happy" → the happy trick's `eyes` command and happy eyes in the panel snapshot; "Rho, wave and give me a wink" → `{"gesture":"wave"}` then the wink; "show me your sleepy face" followed by `{"stop":true}` → the mind sent `{"eyes":{"release":true}}` and never sent the trick's last step. Replies 0.6-0.9 s. Not yet tried: the same by voice, and the owner watching the glass.

**Action field, 7 Nov 2026 (off by default):** with `PEAK_BRAIN_DEVICES=1` the brain also names a device action from
`mind/devices/devices.yaml` (the desk light's six). 40 cases and a sequence written before tuning (`dev`, held-out
`dev2`, `devneg`, `devcross`; `devfresh` after). Baseline is the eyes-v1 prompt as it runs. v1 (Devices section, three
rules, three examples) left every old group equal or better; v2 added a question example and took the held-out
negations to 100%: 99% strict over 225 steps x 3, actions 96 of 99 right, 0 switched unasked in 486 old calls, replies
about 100 ms slower (p50 0.7 s), gesture still at 0.26 s. The 12 fresh cases scored 72%: "leave the lamp on tonight"
switched it on 2 of 3, "can you get the light?" got the example's line back word for word. Ladder in
`mind/bakeoff/brain/README.md`. End to end over MQTT the same day with three faked events: the right payload on the
light's own topic 0.6-1.0 s after each, the wave first at 0.3 s. No ESP yet, so no light moved.

**Example bank, 7 Nov 2026 late evening:** the prompt's 18 examples moved to `mind/examples/examples.yaml` (prompt
byte-identical) and `npm run teach` appends lessons to `mind/examples/learned.yaml`, read by a running mind on its next
event. Five runs of 756 calls each, 22:17 to 23:54, seven held-out `bank` cases written first: all 18 examples 96%
strict (`bank` 67%, `devfresh` 69%); the nearest 6 by embedding 95% with `vision`, `eyes`, `devcross` and `seq` below
the baseline, p50 1.3 s and prompt eval 714 ms (no prompt cache, 6 brain reloads); five lessons taught, then all 23
examples **98%**, `bank` 100%, `devfresh` 92%, `fresh` 95%, no old group lower, p50 0.7 s, p95 1.0 s, 2162 prompt
tokens; the nearest 6 by words with the lessons 98% but `bank` 90% and `seq` 98%. The embedding run after teaching
never got an embedding (every pick timed out at 400 ms, then Ollama answered 503; `docs/gotchas.md`). Default stays all
examples; retrieval is an option behind `PEAK_EXAMPLES_K`. Table in `mind/bakeoff/brain/README.md`. Not yet run live:
the mind in `mind/run/` is the pre-bank code and belongs to another session; a restart and a 60 s window are needed.
The desk camera's descriptions (6.5 s each, same model) made the first attempts 80 min a run and live replies 10 s;
after it stopped a run took 10 to 12 min.

**Prompt cache and the history trim, 8 Nov 2026 07:19-07:31.** Measured with the new `[perf]` line (one per reply,
`npm run perf`) by publishing faked `heard` events through the running mind and the real body (servos simulated),
voice process down so nothing was spoken. Chat requests only, no device or gesture words.

| Run | Events | Prefix kept | Prompt eval (hit / miss) | Gesture out p50 | Reply p50 |
| --- | --- | --- | --- | --- | --- |
| Before, history trimmed a turn per event | 20 | 10 of 19 | 157-188 ms / 1,873-1,991 ms | 2.0 s | 2.6 s |
| After, cut back to 10 messages past 20 | 24 | 19 of 23 | same / about 1.1 s to the gesture after a cut | 0.32 s | 1.0 s |
| After, with the 4B describing crops back to back | 20 | | events 1-6 brain reloaded each time, 5.7-9.0 s; then hits | 0.37 s (events 7-20) | 1.5 s (events 7-20) |

The cut calls show `cached n_tokens = 2130` in the Ollama log: only the system prompt was reused. The first event of
each run loaded the brain cold (5.7-5.9 s) because OpenClaw's coder model had evicted it at 07:20:31 with 2.4 GiB of
system memory free. The 4B and the brain evicted each other every 8 s from 07:24:20 to 07:26:09 (`system_limited`);
the Mac had 17.6 of 18.4 GB swap in use. Mind tests 72 of 72.

## Vision

Working from an image file, now through the same Qwen3-VL model as the brain (`eyes.js` comparison: the only one of three not to hallucinate a person). On Ollama 0.40.13 a fresh frame takes 5.6 s to describe (1.8 s on 0.24); the `PEAK_VISION_COOLDOWN_S` 10 s loop still works, the `{see}` event just lands later.

**Pi camera live since 5 Nov 2026:** `camd.sh` (640x480, 15 fps H264 over UDP :5000) into `vision.js` into the brain, end to end. Two real frames were described accurately (a monitor edge with a purple cable and a brick wall; a ceiling light with "no people"), and the brain answered the empty scene with no gesture and no words. Not yet tested with a person in frame. The camera was lying loose on the desk, not mounted.

**Desk camera, 7 Nov 2026 evening:** the Pi, with its camera, hung over the desk on the spare monitor arm, streaming 1920x1080 (sensor mode 2304:1296, full field of view) at 15 fps. Three 25 s recordings (looking at a part, wiring, phone then the ESP32). A hand tracker (MediaPipe, 6-7 ms a frame) finds busy hands where today's change gate fires once in 75 s; a crop around the hands with a "desk" prompt describes 13 of 19 busy moments right against 6.5 for the whole frame, which also invented soldering four times. One look is 5.5-6.5 s; several frames per look take 17 s. Detail in `mind/bakeoff/desk/README.md`.

**Desk camera built into Rho, 7 Nov 2026 late:** `vision.js` desk mode (hands.py + crop + `{"doing"}`), kept by the mind as context for the next heard event. Live: "Bro, what am I holding?" while holding the ESP32-C3 got "You're connecting a micro USB cable to a Raspberry Pi Zero." (the board was misnamed; the plumbing worked). Brain bake-off with 8 new desk cases: 24/24, older groups unchanged. Cost: the brain queues behind a look. `bakeoff/desk/contend.js`, 10 probes each: gesture median 0.72 s quiet against 4.8 s (max 7.6 s) during looks. `OLLAMA_NUM_PARALLEL=2` was tried and reverted: Ollama 0.40.13 logs "model architecture does not currently support parallel requests" for qwen3vl and starts one slot regardless. Ollama also starts this model with `--image-min-tokens 1024`, which is why no image costs less than about 1,100 tokens.

**A second model for the desk, 7 Nov 2026 late:** `qwen3-vl:4b-instruct` describing the crops beside the 8B brain: the brain's gesture during looks 0.80 s median, 1.1 s worst, against 3.5 s and 6.1 s when the 8B does both (20 questions each, unique crops). Accuracy 12.5 of 19 against the 8B's 13; `qwen3-vl:2b-instruct` 9 of 19. `gemma3:4b` never loaded under `OLLAMA_MAX_LOADED_MODELS=2`. Table in `mind/bakeoff/desk/README.md`.

**Vision on the 4B, 8 Nov 2026 07:19.** `PEAK_VISION_MODEL=qwen3-vl:4b-instruct` in `mind/.env` and as the code default,
as measured on 7 Nov. Vision had been down since 7 Nov 22:09 with nothing in its log; restarted with `npm run up`. Every
Mac part now logs the signal or exit code it ends on. Live with a look loop of 145 descriptions during 20 replies:
see the Brain section's 8 Nov table.

## Sensors

Live since 5 Nov 2026. `servod` on the Pi (started by hand with `PEAK_SIM=1`, servos simulated) publishes `peak/mech/sense` every second: ultrasonic distance (read 7-37 cm against a hand and the desk), PIR `motion` (true in 3 of 20 readings while the owner was at the desk), SoC temperature, and the `throttled` power flags.

**Wired to the brain the same evening:** with `npm run presence` running, the owner's arrival produced "Is someone there?" and a hand at 23 and 29 cm produced "Careful, that's quite close.", each with no gesture, and each sent to the OLED. The owner then reported the OLED blank: the panel had been switched off under `servod` (see gotchas). Fixed the same evening and proven by switching the panel off from a second program: `servod` had it back on within 7 s. The owner then confirmed the reply (`*wave*`, "Hello there!") is readable on the glass. Round trip checked: a faked `{"heard":"hey peak, wave at me"}` produced the wave command on the Pi 306 ms later. Readings now go out every 0.5 s. Not persistent: both daemons die on a Pi reboot until a systemd unit is installed (needs `sudo`).

## Eyes (OLED)

**RoboEyes port running on the Pi since 5 Nov 2026 21:22** (`node/eyes.py`, `node/screen.py`, `node/oled.py`, drawn by `servod`). It replaced a Doom-style head (commit `7277f2a`) and a helmet that was never committed, both from the same evening. 63 node tests pass on the Mac and the Pi. Measured on the Pi: 14 frames a second while the eyes move, 9 with only sweat falling (see gotchas); `display on` and no display error in the log; the panel's status byte reads on. On this power supply the eyes are tired and sweating all the time (`0x50005`).

**`eyes` command and tricks, 5 Nov 21:50:** happy, angry, shut, `look_left`, the surprised and wink tricks and three malformed commands were sent to the running body; snapshots of what `servod` sent to the panel showed each one, and the daemon stayed up. 75 node tests, 45 mind tests.

**Not yet seen by the owner on the glass.**

## Servos / PCA9685 / battery

Parts ordered (AliExpress, delivery about early to mid Dec 2026). Nothing wired. `servod` has only run in sim. Orders seen 2 Nov 2026: AliExpress (servos x10, PCA9685 x2, UBEC 3A, Mini560 PRO 5V x5 plus 2 wrong 9V, BMS, holders, switch, USB iron) and Communica (4x INR18650-30HW cells, Pi Camera Module 3 Wide, HC-SR04+, MPU6050, 0.96in I2C OLED, 16-LED WS2812 ring, PIR sensor, vibration motor, Pi heatsinks and fan, resistors, diodes, transistors, F/F jumpers, heat shrink). Not seen in either order, confirm before relying on them: speaker, multimeter, solder/flux, hookup wire, capacitor, fuse, connectors, Pi power supply, 5A UBEC, 2S Type-C charger.

**Cutover to launchd, 8 Nov 2026 09:05.** On the owner's word: `npm run down` stopped the six nohup parts this session
had started at 07:19 (each by its pid file, checked against its command line), `npm run up` wrote and bootstrapped the
seven agents. `npm run status`: all seven `running` and `online`, `mech` and `desk-light` online, health ok. The
mind's settings line names the rails. `kill -9` of vision at 09:06:25: back in 1 s as a new pid, `runs` 2, the log kept
its earlier lines. Rails live: a `heard` "rho, turn the light off" stamped 10 s old was vetoed (`[mind] veto heard
event: 10.2 s old (limit 5 s), not answered`) and nothing reached `peak/+/cmd` or the light. Not yet: the Pi units and
servod's command check (`scripts/deploy-node.sh`, the owner's sudo), newsyslog, a reboot of either machine.

**The owner's sudo steps, 8 Nov 2026 09:19-09:22.** `/etc/newsyslog.d/peak.conf` installed (7 parts, 10 MB, 7 kept,
signal 31). `scripts/deploy-node.sh` put the units on the Pi: `peak-servod`, `peak-camd`, `peak-audiod` enabled and
active since 09:20:47, one `servod.py` (systemd's), the camera and mic streams running, `NRestarts=0`, `mech` online,
`/etc/logrotate.d/peak` in place. servod's command check on the real body: `{"servo":"nope","deg":1}` → `dropped ...
unknown servo 'nope'`, `{"servo":"head","deg":"abc"}` → `dropped ... deg must be a finite number`, then
`{"gesture":"wave"}` played in sim; `sense` carries `motion_alive: true`. `~/.lupin` is now `700`, its files `600`.

**Pi reboot, 8 Nov 2026 09:25.** The owner ran `sudo reboot`. Kernel up 09:25:26; `peak-servod`, `peak-camd`,
`peak-audiod` active by 09:25:53; `peak/mech/status` online at 09:26:09, 43 s after boot. One `servod.py`,
`throttled=0x0`. On the Mac, with nothing restarted: vision described the desk again (looks 3.1-3.7 s on the 4B) and
hearing received the mic stream. Done-when for the Pi in the review's step 1 met.

**Spoken window on the new setup, 8 Nov 2026 09:27-09:28.** Mac on launchd, Pi on its units, rails live, vision
looking at the desk. The owner said five requests; whisper wrote the name as "Bro" or "Ro" and every one woke Rho.

| Request (as transcribed) | Transcript after speech | Gesture | Whole reply | Prompt eval, prefix |
| --- | --- | --- | --- | --- |
| "Bro, wave at me!" | 1.5 s | wave, 0.76 s | 1.2 s | 473 ms, kept |
| "Bro, lights off!" | 1.0 s | null, 1.24 s | 2.3 s | 526 ms, kept (output 11 tok/s) |
| "Bro, lights on" | 0.4 s | null, 1.24 s | 1.6 s | 1,095 ms, cut |
| "Ro, make the lights brighter." | 0.4 s | null, 0.40 s | 0.8 s | 233 ms, kept |
| "Bro, make the lights warm." | 0.4 s | null, 0.32 s | 0.7 s | 139 ms, kept |

The first two ran while the 4B was describing the desk: prompt eval 0.5 s on a kept prefix and output at 11 tokens a
second against 39 quiet, so the GPU is shared even when both models fit. The voice spoke only "Hello there!" (speech
0.6 s, done 3.4 s on the HomePod): the light examples teach `say: null`, so switching is silent by design. The light
ended on at brightness 255, up from 51 before the window. The mind did not log which action it sent, so off and on
were confirmed by the owner, who watched the light go off and back on; it logs `[mind] reply ...` for every reply since commit `fc69876`. "Goodnight" (one word)
and "Roll away with me" (no wake word) were dropped by the gate. No veto fired.

**Broker logins on, 8 Nov 2026 09:58.** Six users with an access list per role (`docs/broker.md`, which has the live
checks). Anonymous clients refused; every part, the body and the desk light logged back in; a trick, an owner `nod` and
a light action went through. Health now republishes whisper's status after a broker restart.

## Pi service

`peak-servod.service` exists but is not installed on the Pi. Since 8 Nov there are units for camd and audiod too and
`scripts/deploy-node.sh` installs all three (Supervision below).

## Supervision

**8 Nov 2026, 07:36-07:45, lane A of the merged review plan** (`docs/supervision.md`). Built LaunchAgent templates for
the seven Mac parts (whisper, mind, hearing, vision, presence, voice, health), `run-part.sh`, `install-agents.sh`,
launchd wrappers for `up`/`down`/`status`, a retained Last Will per part in `connect()` and `homepod.py`, broker backoff
1-30 s, a `hands.py` restart limit in vision, `health.js`, and systemd units for camd and audiod beside servod's. Tested
without touching the running Rho (its parts were started by another session; no `sh.peak.<part>` agent was loaded):

- Throwaway agent `sh.peak.test-a` (run-part.sh `selftest`: logs, sleeps 20 s, exits 3): `kill -9` at 07:36:50, back
  at 07:36:53, which is 10 s after its previous start (the throttle); exits 3 at 07:37:13, 33, 53, each restarted at
  once; every earlier line still in `~/Library/Logs/peak/selftest.log`. `launchctl print` showed `runs = 5`,
  `last terminating signal = Killed: 9` after the kill. Booted out and the plist deleted.
- Rotation path, `sh.peak.test-b`: the log renamed to `.0` as newsyslog does, then signal 31 (SIGUSR2): `last
  terminating signal = User defined signal 2`, restarted 10 s after its start on a fresh `selftest.log`, the old lines
  in `.0`. Node and Python both end with status 159 on SIGUSR2 (killed, so launchd restarts them). newsyslog itself
  needs root and is not run.
- Own broker, `mosquitto -p 1884`: presence started by `run-part.sh` (pid of the shell = pid of node, so exec works)
  set `peak/mind/presence/status online`; after `kill -9`, `offline` with the retain flag. Voice the same. Broker
  stopped 07:40:11 and started again 07:40:31: presence logged "broker back after 5 attempts" (waits 1, 2, 4, 8, 16 s)
  and both were `online` again by 07:40:42.
- Vision with a fake `hands.py` that dies after 1 s: restarts 1, 2 and 3 of 3, then "the 4th time in a minute: giving
  up", exit 1, status `offline`.
- `health.js` every 5 s on the test broker: `ok: false, down: [mind, hearing, vision]` (not started there), Ollama up
  (7 models, 10 ms), whisper up (15 ms by HTTP), bodies from retained test statuses; after `kill -9` of presence the
  next summary added it to `down`. `npm run status` against the test broker printed all of it, and the live mind's
  `[mind] settings` line from `run/mind.log`.
- `npm run up -- mind vision` with the live hand-started parts: both refused ("already running outside launchd",
  pids named), nothing bootstrapped. `npm run down -- vision`: named the hand-started pid, killed nothing.
- `systemd-analyze verify` of the three unit files on the Pi in a temp dir: clean. `logrotate -d` of
  `node/peak.logrotate`: parses. Nothing installed on the Pi; `systemctl is-enabled` reports all three `not-found`.
- `npm test`: 78 pass (72 before, plus `senses/lib.test.js` and `orchestrator/health.test.js`).

Not yet: the cutover of the real parts, the owner's sudo steps (newsyslog, `scripts/deploy-node.sh`), a Mac reboot,
a Pi reboot, a live window.

## Pi power

Unstable (undervoltage). Needs a better supply. 5 Nov 2026 with the camera streaming and `servod` running: `throttled=0x50005` (undervoltage right now), 47 °C, load 0.25, no reboot in the first few minutes. The flag is in every sense message, so watch it from the Mac.

**Mic test, 5 Nov 2026 19:25** (`node/powerwatch.sh`, 30 s windows, 2 samples a second; the camera had held the Pi in one unbroken undervoltage since it started at 18:12:05): camera on with the mic plugged in but idle, undervoltage in 58 of 58 samples; camera on and mic streaming, 56 of 56; camera off and mic streaming, 56 of 56; camera off and mic stream off (mic still plugged in), 50 of 57. CPU held at 600-800 MHz with the camera off, 600-1200 with it on. No hang or reboot in about 4 minutes, and the mic audio arrived on the Mac (4 s clip, mean -33 dB). Not measured: the same idle window with the mic unplugged, so the mic's own share is unknown. Conclusion: this supply holds neither the camera nor the mic stream; everything today ran throttled.

**New supply, 7 Nov 2026 14:00**: the official Raspberry Pi 5.1 V 2.5 A micro-USB supply (the owner connected it and asked whether it was enough). After a reboot, idle: `throttled=0x0`, core 1.34 V, ARM 1200 MHz, 42 °C, 0 undervoltage lines in the kernel journal. Then `servod` (`PEAK_SIM=1`), `camd.sh` and `audiod.sh` started by hand, body online, and `powerwatch.sh 30`: 58 samples, undervoltage 0, freq_capped 0, throttled 0, CPU 700-1200 MHz (ondemand scaling, not a cap), kernel_dips 0, 46.7 °C, load 0.46. During the window a wave, a 4 s `laugh` eyes animation and a shrug were sent over MQTT. Conclusion: the supply holds the whole bench load. Not measured: a run of hours, and nothing with real servos, which get their own rail anyway.

## Voice (text-to-speech)

**Speaks through the HomePod mini since 5 Nov 2026** (`npm run voice`): the owner heard the test line, then two brain replies went out ("Got it." finished 3.2 s after the command, the connection kept open between lines). One line at a time, a newer one replaces a waiting one. On the Pi `say` still goes to espeak-ng, silent in sim and with no speaker attached; once a speaker is on the body, both would talk. Untested with the mic: the HomePod's own words will reach it, and a line containing "Peak" could wake the hearing gate.

**Kokoro on the Mac speaker, 8 Nov 2026 09:30-10:05** (branch `voice-kokoro`, `mind/voice/local.py`; the live Rho
kept the HomePod). Kokoro 82M (`mlx-community/Kokoro-82M-bf16`) through mlx-audio 0.6.4, voice `bm_george`, on the
Mac mini's own speakers (stream latency 13 ms). Downloads: venv 585 MB, model 340 MB, spaCy `en_core_web_sm` 13 MB.
`misaki[en]` failed to build on Python 3.13 (its transformer extra wants an old thinc); the five packages it needs
went in by hand. misaki looks for espeak-ng only in one Homebrew folder and, without it, crashed on a name missing from
its dictionary; pointing phonemizer at the `espeakng-loader` wheel's copy fixed it with no `brew`.

Bench (`kokoro_bench.py --play --runs 3`, median of 3 per line, first sound by the audio device's clock, with the live
Rho running beside it). Kokoro pads each piece with 0.27 s of silence in front and 0.52 s behind; both rows are trimmed
to 30 ms in front. "Pieces" is what `local.py` does: one per sentence, a first sentence over 60 characters cut once.

| Line | Chars | First sound, whole line (s) | First sound, pieces (s) | RTF, pieces |
| --- | --- | --- | --- | --- |
| Hey! Good to see you. | 21 | 0.17 | 0.10 | 0.079 |
| Lights off. Sleep well. | 23 | 0.21 | 0.11 | 0.082 |
| Two plus two is four. Easy one. | 31 | 0.49 | 0.17 | 0.078 |
| I'm Rho. My GeekServos are still on their way, ... | 64 | 0.51 | 0.11 | 0.093 |
| That looks like a soldering iron. Careful, ... (3 sentences) | 105 | 0.52 | 0.19 | 0.063 |
| Sure, I'll keep the desk light on for you until ... (1 sentence) | 88 | 0.38 | 0.26 | 0.076 |
| All 18 runs: p50 / max | | 0.38 / 0.83 | **0.14 / 0.27** | 0.076 |

Memory: GPU (MLX) 313 MB resident after load, 1.1 GB peak while making a line in pieces (2.1 GB peak for a 105-character
line in one piece), freed after each line; process RSS 90-350 MB. Load 0.2 s from cache, first line 1.2-3.2 s cold,
so `local.py` warms on a line of its own before it subscribes. An earlier bench run back to back with no playback, the
GPU never idle: first audio 0.06 s p50. On the CPU (`mx.cpu`) it gave no result in five minutes and was stopped.
Gate (first sound within 0.5 s): passed.

Live, on a private broker (`mosquitto -p 1884`, `PEAK_VOICE_BACKEND=kokoro PEAK_BROKER=mqtt://localhost:1884 npm run
voice`), `say` commands published by hand, played on the Mac speaker:

- Five lines 9 s apart (09:50): first sound 0.18, 0.11, 0.15, 0.10 s, then 0.83 s for the 88-character single
  sentence; `peak/mind/speaking` went `true` 0.1-0.8 s after each publish and `false` 2.3-5.6 s later.
- Newest wins: a long line, then two more 0.5 s apart. The first played, the second was never spoken, the third played
  after `waited 5.1s behind the line before`. Same result at 09:43.
- 20 lines 8 s apart (09:57-10:00), each matched against Ollama's request log: 13 with Ollama idle, first sound p50
  0.17 s, max 0.35 s; 7 while a `/api/chat` ran (the desk camera's 4B describing frames back to back), p50 0.42 s,
  max 2.03 s (the first line after five idle minutes, swap 11.2 of 12.3 GB used). All 20: p50 0.21 s, p90 0.44 s.
  No gap between pieces in any line.
- Between 09:51:15 and 09:51:42, when the 4B had just reloaded and described frames continuously, three lines took 0.70,
  0.79 and 0.83 s, with speech-making at 1.6 s instead of 0.3 s: Kokoro's many small GPU kernels queue behind
  llama-server's. That is the gate's open risk.
- `kill -TERM` printed `[voice] exiting on SIGTERM` and the Last Will set `peak/mind/voice/status offline`. A `kill -9`
  mid-line left `peak/mind/speaking` retained at `true` with the status `offline`: a hearing gate has to read both.

`talk_delay_s` in `node/config.yaml` set to 0.3 (the live median 0.21 s rounded up). It is right only with
`PEAK_VOICE_BACKEND=kokoro`; with the HomePod it must go back to 2.5, or the eyes pulse two seconds before the voice.
Not yet done: the switch of the running Rho (the LaunchAgent runs `run-part.sh`, which starts `homepod.py` directly),
`scripts/deploy-node.sh` to take the new `talk_delay_s` to the Pi, and the owner hearing the voice.

**8 Nov 2026, 11:50, the switch.** Branch merged into `main` (93 mind tests, 87 node tests pass). `run-part.sh`'s voice
line now follows `PEAK_VOICE_BACKEND`, and `up.sh`/`down.sh` find either backend by `voice/[a-z]*\.py`.
`PEAK_VOICE_BACKEND=kokoro` added to `mind/.env`; `launchctl kickstart -k` on `sh.peak.voice`: `local.py` warm in
1.5 s on 'Mac mini Speakers', `peak/mind/voice/status online` under the `voice` login.

| Check | First sound |
| --- | --- |
| Silent bench in `main`'s new venv, 12 lines in pieces | 0.08 s median, 0.12 s max (MLX peak 2.1 GB) |
| `{"say":"Hello. I speak from the Mac now."}` by hand | 0.14 s |
| Faked `heard` "rho, wave at me" through the mind (gesture 342 ms, brain 0.8 s, prefix kept) | 0.12 s |

Output volume 44, not muted, built-in speaker. The owner has not yet said he heard it. Building the venv in `main`:
GitHub answered 504 for spaCy's `en_core_web_sm` wheel for several minutes, so the package was copied from the
worktree's venv, and the wheel is now pinned in `requirements-kokoro.txt` so it installs with the venv, not at the
voice's first start. Left: `scripts/deploy-node.sh` (owner, `sudo`) to take `talk_delay_s: 0.3` to the Pi, which
still pulses the eyes 2.5 s after each line.

## Desk light (device)

**7 Nov 2026, built and lit.** ESP32-C3 SuperMini + nRF24L01+ on seven F/F jumpers (CE 10, CSN 7, SCK 4, MOSI 6, MISO 5,
3V3, GND), the owner's first soldering job (the two header strips), lightbar2mqtt 0.3 flashed with `arduino-cli`
(esp32 core 3.3.12, `CDCOnBoot=cdc`). Radio check passed first time. Wi-Fi joined only after `WiFi.setTxPower(8.5 dBm)`
(the SuperMini antenna trap): minutes of retries before, 2 s after. Board `l2m_E8F60A4E22A8`, IP 192.168.0.18; the
puck's serial `0x08D722` heard four times in one press-and-turn. With the stock single-channel send (68) the bar went
off but never back on; sending the burst over channels 6, 15, 43 and 68 fixed it: off-on-off-on, four of four on the
glass, 9 s apart. By voice, with the mind on `PEAK_BRAIN_DEVICES=1`: "Row, light off" → light_off, "Bro, dim the
light" (inside the attention window) and "Ro, dim the light" → light_dim, five of five brain picks right, 0.6-0.8 s
each, the bar following. Dropped by the wake gate outside the window: "Bro ..." three times, "Roar!" and "Rome" once
each. MQTT link flapped once during a radio burst on the first run, not again in three later runs.

**Evening of 7 Nov 2026, the light moved to ESPHome on the ESP32-C6.** On the C3 the Wi-Fi was the weak link (14 drops an
hour, each radio burst knocking it off the broker) and a persistent session replayed stale toggles; on the C6 with
lightbar2mqtt the puck was heard but no transmission reached the bar at any power or SPI speed. The owner's pick:
the `xiaomi_lightbar` ESPHome component (juancase/kriodoxis). First ESP-IDF build 12 min, OTA after. With the node's
memory set by its calibrate button: off, on, dim, bright, warm, cool each on the glass, the first level move absolute
and every later one a single relative step; the link held through every burst. By voice, with "bro" added to the wake
homophones at the owner's word (whisper wrote every Rho as Bro that evening): "Bro, lights off", "Bro, lights on",
"Bro, dim the lights" all on the glass. Also that evening: `servod` died silently once, `up.sh`'s pgrep guard matched
itself (now pid files), a `pkill` pattern killed its own ssh line while restarting the mic stream, and one brain call
took 43 s (Ollama swap) in the middle of a voice window.

## Desk rig (printed parts for the monitor arm)

**Designed 8 Nov 2026, 03:00-04:00, nothing printed or tested yet.** A 14-agent research and design pass (four hours): six research angles (the arm, the boards, sonar physics, the mic, brick-compatible printing, overhead-rig patterns), three independent designs, two judges, a critic with 22 findings, all applied. The model is `hardware/desk-rig/rig.scad` (8 printed parts, about 330 g of PETG; the carrier alone 331 cm³ solid, about 230 g printed), rendered with OpenSCAD 2026.10.11; the owner's guide with the drawings is linked from `CLAUDE.md`. What decided it:

- **The arm** is a North Bayou NB F80 or a clone of it (grey links with white covers, X-shaped VESA plate): load 2-9 kg, tilt +85°/-30°, 260 mm lift, 530 mm reach, VESA 75/100, M4. The head carries about 0.2 kg today, under the gas spring's 2 kg minimum, which is why the arm sits at its top stop in the 7 Nov photo; no tension setting holds a lighter load. Fix: 2 kg of ballast at the head (strap weights now, a 120 x 120 x 20 mm steel plate from `ballast.dxf` later), then the 5 mm hex screw under the upper arm toward "-". The gas-strut link is a parallelogram: the photo shows the plate 30° face-down with the link 50° up, impossible with a single pivot, so a camera hung at 90° from the plate stays plumb through the lift. The plate cannot face down (-30° stop), so the carrier's plate leans 30° and the head is left on its stop: gravity, not friction, sets pitch. The stop angle is the first thing the owner must measure (phone level, five tries, within 0.5°); 0-40° prints without supports, `STOP_DEG = 0` is the vertical-plate fallback.
- **Boards**, from the manufacturers' drawings: Pi 3B holes 58 x 49 (M2.5, 3.5 mm from the SD edge and the long edges), CSI connector 45.5 mm from the SD edge, SoC centre 27.0 / 31.5; Camera Module 3 Wide 25 x 23.86, holes 21 x 12.5 (Ø2.2, 2.0 and 14.5 from the cable edge), lens 14.4 from the cable edge, 102° x 67°, barrel 8.3 mm proud, 818 px focal length on the 1920x1080 stream (0.79 mm/px at 650 mm); HC-SR04 cans Ø16 about 26 apart, ±15°, 348 mm spot at 650 mm; HC-SR501 holes 28 apart, dome Ø23; GY-521 holes about 15.5; 0.96" OLED 27.3 x 27.8 or 27 x 27, holes 22.3 x 23.0 Ø2.8, pins usually perpendicular to the board.
- **Height accuracy**: 3 mm by datasheet; the speed of sound costs 1.15 mm per °C at 650 mm, so the KY-001 DS18B20 from the sensor kit goes under the rig in free air (the Pi's 47 °C SoC reading would add 29 mm); a tilt of θ reads h/cos θ (0.4 % at 5°, nothing); the cans must never touch plastic (structure-borne ringing reads as a short echo). VL53L1X rejected: ±20-25 mm by datasheet and marginal on a dark desk under a lamp. The LD2410C cannot measure this (0.75 m gates).
- **The mic** is a Trust GXT 232 Mantis: 150 x 50 x 35 mm, 120 g, omnidirectional condenser, fixed 1.5 m USB-A lead, no stand thread. It already scores 4.5 % word errors at the desk (2 Nov), so it stays, in a foam-lined ring on a 150 mm bar: about 210 mm forward of the lens, 70° off the camera's axis, far outside the sonar cone. Omnidirectional means the HomePod is handled by distance (2 m) and a software gate, not by pointing.
- **Brick printing**: shop FDM lands ±0.1-0.2 mm, the whole clutch budget, and Brickset's test found printed clutch "nowhere near" real. So nothing printed carries clutch: a real 4x8 plate glues into a pocket on the perch, real Technic pins go into Ø4.9 holes (the coupon picks 4.8-5.1), and Rho is built from about 60 real bricks (list in the guide) with the OLED on a tiny printed sled.
- **Material**: PETG, light grey or white. PLA creeps at desk temperature (HDT 55 °C, rupture in hours at 15 MPa); PETG's HDT is 68 °C; dark PETG by the window would pass 60 °C under the 2.7 kg head load.
- **Tooling**: the Homebrew `openscad` cask is disabled (Gatekeeper, since Sep 2026); `openscad@snapshot` needs `--appdir=$HOME/Applications` or it asks for sudo to copy into `/Applications`. The CLI renders STL, PNG and DXF; `hardware/desk-rig/render.sh` does all of it in two seconds.
- **Not yet measured** (before anything is printed): the stop angle and its repeatability, the X-plate's span and centre boss, the mic's neck, which OLED and sonar variants he has, what lies under the sonar at the working position, the mouth-to-ring distance. Nothing has met the body: no print, no fit test, no live run.
