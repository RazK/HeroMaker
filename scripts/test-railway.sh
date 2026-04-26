#!/bin/bash

# Railway Deployment Testing Script
# Usage: ./scripts/test-railway.sh [BACKEND_URL]

set -e

BACKEND_URL="${1:-https://heromaker.up.railway.app}"

echo "🚀 Testing Railway Deployment"
echo "================================"
echo "Backend URL: $BACKEND_URL"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

test_endpoint() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"
    
    echo -n "Testing $name... "
    
    response=$(curl -s -w "\n%{http_code}" "$url" 2>&1)
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $http_code)"
        ((TESTS_PASSED+=1))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $http_code, expected $expected_status)"
        echo "Response: $body"
        ((TESTS_FAILED+=1))
        return 1
    fi
}

test_json_response() {
    local name="$1"
    local url="$2"
    local expected_key="$3"
    
    echo -n "Testing $name... "
    
    response=$(curl -s "$url" 2>&1)
    
    if echo "$response" | jq -e ".$expected_key" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((TESTS_PASSED+=1))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (Expected key '$expected_key' not found)"
        echo "Response: $response"
        ((TESTS_FAILED+=1))
        return 1
    fi
}

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}Warning: jq not installed. Some tests may not work correctly.${NC}"
    echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
    echo ""
fi

# Test 1: Basic Health Check
test_endpoint "Basic Health Check" "$BACKEND_URL/health"

# Test 2: Detailed Health Check
test_endpoint "Detailed Health Check" "$BACKEND_URL/health/detailed"

# Test 3: Root Endpoint
test_endpoint "Root Endpoint" "$BACKEND_URL/"

# Test 4: Check Database Status (if jq available)
if command -v jq &> /dev/null; then
    echo -n "Testing Database Connection... "
    response=$(curl -s "$BACKEND_URL/health/detailed")
    db_status=$(echo "$response" | jq -r '.checks.database.status // "unknown"')
    
    if [ "$db_status" = "healthy" ]; then
        echo -e "${GREEN}✓ PASS${NC} (Database: $db_status)"
        ((TESTS_PASSED+=1))
    else
        echo -e "${RED}✗ FAIL${NC} (Database: $db_status)"
        ((TESTS_FAILED+=1))
    fi
fi

# Test 5: API Documentation (Swagger)
test_endpoint "API Docs" "$BACKEND_URL/docs" 200

# Summary
echo ""
echo "================================"
echo "Test Summary"
echo "================================"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Test file upload (requires authentication)"
    echo "2. Test pipeline execution"
    echo "3. Verify files in S3 bucket (Railway dashboard)"
    echo "4. Verify data in PostgreSQL (Railway dashboard)"
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Check the output above.${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check Railway logs: Railway dashboard → Backend service → Logs"
    echo "2. Verify DATABASE_URL is set correctly"
    echo "3. Verify S3 credentials are set (if using S3)"
    echo "4. Check service is running and healthy"
    exit 1
fi

