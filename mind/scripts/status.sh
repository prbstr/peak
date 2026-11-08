#!/bin/sh
# What is up, from launchd and from the broker's retained status topics:
#   each Mac part: launchd's state, pid and restarts, its retained peak/mind/<part>/status, its last log line;
#   every body and device on peak/<node>/status (mech, desk-light); the last peak/mind/health;
#   the settings the running mind logged at start ([mind] settings: eyes, devices, ...).
#   npm run status
MIND="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MIND"
set -a; [ -f .env ] && . ./.env; set +a
LOGS="${PEAK_LOGS:-$HOME/Library/Logs/peak}"
DOMAIN="gui/$(id -u)"
# mqtt://host:port from PEAK_BROKER, for mosquitto_sub
hostport=${PEAK_BROKER:-mqtt://localhost:1883}; hostport=${hostport#mqtt://}
HOST=${hostport%%:*}; PORT=${hostport##*:}; [ "$PORT" = "$hostport" ] && PORT=1883

retained=$(mosquitto_sub -h "$HOST" -p "$PORT" -v -W 2 -t 'peak/mind/+/status' -t 'peak/+/status' -t 'peak/mind/health' 2>/dev/null)
topic() { printf '%s\n' "$retained" | awk -v t="$1" '$1 == t { $1 = ""; sub(/^ /, ""); print; exit }'; }

printf '%-12s %-9s %-8s %-7s %-8s %s\n' part launchd pid runs mqtt "last log line"
for part in whisper ollama-brain mind hearing vision presence voice health; do
  info=$(launchctl print "$DOMAIN/sh.peak.$part" 2>/dev/null)
  if [ -n "$info" ]; then
    state=$(printf '%s\n' "$info" | awk '/^\tstate = /{print $3; exit}')
    pid=$(printf '%s\n' "$info" | awk '/^\tpid = /{print $3; exit}')
    runs=$(printf '%s\n' "$info" | awk '/^\truns = /{print $3; exit}')
  else state="-"; pid="-"; runs="-"; fi
  mqtt=$(topic "peak/mind/$part/status"); [ -n "$mqtt" ] || mqtt="-"
  log="$LOGS/$part.log"; [ -f "$log" ] || log="$MIND/run/$part.log"
  last=$( [ -f "$log" ] && tail -1 "$log" | cut -c1-70 )
  printf '%-12s %-9s %-8s %-7s %-8s %s\n' "$part" "$state" "${pid:--}" "${runs:--}" "$mqtt" "$last"
done
echo
printf '%s\n' "$retained" | awk '{ n = split($1, p, "/") } n == 3 && p[1] == "peak" && p[3] == "status" && p[2] != "mind" { printf "%-11s %s\n", p[2], $2 }'
health=$(topic peak/mind/health)
if [ -n "$health" ]; then
  printf '%s' "$health" | node -e '
    const h = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const age = Math.round((Date.now() - h.at) / 1000);
    const o = h.ollama.ok ? `up, ${h.ollama.models} models, ${h.ollama.ms} ms` : `DOWN (${h.ollama.error})`;
    console.log(`health      ${h.ok ? "ok" : "down: " + h.down.join(", ")} (${age} s ago); ollama ${o}`);' 2>/dev/null \
    || echo "health      $health"
else
  echo "health      no peak/mind/health on the broker (npm run up -- health)"
fi
log="$LOGS/mind.log"; [ -f "$log" ] || log="$MIND/run/mind.log"
settings=$( [ -f "$log" ] && grep -h '^\[mind\] settings' "$log" | tail -1 )
echo "${settings:-[mind] settings: none logged yet}"
