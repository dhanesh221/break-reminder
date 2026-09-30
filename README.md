# Break Reminder

GNOME Shell **42** (Ubuntu 22.04) eye-rest reminders. Open the eye icon's top-bar menu to turn reminders on/off, toggle eye-break mode, and see your next break, total completed breaks and day streak. GNOME 45+ is not supported.

## What changed

- **Snooze:** every reminder has a "5 more minutes" button. It delays the same kind of break by five active minutes. Full-screen reminders also support Tab then Enter to snooze, or Esc to skip.
- **Meeting/fullscreen pause:** reminders wait while the focused window is fullscreen, matches a meeting-app pattern, or a Shell dialog/overview is open. After that, there is at least one minute of grace. This is best-effort focused-window matching, not microphone or call detection. Browser meetings with unrecognised titles, calls in the background and picture-in-picture may not be detected. Add patterns for your own apps below. A native meeting app is suppressed even when it is not in a call.
- **AFK awareness:** after 60 seconds without input, the break clock pauses. After two idle minutes it resets, treating that time away as a natural break. Returning never triggers an immediate reminder. Natural breaks don't earn stats credit. Idle detection cannot distinguish reading or watching from being away.
- **20-20-20 eye breaks:** a gentle, non-modal card asks you to look 20 feet away for 20 seconds. Apps retain focus. By default the sequence is **20 active minutes -> short eye break -> 30 active minutes -> full-screen long break -> repeat**. This alternating preset does not enforce an eye break every 20 minutes continuously. Turn eye-break mode off for long breaks only. The long break retains its original 10-second countdown; both waiting intervals and long-break duration can be changed.
- **Local streak:** only countdowns that finish earn a completed break. Skips, snoozes, interrupted reminders and idle resets don't. One completed break qualifies a local calendar day; consecutive qualifying days build the streak. Multiple breaks in one day add to the total, not the streak. Stats stay in GSettings across reinstall, lock and logout. No telemetry or network access.

The long overlay does not move, minimise or pause windows. It temporarily takes keyboard/mouse input, releasing the grab before fading out. Short cards do not grab input. Monitor changes, extension disable and relevant settings changes clean up any reminder and timer.

## Install or update

```bash
./install.sh
```

Reload Shell (X11: Alt+F2, `r`, Enter; Wayland: log out and back in), then:

```bash
gnome-extensions enable break-reminder@sherlock
```

Updating requires reinstalling the schema as well as the JS/CSS. `install.sh` does both. GNOME disables the extension while locked; the waiting clock restarts on unlock.

## Settings

No separate preferences window. The menu has the two main switches; for other values:

```bash
SCHEMAS=~/.local/share/gnome-shell/extensions/break-reminder@sherlock/schemas
SCHEMA=org.gnome.shell.extensions.break-reminder
gsettings --schemadir "$SCHEMAS" set "$SCHEMA" eye-interval-minutes 20
gsettings --schemadir "$SCHEMAS" set "$SCHEMA" interval-minutes 30
gsettings --schemadir "$SCHEMAS" set "$SCHEMA" countdown-seconds 10
gsettings --schemadir "$SCHEMAS" set "$SCHEMA" meeting-apps "['zoom', 'teams', 'skype', 'webex', 'google meet', 'meet.google.com', 'jitsi']"
# Reset counters only:
gsettings --schemadir "$SCHEMAS" reset "$SCHEMA" stats-json
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Reminders on/off |
| `eye-breaks-enabled` | `true` | Alternate gentle eye and full-screen long breaks |
| `eye-interval-minutes` | `20` | Active minutes before a short break (1-720) |
| `interval-minutes` | `30` | Active minutes before a long break (1-720) |
| `countdown-seconds` | `10` | Long-break countdown (1-600); eye breaks are fixed at 20 seconds |
| `idle-reset-seconds` | `120` | Idle seconds to count as a natural break (60-3600) |
| `suppress-meetings` | `true` | Pause for focused fullscreen/meeting windows |
| `meeting-apps` | see command above, without `jitsi` | Case-insensitive app ID/name, WM class or title substrings |
| `stats-json` | `{}` | Internal persisted count/streak/date; don't edit manually |

Changing non-stat settings restarts the waiting clock and closes any current reminder.

## Checks

```bash
node --check extension.js
node tests.js
glib-compile-schemas --strict --dry-run schemas
bash -n install.sh
```

These checks cover syntax, schema validity and pure timing/suppression/streak logic, not GNOME's live UI. Before relying on the extension, test on GNOME 42 with short intervals: snooze and Esc; keyboard focus and app input after dismissal; short-card placement; fullscreen and meeting title suppression; idle return; lock/unlock; multiple monitors and hot-plug; disable during a reminder. Check Shell logs for errors. No live GNOME 42 session was available for this update.
