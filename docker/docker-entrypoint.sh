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

# Logging: the same LOG_LEVEL / LOG_REQUESTS the backend reads, so one
# setting quiets both containers.
#   LOG_LEVEL     silent | error | warn | info (default) | debug
#   LOG_REQUESTS  true (default) | false   the per-request access log
# nginx names its levels differently, so map ours onto its error_log levels.
# Request lines are written at info and debug only, and never when
# LOG_REQUESTS is false.
level=$(printf '%s' "${LOG_LEVEL:-info}" | tr 'A-Z' 'a-z' | tr -d ' ')
requests=$(printf '%s' "${LOG_REQUESTS:-true}" | tr 'A-Z' 'a-z' | tr -d ' ')
case "$level" in
  silent) nginx_level=emerg; access=off ;;
  error)  nginx_level=error; access=off ;;
  warn)   nginx_level=warn;  access=off ;;
  debug)  nginx_level=info;  access=on ;;
  info)   nginx_level=notice; access=on ;;
  *)
    echo "Unknown LOG_LEVEL \"$LOG_LEVEL\"; using \"info\". Use one of: silent, error, warn, info, debug." >&2
    nginx_level=notice; access=on ;;
esac
case "$requests" in
  false|0|no|off) access=off ;;
esac
sed -i -E "s|^(error_log[[:space:]]+[^[:space:]]+)[[:space:]]+[a-z]+;|\1 ${nginx_level};|" /etc/nginx/nginx.conf
if [ "$access" = "off" ]; then
  echo "access_log off;" > /etc/nginx/conf.d/00-logging.conf
else
  rm -f /etc/nginx/conf.d/00-logging.conf
fi

exec "$@"
