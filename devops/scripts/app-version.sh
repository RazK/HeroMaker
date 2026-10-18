#!/usr/bin/env bash
# Print the app version of a commit: "v<MAJOR>.<MINOR>.<PATCH> · <short sha>",
# e.g. "v1.0.12 · aadc82c" (semantic versioning).
#
#   MAJOR.MINOR = devops/VERSION, bumped by hand when a release deserves it
#                 (a new minor for a feature launch, a new major for a big change).
#   PATCH       = merges to main (first-parent commits) since devops/VERSION last
#                 changed. Automatic: every merge is a new patch, and bumping
#                 MAJOR.MINOR starts PATCH again at 0.
#   sha         = the exact commit, so the version names precisely what is deployed.
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
file=devops/VERSION
base=$(git show "$ref:$file" 2>/dev/null | tr -d '[:space:]')
if ! [[ "$base" =~ ^[0-9]+\.[0-9]+$ ]]; then
  echo "app-version.sh: $file at $ref must hold MAJOR.MINOR, got '$base'" >&2
  exit 1
fi
# The merge on main that last changed devops/VERSION; PATCH counts the merges after it.
since=$(git log -1 --first-parent --format=%H "$ref" -- "$file")
patch=$(git rev-list --count --first-parent "$since..$ref")
sha=$(git rev-parse --short=7 "$ref")
printf 'v%s.%s · %s\n' "$base" "$patch" "$sha"
