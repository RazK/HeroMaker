#!/bin/sh
# Startup script for nginx that handles Railway's PORT environment variable

# Set default PORT if not provided
export PORT=${PORT:-80}

# Create a temporary nginx config with PORT substituted
# Use envsubst to replace ${PORT} with actual PORT value
envsubst '${PORT}' < /etc/nginx/conf.d/default.conf > /tmp/nginx.conf.tmp

# Replace the default config with the substituted one
mv /tmp/nginx.conf.tmp /etc/nginx/conf.d/default.conf

# Verify nginx config is valid
nginx -t || {
    echo "ERROR: nginx config is invalid after PORT substitution!"
    echo "PORT=$PORT"
    cat /etc/nginx/conf.d/default.conf
    exit 1
}

# Start nginx
echo "Starting nginx on port $PORT"
exec nginx -g "daemon off;"

