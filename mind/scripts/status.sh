#!/bin/sh
# What is up: each Mac part with its pid, the body, the desk light, and the last line of each log.
MIND="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$MIND/run"
show() {
  name=$1; pattern=$2
  pid=$(pgrep -f "$pattern" | head -1)
  last=$( [ -f "$RUN/$name.log" ] && tail -1 "$RUN/$name.log" | cut -c1-90 || echo "" )
  if [ -n "$pid" ]; then printf '%-9s up    pid %-6s %s\n' "$name" "$pid" "$last"; else printf '%-9s down\n' "$name"; fi
}
show whisper "whisper-server"
show mind "orchestrator/index.js"
show hearing "senses/hearing.js"
show vision "senses/vision.js"
show presence "senses/presence.js"
show voice "voice/homepod.py"
printf '%-9s %s\n' body "$(mosquitto_sub -t peak/mech/status -C 1 -W 3 2>/dev/null || echo 'no answer')"
printf '%-9s %s\n' light "$(mosquitto_sub -t 'peak/desk-light/+/availability' -C 1 -W 3 2>/dev/null || echo 'no answer')"
