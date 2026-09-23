#!/usr/bin/env bash
# Manage HeroMaker's Railway environment variables from the layered files in
# devops/railway/env/.
#
#   ./devops/scripts/railway-env.sh resolve -e staging
#   ./devops/scripts/railway-env.sh diff    -e production
#   ./devops/scripts/railway-env.sh sync    -e staging -s backend
#   ./devops/scripts/railway-env.sh check
#   ./devops/scripts/railway-env.sh factor --write
#
# Run with --help for the full reference.

set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "${script_dir}/../.." && pwd)

# Project rule: prefer the project venv, but this tool is stdlib-only so it
# still works in CI and on a fresh clone.
if [ -x "${repo_root}/.venv/bin/python" ]; then
    python_bin="${repo_root}/.venv/bin/python"
elif command -v python3 &>/dev/null; then
    python_bin="python3"
else
    echo "❌ No Python found. Install python3 or create the project venv." >&2
    exit 1
fi

exec "$python_bin" "${script_dir}/railway_env.py" "$@"
