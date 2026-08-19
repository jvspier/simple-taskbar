imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
imports.gi.versions.Gdk = '4.0';
const {Gio, Gtk, Adw, Gdk, GLib} = imports.gi;

Gio.resources_register(Gio.Resource.load(
    '/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));
const DIR = '/home/jeroen/.local/share/gnome-shell/extensions/simple-taskbar@sultech';
Adw.init();

const Prefs = await import(`file://${DIR}/prefs.js`);
const Sizing = await import(`file://${DIR}/src/shared/monitorSizing.js`);
const metadata = JSON.parse(new TextDecoder().decode(
    GLib.file_get_contents(`${DIR}/metadata.json`)[1]));
const prefs = new Prefs.default({
    ...metadata, dir: Gio.File.new_for_path(DIR), path: DIR,
});
const ExtPrefs = await import(
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js');
ExtPrefs.ExtensionPreferences.lookupByUUID = () => prefs;
ExtPrefs.ExtensionPreferences.lookupByURL = () => prefs;

// Drive a throwaway settings store so a failure part way through can never
// leave the real configuration modified.
const {createIsolatedSettings} = await import('./testSettings.js');
const isolated = createIsolatedSettings(DIR);
prefs.getSettings = () => isolated;

const settings = isolated;

const window = new Adw.PreferencesWindow();
prefs.fillPreferencesWindow(window);

function walk(w, out = []) {
    out.push(w);
    let c = w.get_first_child?.();
    while (c) { walk(c, out); c = c.get_next_sibling(); }
    return out;
}
const all = () => walk(window);

// Connector names depend on which dock the machine is plugged into, so the
// test picks whatever is attached rather than naming monitors.
const MONITORS = (() => {
    const list = [];
    const monitors = Gdk.Display.get_default().get_monitors();
    for (let i = 0; i < monitors.get_n_items(); i++) {
        const monitor = monitors.get_item(i);
        const geometry = monitor.get_geometry();
        list.push({
            connector: monitor.connector,
            resolution: `${geometry.width}×${geometry.height}`,
        });
    }
    return list;
})();
if (MONITORS.length < 2) {
    print('SKIP: needs at least two connected monitors');
    imports.system.exit(0);
}
const [TARGET, OTHER] = MONITORS;
// Expected expander subtitle for a monitor at a given resolved size.
const sub = (monitor, panel, icons) =>
    `${monitor.connector} · ${monitor.resolution} · Panel ${panel} px · Icons ${icons} px`;
const expanderFor = connector => all().find(w =>
    w instanceof Adw.ExpanderRow && w.subtitle?.startsWith(`${connector} ·`));
// The scale is still an Adw.SpinRow; override rows are ActionRows carrying a
// SpinButton and a reset button.
const rowsUnder = (expander, title) => walk(expander).filter(w =>
    w instanceof Adw.SpinRow && w.title === title);
const overrideRow = (expander, title) => {
    const row = walk(expander).find(w =>
        w instanceof Adw.SpinRow && w.title === title);
    return {
        row,
        // The value lives on the row itself; the reset button is an extra
        // suffix alongside the row's own spin buttons.
        spin: row,
        reset: walk(row).find(w => w instanceof Gtk.Button &&
            w.icon_name === 'edit-undo-symbolic'),
    };
};

let failures = 0;
const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) { failures++; print(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
    else print(`ok   ${name}`);
};
const stored = () => Sizing.readMonitorSizing(settings);

// --- toggling a monitor on
const dp6 = expanderFor(TARGET.connector);
check('the target monitor starts off', dp6.enable_expansion, false);
check('nothing stored initially', stored(), {});
dp6.enable_expansion = true;
check('toggle writes an entry', stored(), {
    [TARGET.connector]: {enabled: true, scale: 100, overrides: {}},
});
check('subtitle still shows globals',
    dp6.subtitle, sub(TARGET, 62, 43));

// --- scale
const scale = rowsUnder(dp6, 'Scale (%)')[0];
scale.set_value(61);
check('scale stored', stored()[TARGET.connector].scale, 61);
check('subtitle reflects the scaled result',
    dp6.subtitle, sub(TARGET, 43, 26));
check('other monitors untouched', stored()[OTHER.connector], undefined);
check('the other monitor is still global',
    expanderFor(OTHER.connector).subtitle, sub(OTHER, 62, 43));

// --- explicit override
const height = overrideRow(dp6, 'Panel Height');
// The row must show what is in effect, so stepping it moves from there
// rather than jumping to the bottom of the schema range.
check('override row starts at the effective value', height.spin.get_value(), 43);
check('an untouched row offers no reset', height.reset.visible, false);
// A plain Gtk.SpinButton in an ActionRow renders with square buttons; the
// native row keeps the rounded ones the rest of the page uses.
check('override rows are native spin rows',
    height.row instanceof Adw.SpinRow, true);
height.spin.set_value(40);
check('override stored', stored()[TARGET.connector].overrides, {'panel-height': 40});
check('override shrinks the icon in the subtitle',
    dp6.subtitle, sub(TARGET, 40, 23));

// --- rows say whether they follow the scale, and offer a reset when pinned
const spacing = overrideRow(dp6, 'Icon Spacing');
check('an untouched row follows the scale',
    spacing.row.subtitle, 'Following the scale');
check('a pinned row says it overrides',
    height.row.subtitle, 'Overriding the scale');
check('a pinned row offers a reset', height.reset.visible, true);
// Pinning the height shrinks the automatic icon size to fit, which has to be
// visible in the icon row rather than happening silently.
check('icon row follows the pinned height down',
    overrideRow(dp6, 'Icon Size').spin.get_value(), 23);
spacing.spin.set_value(5);
check('editing a row pins it', spacing.row.subtitle, 'Overriding the scale');
check('edit stored', stored()[TARGET.connector].overrides['icon-spacing'], 5);
spacing.reset.emit('clicked');
check('reset hands the row back to the scale',
    spacing.row.subtitle, 'Following the scale');
check('reset drops only that override',
    stored()[TARGET.connector].overrides, {'panel-height': 40});
check('reset restores the scaled value', spacing.spin.get_value(), 2);

// --- clearing overrides
const clearButton = walk(dp6).find(w =>
    w instanceof Gtk.Button && w.label === 'Clear');
clearButton.emit('clicked');
check('overrides cleared', stored()[TARGET.connector].overrides, {});
check('scale survives the clear', stored()[TARGET.connector].scale, 61);
check('cleared rows follow the scale again',
    overrideRow(dp6, 'Panel Height').row.subtitle, 'Following the scale');
check('cleared rows show the scaled value',
    overrideRow(dp6, 'Panel Height').spin.get_value(), 43);
check('subtitle back to the scaled result',
    dp6.subtitle, sub(TARGET, 43, 26));

// --- external changes flow back into the widgets
Sizing.writeMonitorSizing(settings, {
    [TARGET.connector]: {enabled: true, scale: 80, overrides: {'icon-size': 30}},
});
check('external scale synced', scale.get_value(), 80);
check('external override synced',
    overrideRow(dp6, 'Icon Size').spin.get_value(), 30);
check('external subtitle synced',
    dp6.subtitle, sub(TARGET, 50, 30));

// --- switching a monitor back off
dp6.enable_expansion = false;
check('disabled entry kept but inactive', stored()[TARGET.connector].enabled, false);
check('subtitle back to globals',
    dp6.subtitle, sub(TARGET, 62, 43));

// --- changing a global value refreshes every monitor
settings.set_int('panel-height', 60);
check('global change refreshes the scaled monitor',
    expanderFor(OTHER.connector).subtitle, sub(OTHER, 60, 43));
settings.set_int('panel-height', 62);

// --- regression: at a high scale the resolved values sit at the schema
// maxima. Rows must still show those, not the bottom of the range.
Sizing.writeMonitorSizing(settings, {
    [TARGET.connector]: {enabled: true, scale: 150, overrides: {}},
});
const high = Sizing.resolveSizing(settings, TARGET.connector);
check('a high scale is applied rather than truncated',
    [high['panel-height'], high['icon-size']], [93, 65]);
check('height row shows the scaled value',
    overrideRow(dp6, 'Panel Height').spin.get_value(), 93);
check('icon row shows the scaled value',
    overrideRow(dp6, 'Icon Size').spin.get_value(), 65);
check('a large icon warns about upscaled artwork',
    overrideRow(dp6, 'Icon Size').row.subtitle,
    'Following the scale · may look soft above 48 px');
const iconRow = overrideRow(dp6, 'Icon Size');
iconRow.spin.set_value(iconRow.spin.get_value() - 1);
check('stepping down from a large value moves by one',
    Sizing.resolveSizing(settings, TARGET.connector)['icon-size'], 64);

print(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
