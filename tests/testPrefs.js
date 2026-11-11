// SPDX-License-Identifier: GPL-2.0-or-later

// Builds the real preferences window off-screen against isolated settings,
// then drives the per-monitor sizing group the way a user would. Needs a
// graphical session for Gdk; monitors are only listed, never changed.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

import {
    check,
    createIsolatedStore,
    EXTENSION_DIR,
    finish,
} from './testSettings.js';

Gio.resources_register(Gio.Resource.load(
    '/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));
Adw.init();

const Prefs = await import(`file://${EXTENSION_DIR}/prefs.js`);
const Sizing = await import(`file://${EXTENSION_DIR}/src/shared/monitorSizing.js`);
const {addPerMonitorSizingGroup} =
    await import(`file://${EXTENSION_DIR}/src/prefs/perMonitorSizingGroup.js`);
const {listMonitors} =
    await import(`file://${EXTENSION_DIR}/src/prefs/monitorList.js`);

const metadata = JSON.parse(new TextDecoder().decode(
    GLib.file_get_contents(`${EXTENSION_DIR}/metadata.json`)[1]));
const prefs = new Prefs.default({
    ...metadata,
    dir: Gio.File.new_for_path(EXTENSION_DIR),
    path: EXTENSION_DIR,
});
// Gettext resolves the extension by walking up from the module URL, which
// needs the UUID directory to be registered.
const ExtPrefs = await import(
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js');
ExtPrefs.ExtensionPreferences.lookupByUUID = () => prefs;
ExtPrefs.ExtensionPreferences.lookupByURL = () => prefs;

const store = createIsolatedStore();
const settings = store.settings;
prefs.getSettings = schema =>
    schema?.endsWith('.legacy') ? store.legacy : store.main;

// The whole window must still build with the group on both size pages.
const window = new Adw.PreferencesWindow();
prefs.fillPreferencesWindow(window);
check('preferences window builds', true, true);

function walk(widget, out = []) {
    out.push(widget);
    let child = widget.get_first_child?.();
    while (child) {
        walk(child, out);
        child = child.get_next_sibling();
    }
    return out;
}

// The size pages are only attached when navigated to, so the group is
// exercised on a page of its own.
const page = new Adw.PreferencesPage();
const connectSettings = (object, signal, callback) =>
    object.connect(signal, callback);
addPerMonitorSizingGroup({page, settings, connectSettings});
const all = () => walk(page);

// Connector names depend on which dock the machine is plugged into, so the
// test picks whatever is attached rather than naming monitors.
const MONITORS = listMonitors().map(monitor => ({
    ...monitor,
    key: Sizing.monitorKey(monitor),
}));
if (MONITORS.length < 2) {
    print('SKIP: needs at least two connected monitors');
    finish();
    System.exit(0);
}
const [TARGET, OTHER] = MONITORS;
const sub = (monitor, panel, icons) =>
    `${monitor.connector} · ${monitor.resolution} · Panel ${panel} px · Icons ${icons} px`;
const expanderFor = connector => all().find(w =>
    w instanceof Adw.ExpanderRow && w.subtitle?.startsWith(`${connector} ·`));
const spinRow = (expander, title) => walk(expander).find(w =>
    w instanceof Adw.SpinRow && w.title === title);
const overrideRow = (expander, title) => {
    const row = spinRow(expander, title);
    return {
        row,
        reset: walk(row).find(w => w instanceof Gtk.Button &&
            w.icon_name === 'edit-undo-symbolic'),
    };
};
const stored = () => Sizing.readMonitorSizing(settings);

// Globals: panel 62, icons 43, edge padding 7 so icons need 19 px of
// panel around them.

// --- toggling a monitor on
const target = expanderFor(TARGET.connector);
check('the target monitor starts off', target.enable_expansion, false);
check('nothing stored initially', stored(), {});
target.enable_expansion = true;
check('toggle writes an entry keyed by monitor identity', stored(), {
    [TARGET.key]: {label: TARGET.name, enabled: true, scale: 100, overrides: {}},
});
check('subtitle still shows globals', target.subtitle, sub(TARGET, 62, 43));

// --- scale
const scale = spinRow(target, 'Scale (%)');
scale.set_value(61);
check('scale stored', stored()[TARGET.key].scale, 61);
check('subtitle reflects the scaled result (panel grows to fit icons)',
    target.subtitle, sub(TARGET, 45, 26));
check('other monitors untouched', stored()[OTHER.key], undefined);
check('the other monitor is still global',
    expanderFor(OTHER.connector).subtitle, sub(OTHER, 62, 43));

// --- explicit override
const height = overrideRow(target, 'Panel Height');
check('override row starts at the effective value', height.row.get_value(), 45);
check('an untouched row offers no reset', height.reset.visible, false);
height.row.set_value(40);
check('override stored', stored()[TARGET.key].overrides, {'panel-height': 40});
check('override shrinks the icon in the subtitle',
    target.subtitle, sub(TARGET, 40, 21));

const spacing = overrideRow(target, 'Icon Spacing');
check('an untouched row follows the scale',
    spacing.row.subtitle, 'Following the scale');
check('a pinned row says it overrides',
    height.row.subtitle, 'Overriding the scale');
check('a pinned row offers a reset', height.reset.visible, true);
check('icon row follows the pinned height down',
    overrideRow(target, 'Icon Size').row.get_value(), 21);
spacing.row.set_value(5);
check('editing a row pins it', spacing.row.subtitle, 'Overriding the scale');
spacing.reset.emit('clicked');
check('reset drops only that override',
    stored()[TARGET.key].overrides, {'panel-height': 40});
check('reset restores the scaled value', spacing.row.get_value(), 2);

// --- clearing overrides
walk(target).find(w => w instanceof Gtk.Button && w.label === 'Clear')
    .emit('clicked');
check('overrides cleared', stored()[TARGET.key].overrides, {});
check('scale survives the clear', stored()[TARGET.key].scale, 61);
check('subtitle back to the scaled result', target.subtitle, sub(TARGET, 45, 26));

// --- external changes flow back into the widgets
Sizing.writeMonitorSizing(settings, {
    [TARGET.key]: {enabled: true, scale: 80, overrides: {'icon-size': 30}},
});
check('external scale synced', scale.get_value(), 80);
check('external override synced',
    overrideRow(target, 'Icon Size').row.get_value(), 30);
check('external subtitle synced', target.subtitle, sub(TARGET, 50, 30));

// --- switching a monitor back off
target.enable_expansion = false;
check('disabled entry kept but inactive', stored()[TARGET.key].enabled, false);
check('subtitle back to globals', target.subtitle, sub(TARGET, 62, 43));

// --- changing a global value refreshes every monitor
settings.set_int('panel-height', 70);
check('global change refreshes the other monitor',
    expanderFor(OTHER.connector).subtitle, sub(OTHER, 70, 43));
settings.set_int('panel-height', 62);

// --- a high scale reaches large values and warns about raster icons
Sizing.writeMonitorSizing(settings, {
    [TARGET.key]: {enabled: true, scale: 150, overrides: {}},
});
check('height row shows the scaled value',
    overrideRow(target, 'Panel Height').row.get_value(), 93);
check('icon row shows the scaled value',
    overrideRow(target, 'Icon Size').row.get_value(), 65);
check('a large icon warns about upscaled artwork',
    overrideRow(target, 'Icon Size').row.subtitle,
    'Following the scale · may look soft above 48 px');

// --- an entry keyed by connector still works, and moves onto the
// identity key as soon as it is touched
Sizing.writeMonitorSizing(settings, {
    [TARGET.connector]: {enabled: true, scale: 70, overrides: {}},
});
check('a connector entry still resolves',
    Sizing.resolveSizing(settings, TARGET)['panel-height'], 49);
const legacyScale = spinRow(expanderFor(TARGET.connector), 'Scale (%)');
check('the connector entry is shown', legacyScale.get_value(), 70);
legacyScale.set_value(75);
check('editing moves it onto the identity key', Object.keys(stored()), [TARGET.key]);

finish();
