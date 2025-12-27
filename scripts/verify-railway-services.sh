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

# Check if we're in a Railway project
if ! railway status &>/dev/null; then
    echo "⚠️  Not linked to a Railway project."
    echo "   Run: railway link (from project root or service directory)"
    exit 1
fi

echo "✅ Linked to Railway project"
echo ""

# Function to check service
check_service() {
    local service_name=$1
    local expected_root=$2
    
    echo "📦 Checking $service_name service..."
    
    # Check if service exists
    if railway service list 2>/dev/null | grep -q "$service_name"; then
        echo "  ✅ Service '$service_name' exists"
        
        # Try to get service info
        # Note: Railway CLI might not expose root directory directly
        # We'll check by trying to access the service
        
        # Check if we can see service variables (indicates service is accessible)
        if railway variables --service "$service_name" &>/dev/null; then
            echo "  ✅ Service is accessible"
        else
            echo "  ⚠️  Service exists but may not be properly linked"
        fi
        
    else
        echo "  ❌ Service '$service_name' NOT FOUND"
        echo "     Expected root directory: $expected_root"
        echo "     Fix: cd $expected_root && railway link"
        return 1
    fi
    
    echo ""
}

# Check each service
all_good=true

check_service "backend" "backend" || all_good=false
check_service "frontend" "frontend" || all_good=false
check_service "vrm-converter" "vrm-converter-service" || all_good=false

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$all_good" = true ]; then
    echo "✅ All services verified!"
    echo ""
    echo "📋 Next: Run ./scripts/sync-railway-env.sh to sync environment variables"
else
    echo "❌ Some services are missing or not properly linked"
    echo ""
    echo "🔧 To fix:"
    echo "   1. cd backend && railway link"
    echo "   2. cd ../frontend && railway link"
    echo "   3. cd ../vrm-converter-service && railway link"
    echo ""
    echo "   Then run this script again to verify"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

