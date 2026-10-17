#!/bin/bash
# Installiert MS Phase über Adobes eigenen Plugin-Installer (UPIA),
# damit Creative Cloud das Plugin kennt und es nicht wieder aus der Liste streicht.
# Danach Photoshop neu starten: Zusatzmodule (Plugins) > MS Phase.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"

rm -f "$HERE/dist/MS-Phase.ccx"
mkdir -p "$HERE/dist"
(cd "$HERE/phase" && zip -qr "$HERE/dist/MS-Phase.ccx" . -x '.*')

# Nur entfernen, wenn schon installiert (sonst hängt der Installer)
if "$UPIA" --list all 2>/dev/null | grep -q "MS Phase"; then
  "$UPIA" --remove "MS Phase" >/dev/null 2>&1 || true
fi
"$UPIA" --install "$HERE/dist/MS-Phase.ccx"
echo "Fertig. Photoshop neu starten > Zusatzmodule (Plugins) > MS Phase"
