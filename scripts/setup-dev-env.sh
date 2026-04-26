#!/usr/bin/env bash
# Idempotently install local development dependencies for HeroMaker.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Setting up HeroMaker development dependencies..."

if [ ! -x ".venv/bin/python" ]; then
    echo "Creating Python virtual environment at .venv"
    python3 -m venv .venv
fi

if [ -f "backend/requirements.txt" ]; then
    echo "Installing backend Python dependencies"
    .venv/bin/pip install -r backend/requirements.txt
fi

if [ -f "frontend/package-lock.json" ]; then
    echo "Installing frontend dependencies with npm ci"
    npm ci --prefix frontend
elif [ -f "frontend/package.json" ]; then
    echo "Installing frontend dependencies with npm install"
    npm install --prefix frontend
fi

mkdir -p data/db data/files

if [ ! -f ".env" ]; then
    echo "Creating local .env"
    cat > .env <<EOF
DEBUG=true
DATABASE_URL=sqlite:///${ROOT_DIR}/data/db/heromaker.db
FILES_ROOT=${ROOT_DIR}/data/files
VRM_CONVERTER_SERVICE_URL=http://localhost:8001
VRM_CONVERTER_TIMEOUT=300
VITE_API_BASE_URL=
VITE_API_PROXY_TARGET=http://127.0.0.1:8000
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_MODEL_FALLBACK=
EOF
fi

echo "Development dependency setup complete."
