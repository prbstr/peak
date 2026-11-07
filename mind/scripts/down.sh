#!/bin/sh
# Stop the Mac side of Rho: every part npm run up started (by its pid file), and any stray copy of the same
# programs started by hand. The body on the Pi is left running unless asked: npm run down -- body
#   npm run down          the Mac side
#   npm run down -- body  the Pi daemons too (servod, camd, audiod)
set -u
MIND="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$MIND/run"
PI="${PEAK_PI:-lupin@mech.local}"
stop() {
  name=$1; pattern=$2
  pids=$(pgrep -f "$pattern" || true)
  if [ -z "$pids" ]; then echo "$name: not running"; rm -f "$RUN/$name.pid"; return; fi
  kill $pids 2>/dev/null || true
  sleep 1
  for p in $pids; do kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null; done
  rm -f "$RUN/$name.pid"
  echo "$name: stopped ($pids)"
}
# hearing first so its ffmpeg lets go of UDP :5001
stop hearing "senses/hearing.js"
stop vision "senses/vision.js"
stop presence "senses/presence.js"
stop voice "voice/homepod.py"
stop mind "orchestrator/index.js"
stop whisper "whisper-server"
case " $* " in *" body "*)
  # one plain command each; the patterns are bracketed so pgrep never matches this ssh command line itself
  ssh -o ConnectTimeout=5 "$PI" 'for f in ~/peak/camd.pid ~/peak/audiod.pid ~/peak/servod.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; done; pkill -f "[r]picam-vid"; pkill -f "[s]ervod.py"; pkill -f "[a]udiod.sh"; echo "body: stopped"'
  ;;
esac
