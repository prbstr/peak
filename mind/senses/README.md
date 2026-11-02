# senses

Fast local loop on the Mac. Each sense publishes `peak/<node>/event` messages, never raw frames or audio; the orchestrator thinks on events.

| Script | Run | Publishes | Config |
| --- | --- | --- | --- |
| `hearing.js` | `npm run hearing` | `{"heard":"..."}` | `PEAK_AUDIO_SOURCE` (`udp://0.0.0.0:5001` for the Pi mic via `node/audiod.sh`; unset for the Mac mic), `PEAK_AUDIO_DEVICE` (Mac mic avfoundation index), `PEAK_WHISPER_MODEL` (default `small`), `PEAK_MIN_DB` (silence cutoff), `PEAK_AUDIO_FILE` (test with a file) |
| `vision.js` | `npm run vision` | `{"see":"..."}` | `PEAK_VISION_SOURCE` (`udp://0.0.0.0:5000` from the Pi, `avfoundation:<n>`, or an image file), `PEAK_VISION_MODEL` (default `gemma4:26b`), `PEAK_CHANGE`, `PEAK_VISION_COOLDOWN_S`, `PEAK_VISION_ONCE=1` (describe one frame and exit) |

Vision only calls the model when a 16x16 grayscale thumbnail changes enough, then waits out a cooldown.

Notes:
- Pi mic: plug in a USB mic, check it with `arecord -l`, then on the Pi run `PEAK_MIND=<mac-ip> PEAK_ALSA=plughw:1,0 node/audiod.sh` and on the Mac `PEAK_AUDIO_SOURCE=udp://0.0.0.0:5001 npm run hearing`.
- Whisper runs as a fresh process per chunk, so expect a few seconds of delay.
- `gemma4:26b` is about 19 GB loaded. On a 24 GB Mac it pushes the brain model out of memory; use a smaller vision model if both must stay resident.
- Voice output is still unwired (`../voice`).
