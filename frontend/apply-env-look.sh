#!/bin/sh
# Make a non-production environment look unlike production (Raz: "keep the
# icon for the staging distinct from that of the production").
#
#   apply-env-look.sh <environment> <html root> <env-assets root>
#
# Run by start-nginx.sh when the container starts, with Railway's
# RAILWAY_ENVIRONMENT_NAME. Production is left exactly as built. Anything else
# (staging) gets:
#   - its own icon (env-assets/staging/app-icon.png, made by
#     scripts/make_staging_icon.py): installed app, browser tab, in-app logo
#   - its own installed-app name ("HeroMaker Staging" / "HM Staging")
#   - <html data-env="staging">: the STAGING tag beside the logo (toybox.css)
#   - its own tab title
# The code and the bundle are the same in both, so a promote carries nothing
# of this to production. Every replacement must land, or this exits 1: a
# staging that looks like production is the thing this exists to prevent.
# CI runs it on a real build (ci.yml frontend-build), so a change that breaks
# a pattern fails there, not on staging.
set -eu

env_name=$1
html=$2
assets=$3

if [ -z "$env_name" ] || [ "$env_name" = "production" ]; then
    echo "env look: production (as built)"
    exit 0
fi

fail() { echo "ERROR: env look for $env_name: $1" >&2; exit 1; }

cp "$assets/staging/app-icon.png" "$html/app-icon.png" || fail "no staging icon"

manifest="$html/manifest.webmanifest"
grep -q '"name":"HeroMaker"' "$manifest" || fail "manifest name not found"
grep -q '"short_name":"HeroMaker"' "$manifest" || fail "manifest short_name not found"
sed -i -e 's/"name":"HeroMaker"/"name":"HeroMaker Staging"/' \
       -e 's/"short_name":"HeroMaker"/"short_name":"HM Staging"/' "$manifest"

index="$html/index.html"
grep -q '<html lang="en">' "$index" || fail "<html lang=\"en\"> not found in index.html"
grep -q '<title>HeroMaker</title>' "$index" || fail "<title> not found in index.html"
sed -i -e "s|<html lang=\"en\">|<html lang=\"en\" data-env=\"$env_name\">|" \
       -e "s|<title>HeroMaker</title>|<title>HeroMaker · Staging</title>|" "$index"

echo "env look: $env_name (staging icon, name, label)"
