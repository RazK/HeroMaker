#!/bin/bash
# Helper script to run GLB to VRM conversion in Blender container

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null && ! command -v docker &> /dev/null; then
    echo "Error: Docker or docker-compose not found"
    exit 1
fi

# Use docker compose (newer) or docker-compose (older)
if command -v docker &> /dev/null && docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    echo "Error: docker compose not available"
    exit 1
fi

# Parse arguments
if [ $# -lt 2 ]; then
    echo "Usage: $0 <input.glb> <output.vrm>"
    echo "Example: $0 assets/permanent/debug-user-uuid/0e38e287-b8b8-49aa-80bb-65a8ecebfc10/rigged.glb assets/permanent/debug-user-uuid/0e38e287-b8b8-49aa-80bb-65a8ecebfc10/avatar.vrm"
    exit 1
fi

INPUT_GLB="$1"
OUTPUT_VRM="$2"

# Get project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Convert input to absolute path if relative
if [[ "$INPUT_GLB" != /* ]]; then
    if [ -f "$INPUT_GLB" ]; then
        INPUT_GLB="$(cd "$(dirname "$INPUT_GLB")" && pwd)/$(basename "$INPUT_GLB")"
    else
        INPUT_GLB="$PROJECT_ROOT/$INPUT_GLB"
    fi
fi

# Convert output to absolute path if relative
if [[ "$OUTPUT_VRM" != /* ]]; then
    OUTPUT_VRM="$PROJECT_ROOT/$OUTPUT_VRM"
fi

# Ensure input file exists
if [ ! -f "$INPUT_GLB" ]; then
    echo -e "${RED}Error: Input GLB file not found: $INPUT_GLB${NC}"
    exit 1
fi

# Convert to container paths
# Remove project root prefix and ensure it's under assets/
INPUT_RELATIVE="${INPUT_GLB#$PROJECT_ROOT/}"
OUTPUT_RELATIVE="${OUTPUT_VRM#$PROJECT_ROOT/}"

# If paths don't start with assets/, assume they're relative to assets/
if [[ "$INPUT_RELATIVE" != assets/* ]]; then
    CONTAINER_INPUT="/workspace/assets/$INPUT_RELATIVE"
else
    CONTAINER_INPUT="/workspace/${INPUT_RELATIVE}"
fi

if [[ "$OUTPUT_RELATIVE" != assets/* ]]; then
    CONTAINER_OUTPUT="/workspace/assets/$OUTPUT_RELATIVE"
else
    CONTAINER_OUTPUT="/workspace/${OUTPUT_RELATIVE}"
fi

echo -e "${GREEN}Running VRM conversion in Blender container...${NC}"
echo "Input:  $INPUT_GLB"
echo "Output: $OUTPUT_VRM"
echo "Container Input:  $CONTAINER_INPUT"
echo "Container Output: $CONTAINER_OUTPUT"
echo ""

# Ensure container is running
cd "$PROJECT_ROOT"
$DOCKER_COMPOSE up -d blender

# Wait a moment for container to be ready
sleep 2

# Install VRM addon if not already installed
echo -e "${YELLOW}Checking VRM addon installation...${NC}"
$DOCKER_COMPOSE exec -T blender bash -c "
    BLENDER_VERSION=\$(/blender/blender --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo '4.1') && \
    ADDON_DIR=\"/root/.config/blender/\${BLENDER_VERSION}/scripts/addons/VRM_Addon_for_Blender\" && \
    if [ ! -d \"\$ADDON_DIR\" ]; then \
        echo 'Installing VRM addon...' && \
        mkdir -p \$(dirname \"\$ADDON_DIR\") && \
        unzip -q /workspace/downloads/add-on-vrm-v3.17.2.zip -d /tmp/vrm-addon && \
        ADDON_SRC=\$(find /tmp/vrm-addon -type d -name '*VRM*' -o -name '*vrm*' | head -1) && \
        if [ -n \"\$ADDON_SRC\" ]; then \
            cp -r \"\$ADDON_SRC\" \"\$ADDON_DIR\" && \
            echo 'VRM addon installed successfully'; \
        else \
            echo 'Warning: Could not find VRM addon in zip file'; \
        fi && \
        rm -rf /tmp/vrm-addon; \
    else \
        echo 'VRM addon already installed'; \
    fi
"

# Run conversion
echo -e "${GREEN}Starting conversion...${NC}"
$DOCKER_COMPOSE exec -T blender \
    /blender/blender \
    --background \
    --python /workspace/scripts/convert_glb_to_vrm.py \
    -- \
    "$CONTAINER_INPUT" \
    "$CONTAINER_OUTPUT"

# Check if output was created
if [ -f "$OUTPUT_VRM" ]; then
    echo -e "${GREEN}✓ Conversion successful!${NC}"
    echo "Output file: $OUTPUT_VRM"
    ls -lh "$OUTPUT_VRM"
else
    echo -e "${RED}✗ Warning: Output file not found. Check container logs above.${NC}"
    exit 1
fi




