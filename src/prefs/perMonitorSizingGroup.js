// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 sultech

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    getMonitorEntry,
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

    const monitors = Gdk.Display.get_default()?.get_monitors() ?? null;
    let rows = [];
    let syncing = false;

    const updateEntry = (connector, mutate) => {
        const data = readMonitorSizing(settings);
        const entry = getMonitorEntry(data, connector);
        mutate(entry);
        data[connector] = entry;
        writeMonitorSizing(settings, data);
    };

    const describeResolved = connector => {
        const resolved = resolveSizing(settings, connector);
        const height = `${_('Panel')} ${resolved['panel-height']} px`;
        const icons = `${_('Icons')} ${resolved['icon-size']} px`;
        return `${height} · ${icons}`;
    };

    const buildMonitorRow = ({connector, name, resolution}) => {
        const entry = getMonitorEntry(readMonitorSizing(settings), connector);
        const expander = new Adw.ExpanderRow({
            title: name,
            show_enable_switch: true,
            enable_expansion: entry.enabled,
        });
        const syncSubtitle = () => {
            expander.subtitle = [
                connector,
                resolution,
                describeResolved(connector),
            ].join(' · ');
        };
        syncSubtitle();
        expander.connect('notify::enable-expansion', () => {
            if (syncing)
                return;

            updateEntry(connector, current => {
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
        scaleRow.set_value(entry.scale);
        scaleRow.connect('notify::value', row => {
            if (syncing)
                return;

            updateEntry(connector, current => {
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

        // Each override row keeps one value below its usable range as an
        // "automatic" sentinel, the same convention the global button
        // padding setting uses. The subtitle spells out which value is
        // actually in effect so the sentinel never has to be guessed.
        const overrideRows = [];
        for (const {key, lower, upper} of SIZING_KEYS) {
            const sentinel = lower - 1;
            const row = Adw.SpinRow.new_with_range(sentinel, upper, 1);
            row.title = overrideTitle(key);
            const override = entry.overrides[key];
            row.set_value(Number.isFinite(override) ? override : sentinel);
            row.connect('notify::value', widget => {
                if (syncing)
                    return;

                const value = Math.round(widget.get_value());
                updateEntry(connector, current => {
                    if (value === sentinel)
                        delete current.overrides[key];
                    else
                        current.overrides[key] = value;
                });
            });
            advanced.add_row(row);
            overrideRows.push({key, row, sentinel});
        }

        const syncOverrideSubtitles = () => {
            const resolved = resolveSizing(settings, connector);
            for (const {key, row, sentinel} of overrideRows) {
                row.subtitle = row.get_value() === sentinel
                    ? `${_('Automatic')} · ${resolved[key]}`
                    : _('Overriding the scaled value');
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
            updateEntry(connector, current => {
                current.overrides = {};
            });
        });
        clearRow.add_suffix(clearButton);
        clearRow.activatable_widget = clearButton;
        advanced.add_row(clearRow);

        const sync = () => {
            const current = getMonitorEntry(
                readMonitorSizing(settings),
                connector
            );
            syncing = true;
            try {
                expander.enable_expansion = current.enabled;
                if (scaleRow.get_value() !== current.scale)
                    scaleRow.set_value(current.scale);
                for (const {key, row, sentinel} of overrideRows) {
                    const value = Number.isFinite(current.overrides[key])
                        ? current.overrides[key]
                        : sentinel;
                    if (row.get_value() !== value)
                        row.set_value(value);
                }
            } finally {
                syncing = false;
            }
            syncSubtitle();
            syncOverrideSubtitles();
        };

        syncOverrideSubtitles();
        return {row: expander, sync};
    };

    // Monitors that are no longer attached keep their settings, but are
    // only shown so they can be forgotten.
    const buildStaleRow = connector => {
        const row = new Adw.ActionRow({
            title: connector,
            subtitle: _('Not connected · settings kept'),
        });
        const forgetButton = new Gtk.Button({
            label: _('Forget'),
            valign: Gtk.Align.CENTER,
        });
        forgetButton.connect('clicked', () => {
            const data = readMonitorSizing(settings);
            delete data[connector];
            writeMonitorSizing(settings, data);
        });
        row.add_suffix(forgetButton);
        row.activatable_widget = forgetButton;
        return {row, sync: () => {}};
    };

    const connectedMonitors = () => {
        const found = [];
        if (!monitors)
            return found;

        for (let index = 0; index < monitors.get_n_items(); index++) {
            const monitor = monitors.get_item(index);
            const connector = monitor?.connector;
            if (!connector)
                continue;

            const geometry = monitor.get_geometry();
            found.push({
                connector,
                // `description` names the built-in panel properly, where
                // `model` is only the raw EDID identifier.
                name: monitor.description || monitor.model || connector,
                resolution: `${geometry.width}×${geometry.height}`,
            });
        }
        return found;
    };

    // Connectors with stored settings that are not attached right now.
    const staleConnectors = () => {
        const connected = new Set(
            connectedMonitors().map(monitor => monitor.connector)
        );
        return Object.keys(readMonitorSizing(settings))
            .filter(connector => !connected.has(connector))
            .sort();
    };

    let knownStale = '';
    const rebuild = () => {
        for (const {row} of rows)
            group.remove(row);
        rows = [];

        for (const monitor of connectedMonitors())
            rows.push(buildMonitorRow(monitor));

        const stale = staleConnectors();
        for (const connector of stale)
            rows.push(buildStaleRow(connector));
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
        if (staleConnectors().join(',') !== knownStale) {
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
