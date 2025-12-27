#!/bin/bash
# Sync Railway environment variables from railway.env files
# Usage: ./scripts/sync-railway-env.sh [service-name]
# Example: ./scripts/sync-railway-env.sh backend

set -e

SERVICE=${1:-"all"}

if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it:"
    echo "   npm i -g @railway/cli"
    echo "   railway login"
    exit 1
fi

sync_service() {
    local service=$1
    local env_file="railway.env.${service}"
    
    if [ ! -f "$env_file" ]; then
        echo "⚠️  $env_file not found, skipping $service"
        return
    fi
    
    echo "📦 Syncing environment variables for $service..."
    
    # Read env file and set variables
    while IFS='=' read -r key value || [ -n "$key" ]; do
        # Skip comments and empty lines
        [[ "$key" =~ ^#.*$ ]] && continue
        [[ -z "$key" ]] && continue
        
        # Remove quotes from value
        value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//')
        
        echo "  Setting $key=$value"
        railway variables set "$key=$value" --service "$service" || true
    done < "$env_file"
    
    echo "✅ $service synced"
}

if [ "$SERVICE" = "all" ]; then
    echo "🔄 Syncing all services..."
    sync_service "backend"
    sync_service "frontend"
    sync_service "vrm-converter"
else
    sync_service "$SERVICE"
fi

echo "✅ Done!"

