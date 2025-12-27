#!/bin/bash
# Verify Railway services are linked correctly
# Usage: ./scripts/verify-railway-services.sh

set -e

if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it:"
    echo "   npm i -g @railway/cli"
    echo "   railway login"
    exit 1
fi

echo "🔍 Verifying Railway service configuration..."
echo ""

# Function to check service from its directory
check_service() {
    local service_name=$1
    local service_dir=$2
    
    echo "📦 Checking $service_name service..."
    
    if [ ! -d "$service_dir" ]; then
        echo "  ❌ Directory '$service_dir' not found"
        return 1
    fi
    
    # Check from service directory
    cd "$service_dir"
    if railway status &>/dev/null; then
        local status=$(railway status 2>&1 | head -3)
        echo "  ✅ Service is linked"
        echo "     $status" | sed 's/^/     /'
        
        # Check if we can access variables
        if railway variables &>/dev/null 2>&1; then
            echo "  ✅ Service is accessible"
        fi
        cd ..
        return 0
    else
        echo "  ❌ Service '$service_name' NOT LINKED"
        echo "     Fix: cd $service_dir && railway link"
        cd ..
        return 1
    fi
}

# Check each service
all_good=true

check_service "backend" "backend" || all_good=false
check_service "frontend" "frontend" || all_good=false
check_service "vrm-converter" "vrm-converter-service" || all_good=false

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$all_good" = true ]; then
    echo "✅ All services verified and linked!"
    echo ""
    echo "📋 Next: Run ./scripts/sync-railway-env.sh to sync environment variables"
else
    echo "❌ Some services are not properly linked"
    echo ""
    echo "🔧 To fix, link the missing services:"
    echo "   cd backend && railway link"
    echo "   cd ../frontend && railway link"
    echo "   cd ../vrm-converter-service && railway link"
    echo ""
    echo "   Then run this script again to verify"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

