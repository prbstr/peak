#!/bin/sh
# Turn logins on Rho's broker on or off (docs/broker.md). Run on the Mac from the repo root.
#   scripts/broker-auth.sh on       install broker/mosquitto.conf and broker/peak.acl, restart the broker, check that an
#                                   anonymous client is refused and that every part came back
#   scripts/broker-auth.sh off      put the anonymous config back and restart the broker (the way back)
#   scripts/broker-auth.sh acl      copy broker/peak.acl into place and reload it with SIGHUP (no client is dropped)
#   scripts/broker-auth.sh status   which config is live
# It holds no secret: the passwords are written by scripts/broker-passwords.sh, which the owner runs.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ETC=/opt/homebrew/etc/mosquitto
CONF=$ETC/mosquitto.conf
SERVICE="gui/$(id -u)/sh.brew.mosquitto"

restart() {
  launchctl kickstart -k "$SERVICE"
  for i in 1 2 3 4 5 6 7 8 9 10; do nc -z localhost 1883 2>/dev/null && return 0; sleep 1; done
  echo "broker-auth: the broker did not come back on :1883; see 'log show --last 2m --predicate \"process == \\\"mosquitto\\\"\"'" >&2
  return 1
}

# connect as nobody: refused when logins are on (node's mqtt, since mosquitto_sub would use the owner's login file)
anonymous() {
  cd "$REPO/mind" && node -e "
    import('mqtt').then(({ default: mqtt }) => {
      const c = mqtt.connect('mqtt://localhost:1883', { reconnectPeriod: 0, connectTimeout: 4000 });
      c.on('connect', () => { console.log('accepted'); process.exit(0); });
      c.on('error', e => { console.log('refused: ' + e.message); process.exit(0); });
      setTimeout(() => { console.log('no answer'); process.exit(0); }, 5000);
    });"
}

case "${1:-status}" in
  on)
    [ -s "$ETC/passwd" ] || { echo "broker-auth: no $ETC/passwd yet; the owner runs scripts/broker-passwords.sh first" >&2; exit 1; }
    for u in mind senses voice mech desk-light owner; do
      grep -q "^$u:" "$ETC/passwd" || { echo "broker-auth: no password for $u in $ETC/passwd" >&2; exit 1; }
    done
    [ -f "$CONF.before-auth" ] || cp "$CONF" "$CONF.before-auth"
    mkdir -p /opt/homebrew/var/lib/mosquitto
    cp "$REPO/broker/peak.acl" "$ETC/peak.acl"
    cp "$REPO/broker/mosquitto.conf" "$CONF"
    restart
    sleep 3
    echo "anonymous client: $(anonymous)"
    echo "logins are on. npm run status shows whether every part logged back in; scripts/broker-auth.sh off undoes this."
    ;;
  off)
    cp "$REPO/broker/mosquitto.anonymous.conf" "$CONF"
    restart
    echo "anonymous again: $(anonymous)"
    ;;
  acl)
    cp "$REPO/broker/peak.acl" "$ETC/peak.acl"
    pid=$(pgrep -f "[s]bin/mosquitto -c $CONF") || { echo "broker-auth: no broker running" >&2; exit 1; }
    kill -HUP "$pid" && echo "ACL reloaded (pid $pid)"
    ;;
  status)
    if grep -q '^allow_anonymous false' "$CONF"; then echo "logins on ($CONF)"; else echo "anonymous ($CONF)"; fi
    ;;
  *) echo "usage: scripts/broker-auth.sh on|off|acl|status" >&2; exit 64 ;;
esac
