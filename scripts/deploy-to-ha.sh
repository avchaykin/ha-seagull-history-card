#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HA_HOST="${HA_HOST:-192.168.1.184}"
HA_USER="${HA_USER:-avc}"
HA_KEY="${HA_KEY:-$HOME/.ssh/openclaw-ha}"
HA_TARGET_DIR="${HA_TARGET_DIR:-/config/www}"

FILES=(
  "seagull-history-card.js"
  "seagull-history-card-loader.js"
)

if [[ ! -f "$HA_KEY" ]]; then
  echo "[deploy-to-ha] ssh key not found: $HA_KEY" >&2
  exit 1
fi

for file in "${FILES[@]}"; do
  SRC_FILE="$ROOT_DIR/$file"
  TARGET_FILE="$HA_TARGET_DIR/$file"

  if [[ ! -f "$SRC_FILE" ]]; then
    echo "[deploy-to-ha] source file not found: $SRC_FILE" >&2
    exit 1
  fi

  echo "[deploy-to-ha] Deploying $SRC_FILE -> ${HA_USER}@${HA_HOST}:$TARGET_FILE"

  cat "$SRC_FILE" | ssh \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=accept-new \
    -i "$HA_KEY" \
    "${HA_USER}@${HA_HOST}" \
    "sudo tee '$TARGET_FILE' >/dev/null && sudo wc -c '$TARGET_FILE'"

  LOCAL_SHA="$(shasum -a 256 "$SRC_FILE" | awk '{print $1}')"
  REMOTE_SHA="$(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$HA_KEY" "${HA_USER}@${HA_HOST}" "sha256sum '$TARGET_FILE' | awk '{print \$1}'")"

  if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
    echo "[deploy-to-ha] checksum mismatch for $file! local=$LOCAL_SHA remote=$REMOTE_SHA" >&2
    exit 1
  fi

  echo "[deploy-to-ha] OK $file sha256=$LOCAL_SHA"
done
