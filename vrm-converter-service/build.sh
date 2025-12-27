#!/bin/bash
# Build script for VRM Converter Service

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="${SCRIPT_DIR}/VERSION"
VERSION=$(cat "${VERSION_FILE}" | tr -d '[:space:]')
IMAGE_NAME="vrm-converter"
FULL_IMAGE_NAME="${IMAGE_NAME}:${VERSION}"
TAR_FILE="${SCRIPT_DIR}/${IMAGE_NAME}-${VERSION}.tar"

echo "Building ${FULL_IMAGE_NAME}..."

# Build from project root to access downloads folder
cd "${SCRIPT_DIR}/.."
docker build \
    --build-arg VERSION="${VERSION}" \
    -t "${FULL_IMAGE_NAME}" \
    -t "${IMAGE_NAME}:latest" \
    -f vrm-converter-service/Dockerfile \
    .

echo "Build complete!"
echo ""
echo "To save the image:"
echo "  docker save ${FULL_IMAGE_NAME} -o ${TAR_FILE}"
echo ""
echo "To load a saved image:"
echo "  docker load -i ${TAR_FILE}"
echo ""
echo "To tag and push to a registry:"
echo "  docker tag ${FULL_IMAGE_NAME} your-registry/${FULL_IMAGE_NAME}"
echo "  docker push your-registry/${FULL_IMAGE_NAME}"
