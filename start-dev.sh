#!/bin/bash
# Start all HeroMaker services for local development

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting HeroMaker services...${NC}"

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Kill any existing services
echo -e "${YELLOW}Stopping existing services...${NC}"
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
pkill -f "uvicorn app:app.*8001" 2>/dev/null || true
docker stop vrm-converter-service 2>/dev/null || true
sleep 2

# Start Backend
echo -e "${GREEN}Starting Backend (port 8000)...${NC}"
cd "$PROJECT_ROOT/backend"
"$PROJECT_ROOT/.venv/bin/python" -m uvicorn app.main:app --reload --port 8000 > /tmp/heromaker-backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait for backend to be ready
sleep 3
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend is running${NC}"
else
    echo -e "${RED}✗ Backend failed to start${NC}"
    tail -20 /tmp/heromaker-backend.log
    exit 1
fi

# Start Frontend
echo -e "${GREEN}Starting Frontend (port 5173)...${NC}"
cd "$PROJECT_ROOT/frontend"
npm run dev > /tmp/heromaker-frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

# Wait for frontend to be ready
sleep 5
if curl -s http://localhost:5173/ > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend is running${NC}"
else
    echo -e "${YELLOW}⚠ Frontend may still be starting...${NC}"
fi

# Start VRM Converter via Docker
echo -e "${GREEN}Starting VRM Converter via Docker (port 8001)...${NC}"
cd "$PROJECT_ROOT"

# Stop existing container if running
docker stop vrm-converter-service 2>/dev/null || true
docker rm vrm-converter-service 2>/dev/null || true

# Build and start VRM converter container
docker-compose up -d vrm-converter > /tmp/heromaker-vrm.log 2>&1

# Wait for VRM converter to be ready
echo "Waiting for VRM converter to start..."
for i in {1..30}; do
    if curl -s http://localhost:8001/health > /dev/null 2>&1; then
        HEALTH=$(curl -s http://localhost:8001/health)
        if echo "$HEALTH" | grep -q "ready"; then
            echo -e "${GREEN}✓ VRM Converter is running with Blender${NC}"
            break
        fi
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo -e "${YELLOW}⚠ VRM Converter may still be starting...${NC}"
        echo "Check logs: docker logs vrm-converter-service"
    fi
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}All services started!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Backend:     http://localhost:8000"
echo -e "Frontend:    http://localhost:5173"
echo -e "VRM Converter: http://localhost:8001"
echo ""
echo -e "${YELLOW}Logs:${NC}"
echo -e "  Backend:     tail -f /tmp/heromaker-backend.log"
echo -e "  Frontend:    tail -f /tmp/heromaker-frontend.log"
echo -e "  VRM Converter: tail -f /tmp/heromaker-vrm.log"
echo ""
echo -e "${YELLOW}To stop all services:${NC}"
echo -e "  pkill -f 'uvicorn app.main:app|vite' && docker stop vrm-converter-service"
echo ""

# Save PIDs to file for easy cleanup
echo "$BACKEND_PID" > /tmp/heromaker-pids.txt
echo "$FRONTEND_PID" >> /tmp/heromaker-pids.txt
echo "$VRM_PID" >> /tmp/heromaker-pids.txt

