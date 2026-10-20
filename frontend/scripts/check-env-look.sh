#!/bin/sh
# Staging must never look like production (apply-env-look.sh). Run after
# `npm run build`, from frontend/; CI does (ci.yml frontend-build).
#
# Fails when:
#   - app-icon.png changed but staging's icon was not remade from it
#     (.venv/bin/python scripts/make_staging_icon.py)
#   - staging's icon is the same picture as production's
#   - apply-env-look.sh touches production's build at all
#   - a pattern it replaces is gone from the build, so staging would fail to
#     start (it exits 1 rather than look like production)
set -eu

fail() { echo "::error::env look: $1" >&2; exit 1; }

want=$(cut -d' ' -f1 env-assets/staging/SOURCE.sha256)
have=$(sha256sum public/app-icon.png | cut -d' ' -f1)
[ "$want" = "$have" ] || fail "public/app-icon.png changed: run .venv/bin/python scripts/make_staging_icon.py and commit frontend/env-assets/staging"
cmp -s env-assets/staging/app-icon.png public/app-icon.png && fail "staging's icon is production's"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cp -r dist "$tmp/production"
./apply-env-look.sh production "$tmp/production" env-assets
diff -r dist "$tmp/production" >/dev/null || fail "apply-env-look.sh changed production's build"

cp -r dist "$tmp/staging"
./apply-env-look.sh staging "$tmp/staging" env-assets
grep -q 'data-env="staging"' "$tmp/staging/index.html" || fail "staging index.html has no data-env"
grep -q '"short_name":"HM Staging"' "$tmp/staging/manifest.webmanifest" || fail "staging manifest keeps production's name"
grep -q '"src":"app-icon-staging.png"' "$tmp/staging/manifest.webmanifest" || fail "staging's installed app keeps production's icon"
grep -q 'href="/app-icon-staging.png"' "$tmp/staging/index.html" || fail "staging's tab keeps production's icon"
cmp -s "$tmp/staging/app-icon-staging.png" dist/app-icon.png && fail "staging's icon is production's"
cmp -s "$tmp/staging/app-icon.png" dist/app-icon.png || fail "staging changed the in-app logo picture"


echo "env look: staging differs from production, production untouched"
