#!/bin/bash
# Deploy main branch to Railway deployment branch
# Usage: ./scripts/deploy-to-railway.sh

set -e

echo "🚀 Deploying main to Railway deployment branch..."

# Make sure we're on main and up to date
git checkout main
git pull origin main

# Checkout railway-deployment branch
git checkout railway-deployment

# Merge all changes from main (this will include everything)
echo "📦 Merging all changes from main..."
git merge main --no-edit

# Push to railway-deployment
echo "⬆️  Pushing to railway-deployment branch..."
git push origin railway-deployment

# Switch back to main
git checkout main

echo "✅ Deployment complete! Railway will deploy from railway-deployment branch."
echo ""
echo "📋 Summary:"
echo "   - All changes from main have been merged to railway-deployment"
echo "   - Railway will automatically build and deploy"

