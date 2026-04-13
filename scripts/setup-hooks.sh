#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

git config core.hooksPath .githooks
echo "[setup-hooks] core.hooksPath=$(git config --get core.hooksPath)"
echo "[setup-hooks] Git hooks enabled for auto-deploy on commit"
