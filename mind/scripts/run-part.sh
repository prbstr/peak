#!/bin/sh
# Run one part of Rho's Mac side in the foreground, with mind/.env loaded. Each LaunchAgent (sh.peak.<part>, written
# by install-agents.sh) runs this, so no setting or secret lives in a plist. The last step is exec, so the process
# launchd watches, and a kill -9 hits, is the part itself, not this shell.
#   scripts/run-part.sh whisper|mind|hearing|vision|presence|voice|health
#   scripts/run-part.sh selftest     logs, waits 20 s and exits 3 (to prove KeepAlive without touching Rho)
# Each start leaves one line in the part's log, so a restart is visible. PEAK_PART tells the part its name, which
# turns on its retained peak/mind/<part>/status (senses/lib.js connect()).
set -eu
part=${1:?usage: run-part.sh <part>}
MIND="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MIND"
# PEAK_ENV_FILE picks another settings file (a test against its own broker uses one with only PEAK_BROKER in it)
ENV_FILE="${PEAK_ENV_FILE:-./.env}"
set -a
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
set +a
# launchd starts jobs with PATH=/usr/bin:/bin:/usr/sbin:/sbin; the plist adds node's and Homebrew's directories
PATH="${PATH}:/opt/homebrew/bin:/opt/homebrew/sbin"
export PATH PEAK_PART="$part"
# the part's broker user (docs/broker.md): the mind and health log in as mind, the senses as senses, the voice as
# voice, each with its PEAK_MQTT_PASSWORD_<ROLE> from .env. None set: no login, the anonymous broker still works.
case "$part" in
  hearing|vision|presence) role=senses pw=${PEAK_MQTT_PASSWORD_SENSES:-} ;;
  voice)                   role=voice pw=${PEAK_MQTT_PASSWORD_VOICE:-} ;;
  *)                       role=mind pw=${PEAK_MQTT_PASSWORD_MIND:-} ;;
esac
if [ -n "$pw" ]; then export PEAK_MQTT_USER="$role" PEAK_MQTT_PASSWORD="$pw"; fi
unset pw
LOGS="${PEAK_LOGS:-$HOME/Library/Logs/peak}"
mkdir -p "$LOGS"
# pid file for newsyslog: it signals the part after a rotation so launchd reopens the log (docs/supervision.md)
echo $$ > "$LOGS/$part.pid"
echo "[run-part] $(date '+%Y-%m-%d %H:%M:%S') starting $part (pid $$)"

case "$part" in
  whisper)  exec whisper-server -m "${PEAK_WHISPER_GGML:-$HOME/.cache/whisper.cpp/ggml-medium.en.bin}" \
              --host 127.0.0.1 --port 8178 -l en --no-timestamps ;;
  mind)     exec node orchestrator/index.js ;;
  hearing)  export PEAK_AUDIO_SOURCE="${PEAK_AUDIO_SOURCE:-udp://0.0.0.0:5001}"; exec node senses/hearing.js ;;
  vision)   exec node senses/vision.js ;;
  presence) exec node senses/presence.js ;;
  voice)    # PEAK_VOICE_BACKEND (mind/voice/README.md): kokoro speaks on the Mac's own speaker, homepod over AirPlay
            if [ "${PEAK_VOICE_BACKEND:-homepod}" = kokoro ]; then exec voice/.venv-kokoro/bin/python -u voice/local.py
            else exec voice/.venv/bin/python -u voice/homepod.py; fi ;;
  health)   exec node orchestrator/health.js ;;
  selftest) echo "[selftest] alive in $(pwd), PATH has node: $(command -v node || echo none)"; sleep 20
            echo "[selftest] exiting 3"; exit 3 ;;
  *)        echo "run-part.sh: unknown part '$part'" >&2; exit 64 ;;
esac
