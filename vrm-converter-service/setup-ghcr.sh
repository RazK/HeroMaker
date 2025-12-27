#!/bin/bash
# Setup script for GitHub Container Registry authentication

set -e

echo "GitHub Container Registry (GHCR) Setup"
echo "======================================="
echo ""
echo "This script will help you authenticate with GHCR to push/pull Docker images."
echo ""

# Check if already logged in
if docker info 2>/dev/null | grep -q "ghcr.io"; then
    echo "✓ Already logged in to GHCR"
    exit 0
fi

echo "Step 1: Create a GitHub Personal Access Token"
echo "----------------------------------------------"
echo "1. Go to: https://github.com/settings/tokens"
echo "2. Click 'Generate new token' → 'Generate new token (classic)'"
echo "3. Give it a name (e.g., 'GHCR Docker')"
echo "4. Select scope: 'write:packages' (and 'read:packages' if you want to read private packages)"
echo "5. Click 'Generate token'"
echo "6. Copy the token (you won't see it again!)"
echo ""
read -p "Press Enter when you have your token ready..."

echo ""
echo "Step 2: Login to GHCR"
echo "---------------------"
echo "Enter your GitHub username:"
read -r GITHUB_USERNAME

echo "Enter your GitHub Personal Access Token:"
read -rs GITHUB_TOKEN

echo ""
echo "Logging in to ghcr.io..."
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USERNAME" --password-stdin

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Successfully logged in to GHCR!"
    echo ""
    echo "Your images will be available at:"
    echo "  ghcr.io/razk/heromaker/vrm-converter:VERSION"
    echo ""
    echo "To push an image, run:"
    echo "  ./push-image.sh"
else
    echo ""
    echo "✗ Login failed. Please check your credentials and try again."
    exit 1
fi
