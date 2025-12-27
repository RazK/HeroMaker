#!/bin/sh
# Startup script for nginx that handles Railway's PORT environment variable

# Replace PORT placeholder in nginx config with actual PORT env var
# If PORT is not set, default to 80
PORT=${PORT:-80}
sed -i "s/\${PORT:-80}/$PORT/g" /etc/nginx/conf.d/default.conf

# Start nginx
exec nginx -g "daemon off;"

