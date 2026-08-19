// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 sultech

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {RASTER_ICON_LIMIT} from '../shared/panelSizing.js';
import {listMonitors} from './monitorList.js';
import {
    describeMonitorKey,
    getMonitorEntry,
    monitorKey,
    globalSizing,
    MAXIMUM_SCALE,
    MINIMUM_SCALE,
    readMonitorSizing,
    resolveSizing,
    SIZING_KEYS,
    SIZING_SETTING_KEY,
    writeMonitorSizing,
} from '../shared/monitorSizing.js';

// Resolved lazily so the gettext domain is bound before it is used.
function overrideTitle(key) {
    switch (key) {
    case 'panel-height':
        return _('Panel Height');
    case 'icon-size':
        return _('Icon Size');
    case 'icon-spacing':
        return _('Icon Spacing');
    case 'panel-button-padding':
        return _('Panel Button Padding');
    case 'start-button-padding':
        return _('Start Button Padding');
    default:
        return key;
    }
}

export function addPerMonitorSizingGroup({page, settings, connectSettings}) {
    const group = new Adw.PreferencesGroup({
        title: _('Per-Monitor Sizing'),
        description: _(
            'Scale the taskbar independently on each monitor. Displays with a lower pixel density need smaller values to look the same size.'
        ),
    });
    page.add(group);

    // Only used to notice screens being attached or removed; the list
    // itself comes from listMonitors(), which also carries the EDID fields.
    const monitors = Gdk.Display.get_default()?.get_monitors() ?? null;
    let rows = [];
    let syncing = false;

    // Writing always moves an entry onto the identity key, which quietly
    // migrates anything stored against a connector by an earlier version.
    const updateEntry = (monitor, mutate) => {
        const data = readMonitorSizing(settings);
        const key = monitorKey(monitor);
        const entry = getMonitorEntry(data, monitor);
        entry.label = monitor.name;
        mutate(entry);
        data[key] = entry;
        if (monitor.connector && monitor.connector !== key)
            delete data[monitor.connector];
        writeMonitorSizing(settings, data);
    };

    const describeResolved = monitor => {
        const resolved = resolveSizing(settings, monitor);
        const height = `${_('Panel')} ${resolved['panel-height']} px`;
        const icons = `${_('Icons')} ${resolved['icon-size']} px`;
        return `${height} · ${icons}`;
    };

    const buildMonitorRow = monitor => {
        const {connector, name, resolution} = monitor;
        const entry = getMonitorEntry(readMonitorSizing(settings), monitor);
        const expander = new Adw.ExpanderRow({
            title: name,
            show_enable_switch: true,
            enable_expansion: entry.enabled,
        });
        const syncSubtitle = () => {
            expander.subtitle = [
                connector,
                resolution,
                describeResolved(monitor),
            ].join(' · ');
        };
        syncSubtitle();
        expander.connect('notify::enable-expansion', () => {
            if (syncing)
                return;

            updateEntry(monitor, current => {
                current.enabled = expander.enable_expansion;
            });
        });

        const scaleRow = Adw.SpinRow.new_with_range(
            MINIMUM_SCALE,
            MAXIMUM_SCALE,
            1
        );
        scaleRow.title = _('Scale (%)');
        scaleRow.subtitle = _(
            'Percentage applied to the global sizing values'
        );
        // Scaling stops at the same limits the global settings use, so a
        // large scale can quietly stop having any effect. Say so.
        const scaleSubtitle = current => {
            const base = globalSizing(settings);
            // Only the two values that define how big the taskbar looks
            // are worth reporting; the paddings have small ranges of their
            // own and reaching them says nothing useful.
            const capped = SIZING_KEYS.some(({key, lower, upper}) => {
                if (key !== 'panel-height' && key !== 'icon-size')
                    return false;
                if (Number.isFinite(current.overrides[key]))
                    return false;

                const scaled = Math.round(base[key] * current.scale / 100);
                return scaled > upper || scaled < lower;
            });
            scaleRow.subtitle = capped
                ? _('Percentage applied to the global sizing values · already at the size limit')
                : _('Percentage applied to the global sizing values');
        };
        scaleRow.set_value(entry.scale);
        scaleRow.connect('notify::value', row => {
            if (syncing)
                return;

            updateEntry(monitor, current => {
                current.scale = Math.round(row.get_value());
            });
        });
        expander.add_row(scaleRow);

        const advanced = new Adw.ExpanderRow({
            title: _('Advanced overrides'),
            subtitle: _(
                'Set individual values instead of deriving them from the scale'
            ),
        });
        expander.add_row(advanced);

        // Every override row shows the value that is actually in effect,
        // whether it came from the scale or from an override, so stepping a
        // row always moves from what the user can see. Touching a row pins
        // it; its reset button hands it back to the scale.
        const overrideRows = [];
        for (const {key, lower, upper} of SIZING_KEYS) {
            const row = Adw.SpinRow.new_with_range(lower, upper, 1);
            row.title = overrideTitle(key);
            const reset = new Gtk.Button({
                icon_name: 'edit-undo-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: _('Follow the scale again'),
                css_classes: ['flat'],
            });
            reset.connect('clicked', () => {
                updateEntry(monitor, current => {
                    delete current.overrides[key];
                });
            });
            row.connect('notify::value', widget => {
                if (syncing)
                    return;

                const value = Math.round(widget.get_value());
                updateEntry(monitor, current => {
                    current.overrides[key] = value;
                });
            });
            row.add_suffix(reset);
            advanced.add_row(row);
            overrideRows.push({key, row, reset});
        }

        // Must be called with `syncing` held, since it writes to the spins.
        const syncOverrideRows = entry => {
            const resolved = resolveSizing(settings, monitor);
            scaleSubtitle(entry);
            for (const {key, row, reset} of overrideRows) {
                const override = entry.overrides[key];
                const overridden = Number.isFinite(override);
                const value = overridden ? override : resolved[key];
                if (Math.round(row.get_value()) !== value)
                    row.set_value(value);
                reset.visible = overridden;
                const state = overridden
                    ? _('Overriding the scale')
                    : _('Following the scale');
                // A monitor can be scaled past the raster icon ladder even
                // when the global size is below it, so warn per monitor too.
                row.subtitle = key === 'icon-size' &&
                    resolved[key] > RASTER_ICON_LIMIT
                    ? `${state} · ${_('may look soft above')} ${RASTER_ICON_LIMIT} px`
                    : state;
            }
        };

        const clearRow = new Adw.ActionRow({
            title: _('Clear overrides'),
            subtitle: _('Return every value above to automatic'),
        });
        const clearButton = new Gtk.Button({
            label: _('Clear'),
            valign: Gtk.Align.CENTER,
        });
        clearButton.connect('clicked', () => {
            updateEntry(monitor, current => {
                current.overrides = {};
            });
        });
        clearRow.add_suffix(clearButton);
        clearRow.activatable_widget = clearButton;
        advanced.add_row(clearRow);

        const sync = () => {
            const current = getMonitorEntry(
                readMonitorSizing(settings),
                monitor
            );
            syncing = true;
            try {
                expander.enable_expansion = current.enabled;
                if (scaleRow.get_value() !== current.scale)
                    scaleRow.set_value(current.scale);
                syncOverrideRows(current);
            } finally {
                syncing = false;
            }
            syncSubtitle();
        };

        syncing = true;
        try {
            syncOverrideRows(entry);
        } finally {
            syncing = false;
        }
        return {row: expander, sync};
    };

    // Monitors that are no longer attached keep their settings, but are
    // only shown so they can be forgotten.
    const buildStaleRow = key => {
        const stored = readMonitorSizing(settings)[key];
        const row = new Adw.ActionRow({
            title: stored?.label || describeMonitorKey(key),
            subtitle: _('Not connected · settings kept'),
        });
        const forgetButton = new Gtk.Button({
            label: _('Forget'),
            valign: Gtk.Align.CENTER,
        });
        forgetButton.connect('clicked', () => {
            const data = readMonitorSizing(settings);
            delete data[key];
            writeMonitorSizing(settings, data);
        });
        row.add_suffix(forgetButton);
        row.activatable_widget = forgetButton;
        return {row, sync: () => {}};
    };

    const connectedMonitors = () => listMonitors();

    // Stored entries with no screen attached. An entry still keyed by a
    // connector counts as attached while that connector is present, since
    // resolution falls back to it.
    const staleKeys = () => {
        const live = new Set();
        for (const monitor of connectedMonitors()) {
            live.add(monitorKey(monitor));
            if (monitor.connector)
                live.add(monitor.connector);
        }
        return Object.keys(readMonitorSizing(settings))
            .filter(key => !live.has(key))
            .sort();
    };

    let knownStale = '';
    const rebuild = () => {
        for (const {row} of rows)
            group.remove(row);
        rows = [];

        for (const monitor of connectedMonitors())
            rows.push(buildMonitorRow(monitor));

        const stale = staleKeys();
        for (const key of stale)
            rows.push(buildStaleRow(key));
        knownStale = stale.join(',');

        if (rows.length === 0) {
            rows.push({
                row: new Adw.ActionRow({
                    title: _('No monitors detected'),
                    subtitle: _(
                        'Per-monitor sizing needs at least one connected display'
                    ),
                }),
                sync: () => {},
            });
        }

        for (const {row} of rows)
            group.add(row);
    };

    rebuild();

    const syncAll = () => {
        for (const {sync} of rows)
            sync();
    };

    // Only the list of disconnected monitors can add or remove rows;
    // everything else is a value change the existing rows can absorb, so
    // editing one monitor never collapses the row being edited.
    connectSettings(settings, `changed::${SIZING_SETTING_KEY}`, () => {
        if (staleKeys().join(',') !== knownStale) {
            rebuild();
            return;
        }
        syncAll();
    });
    for (const {key} of SIZING_KEYS)
        connectSettings(settings, `changed::${key}`, syncAll);
    connectSettings(settings, 'changed::default-gnome-panel', syncAll);
    connectSettings(settings, 'changed::windows-xp-theme-enabled', syncAll);

    if (monitors) {
        const handler = monitors.connect('items-changed', rebuild);
        group.connect('destroy', () => monitors.disconnect(handler));
    }

    return group;
}
