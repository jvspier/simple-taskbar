// SPDX-License-Identifier: GPL-2.0-or-later

// A private settings object backed by a throwaway keyfile, so preference
// tests never read or write the real dconf database. Globals are pinned to
// fixed values to keep the expected numbers deterministic.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const TEST_GLOBALS = {
    'panel-height': 62,
    'icon-size': 43,
    'icon-spacing': 4,
    'panel-button-padding': -1,
    'start-button-padding': 20,
};

export function createIsolatedSettings(extensionDir) {
    const path = '/org/gnome/shell/extensions/simple-taskbar/';
    const source = Gio.SettingsSchemaSource.new_from_directory(
        `${extensionDir}/schemas`,
        Gio.SettingsSchemaSource.get_default(),
        false
    );
    const schema = source.lookup(
        'org.gnome.shell.extensions.simple-taskbar', true);
    const file = GLib.build_filenamev(
        [GLib.dir_make_tmp('simple-taskbar-tests-XXXXXX'), 'settings.ini']);
    // The schema is not relocatable, so its path must not be passed here;
    // only the backend needs to know which subtree it owns.
    const settings = new Gio.Settings({
        settings_schema: schema,
        // Keys sit directly under the root path, so the backend needs a
        // group name or the writes are silently dropped.
        backend: Gio.keyfile_settings_backend_new(file, path, 'settings'),
    });
    for (const [key, value] of Object.entries(TEST_GLOBALS))
        settings.set_int(key, value);
    return settings;
}
