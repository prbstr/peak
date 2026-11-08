#!/usr/bin/env bash
# Sync node/ to a body and run its three daemons under systemd: peak-servod, peak-camd, peak-audiod. systemd then
# restarts each one 3 s after it dies and starts them all at boot. Also installs node/peak.logrotate.
# Run on the Mac by the owner: sudo on the Pi asks for the lupin password (ssh -t gives it a terminal to ask on).
# docs/supervision.md explains each step.
#   scripts/deploy-node.sh [host]      (default: mech.local)
# The daemons started by hand (npm run up, before the units) are stopped first by their pid files, so the units never
# run beside a second servod. Safe to run again: it only copies files and restarts the units.
set -euo pipefail
HOST=${1:-mech.local}
UNITS="peak-servod peak-camd peak-audiod"
cd "$(dirname "$0")/.."
rsync -a --delete --exclude __pycache__ node/ "lupin@${HOST}:~/peak/node/"
# one plain command line; the hand-started daemons are stopped by pid file only if no unit runs them yet
ssh -t "lupin@${HOST}" "for d in servod camd audiod; do if ! systemctl is-active --quiet peak-\$d && [ -f ~/peak/\$d.pid ]; then kill \"\$(cat ~/peak/\$d.pid)\" 2>/dev/null && echo \"stopped hand-started \$d\"; rm -f ~/peak/\$d.pid; fi; done; for u in $UNITS; do sudo cp ~/peak/node/\$u.service /etc/systemd/system/; done && sudo install -m 644 ~/peak/node/peak.logrotate /etc/logrotate.d/peak && sudo systemctl daemon-reload && sudo systemctl enable $UNITS && sudo systemctl restart $UNITS && systemctl --no-pager --lines=0 status $UNITS"
echo "deployed to ${HOST}"
