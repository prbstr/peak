#!/usr/bin/env bash
# Sync node/ to a body and restart its servo daemon.
#   scripts/deploy-node.sh [host]      (default: mech.local)
set -euo pipefail
HOST=${1:-mech.local}
cd "$(dirname "$0")/.."
rsync -a --delete --exclude __pycache__ node/ "lupin@${HOST}:~/peak/node/"
ssh "lupin@${HOST}" 'sudo cp ~/peak/node/peak-servod.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable peak-servod && sudo systemctl restart peak-servod'
echo "deployed to ${HOST}"
