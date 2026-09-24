#!/usr/bin/env bash
set -euo pipefail

KEYSTORE="${TRAILMARK_UPLOAD_STORE_FILE:-$HOME/.android/trailmark-upload.jks}"
KEY_ALIAS="${TRAILMARK_UPLOAD_KEY_ALIAS:-trailmark-upload}"
KEYCHAIN_SERVICE="Trailmark Android upload keystore"

if [[ ! -f "$KEYSTORE" ]]; then
  echo "Missing Trailmark upload keystore: $KEYSTORE" >&2
  exit 1
fi

if [[ -z "${TRAILMARK_UPLOAD_STORE_PASSWORD:-}" ]]; then
  TRAILMARK_UPLOAD_STORE_PASSWORD="$(security find-generic-password -w -a "$KEY_ALIAS" -s "$KEYCHAIN_SERVICE")"
fi

export TRAILMARK_UPLOAD_STORE_FILE="$KEYSTORE"
export TRAILMARK_UPLOAD_STORE_PASSWORD
export TRAILMARK_UPLOAD_KEY_ALIAS="$KEY_ALIAS"
export TRAILMARK_UPLOAD_KEY_PASSWORD="${TRAILMARK_UPLOAD_KEY_PASSWORD:-$TRAILMARK_UPLOAD_STORE_PASSWORD}"

cd "$(dirname "$0")"
./gradlew clean bundleRelease

echo "Signed bundle: app/build/outputs/bundle/release/app-release.aab"
