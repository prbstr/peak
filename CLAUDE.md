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
- Topics: `peak/<node>/cmd`, `peak/<node>/sense`, `peak/<node>/event`, `peak/<node>/status` (retained online/offline, set by Last Will), `peak/brain/intent`. Schemas in `contracts/`.
- Senses publish **events only**, never raw frames or audio. The orchestrator thinks on events.
- The brain never moves servos directly. It replies with `{gesture, say}` JSON (enforced with Ollama structured outputs); gestures are named in `node/gestures.yaml`.
- The brain answers in a JSON shape (`{gesture, say}`) enforced with Ollama structured outputs, built in `mind/orchestrator/brain.js`. The models do carry the `tools` capability (an earlier note said otherwise); native tool calling for `look_at` is a follow-up, not a blocker.
- The orchestrator thinks on one event at a time; one more may wait, and a newer event replaces it (latest wins, never a backlog). Bodies that go offline are removed from the hive map.
- `servod` runs one motion at a time with a one-deep queue (newer replaces waiting). `say` runs independently of motion. `{"stop": true}` aborts the current move and releases all servos. On boot it eases servos to rest one at a time (`BOOT_SETTLE_MS`) to avoid inrush.
- `peak-servod.service` reaches the Mac by mDNS name (`twentyones-Mac-mini.local`), not a fixed IP.

## Decisions and why

| Decision | Why |
| --- | --- |
| Mosquitto, not RabbitMQ or embedded aedes | Retained messages and Last Will give body presence for free; ESP32 bodies speak MQTT natively. aedes was removed. |
| All AI on the Mac, Pi stays thin | Pi 3B is too slow for whisper or vision. It runs only servod, camd, audiod. |
| Local Ollama brain, not Anthropic | Owner's choice. Abliterated only. |
| One model for brain and eyes: `huihui_ai/qwen3-vl-abliterated:8b-instruct` (since 2 Nov 2026 evening) | Bake-off (`mind/bakeoff/brain`, 52 cases + 20 sequence steps, 5 runs; table in its README): the old split "8B brain + `qwen2.5vl:3b`" was 93% strict at 0.5 s but **16 GB resident** (the 3B eyes are 10.4 GB loaded), so the other program's `qwen3:14b` evicted it constantly. Qwen3-VL unified: 94-96% strict, 0.5 s p50, 7 GB for everything, and the only model of three that did not invent a person in an empty street photo. `huihui_ai/qwen3.5-abliterated:9b` scored highest as a brain (98% unified) but takes 1.3 s per reply, 8.5 GB, and hallucinated a person; it stays installed as the accuracy option (`PEAK_MODEL`, one line). 14B abliterated: 84%, shrugs at everything. Gemma 4 12B: cannot load on Ollama 0.24.0. `gemma4:26b` (19 GB) and `moondream` (garbage descriptions) were ruled out earlier. |
| Prompt carries gesture meanings and examples, temperature 0.3, no sense noise | The first prompt listed bare gesture names and appended uptime/servo angles/temperature every turn; the 8B answered "wave at me" with look_right. With `brain.js`'s prompt the same 8B went to 93% strict. Descriptions live in `mind/orchestrator/gestures.js` because `servod` iterates the YAML values as keyframes. |
| Pi mic streams to the Mac | whisper `small` runs on the Mac; `hearing.js` reads UDP :5001. |
| whisper.cpp server, not the openai-whisper CLI | The CLI cold-started per 5 s chunk (torch load, about 15 s speech-to-reaction). `whisper-server` (Homebrew `whisper.cpp`, Metal) stays resident; `hearing.js` cuts utterances at pauses and POSTs them. |
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
| Whisper server (needed by hearing) | `cd mind && npm run whisper` (model: `~/.cache/whisper.cpp/ggml-small.bin`, port 8178) |
| Hearing, Mac mic | `cd mind && npm run hearing` (needs `npm run whisper` running) |
| Mind unit tests | `cd mind && npm test` (heard filter, brain prompt/schema/parsing) |
| Brain bake-off (models vs cases) | `cd mind && npm run bakeoff:brain` ; `-- --pair <eyes tag>` checks both stay resident; see `mind/bakeoff/brain/README.md` |
| Eyes comparison on photos | `cd mind && node bakeoff/brain/eyes.js --models a,b --images x.jpg,y.jpg` |
| Mic test page (Start/Stop, levels, transcript, playback) | `cd mind && npm run record` then http://localhost:8179; needs `audiod.sh` on the Pi and `npm run whisper` |
| Hearing, Pi mic | Pi: `PEAK_MIND=<mac-ip> ./audiod.sh`; Mac: `PEAK_AUDIO_SOURCE=udp://0.0.0.0:5001 npm run hearing` |
| Vision, one frame from a file | `PEAK_VISION_ONCE=1 PEAK_VISION_SOURCE=<image> npm run vision` |
| Servo daemon in sim | `PEAK_SIM=1 PEAK_BROKER=<mac-ip> ~/peak/.venv/bin/python -u node/servod.py` (Mac: use `.venv/bin/python`) |
| Send a command | `mosquitto_pub -t peak/mech/cmd -m '{"gesture":"wave"}'` |
| Emergency stop | `mosquitto_pub -t peak/mech/cmd -m '{"stop":true}'` |
| Is the body up? | `mosquitto_sub -t peak/mech/status -C 1` |
| Fake an event | `mosquitto_pub -t peak/mech/event -m '{"heard":"hey peak, wave at me"}'` |
| Deploy to the Pi | `scripts/deploy-node.sh [host]` (installs and restarts the systemd unit; for sim testing use plain rsync instead) |

Config is in `mind/.env` (gitignored; `.env.example` is the template): `PEAK_BROKER`, `PEAK_MODEL`, `PEAK_VISION_MODEL`, `PEAK_MIN_DB`, `PEAK_WHISPER_URL`, `PEAK_SILENCE_MS`, `PEAK_NUM_CTX` (4096), `PEAK_TEMPERATURE` (0.3), `PEAK_KEEP_ALIVE` (30m). Set `PEAK_MODEL` and `PEAK_VISION_MODEL` to the same multimodal tag and Ollama loads it once for both; `lib/ollama.js` gives every caller the same load-time options so that works.

## Environment facts

- Mac: Mac mini, 24 GB unified memory. Mac IP on the LAN is `192.168.0.139` (interface `en1`, not `en0`; `ipconfig getifaddr en1`).
- Pi: `lupin@mech.local` (192.168.0.226 at last check), key login works, **`sudo` needs a password** so Claude cannot install packages. Ask the owner to run `sudo` lines.
- Ollama: Homebrew service, **0.24.0** (brew has 0.40.x; upgrading restarts the service and may rewrite the plist below, so plan it). Config in `~/Library/LaunchAgents/sh.brew.ollama.plist` (flash attention, q8 KV cache, `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_KEEP_ALIVE=30m`). Reload with `launchctl bootout/bootstrap`, not `brew services restart` (it rewrites the plist). Live log: `/opt/homebrew/var/log/ollama.log` (`~/.ollama/logs/server.log` is stale). The GPU gets about 17.8 GB of the 24 GB. Another program also loads `qwen3:14b` (12 GB at 32K ctx) or `qwen2.5-coder:7b` into Ollama at times; do not stop it, but expect it to evict our models when the total passes the budget.
- The shell tool cannot write to `/tmp` for ffmpeg outputs reliably; use `mktemp -d` dirs.
- Whisper: whisper.cpp `whisper-server` on 127.0.0.1:8178, `ggml-medium.en.bin` (and `ggml-small.bin`) in `~/.cache/whisper.cpp`. The old openai-whisper CLI (`~/.cache/whisper`) is still installed but unused.
- STT bake-off harness in `mind/bakeoff/` (own venv at `mind/bakeoff/.venv`, python3.13: moonshine-voice, parakeet-mlx, jiwer). Models cached by Moonshine and Hugging Face on first run.

## Gotchas learned the hard way

- ffmpeg single-image input breaks with `-fflags nobuffer`; apply it only to `udp://` video. Never on the audio UDP input: it discards what ffmpeg reads while probing and ate the first sentence. `hearing.js` uses `-probesize 32 -analyzeduration 0` instead. The JPEG encoder needs `format=yuvj420p`.
- **`-ac 1` must be an output option in `audiod.sh`.** On the input side ALSA ignores it and ffmpeg streams stereo; `hearing.js` reads the stream as mono, so whisper got half-speed interleaved garbage all day (2 Nov) while `arecord` clips on the Pi transcribed perfectly. Diagnose this class of bug by recording the same moment on both ends (`ffmpeg ... -f s16le udp://... -f wav /tmp/tee.wav` on the Pi) and comparing with `ffprobe`.
- The Pi USB mic rejects 16 kHz in ffmpeg: `audiod.sh` captures at 48 kHz and resamples. Select it by name (`plughw:CARD=Device,DEV=0`); USB card numbers change after reboots.
- **Never pass `--prompt 'Hey Peak.'` to whisper-server.** Whisper treats the prompt as text already said and suppresses it, so the wake word was being cut off the front of every utterance ("Hey Peak, wave at me" came back as "Wave at me."), on both `small` and `medium`. Without the prompt `medium.en` hears "Hey Peek" reliably, which the filter accepts.
- Whisper hallucinates on quiet audio: "Thanks for watching.", `[BURP]`, bare "Hey.", and whole fluent sentences nobody said. The earlier regex-only filter also dropped the wake phrase itself. Now `heardFilter.js` gates on the wake word; do not add "hey peak" back to a drop list.
- `PEAK_MIN_DB` has no good fixed value on this mic (2 Nov bake-off recording): at `-30`, 4 of 10 phrases spoken at normal distance never opened the gate ("Stop." and the quieter ones); at `-38`, room noise never closed it, so every utterance ran to the 12 s cap, one phrase was cut mid-word across two clips, and whisper returned `[Silence]` for the empty ones. Mean level of real speech clips is -30 to -33 dB, idle about -36. Proper fix: a real VAD (whisper.cpp ships Silero: `--vad -vm ggml-silero-v5.1.2.bin`) or an adaptive noise floor, not another constant.
- `hearing.js` SIGKILLs its ffmpeg child on exit; with SIGTERM it lingered and kept UDP :5001 bound through a quick restart.
- When restarting a sense for a test, kill the mind too or check `pgrep -f orchestrator/index.js`: two minds answer every event twice (happened 2 Nov).
- Do not `pkill -f` on the Pi over ssh with a pattern that appears in the ssh command line itself; it kills the session.
- `say` on the Pi goes to `espeak-ng` as an argv entry, never through a shell (injection fix). Keep it that way.
- The Pi shows **undervoltage** (`vcgencmd get_throttled` = `0x50005`) and has hung or rebooted under load. Still present on 2 Nov 2026 after a new supply AND with the USB mic unplugged: dips every 10-30 s at idle, CPU pinned at 600 MHz. So it is the cable or the supply itself, not a peripheral. After a cable swap (2 Nov evening): idle is clean (one dip at boot, then none over 30 s), but 25 s of 4-core load still produced a dip and live throttling (`0x50005`, CPU at 600 MHz). So the cable was part of it; the supply is still marginal under load. Real-load test (mic streaming + hearing + mind, 4 min, 2 Nov evening): 1 logged dip, no reboot, but the live undervoltage bit was set at the end and the CPU sat at 600 MHz, so the rail hovers right at the 4.63 V threshold. Usable for bench work; not trustworthy for camera + servos. Next: measure the 5V GPIO pin under load (want 4.9-5.2 V); if under 4.8 V, use an official-grade 5.1 V 2.5 A supply. The battery + UBEC path will replace this anyway.
- Mini560 comes in 3.3/5/9/12 V fixed variants; check the SKU says 5V, then measure with a multimeter before connecting the Pi.
- **`qwen2.5vl:3b` is 10.4 GB resident**, not 3.2: the vision encoder and image KV are allocated on load. "8B brain + 3B eyes" was about 16 GB, the whole GPU budget, which is why the 14B never fit and why the other program's `qwen3:14b` evicted our models. Judge vision models by `ollama ps`, not `ollama list`.
- Ollama 0.24.0 cannot load any Gemma 4 build (`unknown model architecture: 'gemma4'` in the live log; `/api/chat` just says "unable to load model"). `huihui_ai/gemma-4-abliterated:12b` and `:12b-qat` are pulled (7.6 GB each) and untested until Ollama is upgraded.
- `node --test <dir>` runs `orchestrator/index.js` as a test and hangs on MQTT. `npm test` names the test files; keep it that way.
- The brain copies the few-shot example lines verbatim ("Hello there!", the weather line) even when told not to. Harmless, but vary the examples if it gets annoying.

## Status

| Area | State |
| --- | --- |
| Repo | https://github.com/prbstr/peak, branch `main`. |
| Broker, orchestrator, `servod` in sim | Working, tested end to end Mac <-> Pi. |
| Hearing | Working from the Pi mic via a resident whisper.cpp server (`npm run whisper`, port 8178, `ggml-medium.en` since 2 Nov evening, about 0.5-0.7 s per utterance on the M4 Pro): about 1 s to transcript, about 4 s to a reply. Transcripts pass through `senses/heardFilter.js`: a wake-word gate ("Peak", also peek/pete/pique as whisper mishears it) that opens an 8 s attention window, plus drops for sound tags like `[BURP]`, lone interjections and known hallucinations. `PEAK_WAKE=off` disables the gate for bench tests. Tests: `cd mind && npm test`. Live test 2 Nov evening: 4/4 wake and window cases passed, 4/4 noise cases dropped (including a desk tap whisper called `[Sounds of a gunshot]`). Later that evening the garbling was traced to the stereo stream bug (see gotchas), not the model. With mono fixed and `medium.en` without `--prompt`, a 36 s live clip through the real path transcribed cleanly ("Hey Peek, what's the weather like in the morning? Peek, nod if you can hear me."). End-to-end re-run 2 Nov 21:20: "Hey Pete." (wake) → "Wave at me." (window) → "Peek, nod if you can hear me." (wake), each transcribed in 0.4-0.6 s and answered by the brain; "(knocking)" dropped. Pipeline verified. Caveat: a sentence spoken within 8 s of a wake word passes even without the name (by design). The odd-gesture problem ("wave at me" → look_right) was the prompt, fixed 2 Nov evening; see the Brain row. **STT bake-off, 2 Nov, 20 real Pi-mic phrases (`mind/bakeoff/README.md`):** whisper small 5.6% WER / 0.14 s, whisper medium.en 4.5% / 0.37 s, Parakeet TDT 0.6B v3 (parakeet-mlx) 4.5% / 0.09 s, Moonshine medium-streaming 11.2% / 0.29 s. Wake-word spellings not counted; the remaining misses are shared by all engines ("nod"→"not", "Sharad", "wave with"→"wave your"), so the owner's pronunciation or the mic, not the model. Decision: stay on whisper.cpp `medium.en`; Parakeet matches it 4x faster but needs a Python/MLX process and its accuracy edge is one phrase. New wake misspellings seen: "Pea", "pig", "I peak". |
| Brain | `huihui_ai/qwen3-vl-abliterated:8b-instruct` for brain and eyes, 7 GB resident. Bake-off 94-96% strict, 0.5 s median, 100% valid JSON; known systematic misses: "don't wave at me" → wave, "where did I leave my keys" → point, "hmm, let me think" → shrug. Timing is logged per reply (`[mind] brain 0.5s (load 44ms, ...)`); a load over 1 s logs an eviction warning. MQTT end-to-end verified with the new model (photo → see event → brain; four heard events → right gestures); not yet voice-tested live. |
| Vision | Working from an image file, now through the same Qwen3-VL model as the brain (`eyes.js` comparison: the only one of three not to hallucinate a person). **Not tested** with the Pi camera: no camera module yet. |
| Servos / PCA9685 / battery | Parts ordered (AliExpress, delivery about early to mid Dec 2026). Nothing wired. `servod` has only run in sim. Orders seen 2 Nov 2026: AliExpress (servos x10, PCA9685 x2, UBEC 3A, Mini560 PRO 5V x5 plus 2 wrong 9V, BMS, holders, switch, USB iron) and Communica (4x INR18650-30HW cells, Pi Camera Module 3 Wide, HC-SR04+, MPU6050, 0.96in I2C OLED, 16-LED WS2812 ring, PIR sensor, vibration motor, Pi heatsinks and fan, resistors, diodes, transistors, F/F jumpers, heat shrink). Not seen in either order, confirm before relying on them: speaker, multimeter, solder/flux, hookup wire, capacitor, fuse, connectors, Pi power supply, 5A UBEC, 2S Type-C charger. |
| Pi service | `peak-servod.service` exists but is not installed on the Pi. |
| Pi power | Unstable (undervoltage). Needs a better supply. |
| Voice (text-to-speech) | `say` uses placeholder espeak-ng. Piper plan is in `mind/voice/README.md`. |

## Next steps

1. Fix Pi power; recheck `vcgencmd get_throttled` reads `0x0`.
2. When parts arrive: measure UBEC and Mini560 outputs, wire PCA9685, tune `node/config.yaml` ranges on the bench, install `peak-servod.service`.
3. Camera module and speaker; test `camd.sh` into `vision.js`.
4. Makefile `m0` target uses plain `python3` (fails on the Mac without PyYAML); point it at `.venv/bin/python`.
5. `scripts/pi-firstboot.sh` was run on the Pi on 2 Nov 2026 (I2C, watchdog, apt deps all confirmed). Run it for each new body.
5b. Servo output now uses `node/pca9685.py` (direct smbus2 driver) instead of `adafruit_servokit`, whose Blinka dependency does not build on the Pi 3B. Unit tests (`python -m unittest test_pca9685` in `node/`) pass on the Mac and the Pi; the real chip has not been tested yet. With no PCA9685 wired, non-sim `servod` exits with an I/O error on the first I2C write, which is expected.
6. Add `look_at` back to the brain's reply shape (native tools now possible: the model has the `tools` capability).
7. Upgrade Ollama (0.24.0 → 0.40.x via brew, then re-apply the plist env) and run `npm run bakeoff:brain -- --models huihui_ai/gemma-4-abliterated:12b,huihui_ai/gemma-4-abliterated:12b-qat --pair huihui_ai/gemma-4-abliterated:12b` to score the two Gemma 4 builds already on disk (7.6 GB each).
8. Live 60 s voice test of the new brain: "Hey Peak, wave at me" / "Peak, nod if you can hear me" / "Peak, look to your left" / "Peak, what's the weather like?", watching `mosquitto_sub -t 'peak/#' -v`.
7. Hearing: replace the `PEAK_MIN_DB` RMS gate with whisper.cpp's Silero VAD or an adaptive floor (see gotchas); add "pea" and "pig" to the wake regex in `heardFilter.js`.

## Working with the owner

- Prefers tables and actionable breakdowns over prose. Short answers, no padding.
- Wants Claude to run things, not hand over commands; where `sudo` or purchases are needed, say exactly what to run or buy.
- Commits are local first; ask before pushing. Never put API keys or `.env` in commits.
- Do not assume the user is `pi`; it is `lupin`.
- Live tests that need the owner to speak or watch: 60 seconds max per window. Run several short ones rather than one long one.
