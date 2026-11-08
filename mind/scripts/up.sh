#!/bin/sh
# Start all of Rho. The Mac parts are LaunchAgents (sh.peak.<part>, mind/launchd/): launchd restarts a part that dies
# (at most once every 10 s), appends its output to ~/Library/Logs/peak/<part>.log and starts it again at login.
# This script bootstraps the agents that are not loaded, writing any missing plist first (install-agents.sh).
# The body's daemons run under systemd when their units are installed (docs/supervision.md); a daemon whose unit is
# enabled is never started by hand here, so there is only ever one servod.
#   npm run up            everything
#   npm run up -- mind    only the named parts (whisper mind hearing vision presence voice health body)
# Settings come from mind/.env, read by run-part.sh each time a part starts.
set -eu
MIND="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MIND"
set -a; [ -f .env ] && . ./.env; set +a
PEAK_MIND="${PEAK_MIND:-192.168.0.139}"
PI="${PEAK_PI:-lupin@mech.local}"
AGENTS="${PEAK_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
DOMAIN="gui/$(id -u)"
WANT="${*:-whisper mind hearing vision presence voice health body}"
wants() { case " $WANT " in *" $1 "*) return 0;; esac; return 1; }

# what each part's process looks like, to find a copy started outside launchd (by hand, or by the old nohup up.sh)
pattern() {
  case $1 in
    whisper) echo "whisper-server" ;; mind) echo "orchestrator/index.js" ;; health) echo "orchestrator/health.js" ;;
    voice) echo "voice/[a-z]*\.py" ;; *) echo "senses/$1.js" ;;
  esac
}
agent_pid() { launchctl print "$DOMAIN/sh.peak.$1" 2>/dev/null | awk '/^\tpid = /{print $3}'; }

start() {
  part=$1 label="sh.peak.$1"
  if launchctl print "$DOMAIN/$label" > /dev/null 2>&1; then
    echo "$part: already loaded (pid $(agent_pid "$part" || true); launchd restarts it if it dies)"; return
  fi
  # a second copy would answer every event twice, or fight over a UDP port
  others=$(pgrep -f "$(pattern "$part")" | tr '\n' ' ' || true)
  if [ -n "$others" ]; then
    echo "$part: NOT started: already running outside launchd (pid $others). npm run down -- $part stops an old"
    echo "        nohup copy; a copy another session started by hand is that session's to stop."
    return
  fi
  [ -f "$AGENTS/$label.plist" ] || sh "$MIND/scripts/install-agents.sh" "$part"
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
  echo "$part: started (log ~/Library/Logs/peak/$part.log)"
}

# whisper first: hearing needs it; the mind needs only the broker
for part in whisper mind hearing vision presence voice health; do wants "$part" && start "$part"; done

# The body: servod (servos simulated until the PCA9685 is wired), the camera and mic streams. A daemon whose systemd
# unit is enabled is left to systemd. Otherwise it is started by hand over ssh, one plain command each, and judged
# alive by the pid file it leaves in ~/peak, never by pgrep (a pattern would match this very ssh command line).
if wants body; then
  for d in servod camd audiod; do
    # prints "enabled" or "hand <alive|dead>", plus the unit's MainPID and the pid file's pid
    state=$(ssh -o ConnectTimeout=5 "$PI" "if systemctl is-enabled --quiet peak-$d 2>/dev/null; then echo enabled \$(systemctl is-active peak-$d) \$(systemctl show -p MainPID --value peak-$d) \$(cat ~/peak/$d.pid 2>/dev/null); elif kill -0 \"\$(cat ~/peak/$d.pid 2>/dev/null)\" 2>/dev/null; then echo hand alive; else echo hand dead; fi" 2>/dev/null || echo unreachable)
    set -- $state
    case "$1" in
      enabled)
        echo "body: $d run by systemd (${2:-?}, pid ${3:-?})"
        # a pid file that is not the unit's own is a copy started by hand before the unit: two servods
        if [ -n "${4:-}" ] && [ "${4:-}" != "${3:-}" ] && ssh -o ConnectTimeout=5 "$PI" "kill -0 $4" 2>/dev/null; then
          echo "body: WARNING $d also runs by hand (pid $4) beside its unit: npm run down -- body"
        fi ;;
      unreachable) echo "body: $PI unreachable over ssh"; break ;;
      *)
        if [ "${2:-}" = alive ]; then echo "body: $d running (started by hand)"; continue; fi
        echo "body: starting $d on $PI"
        case $d in
          servod) ssh -o ConnectTimeout=5 "$PI" 'PEAK_SIM=1 PEAK_BROKER=twentyones-Mac-mini.local setsid nohup ~/peak/.venv/bin/python -u ~/peak/node/servod.py > ~/peak/servod.log 2>&1 < /dev/null & echo $! > ~/peak/servod.pid' ;;
          camd) ssh -o ConnectTimeout=5 "$PI" 'PEAK_MIND='"$PEAK_MIND"' setsid nohup ~/peak/node/camd.sh > ~/peak/camd.log 2>&1 < /dev/null & echo $! > ~/peak/camd.pid' ;;
          audiod) ssh -o ConnectTimeout=5 "$PI" 'PEAK_MIND='"$PEAK_MIND"' setsid nohup ~/peak/node/audiod.sh > ~/peak/audiod.log 2>&1 < /dev/null & echo $! > ~/peak/audiod.pid' ;;
        esac ;;
    esac
  done
  sleep 4
  echo "body: $(mosquitto_sub -t peak/mech/status -C 1 -W 5 2>/dev/null || echo 'no answer')"
fi
echo "ready: say \"Rho\", pause, then the request. npm run status shows the parts; npm run down stops them."
