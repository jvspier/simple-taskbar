// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 sultech

// A settings view for the panel on one monitor. Sizing keys answer with the
// value resolved for that monitor; everything else passes straight through.
// Panels wrap this in their usual CachedSettings or DockPanelSettings, so
// the sizing code above it needs no knowledge of monitors.
//
// The monitor identity is fixed for the lifetime of the view: panels are
// rebuilt whenever the monitor layout changes.

import {RemappedSettings} from './remappedSettings.js';
import {
    asIdentity,
    parseMonitorSizing,
    resolveSizingKey,
    SIZING_SETTING_KEY,
    sizingKeyFor,
} from './monitorSizing.js';

export class MonitorSizedSettings extends RemappedSettings {
    constructor(settings, identity) {
        super(settings);
        this._identity = asIdentity(identity);
        this._serialized = null;
        this._data = null;
        this._connections = new Map();
        this._nextConnectionId = 1;
    }

    get mainSettings() {
        return this._settings.mainSettings ?? this._settings;
    }

    get monitorIdentity() {
        return this._identity;
    }

    _sizingData() {
        const serialized = this._settings.get_string(SIZING_SETTING_KEY);
        if (serialized !== this._serialized) {
            this._serialized = serialized;
            this._data = parseMonitorSizing(serialized);
        }
        return this._data;
    }

    // A sized key changes when either its global value or the per-monitor
    // overrides change.
    _settingSignals(signal) {
        if (signal.startsWith('changed::') &&
            sizingKeyFor(signal.slice('changed::'.length))) {
            return [signal, `changed::${SIZING_SETTING_KEY}`];
        }
        return [signal];
    }

    get_int(key) {
        if (!this._identity)
            return this._settings.get_int(key);

        return resolveSizingKey(
            this._settings,
            this._identity,
            key,
            this._sizingData()
        ) ?? this._settings.get_int(key);
    }

    connect(signal, handler) {
        const id = this._nextConnectionId++;
        this._connections.set(id, this._settingSignals(signal).map(
            target => this._settings.connect(target, handler)
        ));
        return id;
    }

    disconnect(id) {
        for (const handlerId of this._connections.get(id) ?? [])
            this._settings.disconnect(handlerId);
        this._connections.delete(id);
    }
}
