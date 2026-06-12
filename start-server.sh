#!/usr/bin/env bash
# Serve the app locally (ES modules need http://, not file://)
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-4321}"
echo "⚽ MATCHDAY → http://localhost:${PORT}"
# open the browser only once the server actually answers (and only if a opener exists)
(
  for _ in $(seq 1 40); do
    if curl -sf "http://localhost:${PORT}" >/dev/null 2>&1; then
      if command -v open >/dev/null 2>&1; then open "http://localhost:${PORT}"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:${PORT}"
      fi
      break
    fi
    sleep 0.25
  done
) &
exec python3 -m http.server "${PORT}"
