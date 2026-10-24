#!/bin/sh
# Builds the Chrome Web Store upload package: dist/comment-cleaner-for-reddit-<version>.zip
set -eu
cd "$(dirname "$0")/.."

VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
OUT="dist/comment-cleaner-for-reddit-$VERSION.zip"

mkdir -p dist
rm -f "$OUT"
zip -X -q "$OUT" \
  manifest.json \
  popup.html popup.js \
  app.html app.js app.css \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png

echo "Built $OUT"
unzip -l "$OUT"
