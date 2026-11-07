#!/usr/bin/env bash
# Record the Pi camera's UDP stream on the Mac without re-encoding. Stop `npm run vision` first (one reader on :5000).
#   bakeoff/desk/record.sh <seconds> <out.mp4>
set -euo pipefail
exec ffmpeg -y -loglevel error -fflags nobuffer -f h264 -probesize 2000000 -analyzeduration 3000000 -r 15 \
  -i udp://0.0.0.0:5000 -t "$1" -c copy "$2"
