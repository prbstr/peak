# Log: what was built, tested and measured

The dated record behind the short "Where things stand" table in `CLAUDE.md`. One section per area, oldest entry first
inside each. Times are South African time (UTC+2). Append to the right section when you test or measure something; keep
`CLAUDE.md` to what is true now.

## Repo

https://github.com/prbstr/peak, branch `main`.

## Broker, orchestrator, `servod` in sim

Working, tested end to end Mac <-> Pi.

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

## Vision

Working from an image file, now through the same Qwen3-VL model as the brain (`eyes.js` comparison: the only one of three not to hallucinate a person). On Ollama 0.40.13 a fresh frame takes 5.6 s to describe (1.8 s on 0.24); the `PEAK_VISION_COOLDOWN_S` 10 s loop still works, the `{see}` event just lands later.

**Pi camera live since 5 Nov 2026:** `camd.sh` (640x480, 15 fps H264 over UDP :5000) into `vision.js` into the brain, end to end. Two real frames were described accurately (a monitor edge with a purple cable and a brick wall; a ceiling light with "no people"), and the brain answered the empty scene with no gesture and no words. Not yet tested with a person in frame. The camera was lying loose on the desk, not mounted.

## Sensors

Live since 5 Nov 2026. `servod` on the Pi (started by hand with `PEAK_SIM=1`, servos simulated) publishes `peak/mech/sense` every second: ultrasonic distance (read 7-37 cm against a hand and the desk), PIR `motion` (true in 3 of 20 readings while the owner was at the desk), SoC temperature, and the `throttled` power flags.

**Wired to the brain the same evening:** with `npm run presence` running, the owner's arrival produced "Is someone there?" and a hand at 23 and 29 cm produced "Careful, that's quite close.", each with no gesture, and each sent to the OLED. The owner then reported the OLED blank: the panel had been switched off under `servod` (see gotchas). Fixed the same evening and proven by switching the panel off from a second program: `servod` had it back on within 7 s. The owner then confirmed the reply (`*wave*`, "Hello there!") is readable on the glass. Round trip checked: a faked `{"heard":"hey peak, wave at me"}` produced the wave command on the Pi 306 ms later. Readings now go out every 0.5 s. Not persistent: both daemons die on a Pi reboot until a systemd unit is installed (needs `sudo`).

## Eyes (OLED)

**RoboEyes port running on the Pi since 5 Nov 2026 21:22** (`node/eyes.py`, `node/screen.py`, `node/oled.py`, drawn by `servod`). It replaced a Doom-style head (commit `7277f2a`) and a helmet that was never committed, both from the same evening. 63 node tests pass on the Mac and the Pi. Measured on the Pi: 14 frames a second while the eyes move, 9 with only sweat falling (see gotchas); `display on` and no display error in the log; the panel's status byte reads on. On this power supply the eyes are tired and sweating all the time (`0x50005`).

**`eyes` command and tricks, 5 Nov 21:50:** happy, angry, shut, `look_left`, the surprised and wink tricks and three malformed commands were sent to the running body; snapshots of what `servod` sent to the panel showed each one, and the daemon stayed up. 75 node tests, 45 mind tests.

**Not yet seen by the owner on the glass.**

## Servos / PCA9685 / battery

Parts ordered (AliExpress, delivery about early to mid Dec 2026). Nothing wired. `servod` has only run in sim. Orders seen 2 Nov 2026: AliExpress (servos x10, PCA9685 x2, UBEC 3A, Mini560 PRO 5V x5 plus 2 wrong 9V, BMS, holders, switch, USB iron) and Communica (4x INR18650-30HW cells, Pi Camera Module 3 Wide, HC-SR04+, MPU6050, 0.96in I2C OLED, 16-LED WS2812 ring, PIR sensor, vibration motor, Pi heatsinks and fan, resistors, diodes, transistors, F/F jumpers, heat shrink). Not seen in either order, confirm before relying on them: speaker, multimeter, solder/flux, hookup wire, capacitor, fuse, connectors, Pi power supply, 5A UBEC, 2S Type-C charger.

## Pi service

`peak-servod.service` exists but is not installed on the Pi.

## Pi power

Unstable (undervoltage). Needs a better supply. 5 Nov 2026 with the camera streaming and `servod` running: `throttled=0x50005` (undervoltage right now), 47 °C, load 0.25, no reboot in the first few minutes. The flag is in every sense message, so watch it from the Mac.

**Mic test, 5 Nov 2026 19:25** (`node/powerwatch.sh`, 30 s windows, 2 samples a second; the camera had held the Pi in one unbroken undervoltage since it started at 18:12:05): camera on with the mic plugged in but idle, undervoltage in 58 of 58 samples; camera on and mic streaming, 56 of 56; camera off and mic streaming, 56 of 56; camera off and mic stream off (mic still plugged in), 50 of 57. CPU held at 600-800 MHz with the camera off, 600-1200 with it on. No hang or reboot in about 4 minutes, and the mic audio arrived on the Mac (4 s clip, mean -33 dB). Not measured: the same idle window with the mic unplugged, so the mic's own share is unknown. Conclusion: this supply holds neither the camera nor the mic stream; everything today ran throttled.

**New supply, 7 Nov 2026 14:00** (the owner connected it and asked whether it was enough; model and rating not stated). After a reboot, idle: `throttled=0x0`, core 1.34 V, ARM 1200 MHz, 42 °C, 0 undervoltage lines in the kernel journal. Then `servod` (`PEAK_SIM=1`), `camd.sh` and `audiod.sh` started by hand, body online, and `powerwatch.sh 30`: 58 samples, undervoltage 0, freq_capped 0, throttled 0, CPU 700-1200 MHz (ondemand scaling, not a cap), kernel_dips 0, 46.7 °C, load 0.46. During the window a wave, a 4 s `laugh` eyes animation and a shrug were sent over MQTT. Conclusion: the supply holds the whole bench load. Not measured: a run of hours, and nothing with real servos, which get their own rail anyway.

## Voice (text-to-speech)

**Speaks through the HomePod mini since 5 Nov 2026** (`npm run voice`): the owner heard the test line, then two brain replies went out ("Got it." finished 3.2 s after the command, the connection kept open between lines). One line at a time, a newer one replaces a waiting one. On the Pi `say` still goes to espeak-ng, silent in sim and with no speaker attached; once a speaker is on the body, both would talk. Untested with the mic: the HomePod's own words will reach it, and a line containing "Peak" could wake the hearing gate.
