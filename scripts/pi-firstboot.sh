#!/usr/bin/env bash
# First-boot setup for a peak body. Run on the Pi as the login user (lupin), not root.
#   ./pi-firstboot.sh <node-name>      e.g. mech
# Reusable for every new body. Reboot afterwards. Copy node/ to ~/peak/node first (docs/runbook.md, section 4): the
# venv is built from node/requirements.txt. Matches the Pi as it ran on 9 Nov 2026; not yet run on a fresh card.
set -euo pipefail
NODE=${1:?usage: pi-firstboot.sh <node-name>}

sudo raspi-config nonint do_hostname "$NODE"
sudo raspi-config nonint do_i2c 0

sudo apt update
# gpiozero and lgpio from apt, as on mech since 5 Nov 2026 (docs/environment.md)
sudo apt install -y mosquitto-clients python3-venv i2c-tools rpicam-apps espeak-ng ffmpeg alsa-utils python3-gpiozero python3-lgpio

# Hardware watchdog: reboot the Pi if it hangs
CONFIG=/boot/firmware/config.txt
grep -q '^dtparam=watchdog=on' "$CONFIG" || echo 'dtparam=watchdog=on' | sudo tee -a "$CONFIG" >/dev/null
sudo mkdir -p /etc/systemd/system.conf.d
printf '[Manager]\nRuntimeWatchdogSec=10\n' | sudo tee /etc/systemd/system.conf.d/watchdog.conf >/dev/null

mkdir -p ~/peak/node
# --system-site-packages so the venv sees apt's gpiozero and lgpio
python3 -m venv --system-site-packages ~/peak/.venv
~/peak/.venv/bin/pip install -r ~/peak/node/requirements.txt

echo "done. Run: sudo reboot, then reconnect as lupin@${NODE}.local"
