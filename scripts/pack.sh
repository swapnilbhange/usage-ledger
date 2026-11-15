#!/usr/bin/env sh
# Builds dist/usage-ledger-<version>.zip: the extension folder plus the licence files.
set -e
cd "$(dirname "$0")/.."
V=$(node -p "require('./extension/manifest.json').version")
OUT="dist/usage-ledger-$V"
rm -rf "$OUT" "$OUT.zip" && mkdir -p "$OUT"
cp -r extension/. "$OUT/"
cp LICENSE NOTICE THIRD_PARTY_NOTICES.md "$OUT/"
(cd "$OUT" && zip -qr "../usage-ledger-$V.zip" .)
rm -rf "$OUT"
echo "built dist/usage-ledger-$V.zip"
