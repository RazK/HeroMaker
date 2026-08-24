#!/bin/sh
# Startup script for nginx that handles Railway's PORT environment variable

# Set default PORT if not provided
export PORT=${PORT:-80}

# Set the API proxy target.
#
# The bare "backend" hostname only resolves under docker-compose. On Railway the
# backend is reachable at <service>.railway.internal, so falling back to
# "http://backend:8000" there makes every /api/* request hang and then 504 while
# the site still looks healthy - the backend is fine, nginx simply cannot find
# it. Pick the right default per environment, and say which one was used.
if [ -n "${VITE_API_PROXY_TARGET}" ]; then
    export API_PROXY_TARGET="${VITE_API_PROXY_TARGET}"
elif [ -n "${RAILWAY_ENVIRONMENT}" ]; then
    # Railway injects PORT into each service; the backend binds it, so the
    # private-network target must use that port, not the local-dev 8000.
    export API_PROXY_TARGET="http://backend.railway.internal:${BACKEND_PORT:-8080}"
    echo "WARNING: VITE_API_PROXY_TARGET is not set. Defaulting to ${API_PROXY_TARGET}"
    echo "         Set it explicitly on the frontend service to override."
else
    export API_PROXY_TARGET="http://backend:8000"
fi
echo "API proxy target: ${API_PROXY_TARGET}"

# Substitute PORT and API_PROXY_TARGET in nginx config
sed -e "s|\${PORT}|${PORT}|g" \
    -e "s|\${API_PROXY_TARGET}|${API_PROXY_TARGET}|g" \
    < /etc/nginx/conf.d/default.conf > /tmp/nginx.conf.tmp
mv /tmp/nginx.conf.tmp /etc/nginx/conf.d/default.conf

# Verify nginx config is valid
nginx -t || {
    echo "ERROR: nginx config is invalid after PORT substitution!"
    exit 1
}

# Start nginx
exec nginx -g "daemon off;"

