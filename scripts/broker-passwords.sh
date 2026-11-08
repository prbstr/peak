#!/bin/sh
# Write a broker password for each of Rho's broker users to where that client reads it (docs/broker.md).
# The owner runs this on the Mac, from the repo root, in his own terminal: each password is typed hidden (Enter makes a
# random one), so no session ever sees it. Letters, digits, dot, dash and underscore only, so a password never needs
# quoting in .env, YAML or a shell. It restarts nothing and leaves the broker anonymous; the order after it is in
# docs/broker.md (restart the Mac parts, deploy the Pi, re-flash the light, then scripts/broker-auth.sh on).
#   mind, senses, voice   mind/.env  PEAK_MQTT_PASSWORD_MIND / _SENSES / _VOICE
#   mech                  the Pi's ~/peak/peak.env  PEAK_MQTT_USER / PEAK_MQTT_PASSWORD (over ssh, asks the Pi's password
#                         only if the key login fails)
#   desk-light            devices/desk-light/secrets.yaml  mqtt_password
#   owner                 ~/.config/mosquitto_sub and ~/.config/mosquitto_pub, so mosquitto_sub/pub keep working
#   all six               /opt/homebrew/etc/mosquitto/passwd, hashed by mosquitto_passwd
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ETC=/opt/homebrew/etc/mosquitto
PI="${PEAK_PI:-lupin@mech.local}"
umask 077
[ -t 0 ] || { echo "broker-passwords: run this in a terminal, it asks for passwords" >&2; exit 1; }
trap 'stty echo 2>/dev/null' EXIT INT TERM

ask() {
  while :; do
    printf 'password for %s (Enter = random): ' "$1" >&2
    stty -echo; IFS= read -r pw; stty echo; printf '\n' >&2
    [ -n "$pw" ] || pw=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-24)
    case "$pw" in *[!A-Za-z0-9._-]*) echo "  letters, digits, . _ - only; again" >&2 ;; *) break ;; esac
  done
  printf '%s' "$pw"
}

# KEY=value in a file, replacing an old line with that key
setkey() { file=$1 key=$2 value=$3; touch "$file"; { grep -v "^$key=" "$file" || true; printf '%s=%s\n' "$key" "$value"; } > "$file.new"; mv "$file.new" "$file"; }

plain=$(mktemp)
for user in mind senses voice mech desk-light owner; do
  pw=$(ask "$user")
  printf '%s:%s\n' "$user" "$pw" >> "$plain"
  case $user in
    mind)   setkey "$REPO/mind/.env" PEAK_MQTT_PASSWORD_MIND "$pw" ;;
    senses) setkey "$REPO/mind/.env" PEAK_MQTT_PASSWORD_SENSES "$pw" ;;
    voice)  setkey "$REPO/mind/.env" PEAK_MQTT_PASSWORD_VOICE "$pw" ;;
    mech)
      printf 'PEAK_MQTT_USER=mech\nPEAK_MQTT_PASSWORD=%s\n' "$pw" | ssh -o ConnectTimeout=8 "$PI" \
        'umask 077; f=$HOME/peak/peak.env; touch "$f"; { grep -v "^PEAK_MQTT_" "$f" || true; cat; } > "$f.new" && mv "$f.new" "$f"' \
        && echo "  written to $PI:~/peak/peak.env" >&2 ;;
    desk-light)
      f="$REPO/devices/desk-light/secrets.yaml"
      { grep -v '^mqtt_password:' "$f" || true; printf 'mqtt_password: "%s"\n' "$pw"; } > "$f.new" && mv "$f.new" "$f" ;;
    owner)
      mkdir -p "$HOME/.config"
      for t in mosquitto_sub mosquitto_pub; do printf -- '-u owner\n-P %s\n' "$pw" > "$HOME/.config/$t"; done ;;
  esac
done
mosquitto_passwd -U "$plain"
mv "$plain" "$ETC/passwd"
chmod 600 "$ETC/passwd" "$REPO/mind/.env" "$REPO/devices/desk-light/secrets.yaml"
echo "done: six users in $ETC/passwd, each password where its client reads it. The broker is still anonymous;" >&2
echo "next steps are in docs/broker.md." >&2
