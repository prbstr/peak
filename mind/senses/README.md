# senses

Fast local loop on the Mac. Each sense publishes `peak/<node>/event` messages, never raw frames or audio; the orchestrator thinks on events.

| Script | Run | Publishes | Config |
| --- | --- | --- | --- |
| `hearing.js` | `npm run hearing` | `{"heard":"..."}` | `PEAK_AUDIO_SOURCE` (`udp://0.0.0.0:5001` for the Pi mic via `node/audiod.sh`; unset for the Mac mic), `PEAK_AUDIO_DEVICE` (Mac mic avfoundation index), `PEAK_WHISPER_URL` (default `http://127.0.0.1:8178`), `PEAK_MIN_DB` (speech threshold per 100 ms frame), `PEAK_SILENCE_MS` (pause that ends an utterance), `PEAK_AUDIO_FILE` (test with a file) |
| `vision.js` | `npm run vision` | `{"doing":"..."}` (desk mode, the default: what the hands are doing, from a crop around them; needs `senses/.venv` with mediapipe and `senses/models/hand_landmarker.task`, see the head of `hands.py`) or `{"see":"..."}` (`PEAK_VISION_MODE=scene`) | `PEAK_VISION_MODE`, `PEAK_DESK_PAUSE_S`, `PEAK_DESK_PROMPT`, `PEAK_HANDS_PYTHON`, `PEAK_VISION_SOURCE` (`udp://0.0.0.0:5000` from the Pi, `avfoundation:<n>`, or an image file), `PEAK_VISION_MODEL` (default the brain's Qwen3-VL), `PEAK_CHANGE`, `PEAK_VISION_COOLDOWN_S`, `PEAK_VISION_ONCE=1` (describe one frame and exit) |
| `presence.js` | `npm run presence` | `{"sensed":"..."}` | Reads `peak/+/sense` (PIR, ultrasonic) from every body. `PEAK_QUIET_S` (seconds of no movement before movement is an arrival, default 60), `PEAK_NEAR_CM` (default 30), `PEAK_NEAR_COOLDOWN_S` (default 10) |

Vision only calls the model when a 16x16 grayscale thumbnail changes enough, then waits out a cooldown.

Notes:
- Pi mic: plug in a USB mic, check it with `arecord -l`, then on the Pi run `PEAK_MIND=<mac-ip> PEAK_ALSA=plughw:1,0 node/audiod.sh` and on the Mac `PEAK_AUDIO_SOURCE=udp://0.0.0.0:5001 npm run hearing`.
- Hearing needs a resident whisper.cpp server: `brew install whisper.cpp`, put `ggml-medium.en.bin` (from the whisper.cpp HF repo) in `~/.cache/whisper.cpp/`, then `npm run whisper` in a second terminal. Audio is cut into utterances at pauses (`PEAK_SILENCE_MS`, default 700 ms) and sent to the server as soon as you stop talking; the log prints the latency per utterance.
- Vision runs on `qwen3-vl:4b-instruct` (3.4 GB loaded) beside the 8B brain (5.7 GB). On a 24 GB Mac that is already short of memory the two can evict each other; see `docs/gotchas.md`.
- Voice is `mind/voice/homepod.py`: every `say` on `peak/+/cmd`, spoken on the HomePod mini (`npm run voice`).
