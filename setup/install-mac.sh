#!/bin/bash
# Installation de VideoGrab sur macOS - cree par Fulbert Adeniyi.
# Installe la derniere version sans l'alerte "developpeur non identifie" :
#   curl -fsSL https://raw.githubusercontent.com/Fulberitodesign/videograb/main/setup/install-mac.sh | bash
set -euo pipefail

ARCH="$(uname -m)"
[ "$ARCH" = "arm64" ] || ARCH="x64"
URL="https://github.com/Fulberitodesign/videograb/releases/latest/download/VideoGrab-Setup-$ARCH.dmg"

printf '\033[35m=== Installation de VideoGrab (macOS) ===\033[0m\nCree par Fulbert Adeniyi\n\n'

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Telechargement de VideoGrab ($([ "$ARCH" = arm64 ] && echo 'puce Apple' || echo 'Intel'))..."
curl -fL --progress-bar "$URL" -o "$TMP/VideoGrab.dmg"

MNT="$(hdiutil attach -nobrowse -readonly "$TMP/VideoGrab.dmg" | tail -1 | awk -F'\t' '{print $NF}' | sed 's/[[:space:]]*$//')"
DEST="/Applications"
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }

# Ancienne version (VideoGrab 1.x, basee sur Python)
OLD="$HOME/Applications/VideoGrab.app"
if [ -f "$OLD/Contents/Resources/app/videograb.py" ]; then
    rm -rf "$OLD" "$HOME/Library/Application Support/VideoGrab/venv"
fi

rm -rf "$DEST/VideoGrab.app"
ditto "$MNT/VideoGrab.app" "$DEST/VideoGrab.app"
hdiutil detach "$MNT" -quiet || true
xattr -dr com.apple.quarantine "$DEST/VideoGrab.app" 2>/dev/null || true

printf '\n\033[32mVideoGrab est installe dans %s !\033[0m\n' "$DEST"
open "$DEST/VideoGrab.app"
