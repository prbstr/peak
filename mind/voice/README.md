# voice

Text-to-speech for the mind's spoken lines. Two backends, picked by `PEAK_VOICE_BACKEND` in `mind/.env` when
`npm run voice` starts: `homepod` (the default) or `kokoro`. Both listen for `{"say": "..."}` on `peak/+/cmd`, speak
one line at a time with one more waiting (a newer line replaces it), and hold a retained `peak/mind/voice/status`
(`online`, `offline` by Last Will).

| Backend | Speaker | First sound | Memory |
| --- | --- | --- | --- |
| `homepod` (`homepod.py`) | HomePod mini over AirPlay | about 2.5 s (2 s AirPlay buffer) | small |
| `kokoro` (`local.py`) | the Mac mini's own speaker (default output) | 0.21 s median, 0.44 s p90 live; slower while Ollama is busy (below) | 313 MB on the GPU, 1.1 GB peak while speaking |

Set `talk_delay_s` in `node/config.yaml` to match (0.3 for kokoro, 2.5 for homepod), or the eyes pulse out of step.

The LaunchAgent does not go through `npm run voice`: `scripts/run-part.sh` reads `PEAK_VOICE_BACKEND` the same way.
To switch the running Rho, change the line in `mind/.env`, then `launchctl kickstart -k gui/$(id -u)/sh.peak.voice`.

## Kokoro on the Mac speaker

`local.py` runs [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (82M, Apache-2.0) on the GPU through
[mlx-audio](https://github.com/Blaizzy/mlx-audio). Each line is made in pieces, one per sentence, and a first
sentence over 60 characters is cut in two at a comma or before a joining word; each piece plays as soon as it is
made, so the first sound waits only for the first piece. Kokoro pads every piece with about 0.27 s of silence in front
and 0.52 s behind; `local.py` keeps 30 ms in front and a 0.2 s pause after a sentence (0.1 s at a comma).

```sh
python3.13 -m venv voice/.venv-kokoro && voice/.venv-kokoro/bin/pip install -r voice/requirements-kokoro.txt  # once, from mind/
PEAK_VOICE_BACKEND=kokoro npm run voice
voice/.venv-kokoro/bin/python voice/kokoro_bench.py --play     # first sound, real-time factor, memory
```

| Setting (`mind/.env`) | Meaning |
| --- | --- |
| `PEAK_VOICE_BACKEND` | `kokoro` or `homepod` (default) |
| `PEAK_KOKORO_VOICE` | Kokoro voice; first letter is the accent, `a` US, `b` UK. Default `bm_george`, a British man like the Daniel voice used on the HomePod |
| `PEAK_KOKORO_SPEED` | Speaking rate, default 1.0 |
| `PEAK_KOKORO_MODEL` | Hugging Face repo or a folder. Default `mlx-community/Kokoro-82M-bf16`; the cached copy is used when there is one, so a start without internet still speaks |
| `PEAK_MQTT_USER`, `PEAK_MQTT_PASSWORD` | Broker login; unset is anonymous |

It logs `[voice] 'line': first sound 0.17s, speech 0.25s, done at 2.4s` per line (first sound by the audio device's
own clock), adding `waited Xs` when the line queued behind another and `N gap(s)` if the speaker ran dry between
pieces.

**`peak/mind/speaking`** is retained: `true` from the first piece until the last sample has left the speaker, then
`false`; `false` again on every connect. It is meant for a half-duplex hearing gate. A `kill -9` mid-line leaves it
`true` (the Last Will can carry only one topic), so a gate must count it only while `peak/mind/voice/status` is
`online`.

**Ollama slows it.** Kokoro shares the GPU with Ollama. While the desk camera's 4B model describes frames back to
back, the first sound took 0.4-0.8 s instead of 0.1-0.35 s, and once 2.0 s (the first line after five idle minutes,
with the Mac's swap nearly full). On the CPU it is far too slow to use. Numbers in `docs/log.md`, Voice.

The phonemiser (misaki) needs espeak-ng for words missing from its dictionary ("Rho", names). It looks only in one
Homebrew folder, so `local.py` points it at the copy inside the `espeakng-loader` wheel; no `brew install` is needed.

## The HomePod mini

`homepod.py` listens for `{"say": "..."}` on `peak/+/cmd`, makes a WAV with the macOS `say` command and streams it to
an AirPlay speaker with [pyatv](https://pyatv.dev). The Mac's own sound output is not touched.

```sh
python3.13 -m venv voice/.venv && voice/.venv/bin/pip install -r voice/requirements.txt   # once, from mind/
npm run voice                                                                              # from mind/
```

| Setting (`mind/.env`) | Meaning |
| --- | --- |
| `PEAK_SPEAKER` | AirPlay name of the speaker, as the Home app shows it. Required |
| `PEAK_SPEAKER_HOST` | Its IP address. Optional; skips the multicast search |
| `PEAK_VOICE` | macOS voice (`say -v '?'` lists them). Default Daniel |

About 2.5 s pass between the command and the first sound; 2 s of that is AirPlay's buffer. One line plays at a time
and a newer line replaces one that is waiting. The speaker must allow AirPlay from the network without a password.

## Later: a voice on the body

Piper (`brew install piper-tts` or pip) → WAV → stream to the node over MQTT (`peak/<node>/audio`, binary) or over
HTTP. The node plays it with `aplay`.
