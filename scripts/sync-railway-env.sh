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
    local service_dir=$2
    local env_file="railway.env.${service}"
    
    if [ ! -f "$env_file" ]; then
        echo "⚠️  $env_file not found, skipping $service"
        return
    fi
    
    if [ ! -d "$service_dir" ]; then
        echo "⚠️  $service_dir directory not found, skipping $service"
        return
    fi
    
    echo "📦 Syncing environment variables for $service..."
    
    # Change to service directory (Railway CLI is linked at service level)
    cd "$service_dir"
    
    # Verify we're linked to the right service
    if ! railway status &>/dev/null; then
        echo "  ❌ Not linked to $service. Run: cd $service_dir && railway link"
        cd ..
        return 1
    fi
    
    # Read env file and set variables (from service directory)
    while IFS='=' read -r key value || [ -n "$key" ]; do
        # Skip comments and empty lines
        [[ "$key" =~ ^#.*$ ]] && continue
        [[ -z "$key" ]] && continue
        
        # Remove quotes from value
        value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//')
        
        echo "  Setting $key"
        # Railway CLI uses --set flag (not 'set' subcommand)
        railway variables --set "$key=$value" 2>&1 | grep -v "already exists" || true
    done < "../$env_file"
    
    cd ..
    echo "✅ $service synced"
}

if [ "$SERVICE" = "all" ]; then
    echo "🔄 Syncing all services..."
    sync_service "backend" "backend"
    sync_service "frontend" "frontend"
    sync_service "vrm-converter" "vrm-converter-service"
else
    # Map service name to directory
    case "$SERVICE" in
        backend)
            sync_service "backend" "backend"
            ;;
        frontend)
            sync_service "frontend" "frontend"
            ;;
        vrm-converter)
            sync_service "vrm-converter" "vrm-converter-service"
            ;;
        *)
            echo "❌ Unknown service: $SERVICE"
            echo "   Use: backend, frontend, or vrm-converter"
            exit 1
            ;;
    esac
fi

echo ""
echo "✅ Done!"

