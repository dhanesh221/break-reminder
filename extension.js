/* Break Reminder — GNOME Shell 42 extension.
 *
 * A top-bar icon toggles periodic breaks. When on, every `interval-minutes`
 * a full-screen overlay says "Look away from the screen" and counts down
 * `countdown-seconds` to 0, then fades away. Escape dismisses it early.
 *
 * The overlay is purely a Shell actor drawn above everything: no windows are
 * touched, minimised or paused. While it is up, the Shell holds a modal grab
 * so Escape can be caught; input returns to your apps the moment it closes.
 */
'use strict';

const { Clutter, GLib, GObject, Shell, St } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

const ICON_ON = 'view-reveal-symbolic';
const ICON_OFF = 'view-conceal-symbolic';
const FADE_IN_MS = 300;
const FADE_OUT_MS = 400;

class BreakOverlay {
    constructor(seconds, onFinished) {
        this._remaining = seconds;
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

        for (const monitor of Main.layoutManager.monitors)
            this._actor.add_child(this._buildMonitorBackdrop(monitor));

        Main.layoutManager.addTopChrome(this._actor);

        this._actor.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                this.close();
            return Clutter.EVENT_STOP;
        });

        // Geometry is stale if monitors change mid-break; just end the break.
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed',
            () => this.close());

        // NONE blocks global keybindings (Super, Alt+Tab, ...) while shown.
        this._grab = Main.pushModal(this._actor, {
            actionMode: Shell.ActionMode.NONE,
        });

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
            this.close();
            return GLib.SOURCE_REMOVE;
        });
    }

    _buildMonitorBackdrop(monitor) {
        const backdrop = new St.Widget({
            style_class: 'break-reminder-backdrop',
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
            style_class: 'break-reminder-message',
            text: 'Look away from the screen',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const countdown = new St.Label({
            style_class: 'break-reminder-countdown',
            text: `${this._remaining}`,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._countdownLabels.push(countdown);
        box.add_child(countdown);

        box.add_child(new St.Label({
            style_class: 'break-reminder-hint',
            text: 'Press Esc to skip',
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

    // Normal end (countdown hit 0, or Escape): fade out, then notify.
    close() {
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
                    this._onFinished?.();
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
        super._init(0.0, 'Break Reminder', true);

        this._settings = settings;
        this._timerId = 0;
        this._overlay = null;

        this._icon = new St.Icon({ style_class: 'system-status-icon' });
        this.add_child(this._icon);

        this._settingsIds = [
            settings.connect('changed::enabled', () => this._sync()),
            settings.connect('changed::interval-minutes', () => this._sync()),
        ];
        this._sync();
    }

    // Click toggles, like Caffeine. There is no menu.
    vfunc_event(event) {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS ||
            type === Clutter.EventType.TOUCH_BEGIN) {
            const enabled = this._settings.get_boolean('enabled');
            this._settings.set_boolean('enabled', !enabled);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _sync() {
        const enabled = this._settings.get_boolean('enabled');
        this._icon.icon_name = enabled ? ICON_ON : ICON_OFF;

        this._stopTimer();
        if (!enabled) {
            this._overlay?.destroy();
            this._overlay = null;
        } else if (!this._overlay) {
            this._startTimer();
        }
        // If an overlay is up, the timer restarts when it finishes.
    }

    _startTimer() {
        const seconds = this._settings.get_int('interval-minutes') * 60;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._timerId = 0;
            this._showBreak();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _showBreak() {
        this._overlay = new BreakOverlay(this._settings.get_int('countdown-seconds'), () => {
            this._overlay = null;
            if (this._settings.get_boolean('enabled'))
                this._startTimer();
        });
    }

    _onDestroy() {
        this._stopTimer();
        this._overlay?.destroy();
        this._overlay = null;
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._settingsIds = [];
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

function init() {
    return new Extension();
}
