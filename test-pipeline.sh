#!/bin/bash
# Quick test script for pipeline refactor

set -e

BASE_URL="http://localhost:8000"
API_BASE="${BASE_URL}/api"

echo "=========================================="
echo "Pipeline Refactor Test Suite"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Health check
echo -e "${YELLOW}Test 1: Health Check${NC}"
if curl -s "${BASE_URL}/health" | grep -q "ok"; then
    echo -e "${GREEN}✓ Backend is healthy${NC}"
else
    echo -e "${RED}✗ Backend health check failed${NC}"
    exit 1
fi
echo ""

# Test 2: Cost endpoint - full pipeline
echo -e "${YELLOW}Test 2: Cost Calculation - Full Pipeline${NC}"
COST=$(curl -s "${API_BASE}/creations/cost" | python3 -c "import sys, json; print(json.load(sys.stdin)['cost'])")
if [ "$COST" == "10" ]; then
    echo -e "${GREEN}✓ Full pipeline cost is 10 credits${NC}"
else
    echo -e "${RED}✗ Expected 10 credits, got ${COST}${NC}"
fi
echo ""

# Test 3: Cost endpoint - specific steps
echo -e "${YELLOW}Test 3: Cost Calculation - Specific Steps${NC}"
COST=$(curl -s "${API_BASE}/creations/cost?steps=openai_render,meshy_3d" | python3 -c "import sys, json; print(json.load(sys.stdin)['cost'])")
if [ "$COST" == "7" ]; then
    echo -e "${GREEN}✓ openai_render + meshy_3d cost is 7 credits${NC}"
else
    echo -e "${RED}✗ Expected 7 credits, got ${COST}${NC}"
fi
echo ""

# Test 4: Cost endpoint - single step
echo -e "${YELLOW}Test 4: Cost Calculation - Single Step${NC}"
COST=$(curl -s "${API_BASE}/creations/cost?steps=image_processing" | python3 -c "import sys, json; print(json.load(sys.stdin)['cost'])")
if [ "$COST" == "0" ]; then
    echo -e "${GREEN}✓ image_processing is free (0 credits)${NC}"
else
    echo -e "${RED}✗ Expected 0 credits, got ${COST}${NC}"
fi
echo ""

# Test 5: Verify venv
echo -e "${YELLOW}Test 5: Verify Venv Setup${NC}"
if [ -f ".venv/bin/python" ]; then
    echo -e "${GREEN}✓ .venv/bin/python exists${NC}"
else
    echo -e "${RED}✗ .venv/bin/python not found${NC}"
fi
echo ""

echo -e "${GREEN}=========================================="
echo "Basic tests completed!"
echo "==========================================${NC}"
echo ""
echo "Note: Full API tests (auth, create, run) require:"
echo "  1. Authentication token"
echo "  2. Image file for upload"
echo "  3. Active backend with database"
echo ""
echo "Use test-pipeline.http for comprehensive API testing"
