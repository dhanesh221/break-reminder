/* Break Reminder: GNOME Shell 42. No network access or usage telemetry. */
'use strict';
const { Clutter, GLib, GObject, Meta, Shell, St } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ICON_ON = 'view-reveal-symbolic';
const ICON_OFF = 'view-conceal-symbolic';
const FADE_IN_MS = 300;
const FADE_OUT_MS = 400;

// Pure helpers are also exercised by tests.js, without a running Shell.
function isSuppressed(fullscreen, identity, patterns) {
    const name = identity.toLowerCase();
    return fullscreen || patterns.some(pattern =>
        pattern.trim() && name.includes(pattern.trim().toLowerCase()));
}

function recordCompletion(stats, date) {
    const day = date.toISOString().slice(0, 10);
    const previous = new Date(date.getTime() - 86400000).toISOString().slice(0, 10);
    return {
        total: Math.min(2147483647, stats.total + 1),
        streak: stats.day === day ? stats.streak :
            (stats.day === previous ? stats.streak + 1 : 1),
        day,
    };
}

function advanceClock(remaining, elapsed, idle, idleReset, wasIdle) {
    if (idle >= idleReset)
        return { remaining, paused: true, reset: true };
    if (idle >= 60)
        return { remaining, paused: true, reset: false };
    return { remaining: wasIdle ? Math.max(remaining, 60) : Math.max(0, remaining - elapsed),
        paused: false, reset: false };
}

class BreakOverlay {
    constructor(seconds, onFinished, gentle = false) {
        this._remaining = seconds;
        this._gentle = gentle;
        this._onFinished = onFinished;
        this._countdownLabels = [];

        this._actor = new St.Widget({
            reactive: true,
            opacity: 0,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
        });

        if (gentle) {
            // A small, non-modal card. Apps keep keyboard and pointer focus.
            this._actor.width = 380;
            this._actor.height = 220;
            const monitor = Main.layoutManager.primaryMonitor;
            this._actor.x = monitor.x + Math.max(0, (monitor.width - 380) / 2);
            this._actor.y = monitor.y + Main.panel.height + 12;
            this._actor.add_child(this._buildMonitorBackdrop({
                x: 0, y: 0, width: 380, height: 220,
            }));
        } else {
            for (const monitor of Main.layoutManager.monitors)
                this._actor.add_child(this._buildMonitorBackdrop(monitor));
        }
        Main.layoutManager.addTopChrome(this._actor);
        this._actor.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close('skipped');
                return Clutter.EVENT_STOP;
            }
            if (!this._gentle && event.get_key_symbol() === Clutter.KEY_Tab) {
                this._snoozeButton.grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            // Let Enter/Space reach the focused snooze button.
            return Clutter.EVENT_PROPAGATE;
        });
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed',
            () => this.close('skipped'));
        if (!gentle)
            this._grab = Main.pushModal(this._actor, { actionMode: Shell.ActionMode.NONE });

        this._actor.ease({
            opacity: 255,
            duration: FADE_IN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._remaining--;
            this._updateCountdown();
            if (this._remaining > 0)
                return GLib.SOURCE_CONTINUE;

            this._tickId = 0;
            this.close('completed');
            return GLib.SOURCE_REMOVE;
        });
    }

    _buildMonitorBackdrop(monitor) {
        const backdrop = new St.Widget({
            style_class: this._gentle ? 'break-reminder-card' : 'break-reminder-backdrop',
            layout_manager: new Clutter.BinLayout(),
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });

        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        backdrop.add_child(box);

        box.add_child(new St.Label({
            style_class: this._gentle ? 'break-reminder-card-message' : 'break-reminder-message',
            text: this._gentle ? 'Look 20 feet away' : 'Look away from the screen',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const countdown = new St.Label({
            style_class: this._gentle ? 'break-reminder-card-countdown' : 'break-reminder-countdown',
            text: `${this._remaining}`,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._countdownLabels.push(countdown);
        box.add_child(countdown);

        const snooze = new St.Button({
            style_class: 'break-reminder-snooze',
            label: '5 more minutes', reactive: true, can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        if (!this._snoozeButton)
            this._snoozeButton = snooze;
        snooze.connect('clicked', () => this.close('snoozed'));
        box.add_child(snooze);
        box.add_child(new St.Label({
            style_class: 'break-reminder-hint',
            text: this._gentle ? '20 seconds for your eyes' : 'Esc to skip | Tab, Enter to snooze',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        return backdrop;
    }

    _updateCountdown() {
        for (const label of this._countdownLabels)
            label.text = `${this._remaining}`;
    }

    // Stops timers and hands input back to apps. Safe to call repeatedly.
    _release() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
    }

    _destroyActor() {
        if (!this._actor)
            return;
        Main.layoutManager.removeChrome(this._actor);
        this._actor.destroy();
        this._actor = null;
    }

    // Release grabs first, then fade out and report completion/skip/snooze.
    close(result = 'skipped') {
        if (this._closing || !this._actor)
            return;
        this._closing = true;
        this._release();

        this._actor.remove_all_transitions();
        this._actor.ease({
            opacity: 0,
            duration: FADE_OUT_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                const wasTornDown = !this._actor;
                this._destroyActor();
                if (!wasTornDown)
                    this._onFinished?.(result);
            },
        });
    }

    // Immediate teardown (extension disabled / reminders switched off). No callback.
    destroy() {
        this._release();
        this._destroyActor();
    }
}

const BreakIndicator = GObject.registerClass(
class BreakIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Break Reminder');
        this._settings = settings;
        this._timerId = 0;
        this._overlay = null;
        this._idleMonitor = Meta.IdleMonitor.get_core();
        this._nextShort = settings.get_boolean('eye-breaks-enabled');
        this._wasIdle = false;
        this._icon = new St.Icon({ style_class: 'system-status-icon' });
        this.add_child(this._icon);
        this._toggle = new PopupMenu.PopupSwitchMenuItem('Reminders', false);
        this._toggle.connect('toggled', (_item, state) => settings.set_boolean('enabled', state));
        this.menu.addMenuItem(this._toggle);
        this._eyeToggle = new PopupMenu.PopupSwitchMenuItem('20-20-20 eye breaks', false);
        this._eyeToggle.connect('toggled', (_item, state) => settings.set_boolean('eye-breaks-enabled', state));
        this.menu.addMenuItem(this._eyeToggle);
        this._status = new PopupMenu.PopupMenuItem('', { reactive: false });
        this.menu.addMenuItem(this._status);
        this._statsItem = new PopupMenu.PopupMenuItem('', { reactive: false });
        this.menu.addMenuItem(this._statsItem);
        this.menu.connect('open-state-changed', () => this._updateStats());
        this._settingsId = settings.connect('changed', (_settings, key) => {
            if (key === 'stats-json') {
                this._updateStats();
                return;
            }
            this._restart();
        });
        this._restart();
    }

    _interval() {
        return this._settings.get_int(this._nextShort ? 'eye-interval-minutes' : 'interval-minutes') * 60;
    }

    _restart() {
        this._stop();
        const enabled = this._settings.get_boolean('enabled');
        this._icon.icon_name = enabled ? ICON_ON : ICON_OFF;
        this._toggle.setToggleState(enabled);
        this._eyeToggle.setToggleState(this._settings.get_boolean('eye-breaks-enabled'));
        this._nextShort = this._settings.get_boolean('eye-breaks-enabled');
        this._remaining = this._interval();
        this._wasIdle = false;
        this._lastTick = GLib.get_monotonic_time();
        this._status.label.text = enabled ? 'Waiting for next break' : 'Reminders off';
        this._updateStats();
        if (enabled) {
            this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._tick();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _focusedSuppressed() {
        if (!this._settings.get_boolean('suppress-meetings'))
            return false;
        const window = global.display.focus_window;
        if (!window)
            return false;
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const identity = [window.get_wm_class(), window.get_title(), app?.get_id(), app?.get_name()]
            .filter(Boolean).join(' ');
        return isSuppressed(window.is_fullscreen(), identity,
            this._settings.get_strv('meeting-apps'));
    }

    // Our own open menu holds a modal grab too; that is not a reason to pause.
    _busy() {
        return this._focusedSuppressed() || Main.overview.visible ||
            Main.modalCount > 0 && !this._overlay && !this.menu.isOpen;
    }

    _tick() {
        const now = GLib.get_monotonic_time();
        const elapsed = Math.max(0, (now - this._lastTick) / 1000000);
        this._lastTick = now;
        if (this._overlay) {
            // A break is meant to be input-free, so idle time never cancels it.
            if (this._busy()) {
                this._remaining = Math.max(this._remaining, 60);
                this._overlay.destroy();
                this._overlay = null;
                this._status.label.text = 'Paused: meeting, fullscreen or Shell dialog';
            }
            return;
        }
        const idle = this._idleMonitor.get_idletime() / 1000;
        const clock = advanceClock(this._remaining, elapsed, idle,
            this._settings.get_int('idle-reset-seconds'), this._wasIdle);
        this._wasIdle = clock.paused;
        if (clock.paused) {
            if (clock.reset) {
                this._nextShort = this._settings.get_boolean('eye-breaks-enabled');
                this._remaining = this._interval();
            }
            this._status.label.text = clock.reset ? 'Away: break clock reset' : 'Idle: clock paused';
            return;
        }
        if (this._busy()) {
            // Pause while busy and leave a full minute of grace afterwards.
            this._remaining = Math.max(this._remaining, 60);
            this._status.label.text = 'Paused: meeting, fullscreen or Shell dialog';
            return;
        }
        this._remaining = clock.remaining;
        this._status.label.text = `${this._nextShort ? 'Eye' : 'Long'} break in ${Math.ceil(this._remaining / 60)} min`;
        if (this._remaining <= 0)
            this._showBreak();
    }

    _showBreak() {
        const short = this._nextShort;
        this._status.label.text = short ? 'Eye break' : 'Long break';
        this._overlay = new BreakOverlay(short ? 20 : this._settings.get_int('countdown-seconds'), result => {
            this._overlay = null;
            if (result === 'snoozed') {
                this._remaining = 300; // Same kind of break; no stats credit.
            } else {
                if (result === 'completed')
                    this._recordBreak();
                this._nextShort = this._settings.get_boolean('eye-breaks-enabled') ? !short : false;
                this._remaining = this._interval();
            }
            this._lastTick = GLib.get_monotonic_time();
        }, short);
    }

    _readStats() {
        try {
            const stats = JSON.parse(this._settings.get_string('stats-json'));
            if (Number.isInteger(stats.total) && stats.total >= 0 &&
                Number.isInteger(stats.streak) && stats.streak >= 0 &&
                /^\d{4}-\d{2}-\d{2}$/.test(stats.day))
                return stats;
        } catch (_) { /* A damaged stats value must not break the extension. */ }
        return { total: 0, streak: 0, day: '' };
    }

    _localDate() {
        const now = new Date();
        // UTC day arithmetic on the local calendar date avoids DST errors.
        return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    }

    _recordBreak() {
        this._settings.set_string('stats-json', JSON.stringify(recordCompletion(this._readStats(), this._localDate())));
    }

    _updateStats() {
        const stats = this._readStats();
        const today = this._localDate();
        const yesterday = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
        const streak = stats.day === today.toISOString().slice(0, 10) || stats.day === yesterday ? stats.streak : 0;
        this._statsItem.label.text = `${stats.total} breaks taken | ${streak} day streak`;
    }

    _stop() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        this._overlay?.destroy();
        this._overlay = null;
    }

    _onDestroy() {
        this._stop();
        this._settings.disconnect(this._settingsId);
        super._onDestroy();
    }
});

class Extension {
    enable() {
        this._settings = ExtensionUtils.getSettings();
        this._indicator = new BreakIndicator(this._settings);
        Main.panel.addToStatusArea('break-reminder', this._indicator);
    }
    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
function init() { return new Extension(); }
