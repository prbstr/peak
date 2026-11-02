#!/usr/bin/env bash
# First-boot setup for a peak body. Run on the Pi as the login user (lupin), not root.
#   ./pi-firstboot.sh <node-name>      e.g. mech
# Reusable for every new body. Reboot afterwards.
set -euo pipefail
NODE=${1:?usage: pi-firstboot.sh <node-name>}

sudo raspi-config nonint do_hostname "$NODE"
sudo raspi-config nonint do_i2c 0

sudo apt update
sudo apt install -y mosquitto-clients python3-venv i2c-tools rpicam-apps espeak-ng ffmpeg alsa-utils

# Hardware watchdog: reboot the Pi if it hangs
CONFIG=/boot/firmware/config.txt
grep -q '^dtparam=watchdog=on' "$CONFIG" || echo 'dtparam=watchdog=on' | sudo tee -a "$CONFIG" >/dev/null
sudo mkdir -p /etc/systemd/system.conf.d
printf '[Manager]\nRuntimeWatchdogSec=10\n' | sudo tee /etc/systemd/system.conf.d/watchdog.conf >/dev/null

mkdir -p ~/peak/node
python3 -m venv ~/peak/.venv
~/peak/.venv/bin/pip install paho-mqtt pyyaml smbus2 gpiozero

echo "done. Run: sudo reboot, then reconnect as lupin@${NODE}.local"
