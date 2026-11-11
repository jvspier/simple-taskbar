// SPDX-License-Identifier: GPL-2.0-or-later

// Resolution of per-monitor sizing, and the settings view panels read it
// through. Runs against isolated settings; see testSettings.js.
import {
    asIdentity,
    monitorKey,
    resolveSizing,
    SIZING_SETTING_KEY,
} from '../src/shared/monitorSizing.js';
import {MonitorSizedSettings} from '../src/shared/monitorSizedSettings.js';
import {CachedSettings} from '../src/shared/remappedSettings.js';
import {DockPanelSettings} from '../src/dock/dockPanelSettings.js';
import {taskbarPanelHeight} from '../src/shared/panelSizing.js';
import {
    check,
    createIsolatedSettings,
    finish,
    TEST_GLOBALS,
} from './testSettings.js';

const settings = createIsolatedSettings();
const setSizing = data =>
    settings.set_string(SIZING_SETTING_KEY, JSON.stringify(data));

const GLOBALS = {
    'panel-height': 62,
    'icon-size': 43,
    'icon-spacing': 4,
    'panel-button-padding': -1,
    'start-button-padding': 20,
};
// icon-edge-padding 7 -> reserve of 7 * 2 + 5.
const RESERVE = 19;

const laptop = {vendor: 'AUO', product: '0xd291', serial: '0x00000000', connector: 'eDP-1'};
const dell27 = {vendor: 'DEL', product: 'DELL U2715H', serial: 'GH85D7690E9L', connector: 'DP-9'};
const dell24 = {vendor: 'DEL', product: 'DELL U2414H', serial: '292K47AK0FKL', connector: 'DP-6'};
const virtual = {vendor: '', product: '', serial: '', connector: 'Meta-0'};

// Identity
check('EDID key', monitorKey(dell27), 'DEL|DELL U2715H|GH85D7690E9L');
check('no EDID falls back to the connector', monitorKey(virtual), 'Meta-0');
check('asIdentity is idempotent',
    asIdentity(asIdentity(dell27)), asIdentity(dell27));

// Resolution
check('no entry -> globals', resolveSizing(settings, dell27), GLOBALS);
check('unknown monitor -> globals', resolveSizing(settings, null), GLOBALS);

setSizing({
    [monitorKey(dell27)]: {enabled: true, scale: 73, overrides: {}},
    [monitorKey(dell24)]: {enabled: true, scale: 61, overrides: {}},
});
const dp9 = resolveSizing(settings, dell27);
const dp6 = resolveSizing(settings, dell24);
check('scaled panel keeps room for its icons (27")',
    dp9['panel-height'] >= dp9['icon-size'] + RESERVE, true);
check('scaled panel keeps room for its icons (24")',
    dp6['panel-height'] >= dp6['icon-size'] + RESERVE, true);
check('automatic padding stays automatic', dp6['panel-button-padding'], -1);
check('start padding scales', dp6['start-button-padding'], Math.round(20 * 0.61));
check('other monitors untouched', resolveSizing(settings, laptop), GLOBALS);

// The same screen behind a different connector keeps its entry.
check('entry follows the screen across connectors',
    resolveSizing(settings, {...dell24, connector: 'DP-7'}), dp6);

setSizing({'eDP-1': {enabled: true, scale: 100, overrides: {'panel-height': 80}}});
check('connector-keyed entries still resolve',
    resolveSizing(settings, laptop)['panel-height'], 80);

setSizing({[monitorKey(dell24)]: {enabled: true, scale: 61, overrides: {'panel-height': 40}}});
const forced = resolveSizing(settings, dell24);
check('explicit height wins', forced['panel-height'], 40);
check('icons shrink to fit an explicit height', forced['icon-size'], 40 - RESERVE);

setSizing({[monitorKey(dell24)]: {enabled: true, scale: 100, overrides: {'panel-height': 40, 'icon-size': 40}}});
check('both explicit -> panel grows',
    resolveSizing(settings, dell24)['panel-height'], 40 + RESERVE);

setSizing({[monitorKey(dell24)]: {enabled: false, scale: 61, overrides: {'panel-height': 40}}});
check('disabled entry ignored', resolveSizing(settings, dell24), GLOBALS);

settings.set_string(SIZING_SETTING_KEY, 'not json');
check('malformed JSON -> globals', resolveSizing(settings, dell24), GLOBALS);

setSizing({[monitorKey(dell24)]: {enabled: true, scale: 1000, overrides: {'icon-size': 9999}}});
const clamped = resolveSizing(settings, dell24);
check('scale and overrides are clamped to the schema ranges',
    [clamped['icon-size'], clamped['icon-spacing']], [128, 6]);

// The configuration in use on the real machine, written by the previous
// version of the feature, must carry over unchanged.
setSizing({
    [monitorKey(laptop)]: {label: 'Built-in display', enabled: true, scale: 150,
        overrides: {'panel-height': 70, 'icon-size': 52}},
    [monitorKey(dell27)]: {label: 'Dell Inc. 27"', enabled: true, scale: 100,
        overrides: {'panel-height': 70, 'icon-size': 45}},
});
check('existing laptop entry (panel grows by 1 for the new edge reserve)',
    resolveSizing(settings, laptop),
    {'panel-height': 71, 'icon-size': 52, 'icon-spacing': 6,
        'panel-button-padding': -1, 'start-button-padding': 20});
check('existing 27" entry',
    resolveSizing(settings, dell27),
    {'panel-height': 70, 'icon-size': 45, 'icon-spacing': 4,
        'panel-button-padding': -1, 'start-button-padding': 20});

// The settings view
const view = new MonitorSizedSettings(settings, laptop);
check('view answers sized keys per monitor',
    [view.get_int('panel-height'), view.get_int('icon-size')], [71, 52]);
check('view passes other keys through',
    view.get_int('icon-edge-padding'), TEST_GLOBALS['icon-edge-padding']);
check('view without identity is the globals',
    new MonitorSizedSettings(settings, null).get_int('icon-size'), 43);
check('padding alias shares the override', view.get_int(
    'taskbar-dynamic-panel-button-padding'), Math.round(6 * 1.5));
check('dock height alias scales its own global',
    view.get_int('dock-panel-height'), 70);

const cached = new CachedSettings(view);
check('cached panel settings see the monitor value',
    cached.get_int('icon-size'), 52);
check('panel thickness computed through the view',
    taskbarPanelHeight(cached, cached.get_int('icon-size')), 71);

// Changing the overrides must reach both the cache and listeners of the
// sized keys, since nothing else tells a panel its size changed.
let notified = 0;
const id = cached.connect('changed::icon-size', () => notified++);
setSizing({[monitorKey(laptop)]: {enabled: true, scale: 100, overrides: {'icon-size': 30}}});
check('override change notifies sized-key listeners', notified, 1);
check('override change invalidates the cache', cached.get_int('icon-size'), 30);
cached.disconnect(id);
setSizing({});
check('disconnect removes every fanned-out handler', notified, 1);
cached.destroy();

const dock = new DockPanelSettings(new MonitorSizedSettings(settings, laptop));
setSizing({[monitorKey(laptop)]: {enabled: true, scale: 100, overrides: {'icon-size': 60}}});
check('dock icon size per monitor', dock.get_int('icon-size'), 60);
settings.set_boolean('dock-panel-mode', true);
dock.setRuntimeIconSize(null);
check('dock panel-mode thickness follows the monitor icon size',
    dock.get_int('panel-height'), 60 + RESERVE);
setSizing({[monitorKey(laptop)]: {enabled: true, scale: 100, overrides: {'panel-height': 100}}});
check('dock panel-mode honours a height override',
    dock.get_int('panel-height'), 100);
dock.destroy();

finish();
