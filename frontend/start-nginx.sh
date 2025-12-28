#!/bin/sh
# Startup script for nginx that handles Railway's PORT environment variable

# Set default PORT if not provided
export PORT=${PORT:-80}

# Set default BACKEND_URL if not provided (Docker Compose uses backend:8000, Railway uses backend.railway.internal:8000)
export BACKEND_URL=${BACKEND_URL:-backend:8000}

# Debug: Print environment variables (force output to stderr so it shows in logs)
echo "=== Environment Variables ===" >&2
echo "PORT=$PORT" >&2
echo "BACKEND_URL=$BACKEND_URL" >&2
echo "=============================" >&2

# Create a temporary nginx config with PORT and BACKEND_URL substituted
# Use envsubst to replace ${PORT} and ${BACKEND_URL} with actual values
# Note: envsubst expects variable names WITHOUT ${}, so use 'PORT BACKEND_URL' not '${PORT} ${BACKEND_URL}'
envsubst 'PORT BACKEND_URL' < /etc/nginx/conf.d/default.conf > /tmp/nginx.conf.tmp

# Debug: Show the substituted proxy_pass line
echo "=== Nginx proxy_pass configuration ===" >&2
grep "proxy_pass" /tmp/nginx.conf.tmp || echo "WARNING: proxy_pass not found in config!" >&2
echo "======================================" >&2

# Debug: Show the actual proxy_pass value
echo "=== Actual proxy_pass value ===" >&2
grep -o "proxy_pass http://[^;]*" /tmp/nginx.conf.tmp | head -1 >&2 || echo "No proxy_pass found" >&2
echo "======================================" >&2

# Replace the default config with the substituted one
mv /tmp/nginx.conf.tmp /etc/nginx/conf.d/default.conf

# Verify nginx config is valid
nginx -t || {
    echo "ERROR: nginx config is invalid after substitution!"
    echo "PORT=$PORT"
    echo "BACKEND_URL=$BACKEND_URL"
    echo "=== Generated nginx config ==="
    cat /tmp/nginx.conf.tmp
    echo "=============================="
    exit 1
}

# Start nginx
echo "Starting nginx on port $PORT"
exec nginx -g "daemon off;"

