#!/bin/bash
# Pull Docker image from GitHub Container Registry (GHCR)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="${SCRIPT_DIR}/VERSION"
VERSION=$(cat "${VERSION_FILE}" | tr -d '[:space:]')
IMAGE_NAME="vrm-converter-service"

# Get GitHub repository info
# Convert to lowercase for GHCR compatibility
GITHUB_REPO="${GITHUB_REPO:-$(git remote get-url origin 2>/dev/null | sed -E 's/.*github.com[:/]([^/]+)\/([^/]+)(\.git)?$/\1\/\2/' | sed 's/\.git$//' | tr '[:upper:]' '[:lower:]' || echo '')}"

if [ -z "${GITHUB_REPO}" ]; then
    echo "Error: Could not determine GitHub repository."
    echo "Please set GITHUB_REPO environment variable (e.g., 'owner/repo-name')"
    exit 1
fi

# GHCR requires lowercase image names
GHCR_IMAGE="ghcr.io/${GITHUB_REPO}/${IMAGE_NAME}"
GHCR_IMAGE_VERSIONED="${GHCR_IMAGE}:${VERSION}"

echo "Pulling ${GHCR_IMAGE_VERSIONED}..."

docker pull "${GHCR_IMAGE_VERSIONED}"

# Tag as local image
docker tag "${GHCR_IMAGE_VERSIONED}" "${IMAGE_NAME}:${VERSION}"
docker tag "${GHCR_IMAGE_VERSIONED}" "${IMAGE_NAME}:latest"

echo "Image pulled and tagged as ${IMAGE_NAME}:${VERSION} and ${IMAGE_NAME}:latest"
