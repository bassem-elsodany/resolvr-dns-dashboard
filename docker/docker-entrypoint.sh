#!/bin/sh
set -e

# Regenerates env-config.js from the container's environment on every
# start, so BACKEND_URL can be set per-deployment (docker-compose.yml,
# `docker run -e`, ...) without rebuilding the image — see
# frontend/src/lib/backendUrl.ts for how the app reads it.
# Escaped for a JS string literal in case the URL ever contains a
# backslash or double quote.
escaped_backend_url=$(printf '%s' "${BACKEND_URL:-}" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__RESOLVR_ENV__ = {
  BACKEND_URL: "${escaped_backend_url}"
}
EOF

exec "$@"
