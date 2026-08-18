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

const settings = prefs.getSettings();
const ORIGINAL = settings.get_string('per-monitor-sizing');
settings.set_string('per-monitor-sizing', '{}');

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
// Rows belonging to one monitor's expander subtree.
const rowsUnder = (expander, title) => walk(expander).filter(w =>
    w instanceof Adw.SpinRow && w.title === title);

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
const heightRow = rowsUnder(dp6, 'Panel Height')[0];
check('override starts at the Auto sentinel', heightRow.get_value(), 29);
heightRow.set_value(40);
check('override stored', stored()['DP-6'].overrides, {'panel-height': 40});
check('override shrinks the icon in the subtitle',
    dp6.subtitle, 'DP-6 · 1080×1920 · Panel 40 px · Icons 23 px');

// --- the automatic sentinel is explained in the row subtitle
const spacingRow = rowsUnder(dp6, 'Icon Spacing')[0];
check('sentinel row explains the effective value',
    spacingRow.subtitle, 'Automatic · 2');
check('overridden row says so',
    rowsUnder(dp6, 'Panel Height')[0].subtitle, 'Overriding the scaled value');
spacingRow.set_value(5);
check('changing an override updates its subtitle',
    spacingRow.subtitle, 'Overriding the scaled value');
spacingRow.set_value(-6);
check('back to automatic', spacingRow.subtitle, 'Automatic · 2');

// --- clearing overrides
const clearButton = walk(dp6).find(w =>
    w instanceof Gtk.Button && w.label === 'Clear');
clearButton.emit('clicked');
check('overrides cleared', stored()['DP-6'].overrides, {});
check('scale survives the clear', stored()['DP-6'].scale, 61);
check('cleared rows explain the scaled value again',
    rowsUnder(dp6, 'Panel Height')[0].subtitle, 'Automatic · 43');
check('rows returned to Auto', heightRow.get_value(), 29);
check('subtitle back to the scaled result',
    dp6.subtitle, 'DP-6 · 1080×1920 · Panel 43 px · Icons 26 px');

// --- external changes flow back into the widgets
Sizing.writeMonitorSizing(settings, {
    'DP-6': {enabled: true, scale: 80, overrides: {'icon-size': 30}},
});
check('external scale synced', scale.get_value(), 80);
check('external override synced', rowsUnder(dp6, 'Icon Size')[0].get_value(), 30);
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

settings.set_string('per-monitor-sizing', ORIGINAL);
print(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
