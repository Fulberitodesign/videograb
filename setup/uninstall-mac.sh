#!/bin/bash
# Desinstallation de VideoGrab sur macOS. Les videos telechargees ne sont pas supprimees.
APP="$HOME/Applications/VideoGrab.app"
SUPPORT="$HOME/Library/Application Support/VideoGrab"

printf '=== Desinstallation de VideoGrab ===\n'
if [ -t 0 ]; then
    read -r -p "Supprimer VideoGrab de ce Mac ? (o/N) " answer
    case "$answer" in [oOyY]*) ;; *) exit 0 ;; esac
fi

pkill -f "VideoGrab.app/Contents/Resources/app/videograb.py" 2>/dev/null || true
rm -rf "$APP" "$SUPPORT"
printf 'VideoGrab a ete desinstalle. Vos videos (Films/VideoGrab) sont conservees.\n'
