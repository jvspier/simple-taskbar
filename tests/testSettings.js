// SPDX-License-Identifier: GPL-2.0-or-later

// Private settings backed by a throwaway keyfile, so tests never read or
// write the real dconf database: the running extension applies changes
// live, so a test that crashed before its cleanup would resize the real
// taskbar. Globals are pinned to fixed values to keep the expected numbers
// independent of whatever is configured on the machine.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {createRoutedSettings} from '../src/shared/routedSettings.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.simple-taskbar';
const ROOT_PATH = '/org/gnome/shell/extensions/simple-taskbar/';

export const TEST_GLOBALS = {
    'panel-height': 62,
    'icon-size': 43,
    'icon-spacing': 4,
    'icon-edge-padding': 7,
    'panel-button-padding': -1,
    'taskbar-dynamic-panel-button-padding': 6,
    'start-button-padding': 20,
    'dock-panel-height': 67,
};

export const EXTENSION_DIR = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0]));

// The raw schema objects, for code that builds its own routed settings,
// plus a routed view over them like the one the extension uses.
export function createIsolatedStore(extensionDir = EXTENSION_DIR) {
    const source = Gio.SettingsSchemaSource.new_from_directory(
        `${extensionDir}/schemas`,
        Gio.SettingsSchemaSource.get_default(),
        false
    );
    const file = GLib.build_filenamev(
        [GLib.dir_make_tmp('simple-taskbar-tests-XXXXXX'), 'settings.ini']);
    // Keys sit directly under the root path, so the backend needs a root
    // group name or the writes are silently dropped.
    const backend = Gio.keyfile_settings_backend_new(file, ROOT_PATH, 'settings');
    // The schemas are not relocatable, so no path may be passed here.
    const create = id => new Gio.Settings({
        settings_schema: source.lookup(id, true),
        backend,
    });
    const main = create(SCHEMA_ID);
    const legacy = create(`${SCHEMA_ID}.legacy`);
    const settings = createRoutedSettings(main, legacy);
    for (const [key, value] of Object.entries(TEST_GLOBALS))
        settings.set_int(key, value);
    return {main, legacy, settings};
}

export function createIsolatedSettings(extensionDir = EXTENSION_DIR) {
    return createIsolatedStore(extensionDir).settings;
}

let failures = 0;

export function check(name, actual, expected) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        print(`ok   ${name}`);
        return;
    }
    failures++;
    print(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n` +
        `  expected ${JSON.stringify(expected)}`);
}

export function finish() {
    print(failures ? `FAILURE: ${failures} failed` : 'ALL PASS');
    if (failures)
        System.exit(1);
}
