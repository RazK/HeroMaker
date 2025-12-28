#!/bin/bash
# Quick script to sync local creations to Railway
# Usage: ./scripts/sync-to-railway.sh

set -e

echo "============================================================"
echo "Sync Local Creations to Railway"
echo "============================================================"
echo ""

# Check prerequisites
if [ ! -f "./data/db/heromaker.db" ]; then
    echo "❌ ERROR: Local database not found at ./data/db/heromaker.db"
    exit 1
fi

if [ ! -d "./data/files" ]; then
    echo "❌ ERROR: Local files directory not found at ./data/files"
    exit 1
fi

echo "✓ Local database found"
echo "✓ Local files directory found"
echo ""

# Check for .env.railway file
RAILWAY_ENV=".env.railway"
if [ ! -f "$RAILWAY_ENV" ]; then
    echo "⚠️  Railway credentials file not found: $RAILWAY_ENV"
    echo ""
    echo "Creating from template..."
    if [ -f ".env.railway.example" ]; then
        cp .env.railway.example "$RAILWAY_ENV"
        echo "✓ Created $RAILWAY_ENV from template"
        echo ""
        echo "Please edit $RAILWAY_ENV and add your Railway credentials:"
        echo "  - PostgreSQL: Railway → PostgreSQL service → Connect"
        echo "  - S3: Railway → Storage Bucket → View credentials"
        echo ""
        read -p "Press Enter after you've filled in the credentials, or Ctrl+C to cancel..."
    else
        echo "❌ Template file .env.railway.example not found"
        echo ""
        echo "Please create $RAILWAY_ENV manually with:"
        echo "  DATABASE_URL=postgresql://user:pass@host:port/dbname"
        echo "  S3_BUCKET=your-bucket-name"
        echo "  S3_ENDPOINT=https://storage.railway.app"
        echo "  S3_ACCESS_KEY_ID=your-access-key-id"
        echo "  S3_SECRET_ACCESS_KEY=your-secret-access-key"
        echo "  S3_REGION=auto"
        echo ""
        read -p "Press Enter after creating the file, or Ctrl+C to cancel..."
    fi
else
    echo "✓ Found Railway credentials file: $RAILWAY_ENV"
    # Load it for this script (Python script will load it too)
    export $(grep -v '^#' "$RAILWAY_ENV" | xargs)
fi

# Check if Railway credentials are set
if [ -z "$DATABASE_URL" ] || [[ ! "$DATABASE_URL" =~ ^postgresql:// ]]; then
    echo "⚠️  WARNING: DATABASE_URL not set or not PostgreSQL"
    echo "Please check your $RAILWAY_ENV file"
    exit 1
fi

if [ -z "$S3_BUCKET" ]; then
    echo "⚠️  WARNING: S3_BUCKET not set"
    echo "Files will not be migrated to S3"
    echo "Please check your $RAILWAY_ENV file"
    exit 1
fi

echo ""
echo "Running sync script..."
echo ""

cd backend
# Use venv python if available, otherwise system python
if [ -f "../.venv/bin/python" ]; then
    ../.venv/bin/python scripts/sync_local_to_railway.py
else
    python scripts/sync_local_to_railway.py
fi

