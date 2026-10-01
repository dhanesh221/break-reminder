'use strict';
// Run: node tests.js. Pure timing/statistics checks plus mocked indicator methods.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, 'extension.js'), 'utf8');
const helpers = source.slice(source.indexOf('function isSuppressed'), source.indexOf('class BreakOverlay'));
const context = vm.createContext({ Date });
vm.runInContext(helpers, context);
const { isSuppressed, recordCompletion, advanceClock } = context;
assert.equal(isSuppressed(true, 'Firefox', []), true);
assert.equal(isSuppressed(false, 'Zoom Workplace', ['ZOOM']), true);
assert.equal(isSuppressed(false, 'Google Meet - Firefox', ['google meet']), true);
assert.equal(isSuppressed(false, 'Firefox docs', ['zoom', '']), false);
assert.equal(advanceClock(10, 3, 0, 120, false).remaining, 7);
assert.equal(advanceClock(0, 3, 60, 120, false).paused, true);
assert.equal(advanceClock(10, 3, 120, 120, false).reset, true);
assert.equal(advanceClock(0, 3, 0, 120, true).remaining, 60);
assert.equal(advanceClock(300, 3, 0, 120, true).remaining, 300);
// GNOME 42 has no Meta.IdleMonitor.get_core; prefer the backend monitor.
const monitor = { get_idletime: () => 60000 };
const backend = { get_core_idle_monitor() { assert.equal(this, backend); return monitor; } };
let legacyCalls = 0;
const legacy = { IdleMonitor: { get_core() { legacyCalls++; return monitor; } } };
assert.equal(context.getIdleMonitor({ backend }, {}), monitor);
assert.equal(context.getIdleMonitor({ backend }, legacy), monitor);
assert.equal(legacyCalls, 0);
assert.equal(context.getIdleMonitor({}, legacy), monitor);
assert.equal(legacyCalls, 1);
assert.equal(context.getIdleMonitor({ backend: { get_core_idle_monitor: null } }, legacy), monitor);
assert.equal(context.getIdleMonitor({ backend: { get_core_idle_monitor: () => null } }, legacy), monitor);
assert.equal(context.getIdleMonitor({ backend: { get_core_idle_monitor: () => ({}) } }, legacy), monitor);
assert.equal(context.getIdleMonitor({ backend: { get_core_idle_monitor() { throw new Error('unavailable'); } } }, legacy), monitor);
assert.throws(() => context.getIdleMonitor({}, {}), /no supported core idle monitor API/);
assert.throws(() => context.getIdleMonitor({}, { IdleMonitor: { get_core: 42 } }), /no supported core idle monitor API/);
console.log('Idle monitor GNOME 42 API and guarded fallback tests passed.');
let stats = { total: 0, streak: 0, day: '' };
const d = day => new Date(`${day}T00:00:00Z`);
stats = recordCompletion(stats, d('2026-09-30'));
assert.equal(stats.total, 1); assert.equal(stats.streak, 1);
stats = recordCompletion(stats, d('2026-09-30'));
assert.equal(stats.total, 2); assert.equal(stats.streak, 1);
stats = recordCompletion(stats, d('2026-10-01'));
assert.equal(stats.streak, 2);
stats = recordCompletion(stats, d('2026-10-03'));
assert.equal(stats.streak, 1);
// Midnight, year boundary, leap day and DST-safe local-date arithmetic.
assert.equal(recordCompletion({ total: 3, streak: 4, day: '2026-12-31' }, d('2027-01-01')).streak, 5);
assert.equal(recordCompletion({ total: 3, streak: 4, day: '2028-02-29' }, d('2028-03-01')).streak, 5);
console.log('Timing, suppression and streak tests passed.');
// Exercise the actual indicator methods with minimal dependency mocks.
class Button { _init() {} }
const settingsValues = {
    'enabled': true, 'eye-breaks-enabled': true, 'eye-interval-minutes': 20,
    'interval-minutes': 30, 'countdown-seconds': 10, 'idle-reset-seconds': 120,
    'stats-json': '{}',
};
const settings = {
    get_boolean: k => settingsValues[k], get_int: k => settingsValues[k],
    get_string: k => settingsValues[k],
    set_string: (k, v) => { settingsValues[k] = v; },
};
let now = 0, idle = 0, destroyed = 0;
const mainMock = { overview: { visible: false }, modalCount: 0 };
const shell = vm.createContext({ Date, console, imports: {
    gi: { Clutter: {}, GLib: { get_monotonic_time: () => now },
        GObject: { registerClass: c => c }, Meta: {}, Shell: {}, St: {} },
    misc: { extensionUtils: {} },
    ui: { main: mainMock,
        panelMenu: { Button }, popupMenu: {} },
} });
vm.runInContext(source + '\nthis.Indicator = BreakIndicator;', shell);
const indicator = Object.create(shell.Indicator.prototype);
Object.assign(indicator, { _settings: settings, _nextShort: true,
    _remaining: 1200, _wasIdle: false, _lastTick: 0, _overlay: null,
    _idleMonitor: { get_idletime: () => idle * 1000 },
    _status: { label: {} }, _statsItem: { label: {} }, menu: { isOpen: false },
});
let suppressed = false, shown = 0;
indicator._focusedSuppressed = () => suppressed;
indicator._showBreak = () => { shown++; };
now = 1000000; indicator._tick(); assert.equal(indicator._remaining, 1199);
indicator._remaining = 0; suppressed = true;
now += 1000000; indicator._tick(); assert.equal(shown, 0); assert.equal(indicator._remaining, 60);
suppressed = false; idle = 130;
// Looking away during a break is idle time; it must not cancel the break.
const overlay = { destroy: () => { destroyed++; } };
indicator._overlay = overlay;
now += 1000000; indicator._tick(); assert.equal(destroyed, 0);
assert.equal(indicator._overlay, overlay);
indicator._overlay = null;
now += 1000000; indicator._tick(); assert.equal(indicator._remaining, 1200);
idle = 0; now += 1000000; indicator._tick(); assert.equal(indicator._remaining, 1200);
indicator._remaining = 1; now += 1000000; indicator._tick(); assert.equal(shown, 1);
// Our own open menu is modal but must not pause; a Shell dialog must.
indicator._remaining = 600; mainMock.modalCount = 1; indicator.menu.isOpen = true;
now += 1000000; indicator._tick(); assert.equal(indicator._remaining, 599);
assert.match(indicator._status.label.text, /break in/);
indicator.menu.isOpen = false;
now += 1000000; indicator._tick(); assert.equal(indicator._remaining, 599);
assert.match(indicator._status.label.text, /Paused/);
mainMock.modalCount = 0;
indicator._recordBreak(); indicator._updateStats();
assert.equal(JSON.parse(settingsValues['stats-json']).total, 1);
settingsValues['stats-json'] = 'invalid'; assert.equal(indicator._readStats().total, 0);
console.log('Indicator active-time, suppression, AFK-return and persistence tests passed.');
