# voice

Text-to-speech for the mind's spoken lines.

## Today: the HomePod mini

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
