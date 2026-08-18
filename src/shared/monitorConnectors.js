// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 sultech

// Maps shell monitor indices onto the connector names used to key
// per-monitor sizing overrides. Shell process only -- the preferences
// process reads the same connector names from Gdk instead.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function monitorManager() {
    return global.backend?.get_monitor_manager?.() ?? null;
}

// Connector name for a monitor index, or null when it cannot be resolved.
export function connectorForMonitorIndex(index) {
    if (!Number.isInteger(index) || index < 0)
        return null;

    const manager = monitorManager();
    if (!manager)
        return null;

    for (const monitor of manager.get_monitors()) {
        if (!monitor.is_active())
            continue;

        const connector = monitor.get_connector();
        if (manager.get_monitor_for_connector(connector) === index)
            return connector;
    }
    return null;
}

export function connectorForMonitor(monitor) {
    return connectorForMonitorIndex(monitor?.index ?? -1);
}

export function primaryConnector() {
    return connectorForMonitor(Main.layoutManager.primaryMonitor);
}
