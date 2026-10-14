#!/bin/bash
# Installation de VideoGrab sur macOS - cree par Fulbert Adeniyi.
# Double-clic sur installer-mac.command, ou dans le Terminal :
#   curl -fsSL https://raw.githubusercontent.com/Fulberitodesign/videograb/main/setup/install-mac.sh | bash
set -euo pipefail

REPO_ZIP="https://github.com/Fulberitodesign/videograb/archive/refs/heads/main.zip"
SUPPORT="$HOME/Library/Application Support/VideoGrab"
APP="$HOME/Applications/VideoGrab.app"

step() { printf '\n\033[36m> %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1"; exit 1; }

printf '\033[35m=== Installation de VideoGrab (macOS) ===\033[0m\n'
printf 'Cree par Fulbert Adeniyi\n'

# 0. Fichiers de l'application : dossier du script, sinon telechargement depuis GitHub
SRC=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
if [ -z "$SRC" ] || [ ! -f "$SRC/videograb.py" ]; then
    step "Telechargement de VideoGrab..."
    TMP="$(mktemp -d)"
    curl -fsSL "$REPO_ZIP" -o "$TMP/videograb.zip"
    ditto -x -k "$TMP/videograb.zip" "$TMP"
    SRC="$TMP/videograb-main"
    [ -f "$SRC/videograb.py" ] || fail "Telechargement incomplet, reessayez."
fi

# 1. Python 3.10 ou plus
step "Recherche de Python 3..."
BREW="$(command -v brew || true)"
[ -z "$BREW" ] && [ -x /opt/homebrew/bin/brew ] && BREW=/opt/homebrew/bin/brew
[ -z "$BREW" ] && [ -x /usr/local/bin/brew ] && BREW=/usr/local/bin/brew

find_python() {
    for c in /opt/homebrew/bin/python3 /usr/local/bin/python3 \
             /Library/Frameworks/Python.framework/Versions/Current/bin/python3 /usr/bin/python3; do
        [ -x "$c" ] || continue
        # /usr/bin/python3 n'est qu'un raccourci tant que les outils Xcode ne sont pas installes
        if [ "$c" = /usr/bin/python3 ] && ! xcode-select -p >/dev/null 2>&1; then continue; fi
        if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
            echo "$c"; return
        fi
    done
}

PY="$(find_python)"
if [ -z "$PY" ]; then
    if [ -n "$BREW" ]; then
        step "Installation de Python avec Homebrew..."
        "$BREW" install python
        PY="$(find_python)"
    fi
fi
if [ -z "$PY" ]; then
    open "https://www.python.org/downloads/macos/"
    fail "Python 3.10+ est necessaire. Installez-le depuis la page qui vient de s'ouvrir (bouton 'Download Python'), puis relancez l'installation."
fi
ok "Python : $("$PY" --version)"

# 2. Environnement dedie + yt-dlp
step "Installation de yt-dlp..."
mkdir -p "$SUPPORT"
rm -rf "$SUPPORT/venv"
"$PY" -m venv "$SUPPORT/venv"
VPY="$SUPPORT/venv/bin/python"
"$VPY" -m pip install --upgrade --quiet --disable-pip-version-check pip "yt-dlp[default]" certifi
ok "yt-dlp : OK"

# 3. ffmpeg
step "Verification de ffmpeg..."
if command -v ffmpeg >/dev/null 2>&1 || [ -x /opt/homebrew/bin/ffmpeg ] || [ -x /usr/local/bin/ffmpeg ]; then
    ok "ffmpeg : OK"
elif [ -n "$BREW" ]; then
    "$BREW" install ffmpeg
    ok "ffmpeg installe avec Homebrew"
else
    "$VPY" -m pip install --quiet --disable-pip-version-check imageio-ffmpeg
    ok "ffmpeg integre installe"
fi

# 4. Application VideoGrab.app
step "Creation de l'application dans ~/Applications"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app/ui"
cp "$SRC/videograb.py" "$APP/Contents/Resources/app/"
cp "$SRC"/ui/* "$APP/Contents/Resources/app/ui/"
cp "$SRC/ui/logo.icns" "$APP/Contents/Resources/VideoGrab.icns"
cp "$SRC/setup/uninstall-mac.sh" "$APP/Contents/Resources/"

cat > "$APP/Contents/MacOS/VideoGrab" <<'LAUNCHER'
#!/bin/bash
exec "$HOME/Library/Application Support/VideoGrab/venv/bin/python" "$(dirname "$0")/../Resources/app/videograb.py"
LAUNCHER
chmod +x "$APP/Contents/MacOS/VideoGrab" "$APP/Contents/Resources/uninstall-mac.sh"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>VideoGrab</string>
  <key>CFBundleDisplayName</key><string>VideoGrab</string>
  <key>CFBundleIdentifier</key><string>com.fulbertadeniyi.videograb</string>
  <key>CFBundleShortVersionString</key><string>1.1</string>
  <key>CFBundleVersion</key><string>1.1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>VideoGrab</string>
  <key>CFBundleIconFile</key><string>VideoGrab</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Cree par Fulbert Adeniyi</string>
</dict>
</plist>
PLIST

xattr -cr "$APP" 2>/dev/null || true
touch "$APP"

printf '\n\033[32mVideoGrab est installe dans Applications (dossier personnel) !\033[0m\n'
printf 'Astuce : glissez-le dans le Dock pour le retrouver facilement.\n'
open "$APP"
