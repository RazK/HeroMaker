#!/usr/bin/env bash
# Print the app version of a commit: "v<N> · <short sha>", e.g. "v108 · aadc82c".
#
#   N   = commits on main's first-parent line up to that commit, i.e. one per
#         merged PR or direct push. Monotonic, never bumped by hand.
#   sha = the exact commit, so the version names precisely what is deployed.
#
# Computed from the commit, never from the CI run, so production shows the same
# version as the staging build it promoted.
#
# The deploy jobs write this into frontend/VERSION and backend/app/VERSION just
# before `railway up` (Railway builds from the uploaded directory, which has no
# .git). Without that file the frontend reads VITE_APP_VERSION and the backend
# APP_VERSION; with neither, both say "dev".
#
# Needs full history: actions/checkout with fetch-depth: 0.
set -euo pipefail
ref="${1:-HEAD}"
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "app-version.sh: shallow clone, the commit count would be wrong (use fetch-depth: 0)" >&2
  exit 1
fi
n=$(git rev-list --count --first-parent "$ref")
sha=$(git rev-parse --short=7 "$ref")
printf 'v%s · %s\n' "$n" "$sha"
