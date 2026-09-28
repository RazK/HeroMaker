#!/usr/bin/env bash
# Build Hero Moves and place it at frontend/public/play/, where the frontend's
# Vite build copies it into dist/ and nginx serves it at /play/.
#
# Why a pre-build step and not a Dockerfile stage: Railway builds each service
# with its Root Directory (frontend/) as the Docker context and has no setting
# in railway.toml to widen it, so the image cannot reach ../games. Every path
# that builds the frontend image runs this first: the deploy jobs in
# build-images.yml and promote-production.yml, the CI image build, and anyone
# running docker compose locally.
#
# The output is a build product: do not commit it. It is deliberately NOT
# gitignored, because `railway up` skips gitignored files and would drop the
# game from the upload.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GAME="$ROOT/games/hero-moves"
OUT="$ROOT/frontend/public/play"

cd "$GAME"
npm ci --no-audit --no-fund
npm run build
# Same pruning as the GitHub Pages publish (.github/workflows/pages.yml): the
# pose-tracker weights and the developer harness pages are not the game.
rm -rf dist/model dist/dancers.html dist/moveslab.html dist/posecheck.html dist/posegate.html

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R dist/. "$OUT/"
echo "Hero Moves bundled into ${OUT#$ROOT/} ($(du -sh "$OUT" | cut -f1))"
