#!/usr/bin/env bash
# Stream the Pi camera to the mind over UDP. Run on the Pi.
#   PEAK_MIND=<mac-ip> ./camd.sh
# On the Mac, view with: ffplay -fflags nobuffer udp://0.0.0.0:5000
MIND=${PEAK_MIND:?set PEAK_MIND to the Mac's IP}
rpicam-vid -t 0 --width 640 --height 480 --framerate 15 --inline --codec h264 -o "udp://${MIND}:5000"
