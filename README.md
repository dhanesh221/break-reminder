# Break Reminder

A GNOME Shell extension that reminds you to rest your eyes. Click the eye icon in the top bar to turn reminders on or off. When they're on, a full-screen overlay appears every 30 minutes saying **"Look away from the screen"** with a countdown from 10 to 0, then fades away. Press **Esc** to dismiss it early.

The overlay is purely visual: no windows are moved, minimised or paused. While it is showing, keyboard and mouse input goes to the overlay (so Esc can be caught) and returns to your apps as soon as it closes.

## Compatibility

GNOME Shell **42** (Ubuntu 22.04). GNOME 45 and later use a different extension format and are not supported.

## Install

```bash
./install.sh
```

Then reload GNOME Shell so it picks up the new extension (X11: <kbd>Alt</kbd>+<kbd>F2</kbd>, `r`, <kbd>Enter</kbd>; Wayland: log out and back in) and enable it:

```bash
gnome-extensions enable break-reminder@sherlock
```

## Settings

There is no preferences window; use `gsettings`:

```bash
SCHEMAS=~/.local/share/gnome-shell/extensions/break-reminder@sherlock/schemas
gsettings --schemadir $SCHEMAS set org.gnome.shell.extensions.break-reminder interval-minutes 30
gsettings --schemadir $SCHEMAS set org.gnome.shell.extensions.break-reminder countdown-seconds 10
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Reminders on/off (what the top-bar icon toggles) |
| `interval-minutes` | `30` | Time between breaks, counted from when the previous overlay closed |
| `countdown-seconds` | `10` | Length of the on-screen countdown |

GNOME disables extensions while the screen is locked, so the interval restarts after you unlock.
