import {
    readMonitorSizing, writeMonitorSizing, resolveSizing,
    getMonitorEntry, sizingEquals, SIZING_KEYS,
} from '../src/shared/monitorSizing.js';

// Minimal GSettings stand-in.
class FakeSettings {
    constructor(values) { this._v = {...values}; }
    get_int(k) { return this._v[k]; }
    get_string(k) { return this._v[k]; }
    set_string(k, v) { this._v[k] = v; }
    get_boolean(k) { return Boolean(this._v[k]); }
}

let failures = 0;
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) { failures++; print(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
    else print(`ok   ${name} -> ${JSON.stringify(actual)}`);
}

// Jeroen's current globals.
const base = {
    'panel-height': 62, 'icon-size': 43, 'icon-spacing': 4,
    'panel-button-padding': -1, 'start-button-padding': 20,
    'default-gnome-panel': false,
    'windows-xp-theme-enabled': false,
    'per-monitor-sizing': '{}',
};

const s = new FakeSettings(base);

check('no overrides -> globals', resolveSizing(s, 'eDP-1'), {
    'panel-height': 62, 'icon-size': 43, 'icon-spacing': 4,
    'panel-button-padding': -1, 'start-button-padding': 20,
});

check('unknown connector -> globals', resolveSizing(s, null), {
    'panel-height': 62, 'icon-size': 43, 'icon-spacing': 4,
    'panel-button-padding': -1, 'start-button-padding': 20,
});

// Scale-only, the DPI ratios of the real setup.
s.set_string('per-monitor-sizing', JSON.stringify({
    'DP-9': {enabled: true, scale: 73, overrides: {}},
    'DP-6': {enabled: true, scale: 61, overrides: {}},
}));
const dp9 = resolveSizing(s, 'DP-9');
const dp6 = resolveSizing(s, 'DP-6');
print(`DP-9 @73% -> ${JSON.stringify(dp9)}`);
print(`DP-6 @61% -> ${JSON.stringify(dp6)}`);
check('scale keeps icon+reserve invariant (DP-9)',
    dp9['panel-height'] >= dp9['icon-size'] + 17, true);
check('scale keeps icon+reserve invariant (DP-6)',
    dp6['panel-height'] >= dp6['icon-size'] + 17, true);
check('automatic padding stays automatic', dp6['panel-button-padding'], -1);
check('start padding scales', dp6['start-button-padding'], Math.round(20 * 0.61));
check('eDP-1 untouched', resolveSizing(s, 'eDP-1')['panel-height'], 62);

// Explicit height override shrinks the icon instead of growing the panel.
s.set_string('per-monitor-sizing', JSON.stringify({
    'DP-6': {enabled: true, scale: 61, overrides: {'panel-height': 40}},
}));
const forced = resolveSizing(s, 'DP-6');
check('explicit height wins', forced['panel-height'], 40);
check('icon shrinks to fit explicit height', forced['icon-size'], 23);

// Both explicit and conflicting: panel grows, matching global behaviour.
s.set_string('per-monitor-sizing', JSON.stringify({
    'DP-6': {enabled: true, scale: 100, overrides: {'panel-height': 40, 'icon-size': 40}},
}));
check('both explicit -> panel grows', resolveSizing(s, 'DP-6')['panel-height'], 57);

// Disabled entry falls back to globals.
s.set_string('per-monitor-sizing', JSON.stringify({
    'DP-6': {enabled: false, scale: 61, overrides: {'panel-height': 40}},
}));
check('disabled entry ignored', resolveSizing(s, 'DP-6')['panel-height'], 62);

// GNOME panel mode skips the icon reserve.
const g = new FakeSettings({...base, 'default-gnome-panel': true,
    'per-monitor-sizing': JSON.stringify({'DP-6': {enabled: true, scale: 55, overrides: {}}})});
check('gnome panel mode allows a short panel',
    resolveSizing(g, 'DP-6')['panel-height'], 34);

// Windows XP mode picks its own proportions (30 px panel, 16 px icons),
// which deliberately violate the icon reserve. Scaling must preserve that
// instead of growing the panel back to icon + reserve.
const xp = new FakeSettings({
    'panel-height': 30, 'icon-size': 16, 'icon-spacing': -1,
    'panel-button-padding': -1, 'start-button-padding': 3,
    'default-gnome-panel': false, 'windows-xp-theme-enabled': true,
    'per-monitor-sizing': JSON.stringify({
        'DP-6': {enabled: true, scale: 80, overrides: {}},
    }),
});
const xpResolved = resolveSizing(xp, 'DP-6');
// XP mode already sits on the schema floors (30 px panel, 16 px icons), so
// scaling down mostly clamps rather than shrinking. That is a documented
// limitation, not a bug: the values stay valid and the look stays intact.
check('xp mode clamps to the schema floors', xpResolved, {
    'panel-height': 30, 'icon-size': 15, 'icon-spacing': -1,
    'panel-button-padding': -1, 'start-button-padding': 2,
});
check('xp negative spacing stays negative', xpResolved['icon-spacing'] < 0, true);
check('xp mode never grows the panel to icon + reserve',
    xpResolved['panel-height'] < xpResolved['icon-size'] + 17, true);

// Range clamping and malformed input.
s.set_string('per-monitor-sizing', JSON.stringify({
    'DP-6': {enabled: true, scale: 9999, overrides: {'icon-size': 999, 'bogus': 5}},
}));
const clamped = resolveSizing(s, 'DP-6');
check('scale clamps to 150', getMonitorEntry(readMonitorSizing(s), 'DP-6').scale, 150);
// An absurd icon size clamps to the ceiling, and the panel grows to hold it
// until it hits its own ceiling, at which point the icon gives way again.
check('panel grows to its ceiling', clamped['panel-height'], 256);
check('icon settles at the ceiling minus the reserve',
    clamped['icon-size'], 239);
check('the reserve still holds at the ceiling',
    clamped['panel-height'] >= clamped['icon-size'] + 17, true);

// The point of raising the limits: a high scale on a dense display is no
// longer silently truncated at the old 80/48 ceiling.
s.set_string('per-monitor-sizing', JSON.stringify({
    'eDP-1': {enabled: true, scale: 150, overrides: {}},
}));
check('a high scale is no longer capped at the old limits',
    resolveSizing(s, 'eDP-1'), {
        'panel-height': 93, 'icon-size': 65, 'icon-spacing': 6,
        // The paddings keep their own modest ranges, so this one still caps.
        'panel-button-padding': -1, 'start-button-padding': 20,
    });

s.set_string('per-monitor-sizing', 'not json at all');
check('malformed json -> empty', readMonitorSizing(s), {});
check('malformed json -> globals', resolveSizing(s, 'DP-6')['panel-height'], 62);

s.set_string('per-monitor-sizing', '[1,2,3]');
check('array json -> empty', readMonitorSizing(s), {});

// Round trip.
s.set_string('per-monitor-sizing', '{}');
writeMonitorSizing(s, {'DP-6': {enabled: true, scale: 61, overrides: {'icon-size': 26}}});
check('round trip', readMonitorSizing(s), {
    'DP-6': {enabled: true, scale: 61, overrides: {'icon-size': 26}},
});

check('sizingEquals identical', sizingEquals(dp9, resolveSizing(new FakeSettings({...base,
    'per-monitor-sizing': JSON.stringify({'DP-9': {enabled: true, scale: 73, overrides: {}}})}), 'DP-9')), true);
check('sizingEquals differing', sizingEquals(dp9, dp6), false);
check('sizingEquals null', sizingEquals(null, dp6), false);

print(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
