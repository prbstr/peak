# STT bake-off

Compares speech-to-text engines on the same utterances recorded from the mech's mic: whisper.cpp `small` (what `hearing.js` uses), Moonshine Voice, Parakeet TDT 0.6B v3. Reports word error rate and transcription time per engine.

## Record

The clips come from `hearing.js` itself, so they are cut exactly the way the mind hears them.

```sh
# Mac, two terminals:
npm run whisper
PEAK_AUDIO_SOURCE=udp://0.0.0.0:5001 PEAK_DUMP_DIR=bakeoff/clips npm run hearing
# Pi:
PEAK_MIND=192.168.0.139 ./audiod.sh
```

Read `phrases.txt` aloud in order, one line at a time, pausing about a second between lines. Each utterance lands in `bakeoff/clips/` as a timestamped wav. Then `ls bakeoff/clips | wc -l` should equal the line count of `phrases.txt`; delete extras (coughs, false starts) before scoring. `clips/` is gitignored.

If the gate misfires (nothing captured, or one 12 s clip holding several phrases), cut the saved wavs by hand with `ffmpeg -ss/-to` and name them `NN.wav` after the phrase number; `bakeoff.py` then scores each against phrase NN and tolerates gaps. Keep the originals in `bakeoff/raw/` (gitignored).

## Results, 2 Nov 2026, 20 phrases from the Pi USB mic at desk distance

| Engine | WER | Exact | Mean s | Max s |
| --- | --- | --- | --- | --- |
| whisper small (whisper.cpp, Metal) | 5.6% | 15/20 | 0.14 | 0.15 |
| whisper medium.en (whisper.cpp, Metal) | 4.5% | 16/20 | 0.37 | 0.40 |
| Moonshine medium-streaming | 11.2% | 13/20 | 0.29 | 1.10 |
| Parakeet TDT 0.6B v3 (parakeet-mlx) | 4.5% | 16/20 | 0.09 | 0.20 |

Every engine got "nod"→"not", "Sharad", and "wave with your"→"wave your" wrong, so those are the speaker and mic, not the model. Moonshine's extra misses were wake words ("pig", "Faye pig") and a dropped "rest". Timings are with one engine loaded at a time; in the all-engines run Parakeet averaged 9 s because two whisper-servers and Moonshine were still resident next to Ollama on 24 GB. Score engines one at a time when timing matters.

## Score

```sh
bakeoff/.venv/bin/python bakeoff/bakeoff.py            # all engines
bakeoff/.venv/bin/python bakeoff/bakeoff.py whisper     # one engine
```

Spellings of "Peak" that the wake-word gate accepts (Peek, Pete, ...) are not counted as errors. Names like "Sharad" are, so expect one or two misses per engine from those alone.

Synthetic clips for checking the harness without a mic (the macOS voice is far cleaner than the Pi mic, so do not read anything into its scores): `bakeoff/make-synth.sh`.

Setup once: `python3.13 -m venv bakeoff/.venv && bakeoff/.venv/bin/pip install moonshine-voice parakeet-mlx jiwer`. whisper.cpp is scored through the running `whisper-server`, the other two load in-process (first run downloads their models).
