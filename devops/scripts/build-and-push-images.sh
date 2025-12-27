#!/bin/bash
# Build and push Docker images to registry
# Usage: ./scripts/build-and-push-images.sh [registry] [tag]
# Example: ./scripts/build-and-push-images.sh ghcr.io/razk/heromaker latest

set -e

REGISTRY=${1:-"ghcr.io/razk/heromaker"}
TAG=${2:-"latest"}

echo "🏗️  Building and pushing Docker images to ${REGISTRY} with tag ${TAG}"

# Build backend image
echo "📦 Building backend image..."
docker build -t ${REGISTRY}/backend:${TAG} -f backend/Dockerfile ./backend

# Build frontend image
echo "📦 Building frontend image..."
docker build -t ${REGISTRY}/frontend:${TAG} -f frontend/Dockerfile ./frontend

# Build VRM converter image
echo "📦 Building VRM converter image..."
docker build -t ${REGISTRY}/vrm-converter:${TAG} \
  --build-arg VERSION=${VRM_CONVERTER_VERSION:-1.0.0} \
  -f vrm-converter-service/Dockerfile .

# Push images
echo "🚀 Pushing images to registry..."
docker push ${REGISTRY}/backend:${TAG}
docker push ${REGISTRY}/frontend:${TAG}
docker push ${REGISTRY}/vrm-converter:${TAG}

echo "✅ All images built and pushed successfully!"
echo ""
echo "Images:"
echo "  - ${REGISTRY}/backend:${TAG}"
echo "  - ${REGISTRY}/frontend:${TAG}"
echo "  - ${REGISTRY}/vrm-converter:${TAG}"


