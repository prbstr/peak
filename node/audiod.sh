#!/usr/bin/env bash
# Stream the Pi's USB microphone to the mind as raw 16 kHz mono PCM over UDP. Run on the Pi.
#   PEAK_MIND=<mac-ip> [PEAK_ALSA=plughw:CARD=Device,DEV=0] ./audiod.sh
# Select the mic by name, not number: USB card numbers change between boots. Captures at 48 kHz (this USB mic rejects 16 kHz in ffmpeg) and resamples to 16 kHz for whisper. Find the card with `arecord -l`. The Mac side is mind/senses/hearing.js with PEAK_AUDIO_SOURCE=udp://0.0.0.0:5001
MIND=${PEAK_MIND:?set PEAK_MIND to the Mac IP address}
ALSA=${PEAK_ALSA:-plughw:CARD=Device,DEV=0}
# -ac 1 must be an OUTPUT option: on the input side alsa ignores it and captures stereo, and a stereo
# s16le stream read as mono by hearing.js is unintelligible to whisper.
exec ffmpeg -hide_banner -loglevel warning -f alsa -ar 48000 -i "$ALSA" -ar 16000 -ac 1 -f s16le "udp://${MIND}:5001?pkt_size=1280"
