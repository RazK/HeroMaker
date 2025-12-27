#!/bin/bash
# Configure Railway services entirely from code - no clickops needed!
# Usage: ./scripts/configure-railway.sh
# Requires: Railway CLI installed and logged in

set -e

if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it:"
    echo "   npm i -g @railway/cli"
    echo "   railway login"
    exit 1
fi

echo "🚀 Configuring Railway services from code..."
echo ""

# Function to link service with root directory
link_service() {
    local service_name=$1
    local root_dir=$2
    
    echo "📦 Configuring $service_name service..."
    
    # Link service (this sets up the connection)
    # Note: Root directory is set when you link from a specific directory
    # We'll use Railway CLI's service commands
    
    # Set service variables from railway.env files
    if [ -f "railway.env.$service_name" ]; then
        echo "  📝 Setting environment variables..."
        while IFS='=' read -r key value || [ -n "$key" ]; do
            # Skip comments and empty lines
            [[ "$key" =~ ^#.*$ ]] && continue
            [[ -z "$key" ]] && continue
            
            # Remove quotes from value
            value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//')
            
            echo "    Setting $key"
            railway variables set "$key=$value" --service "$service_name" 2>/dev/null || echo "    ⚠️  Failed to set $key (may already exist)"
        done < "railway.env.$service_name"
    fi
    
    echo "  ✅ $service_name configured"
}

# Note: Root directory must be set manually ONCE in Railway dashboard
# OR when initially linking the service via Railway CLI from that directory
# After that, railway.toml files in each directory handle the rest

echo "⚠️  IMPORTANT: Root Directory Setup"
echo ""
echo "Railway CLI doesn't support setting root directory directly."
echo "You have two options:"
echo ""
echo "Option 1: One-time manual setup (recommended)"
echo "  1. Go to Railway dashboard"
echo "  2. For each service → Settings → Source"
echo "  3. Set Root Directory:"
echo "     - Backend: 'backend'"
echo "     - Frontend: 'frontend'"
echo "     - VRM Converter: 'vrm-converter-service'"
echo "  4. After that, all config comes from railway.toml files!"
echo ""
echo "Option 2: Link services from their directories"
echo "  cd backend && railway link"
echo "  cd ../frontend && railway link"
echo "  cd ../vrm-converter-service && railway link"
echo ""

read -p "Have you set the root directories? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Please set root directories first, then run this script again."
    exit 1
fi

# Configure environment variables
echo ""
echo "🔧 Setting environment variables from railway.env files..."
link_service "backend" "backend"
link_service "frontend" "frontend"
link_service "vrm-converter" "vrm-converter-service"

echo ""
echo "✅ Railway configuration complete!"
echo ""
echo "📋 What's configured:"
echo "  ✅ Environment variables (from railway.env.* files)"
echo "  ✅ Build/deploy settings (from railway.toml files)"
echo "  ✅ Health checks (from railway.toml files)"
echo ""
echo "🚀 Next: Just push to railway-deployment branch and Railway auto-deploys!"

