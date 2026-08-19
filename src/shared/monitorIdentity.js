// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 sultech

// Identifies the physical screen behind a shell monitor index, so per-monitor
// settings can follow the screen rather than the connector it is plugged
// into. Shell process only -- the preferences process reads the same fields
// from Mutter's DisplayConfig instead.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function monitorManager() {
    return global.backend?.get_monitor_manager?.() ?? null;
}

// {vendor, product, serial, connector} for a monitor index, or null.
export function identityForMonitorIndex(index) {
    if (!Number.isInteger(index) || index < 0)
        return null;

    const manager = monitorManager();
    if (!manager)
        return null;

    for (const monitor of manager.get_monitors()) {
        if (!monitor.is_active())
            continue;

        const connector = monitor.get_connector();
        if (manager.get_monitor_for_connector(connector) !== index)
            continue;

        return {
            vendor: monitor.get_vendor(),
            product: monitor.get_product(),
            serial: monitor.get_serial(),
            connector,
        };
    }
    return null;
}

export function identityForMonitor(monitor) {
    return identityForMonitorIndex(monitor?.index ?? -1);
}

export function primaryIdentity() {
    return identityForMonitor(Main.layoutManager.primaryMonitor);
}
