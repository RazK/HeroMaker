#!/usr/bin/env bash
# Install HeroMaker's default seed database and gallery files.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED_DIR="$ROOT_DIR/seed-data/default"
DB_PATH="$ROOT_DIR/data/db/heromaker.db"
FILES_ROOT="$ROOT_DIR/data/files"
FORCE=false

if [ "${1:-}" = "--force" ]; then
    FORCE=true
fi

if [ ! -f "$SEED_DIR/heromaker_seed.sql" ]; then
    echo "ERROR: Seed SQL not found at $SEED_DIR/heromaker_seed.sql" >&2
    exit 1
fi

if [ -f "$DB_PATH" ] && [ "$FORCE" != "true" ]; then
    echo "Seed database already exists at $DB_PATH"
    echo "Use --force to replace it."
    exit 0
fi

mkdir -p "$(dirname "$DB_PATH")" "$FILES_ROOT"

"$ROOT_DIR/.venv/bin/python" - "$SEED_DIR" "$DB_PATH" "$FILES_ROOT" <<'PY'
import shutil
import sqlite3
import sys
from pathlib import Path

seed_dir = Path(sys.argv[1])
db_path = Path(sys.argv[2])
files_root = Path(sys.argv[3])
sql_path = seed_dir / "heromaker_seed.sql"
seed_files = seed_dir / "files"

if db_path.exists():
    db_path.unlink()

connection = sqlite3.connect(db_path)
try:
    connection.executescript(sql_path.read_text(encoding="utf-8"))
    connection.commit()
finally:
    connection.close()

if seed_files.exists():
    shutil.copytree(seed_files, files_root, dirs_exist_ok=True)

print(f"Installed seed database: {db_path}")
print(f"Installed seed files: {files_root}")
PY
