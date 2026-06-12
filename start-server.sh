#!/usr/bin/env bash
# Serve the app locally (ES modules need http://, not file://)
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-4321}"
echo "⚽ MATCHDAY → http://localhost:${PORT}"
( sleep 1 && open "http://localhost:${PORT}" ) &
python3 -m http.server "${PORT}"
