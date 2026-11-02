# voice

Text-to-speech. Not wired yet — fill in at M5.

Piper (`brew install piper-tts` or pip) → WAV → stream to the node over MQTT (`peak/<node>/audio`, binary) or over HTTP. The node plays it with `aplay`.
