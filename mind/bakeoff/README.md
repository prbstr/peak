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

## Score

```sh
bakeoff/.venv/bin/python bakeoff/bakeoff.py            # all engines
bakeoff/.venv/bin/python bakeoff/bakeoff.py whisper     # one engine
```

Setup once: `python3.13 -m venv bakeoff/.venv && bakeoff/.venv/bin/pip install moonshine-voice parakeet-mlx jiwer`. whisper.cpp is scored through the running `whisper-server`, the other two load in-process (first run downloads their models).
