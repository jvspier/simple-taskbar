// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 sultech

// Enumerates the attached screens for the preferences window. Geometry and
// names come from Gdk; the EDID vendor, product and serial that identify a
// screen across docks come from Mutter, which is the only source for them in
// this process.

import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';

const DISPLAY_CONFIG = {
    name: 'org.gnome.Mutter.DisplayConfig',
    path: '/org/gnome/Mutter/DisplayConfig',
};

// connector -> {vendor, product, serial}
function readMonitorSpecs() {
    const specs = new Map();
    try {
        const reply = Gio.DBus.session.call_sync(
            DISPLAY_CONFIG.name,
            DISPLAY_CONFIG.path,
            DISPLAY_CONFIG.name,
            'GetCurrentState',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            2000,
            null
        );
        const [, monitors] = reply.deepUnpack();
        for (const monitor of monitors) {
            const [connector, vendor, product, serial] = monitor[0];
            specs.set(connector, {vendor, product, serial});
        }
    } catch {
        // Without Mutter the connector alone still identifies a screen well
        // enough to configure the session in front of the user.
    }
    return specs;
}

export function listMonitors() {
    const specs = readMonitorSpecs();
    const monitors = Gdk.Display.get_default()?.get_monitors() ?? null;
    const found = [];
    if (!monitors)
        return found;

    for (let index = 0; index < monitors.get_n_items(); index++) {
        const monitor = monitors.get_item(index);
        const connector = monitor?.connector;
        if (!connector)
            continue;

        const geometry = monitor.get_geometry();
        const spec = specs.get(connector) ?? {};
        found.push({
            connector,
            vendor: spec.vendor,
            product: spec.product,
            serial: spec.serial,
            // `description` names the built-in panel properly, where `model`
            // is only the raw EDID identifier.
            name: monitor.description || monitor.model || connector,
            resolution: `${geometry.width}×${geometry.height}`,
        });
    }
    return found;
}
