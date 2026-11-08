#!/bin/sh
# Write Rho's LaunchAgents: mind/launchd/peak.<part>.plist.template, filled in, becomes
# ~/Library/LaunchAgents/sh.peak.<part>.plist. Writing one does not start it; npm run up does (launchctl bootstrap).
# Once written, the parts start at every login by themselves.
#   scripts/install-agents.sh [parts]              write the plists (default: all seven)
#   scripts/install-agents.sh --dry-run [parts]    print them, write nothing
#   scripts/install-agents.sh --uninstall [parts]  boot each one out and delete its plist (stops it for good)
#   scripts/install-agents.sh --selftest NAME      write and start sh.peak.test-NAME, run-part.sh's selftest part: it
#                                                  logs, exits 3 after 20 s and is restarted, to prove KeepAlive and the appended log
#   scripts/install-agents.sh --uninstall --selftest NAME   remove it again
#   scripts/install-agents.sh --newsyslog          print the log rotation rules; the owner installs them with sudo
#                                                  (docs/supervision.md)
# Run it again after node moves (an nvm upgrade): the plists carry node's directory in PATH.
# Never brew services and never launchctl load: bootstrap and bootout only (docs/gotchas.md, Ollama).
set -eu
MIND="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="${PEAK_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
LOGS="${PEAK_LOGS:-$HOME/Library/Logs/peak}"
DOMAIN="gui/$(id -u)"
ALL="whisper ollama-brain mind hearing vision presence voice health"

mode=install selftest=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) mode=dry ;;
    --uninstall) mode=uninstall ;;
    --selftest) selftest=${2:?--selftest needs a name}; shift ;;
    --newsyslog) mode=newsyslog ;;
    -*) echo "install-agents.sh: unknown option $1" >&2; exit 64 ;;
    *) break ;;
  esac
  shift
done
PARTS="${*:-$ALL}"

node_bin=$(command -v node || true)
[ -n "$node_bin" ] || { echo "install-agents.sh: node is not on PATH" >&2; exit 1; }
AGENT_PATH="$(dirname "$node_bin"):/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin"

# render <template part> <label> <run-part argument>
render() {
  sed -e "s|@MIND@|$MIND|g" -e "s|@LOGS@|$LOGS|g" -e "s|@PATH@|$AGENT_PATH|g" \
      -e "s|<string>sh\.peak\.$1</string>|<string>$2</string>|" \
      -e "s|<string>$1</string>|<string>$3</string>|" \
      -e "s|$LOGS/$1\.log|$LOGS/$3.log|g" \
      "$MIND/launchd/peak.$1.plist.template"
}

loaded() { launchctl print "$DOMAIN/$1" > /dev/null 2>&1; }

# write <template part> <label> <run-part argument>
write() {
  plist="$AGENTS/$2.plist"
  tmp=$(mktemp)
  render "$1" "$2" "$3" > "$tmp"
  plutil -lint -s "$tmp" || { echo "$2: rendered plist does not lint" >&2; rm -f "$tmp"; exit 1; }
  if [ -f "$plist" ] && cmp -s "$tmp" "$plist"; then rm -f "$tmp"; echo "$2: unchanged"; return; fi
  mv "$tmp" "$plist"
  chmod 644 "$plist"
  if loaded "$2"; then echo "$2: written to $plist; it is running the old one: npm run down -- $3, then npm run up -- $3"
  else echo "$2: written to $plist"; fi
}

remove() {
  if loaded "$1"; then launchctl bootout "$DOMAIN/$1" && echo "$1: booted out"; fi
  rm -f "$AGENTS/$1.plist" && echo "$1: plist removed"
}

# Rotation: at 10 MB a log is renamed (7 kept, bzip2) and the part gets signal 31 (SIGUSR2), which no part handles,
# so it ends as if killed and launchd starts it again on a fresh log. A clean exit would not be restarted, and
# newsyslog cannot copy-and-truncate, so the signal is what makes launchd reopen the file.
if [ $mode = newsyslog ]; then
  echo "# Rho's logs (written by mind/scripts/install-agents.sh --newsyslog). Fields: file owner:group mode count size(KB) when flags pidfile signal"
  for part in $ALL; do
    printf '%s %s:%s 644 7 10240 * J %s 31\n' "$LOGS/$part.log" "$(id -un)" "$(id -gn)" "$LOGS/$part.pid"
  done
  exit 0
fi

mkdir -p "$AGENTS" "$LOGS"

if [ -n "$selftest" ]; then
  label="sh.peak.test-$selftest"
  case $mode in
    uninstall) remove "$label" ;;
    dry) render presence "$label" selftest ;;
    *) write presence "$label" selftest
       launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist" && echo "$label: started; log $LOGS/selftest.log" ;;
  esac
  exit 0
fi

for part in $PARTS; do
  case " $ALL " in *" $part "*) ;; *) echo "install-agents.sh: unknown part $part (parts: $ALL)" >&2; exit 64 ;; esac
  case $mode in
    dry) echo "==> $AGENTS/sh.peak.$part.plist"; render "$part" "sh.peak.$part" "$part" ;;
    uninstall) remove "sh.peak.$part" ;;
    *) write "$part" "sh.peak.$part" "$part" ;;
  esac
done
