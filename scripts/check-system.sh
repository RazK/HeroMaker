#!/usr/bin/env bash
# Verify that a HeroMaker environment is usable.

set -euo pipefail

MODE="${1:-local}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"

BACKEND_PID=""
FRONTEND_PID=""
VRM_PID=""
TMP_DIR="$(mktemp -d)"

cleanup() {
    for pid in "$FRONTEND_PID" "$BACKEND_PID" "$VRM_PID"; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log() {
    printf '\n==> %s\n' "$1"
}

fail() {
    echo "ERROR: $*" >&2
    for log_file in "$TMP_DIR"/*.log; do
        if [ -f "$log_file" ]; then
            echo "--- $log_file ---" >&2
            sed -n '1,160p' "$log_file" >&2 || true
        fi
    done
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

wait_for_url() {
    local name="$1"
    local url="$2"
    local attempts="${3:-60}"

    for _ in $(seq 1 "$attempts"); do
        if curl -fsS "$url" >/dev/null 2>&1; then
            echo "$name is reachable: $url"
            return 0
        fi
        sleep 1
    done

    fail "$name did not become reachable: $url"
}

assert_json_field() {
    local url="$1"
    local field="$2"
    local expected="$3"

    "$PYTHON_BIN" - "$url" "$field" "$expected" <<'PY'
import json
import sys
import urllib.request

url, field, expected = sys.argv[1:]
with urllib.request.urlopen(url, timeout=10) as response:
    payload = json.loads(response.read().decode("utf-8"))

value = payload
for part in field.split("."):
    value = value[part]

if str(value) != expected:
    raise SystemExit(f"{url}: expected {field}={expected!r}, got {value!r}")

print(f"{url}: {field}={expected}")
PY
}

assert_body_contains() {
    local url="$1"
    local expected="$2"

    "$PYTHON_BIN" - "$url" "$expected" <<'PY'
import sys
import urllib.request

url, expected = sys.argv[1:]
with urllib.request.urlopen(url, timeout=10) as response:
    body = response.read().decode("utf-8", errors="replace")

if expected not in body:
    raise SystemExit(f"{url}: expected body to contain {expected!r}")

print(f"{url}: body contains {expected}")
PY
}

run_local() {
    require_command curl
    require_command npm

    [ -x "$ROOT_DIR/.venv/bin/python" ] || fail "Missing .venv. Run: bash scripts/setup-dev-env.sh"
    [ -d "$ROOT_DIR/frontend/node_modules" ] || fail "Missing frontend/node_modules. Run: bash scripts/setup-dev-env.sh"
    PYTHON_BIN="$ROOT_DIR/.venv/bin/python"

    mkdir -p "$ROOT_DIR/data/db" "$ROOT_DIR/data/files"

    log "Checking frontend production build"
    npm run build --prefix "$ROOT_DIR/frontend"

    if curl -fsS "http://localhost:8001/health" >/dev/null 2>&1; then
        echo "Using existing VRM converter on port 8001"
    else
        [ -x "/usr/bin/blender" ] || fail "Blender is required for local VRM converter checks. Install blender or start a VRM converter on port 8001."
        log "Starting local VRM converter"
        (
            cd "$ROOT_DIR/vrm-converter-service"
            BLENDER_PATH=/usr/bin/blender "$ROOT_DIR/.venv/bin/python" -m uvicorn app:app --host 127.0.0.1 --port 8001
        ) >"$TMP_DIR/vrm.log" 2>&1 &
        VRM_PID=$!
        wait_for_url "VRM converter" "http://localhost:8001/health"
    fi

    if curl -fsS "http://localhost:8000/health" >/dev/null 2>&1; then
        echo "Using existing backend on port 8000"
    else
        log "Starting local backend"
        (
            cd "$ROOT_DIR/backend"
            DEBUG=true \
            DATABASE_URL="sqlite:///$ROOT_DIR/data/db/heromaker.db" \
            FILES_ROOT="$ROOT_DIR/data/files" \
            VRM_CONVERTER_SERVICE_URL="http://localhost:8001" \
            "$ROOT_DIR/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
        ) >"$TMP_DIR/backend.log" 2>&1 &
        BACKEND_PID=$!
        wait_for_url "Backend" "http://localhost:8000/health"
    fi

    if curl -fsS "http://localhost:5173/" >/dev/null 2>&1; then
        echo "Using existing frontend dev server on port 5173"
    else
        log "Starting local frontend"
        (
            cd "$ROOT_DIR/frontend"
            npm run dev -- --host 127.0.0.1 --port 5173
        ) >"$TMP_DIR/frontend.log" 2>&1 &
        FRONTEND_PID=$!
        wait_for_url "Frontend" "http://localhost:5173/"
    fi

    log "Validating service contracts"
    assert_json_field "http://localhost:8000/health" "status" "healthy"
    assert_json_field "http://localhost:8000/health/detailed" "status" "healthy"
    assert_json_field "http://localhost:8000/health/detailed" "checks.database.status" "healthy"
    assert_json_field "http://localhost:8000/health/detailed" "checks.vrm_converter.status" "healthy"
    assert_json_field "http://localhost:8001/health" "status" "online"
    assert_json_field "http://localhost:8001/health" "blender" "ready"
    assert_json_field "http://localhost:8001/health" "script" "ready"
    assert_body_contains "http://localhost:5173/" "HeroMaker"

    log "System check passed in local mode"
}

run_production() {
    require_command curl
    require_command python3

    PYTHON_BIN="${PYTHON_BIN:-python3}"

    : "${BACKEND_URL:?Set BACKEND_URL for production checks}"
    : "${FRONTEND_URL:?Set FRONTEND_URL for production checks}"
    : "${VRM_CONVERTER_URL:?Set VRM_CONVERTER_URL for production checks}"

    BACKEND_URL="${BACKEND_URL%/}"
    FRONTEND_URL="${FRONTEND_URL%/}"
    VRM_CONVERTER_URL="${VRM_CONVERTER_URL%/}"

    log "Validating production service contracts"
    assert_json_field "$BACKEND_URL/health" "status" "healthy"
    assert_json_field "$BACKEND_URL/health/detailed" "status" "healthy"
    assert_json_field "$BACKEND_URL/health/detailed" "checks.database.status" "healthy"
    assert_json_field "$BACKEND_URL/health/detailed" "checks.vrm_converter.status" "healthy"
    assert_json_field "$VRM_CONVERTER_URL/health" "status" "online"
    assert_json_field "$VRM_CONVERTER_URL/health" "blender" "ready"
    assert_json_field "$VRM_CONVERTER_URL/health" "script" "ready"
    assert_body_contains "$FRONTEND_URL/" "HeroMaker"

    log "System check passed in production mode"
}

case "$MODE" in
    local)
        run_local
        ;;
    production)
        run_production
        ;;
    *)
        fail "Usage: $0 [local|production]"
        ;;
esac
