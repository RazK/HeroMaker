#!/usr/bin/env bash
# Go-live check: is this deployment selling through Grow, and only through Grow?
#
#   devops/scripts/golive-check.sh <site-url> staging|production [expected-short-sha]
#
# Read-only. Sends no money, opens no checkout, writes nothing. Every probe is
# an unauthenticated request whose answer says which payment path is armed:
#
#   Grow notify   POST /api/payments/grow/notify/x/y   401 = grow sells here (the
#                                                      fake order is refused);
#                                                      404 = grow is not selected
#   sandbox       POST /api/payments/grow/callback     must be 404 (grow_sandbox off)
#   stand-in      POST .../grow-standin/.../createPaymentProcess
#                                                      production: must be 404
#   Lemon Squeezy POST /api/payments/webhook           must be 401 (believes nothing)
#
# Step 6 of docs/launch/GO_LIVE.md runs it against production; the runbook's
# dry run runs it against staging. Exit code = number of failed checks.
set -uo pipefail

BASE="${1:?usage: golive-check.sh <site-url> staging|production [expected-short-sha]}"
BASE="${BASE%/}"
ENV="${2:?say staging or production}"
WANT_SHA="${3:-}"
fails=0

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fails=$((fails + 1)); }
code() { curl -s -o /dev/null -m 20 -w '%{http_code}' -X POST "$BASE$1"; }

echo "Go-live check: $BASE ($ENV)"

version=$(curl -s -m 20 "$BASE/api/version" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
if [ -z "$version" ]; then bad "GET /api/version answered nothing"
elif [ -n "$WANT_SHA" ] && [[ "$version" != *"$WANT_SHA"* ]]; then bad "running $version, want $WANT_SHA"
else ok "running $version"; fi

packs=$(curl -s -m 20 "$BASE/api/v1/packs")
if grep -q '"slug":"single"' <<<"$packs" && grep -q '"price_display":"₪10"' <<<"$packs" \
   && grep -q '"slug":"family"' <<<"$packs" && grep -q '"price_display":"₪39"' <<<"$packs"; then
  ok "on sale: One hero ₪10, Family ₪39"
else
  bad "packs are not One hero ₪10 + Family ₪39: ${packs:0:160}"
fi

c=$(code /api/payments/grow/notify/golive-check/not-a-token)
[ "$c" = 401 ] && ok "Grow notify armed (an unproven notify gets 401)" || bad "Grow notify answered $c, want 401 (404 = PAYMENTS_PROVIDER is not grow, or a GROW_* key is missing)"

c=$(code /api/payments/grow/callback)
[ "$c" = 404 ] && ok "grow_sandbox off (404)" || bad "grow_sandbox callback answered $c, want 404"

c=$(code /api/payments/grow-standin/api/light/server/1.0/createPaymentProcess)
if [ "$ENV" = production ]; then
  [ "$c" = 404 ] && ok "Grow stand-in off (404)" || bad "Grow stand-in answered $c on production, want 404"
else
  [ "$c" != 404 ] && ok "Grow stand-in on (staging: $c)" || echo "  ----  Grow stand-in off on staging (fine once staging uses Grow's own sandbox)"
fi

c=$(code /api/payments/webhook)
[ "$c" = 401 ] && ok "Lemon Squeezy webhook believes nothing (401)" || bad "Lemon Squeezy webhook answered $c, want 401"

title=$(curl -s -m 20 "$BASE/" | sed -n 's:.*<title>\([^<]*\)</title>.*:\1:p' | head -1)
if [ "$ENV" = production ]; then
  [[ "$title" != *Staging* ]] && ok "looks like production (\"$title\")" || bad "production shows the STAGING look (\"$title\")"
else
  [[ "$title" == *Staging* ]] && ok "looks like staging (\"$title\")" || bad "staging does not show the STAGING look (\"$title\")"
fi

echo
[ "$fails" -eq 0 ] && echo "ALL PASS" || echo "$fails FAILED"
exit "$fails"
