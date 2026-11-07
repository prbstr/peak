#!/usr/bin/env bash
# Stream the Pi camera to the mind over UDP. Run on the Pi.
#   PEAK_MIND=<mac-ip> ./camd.sh
# On the Mac, view with: ffplay -fflags nobuffer -f h264 udp://0.0.0.0:5000
MIND=${PEAK_MIND:?set PEAK_MIND to the Mac IP address}
# Since 7 Nov 2026 the camera hangs over the desk and the mind crops around the hands, so it needs the detail:
# 1920x1080 (the Pi 3's H264 encoder tops out there) taken from the 2304x1296 sensor mode, which keeps the full field
# of view. PEAK_CAM_SIZE=640x480 PEAK_CAM_MODE= gives the old room view. The bitrate is rpicam-vid's own (about
# 10 Mbit/s, what the desk bake-off was measured on); PEAK_CAM_BITRATE sets one.
SIZE=${PEAK_CAM_SIZE:-1920x1080}
MODE=${PEAK_CAM_MODE-2304:1296}
# --intra 15: a keyframe every second, so a reader that opens the stream mid-way waits at most a second.
# -n -v 0: no preview window, no per-frame log lines.
exec rpicam-vid -t 0 -n -v 0 ${MODE:+--mode "$MODE"} --width "${SIZE%x*}" --height "${SIZE#*x}" --framerate 15 \
  ${PEAK_CAM_BITRATE:+--bitrate "$PEAK_CAM_BITRATE"} --intra 15 --inline --codec h264 -o "udp://${MIND}:5000"
