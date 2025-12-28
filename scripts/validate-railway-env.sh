#!/bin/bash
# Validate .env.railway file

ENV_FILE=".env.railway"

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ $ENV_FILE not found"
    exit 1
fi

echo "Validating $ENV_FILE..."
echo ""

# Load the file
set -a
source "$ENV_FILE"
set +a

ERRORS=0
WARNINGS=0

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL is missing"
    ERRORS=$((ERRORS + 1))
elif [[ "$DATABASE_URL" == *"user:password@host:port/database"* ]] || [[ "$DATABASE_URL" == *"postgresql://user:password"* ]]; then
    echo "⚠️  DATABASE_URL still has placeholder values"
    WARNINGS=$((WARNINGS + 1))
elif [[ ! "$DATABASE_URL" =~ ^postgresql:// ]]; then
    echo "❌ DATABASE_URL must start with 'postgresql://'"
    ERRORS=$((ERRORS + 1))
else
    # Extract parts for validation
    if [[ "$DATABASE_URL" =~ postgresql://([^:]+):([^@]+)@([^:]+):([^/]+)/(.+) ]]; then
        echo "✓ DATABASE_URL format looks correct"
        echo "  Host: ${BASH_REMATCH[3]}"
        echo "  Port: ${BASH_REMATCH[4]}"
        echo "  Database: ${BASH_REMATCH[5]}"
    else
        echo "⚠️  DATABASE_URL format may be incorrect"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

echo ""

# Check S3 variables
if [ -z "$S3_BUCKET" ]; then
    echo "❌ S3_BUCKET is missing"
    ERRORS=$((ERRORS + 1))
elif [[ "$S3_BUCKET" == "your-bucket-name" ]]; then
    echo "⚠️  S3_BUCKET still has placeholder value"
    WARNINGS=$((WARNINGS + 1))
else
    echo "✓ S3_BUCKET is set: $S3_BUCKET"
fi

if [ -z "$S3_ENDPOINT" ]; then
    echo "⚠️  S3_ENDPOINT is missing (will use default: https://storage.railway.app)"
    WARNINGS=$((WARNINGS + 1))
elif [[ "$S3_ENDPOINT" != "https://storage.railway.app" ]]; then
    echo "⚠️  S3_ENDPOINT is not the Railway default: $S3_ENDPOINT"
    WARNINGS=$((WARNINGS + 1))
else
    echo "✓ S3_ENDPOINT is correct: $S3_ENDPOINT"
fi

if [ -z "$S3_ACCESS_KEY_ID" ]; then
    echo "❌ S3_ACCESS_KEY_ID is missing"
    ERRORS=$((ERRORS + 1))
elif [[ "$S3_ACCESS_KEY_ID" == "your-access-key-id" ]]; then
    echo "⚠️  S3_ACCESS_KEY_ID still has placeholder value"
    WARNINGS=$((WARNINGS + 1))
elif [[ "$S3_ACCESS_KEY_ID" =~ ^tid_ ]]; then
    echo "✓ S3_ACCESS_KEY_ID format looks correct (Railway token ID)"
else
    echo "✓ S3_ACCESS_KEY_ID is set (format may vary)"
fi

if [ -z "$S3_SECRET_ACCESS_KEY" ]; then
    echo "❌ S3_SECRET_ACCESS_KEY is missing"
    ERRORS=$((ERRORS + 1))
elif [[ "$S3_SECRET_ACCESS_KEY" == "your-secret-access-key" ]]; then
    echo "⚠️  S3_SECRET_ACCESS_KEY still has placeholder value"
    WARNINGS=$((WARNINGS + 1))
elif [[ "$S3_SECRET_ACCESS_KEY" =~ ^tsec_ ]]; then
    echo "✓ S3_SECRET_ACCESS_KEY format looks correct (Railway token secret)"
else
    echo "✓ S3_SECRET_ACCESS_KEY is set (format may vary)"
fi

if [ -z "$S3_REGION" ]; then
    echo "⚠️  S3_REGION is missing (will use default: auto)"
    WARNINGS=$((WARNINGS + 1))
elif [[ "$S3_REGION" == "auto" ]]; then
    echo "✓ S3_REGION is set to 'auto' (Railway default)"
else
    echo "✓ S3_REGION is set: $S3_REGION"
fi

echo ""
echo "============================================================"
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "✅ All variables are valid!"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo "⚠️  Validation passed with $WARNINGS warning(s)"
    echo "   Some variables may still have placeholder values"
    exit 0
else
    echo "❌ Validation failed with $ERRORS error(s) and $WARNINGS warning(s)"
    exit 1
fi
