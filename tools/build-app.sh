#!/usr/bin/env bash
# Builds the Angular app in a scratch copy (node_modules stays off the Windows folder, which is slow for npm)
# and copies the output into the API's wwwroot. Usage: bash tools/build-app.sh [test]
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$HOME/ngwork/app"
mkdir -p "$WORK"
rsync -a --delete --exclude node_modules --exclude dist --exclude .angular "$REPO/app/" "$WORK/"
cd "$WORK"
[ -d node_modules ] || npm ci --no-audit --no-fund
if [ "${1:-}" = "test" ]; then npx ng test --watch=false; exit 0; fi
npx ng build --configuration production
rm -rf "$REPO/src/PastimeRivals.Api/wwwroot"
mkdir -p "$REPO/src/PastimeRivals.Api/wwwroot"
cp -r dist/app/browser/. "$REPO/src/PastimeRivals.Api/wwwroot/"
cp package-lock.json "$REPO/app/package-lock.json"
echo "App built into src/PastimeRivals.Api/wwwroot"
