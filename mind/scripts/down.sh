#!/bin/sh
# Stop Rho's Mac parts: launchctl bootout of each sh.peak.<part> agent, and any old copy the nohup up.sh started
# (by its run/<part>.pid, checked against what the process is). A copy started by hand in a terminal or by another
# session is named, not killed. bootout lasts until the next login or npm run up; install-agents.sh --uninstall
# removes a part for good.
#   npm run down               the Mac side
#   npm run down -- vision     only the named parts (whisper mind hearing vision presence voice health)
#   npm run down -- body       the Mac side and the Pi daemons started by hand (servod, camd, audiod); a daemon run
#                              by its systemd unit needs sudo to stop, and the line to run is printed
set -u
MIND="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$MIND/run"
PI="${PEAK_PI:-lupin@mech.local}"
DOMAIN="gui/$(id -u)"
ALL="hearing vision presence voice health mind ollama-brain whisper" # hearing first so its ffmpeg lets go of UDP :5001

parts=""
for a in "$@"; do [ "$a" = body ] || parts="$parts $a"; done
[ -n "$parts" ] || parts=$ALL

pattern() {
  case $1 in
    whisper) echo "whisper-server" ;; mind) echo "orchestrator/index.js" ;; health) echo "orchestrator/health.js" ;;
    voice) echo "voice/[a-z]*\.py" ;; ollama-brain) echo "[o]llama-brain-has-no-pattern" ;; *) echo "senses/$1.js" ;;
  esac
}

# a pid and all its descendants (npm -> sh -> node)
tree() { echo "$1"; for c in $(pgrep -P "$1" 2>/dev/null); do tree "$c"; done; }

stop() {
  part=$1 label="sh.peak.$1" pat=$(pattern "$1") said=""
  if launchctl print "$DOMAIN/$label" > /dev/null 2>&1; then
    launchctl bootout "$DOMAIN/$label" && echo "$part: stopped (booted out $label)"; said=1
  fi
  # the old up.sh left run/<part>.pid; stop that copy by its pid, and only if it still is that program
  if [ -f "$RUN/$part.pid" ]; then
    pid=$(cat "$RUN/$part.pid")
    # the pid is npm's (npm run -s <part>); the part itself is its grandchild
    if ps -p "$pid" -o command= 2>/dev/null | grep -q "$pat\|npm run"; then
      pids=$(tree "$pid" | tr '\n' ' ')
      kill $pids 2>/dev/null; sleep 1
      for p in $pids; do kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null; done
      echo "$part: stopped the old nohup copy (pids $pids)"; said=1
    fi
    rm -f "$RUN/$part.pid"
  fi
  sleep 0.2
  left=$(pgrep -f "$pat" | tr '\n' ' ')
  if [ -n "$left" ]; then echo "$part: still running outside launchd (pid $left), started by hand: not stopped"
  elif [ -z "$said" ]; then echo "$part: not running"; fi
}

for part in $ALL; do case " $parts " in *" $part "*) stop "$part" ;; esac; done

case " $* " in *" body "*)
  # one plain command; bracketed patterns so pkill never matches this ssh command line itself
  ssh -o ConnectTimeout=5 "$PI" 'for d in camd audiod servod; do
    if systemctl is-enabled --quiet peak-$d 2>/dev/null; then echo "body: $d is run by systemd; to stop it: sudo systemctl stop peak-$d (on the Pi)"; continue; fi
    if [ -f ~/peak/$d.pid ] && kill "$(cat ~/peak/$d.pid)" 2>/dev/null; then echo "body: $d stopped"; else echo "body: $d not running"; fi
    rm -f ~/peak/$d.pid
    case $d in camd) pkill -f "[r]picam-vid" ;; audiod) pkill -f "[a]udiod.sh" ;; servod) pkill -f "[s]ervod.py" ;; esac
  done; true'
  ;;
esac
