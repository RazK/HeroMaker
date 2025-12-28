#!/bin/sh
# Startup script for nginx that handles Railway's PORT environment variable

# Set default PORT if not provided
export PORT=${PORT:-80}

# Substitute PORT in nginx config
sed "s|\${PORT}|${PORT}|g" < /etc/nginx/conf.d/default.conf > /tmp/nginx.conf.tmp
mv /tmp/nginx.conf.tmp /etc/nginx/conf.d/default.conf

# Verify nginx config is valid
nginx -t || {
    echo "ERROR: nginx config is invalid after PORT substitution!"
    exit 1
}

# Start nginx
exec nginx -g "daemon off;"

