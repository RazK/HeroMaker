#!/usr/bin/env bash
# Push environment variables to Railway.
#
# Thin wrapper kept for muscle memory and for the docs that reference it.
# The variables themselves live in devops/railway/env/ — see the README there.
#
#   ./devops/scripts/sync-railway-env.sh                      # production, all services
#   ./devops/scripts/sync-railway-env.sh -e staging           # staging, all services
#   ./devops/scripts/sync-railway-env.sh backend              # production, one service
#   ./devops/scripts/sync-railway-env.sh -e staging backend   # both
#
# Anything railway-env.sh accepts (-n/--dry-run, -y, --skip-deploys) works here.

set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

args=()
expects_value=false
for arg in "$@"; do
    if [ "$expects_value" = true ]; then
        args+=("$arg")
        expects_value=false
        continue
    fi
    case "$arg" in
        -s|--service|-e|--environment)
            args+=("$arg")
            expects_value=true
            ;;
        # Legacy positional form: `sync-railway-env.sh backend`
        backend|frontend|vrm-converter)
            args+=(--service "$arg")
            ;;
        # Legacy `all` meant every service, which is already the default.
        all)
            ;;
        *)
            args+=("$arg")
            ;;
    esac
done

exec "${script_dir}/railway-env.sh" sync ${args[@]+"${args[@]}"}
