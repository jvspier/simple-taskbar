imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
imports.gi.versions.Gdk = '4.0';
const {Gio, Gtk, Adw, GLib} = imports.gi;

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
const dp6 = expanderFor('DP-6');
check('DP-6 starts off', dp6.enable_expansion, false);
check('nothing stored initially', stored(), {});
dp6.enable_expansion = true;
check('toggle writes an entry', stored(), {
    'DP-6': {enabled: true, scale: 100, overrides: {}},
});
check('subtitle still shows globals',
    dp6.subtitle, 'DP-6 · 1080×1920 · Panel 62 px · Icons 43 px');

// --- scale
const scale = rowsUnder(dp6, 'Scale (%)')[0];
scale.set_value(61);
check('scale stored', stored()['DP-6'].scale, 61);
check('subtitle reflects the scaled result',
    dp6.subtitle, 'DP-6 · 1080×1920 · Panel 43 px · Icons 26 px');
check('other monitors untouched', stored()['DP-9'], undefined);
check('eDP-1 still global',
    expanderFor('eDP-1').subtitle, 'eDP-1 · 1920×1200 · Panel 62 px · Icons 43 px');

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
check('override stored', stored()['DP-6'].overrides, {'panel-height': 40});
check('override shrinks the icon in the subtitle',
    dp6.subtitle, 'DP-6 · 1080×1920 · Panel 40 px · Icons 23 px');

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
check('edit stored', stored()['DP-6'].overrides['icon-spacing'], 5);
spacing.reset.emit('clicked');
check('reset hands the row back to the scale',
    spacing.row.subtitle, 'Following the scale');
check('reset drops only that override',
    stored()['DP-6'].overrides, {'panel-height': 40});
check('reset restores the scaled value', spacing.spin.get_value(), 2);

// --- clearing overrides
const clearButton = walk(dp6).find(w =>
    w instanceof Gtk.Button && w.label === 'Clear');
clearButton.emit('clicked');
check('overrides cleared', stored()['DP-6'].overrides, {});
check('scale survives the clear', stored()['DP-6'].scale, 61);
check('cleared rows follow the scale again',
    overrideRow(dp6, 'Panel Height').row.subtitle, 'Following the scale');
check('cleared rows show the scaled value',
    overrideRow(dp6, 'Panel Height').spin.get_value(), 43);
check('subtitle back to the scaled result',
    dp6.subtitle, 'DP-6 · 1080×1920 · Panel 43 px · Icons 26 px');

// --- external changes flow back into the widgets
Sizing.writeMonitorSizing(settings, {
    'DP-6': {enabled: true, scale: 80, overrides: {'icon-size': 30}},
});
check('external scale synced', scale.get_value(), 80);
check('external override synced',
    overrideRow(dp6, 'Icon Size').spin.get_value(), 30);
check('external subtitle synced',
    dp6.subtitle, 'DP-6 · 1080×1920 · Panel 50 px · Icons 30 px');

// --- switching a monitor back off
dp6.enable_expansion = false;
check('disabled entry kept but inactive', stored()['DP-6'].enabled, false);
check('subtitle back to globals',
    dp6.subtitle, 'DP-6 · 1080×1920 · Panel 62 px · Icons 43 px');

// --- changing a global value refreshes every monitor
settings.set_int('panel-height', 60);
check('global change refreshes the scaled monitor',
    expanderFor('DP-9').subtitle, 'DP-9 · 2560×1440 · Panel 60 px · Icons 43 px');
settings.set_int('panel-height', 62);

// --- regression: at a high scale the resolved values sit at the schema
// maxima. Rows must still show those, not the bottom of the range.
Sizing.writeMonitorSizing(settings, {
    'DP-6': {enabled: true, scale: 150, overrides: {}},
});
const high = Sizing.resolveSizing(settings, 'DP-6');
check('a high scale clamps at the schema maxima',
    [high['panel-height'], high['icon-size']], [80, 48]);
check('height row shows the clamped value',
    overrideRow(dp6, 'Panel Height').spin.get_value(), 80);
check('icon row shows the clamped value',
    overrideRow(dp6, 'Icon Size').spin.get_value(), 48);
const iconSpin = overrideRow(dp6, 'Icon Size').spin;
iconSpin.set_value(iconSpin.get_value() - 1);
check('stepping down from a clamped value moves by one',
    Sizing.resolveSizing(settings, 'DP-6')['icon-size'], 47);

print(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
