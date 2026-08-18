// Builds the real preferences window off-screen and inspects the widget tree.
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
imports.gi.versions.Gdk = '4.0';
const {Gio, Gtk, Adw, GLib} = imports.gi;

Gio.resources_register(Gio.Resource.load(
    '/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));

const DIR = '/home/jeroen/.local/share/gnome-shell/extensions/simple-taskbar@sultech';
Adw.init();

const Prefs = await import(`file://${DIR}/prefs.js`);

const metadata = JSON.parse(new TextDecoder().decode(
    GLib.file_get_contents(`${DIR}/metadata.json`)[1]));

const prefs = new Prefs.default({
    ...metadata,
    dir: Gio.File.new_for_path(DIR),
    path: DIR,
});

// Gettext resolves the extension by walking up from the module URL, which
// needs the UUID directory to be registered.
const ExtPrefs = await import(
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js');
ExtPrefs.ExtensionPreferences.lookupByUUID = () => prefs;
ExtPrefs.ExtensionPreferences.lookupByURL = () => prefs;

const window = new Adw.PreferencesWindow();
prefs.fillPreferencesWindow(window);

function walk(widget, depth = 0, out = []) {
    out.push({depth, widget});
    let child = widget.get_first_child?.();
    while (child) {
        walk(child, depth + 1, out);
        child = child.get_next_sibling();
    }
    return out;
}

// Adw pages/groups are not plain children, so collect via the tree of the
// window plus the group's own row containers.
const nodes = walk(window);
const groups = nodes.filter(n => n.widget instanceof Adw.PreferencesGroup);
const target = groups.find(n => n.widget.title === 'Per-Monitor Sizing');

if (!target) {
    print('FAIL: Per-Monitor Sizing group not found');
    print('groups found: ' + groups.map(g => g.widget.title).join(' | '));
    imports.system.exit(1);
}

print('OK: group present — ' + target.widget.title);
print('    description: ' + target.widget.description);

const groupNodes = walk(target.widget);
const expanders = groupNodes.filter(n => n.widget instanceof Adw.ExpanderRow);
const spins = groupNodes.filter(n => n.widget instanceof Adw.SpinRow);
const actions = groupNodes.filter(n => n.widget instanceof Adw.ActionRow &&
    !(n.widget instanceof Adw.SpinRow) && !(n.widget instanceof Adw.ExpanderRow));

print('\nExpander rows (' + expanders.length + '):');
for (const {widget} of expanders)
    print(`  "${widget.title}"  subtitle="${widget.subtitle}"  enabled=${widget.enable_expansion}`);

print('\nSpin rows (' + spins.length + '):');
for (const {widget} of spins)
    print(`  "${widget.title}"  value=${widget.get_value()}  range=[${widget.get_adjustment().get_lower()}..${widget.get_adjustment().get_upper()}]`);

print('\nAction rows (' + actions.length + '):');
for (const {widget} of actions)
    print(`  "${widget.title}" — ${widget.subtitle}`);

const monitorExpanders = expanders.filter(e => e.widget.subtitle?.includes('Panel '));
print(`\nMonitors listed: ${monitorExpanders.length}`);
print(monitorExpanders.length >= 1 ? 'PASS' : 'FAIL: no monitor rows');
