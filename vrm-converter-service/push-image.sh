#!/bin/bash
# Push Docker image to GitHub Container Registry (GHCR)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="${SCRIPT_DIR}/VERSION"
VERSION=$(cat "${VERSION_FILE}" | tr -d '[:space:]')
IMAGE_NAME="vrm-converter"
FULL_IMAGE_NAME="${IMAGE_NAME}:${VERSION}"

# Get GitHub repository info
# Assumes repo is in format: owner/repo-name
# You can override with GITHUB_REPO environment variable
GITHUB_REPO="${GITHUB_REPO:-$(git remote get-url origin 2>/dev/null | sed -E 's/.*github.com[:/]([^/]+)\/([^/]+)(\.git)?$/\1\/\2/' | sed 's/\.git$//' | tr '[:upper:]' '[:lower:]' || echo '')}"

if [ -z "${GITHUB_REPO}" ]; then
    echo "Error: Could not determine GitHub repository."
    echo "Please set GITHUB_REPO environment variable (e.g., 'owner/repo-name')"
    exit 1
fi

# GHCR requires lowercase image names
GHCR_IMAGE="ghcr.io/${GITHUB_REPO}/${IMAGE_NAME}"
GHCR_IMAGE_VERSIONED="${GHCR_IMAGE}:${VERSION}"
GHCR_IMAGE_LATEST="${GHCR_IMAGE}:latest"

echo "Pushing ${FULL_IMAGE_NAME} to ${GHCR_IMAGE_VERSIONED}..."

# Tag the image for GHCR
docker tag "${FULL_IMAGE_NAME}" "${GHCR_IMAGE_VERSIONED}"
docker tag "${FULL_IMAGE_NAME}" "${GHCR_IMAGE_LATEST}"

# Check if user is logged in to GHCR by testing a pull (doesn't require auth for public repos)
# or check config file
if ! grep -q "ghcr.io" ~/.docker/config.json 2>/dev/null; then
    echo ""
    echo "You need to authenticate with GHCR first."
    echo ""
    echo "Option 1: Use setup script (recommended):"
    echo "  ./setup-ghcr.sh"
    echo ""
    echo "Option 2: Manual login:"
    echo "  echo \$GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin"
    echo ""
    echo "Create a GitHub Personal Access Token (PAT) with 'write:packages' permission at:"
    echo "  https://github.com/settings/tokens"
    echo ""
    read -p "Press Enter to continue (will attempt push - may fail if not authenticated), or Ctrl+C to cancel..."
fi

# Push both versioned and latest tags
docker push "${GHCR_IMAGE_VERSIONED}"
docker push "${GHCR_IMAGE_LATEST}"

echo ""
echo "Image pushed successfully!"
echo "  Versioned: ${GHCR_IMAGE_VERSIONED}"
echo "  Latest: ${GHCR_IMAGE_LATEST}"
echo ""
echo "To pull the image:"
echo "  docker pull ${GHCR_IMAGE_VERSIONED}"
echo ""
echo "To use in docker-compose, update the image:"
echo "  image: ${GHCR_IMAGE_VERSIONED}"
