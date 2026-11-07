#!/bin/sh
# Start all of Rho: the Mac side (whisper, mind, hearing from the Pi mic, vision from the Pi camera, presence,
# voice on the HomePod) as detached processes that outlive this shell, and the body on the Pi if it is not online.
# Each Mac part gets run/<name>.pid and run/<name>.log. A part already running is left alone.
#   npm run up            everything
#   npm run up -- mind    only the named parts (whisper mind hearing vision presence voice body)
# Settings come from mind/.env (PEAK_BRAIN_EYES, PEAK_BRAIN_DEVICES, PEAK_MIND, ...).
set -eu
MIND="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$MIND/run"
mkdir -p "$RUN"
cd "$MIND"
set -a; [ -f .env ] && . ./.env; set +a
PEAK_MIND="${PEAK_MIND:-192.168.0.139}"
PI="${PEAK_PI:-lupin@mech.local}"
WANT="${*:-whisper mind hearing vision presence voice body}"

running() { pgrep -f "$1" > /dev/null 2>&1; }
start() {
  name=$1; pattern=$2; shift 2
  if running "$pattern"; then echo "$name: already running (pid $(pgrep -f "$pattern" | head -1))"; return; fi
  nohup "$@" > "$RUN/$name.log" 2>&1 < /dev/null &
  echo $! > "$RUN/$name.pid"
  echo "$name: started (pid $!, log run/$name.log)"
}
wants() { case " $WANT " in *" $1 "*) return 0;; esac; return 1; }

# the Mac side; whisper first, the mind needs the broker only, hearing needs whisper
wants whisper && start whisper "whisper-server" npm run -s whisper
wants mind && start mind "orchestrator/index.js" npm run -s start
wants hearing && start hearing "senses/hearing.js" env PEAK_AUDIO_SOURCE=udp://0.0.0.0:5001 npm run -s hearing
wants vision && start vision "senses/vision.js" npm run -s vision
wants presence && start presence "senses/presence.js" npm run -s presence
wants voice && start voice "voice/homepod.py" npm run -s voice

# the body: servod (servos simulated until the PCA9685 is wired), camera and mic streams, each one plain ssh command
if wants body; then
  status=$(mosquitto_sub -t peak/mech/status -C 1 -W 3 2>/dev/null || true)
  if [ "$status" = "online" ]; then
    echo "body: online"
  else
    echo "body: $status, starting servod, camd and audiod on $PI"
    ssh -o ConnectTimeout=5 "$PI" 'pgrep -f "[s]ervod.py" > /dev/null || (PEAK_SIM=1 PEAK_BROKER=twentyones-Mac-mini.local setsid nohup ~/peak/.venv/bin/python -u ~/peak/node/servod.py > ~/peak/servod.log 2>&1 < /dev/null & echo $! > ~/peak/servod.pid)'
  fi
  ssh -o ConnectTimeout=5 "$PI" 'pgrep -f "[r]picam-vid" > /dev/null || (PEAK_MIND='"$PEAK_MIND"' setsid nohup ~/peak/node/camd.sh > ~/peak/camd.log 2>&1 < /dev/null &)'
  ssh -o ConnectTimeout=5 "$PI" 'pgrep -f "[a]udiod|arecord|ffmpeg.*5001" > /dev/null || (PEAK_MIND='"$PEAK_MIND"' setsid nohup ~/peak/node/audiod.sh > ~/peak/audiod.log 2>&1 < /dev/null &)'
  echo "body: camera and mic streams checked"
fi
echo "ready: say \"Rho\", pause, then the request. npm run status shows the parts; npm run down stops them."
