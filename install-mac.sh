#!/bin/bash
# Installs MS Phase via Adobe's own plugin installer (UPIA),
# so Creative Cloud knows the plugin and doesn't drop it from the list again.
# Restart Photoshop afterwards: Plugins > MS Phase.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"

rm -f "$HERE/dist/MS-Phase.ccx"
mkdir -p "$HERE/dist"
(cd "$HERE/phase" && zip -qr "$HERE/dist/MS-Phase.ccx" . -x '.*')

# only remove if already installed (otherwise the installer hangs)
if "$UPIA" --list all 2>/dev/null | grep -q "MS Phase"; then
  "$UPIA" --remove "MS Phase" >/dev/null 2>&1 || true
fi
"$UPIA" --install "$HERE/dist/MS-Phase.ccx"
echo "Done. Restart Photoshop > Plugins > MS Phase"
