#!/bin/sh
# Startup script for nginx that handles Railway's PORT environment variable

# Set default PORT if not provided
export PORT=${PORT:-80}

# Set default API proxy target (use Docker service name or env var).
#
# The default below is the DOCKER COMPOSE one: `backend` resolves on the
# compose network and the container listens on 8000 there. It is wrong on
# Railway, where the service is `backend.railway.internal` and uvicorn binds
# ${PORT} (8080). Nothing normally notices, because the SPA calls the backend's
# public domain directly via VITE_API_BASE_URL and never uses this proxy - but
# anyone who curls /api/... on the FRONTEND host gets a 20-second hang and a
# 504 that reads exactly like an outage. It cost four days once.
#
# So on Railway, set VITE_API_PROXY_TARGET explicitly.
export API_PROXY_TARGET=${VITE_API_PROXY_TARGET:-http://backend:8000}

echo "nginx: proxying /api -> ${API_PROXY_TARGET}" 

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

