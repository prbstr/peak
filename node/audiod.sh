#!/usr/bin/env bash
# Stream the Pi's USB microphone to the mind as raw 16 kHz mono PCM over UDP. Run on the Pi.
#   PEAK_MIND=<mac-ip> [PEAK_ALSA=plughw:1,0] ./audiod.sh
# Captures at 48 kHz (this USB mic rejects 16 kHz in ffmpeg) and resamples to 16 kHz for whisper. Find the card with `arecord -l`. The Mac side is mind/senses/hearing.js with PEAK_AUDIO_SOURCE=udp://0.0.0.0:5001
MIND=${PEAK_MIND:?set PEAK_MIND to the Mac IP address}
ALSA=${PEAK_ALSA:-plughw:1,0}
exec ffmpeg -hide_banner -loglevel warning -f alsa -ar 48000 -ac 1 -i "$ALSA" -ar 16000 -f s16le "udp://${MIND}:5001?pkt_size=1280"
