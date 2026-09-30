#!/usr/bin/env bash
# Installs Break Reminder into the current user's GNOME Shell extensions dir.
set -euo pipefail

UUID="break-reminder@sherlock"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

mkdir -p "$DEST/schemas"
cp "$SRC/metadata.json" "$SRC/extension.js" "$SRC/stylesheet.css" "$DEST/"
cp "$SRC"/schemas/*.gschema.xml "$DEST/schemas/"
glib-compile-schemas "$DEST/schemas"

echo "Installed to $DEST"
echo
echo "Next:"
echo "  1. Reload GNOME Shell so it notices the new extension:"
echo "       X11:     Alt+F2, type r, Enter (open windows are kept)"
echo "       Wayland: log out and back in"
echo "  2. gnome-extensions enable $UUID"
