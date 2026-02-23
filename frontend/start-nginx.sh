#!/bin/sh
# Startup script for nginx that handles Railway's PORT environment variable

# Set default PORT if not provided
export PORT=${PORT:-80}

# Set default API proxy target (use Docker service name or env var)
export API_PROXY_TARGET=${VITE_API_PROXY_TARGET:-http://backend:8000}

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

