#!/usr/bin/env bash
# Stream the Pi camera to the mind over UDP. Run on the Pi.
#   PEAK_MIND=<mac-ip> ./camd.sh
# On the Mac, view with: ffplay -fflags nobuffer udp://0.0.0.0:5000
MIND=${PEAK_MIND:?set PEAK_MIND to the Mac IP address}
# --intra 15: a keyframe every second. vision.js opens the stream fresh for each look and has to wait for one;
# at the default (every 60 frames) a single look took over 5 s. -n -v 0: no preview window, no per-frame log lines.
exec rpicam-vid -t 0 -n -v 0 --width 640 --height 480 --framerate 15 --intra 15 --inline --codec h264 -o "udp://${MIND}:5000"
