// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 sultech

// Per-monitor sizing overrides.
//
// The sizing keys (panel height, icon size, spacing, paddings) are global,
// which forces one pixel size across monitors of very different pixel
// densities. This module resolves those globals into per-monitor values:
// every monitor may carry a scale percentage applied to the global sizes
// plus optional explicit overrides for individual keys.
//
// Overrides live in a single JSON string setting keyed by the monitor's own
// identity (vendor, product and serial from its EDID) rather than by the
// connector it happens to occupy, because docks hand out connector names
// dynamically: the same screen can be DP-6 at one desk and DP-7 at another.
// Entries written by earlier versions are keyed by connector and are still
// honoured as a fallback.
// Both the shell and the preferences process import this file, so it must
// stay free of Meta, St and Gtk imports.

import {
    ICON_VERTICAL_RESERVE,
    MAX_ICON_SIZE,
    MAX_PANEL_HEIGHT,
} from './panelSizing.js';

export const SIZING_SETTING_KEY = 'per-monitor-sizing';

export const MINIMUM_SCALE = 50;
export const MAXIMUM_SCALE = 150;
export const DEFAULT_SCALE = 100;

// Keys that participate in per-monitor sizing, with the ranges declared by
// the schema. `automatic` marks a sentinel that must survive scaling
// untouched, because it selects a behaviour rather than a pixel size.
export const SIZING_KEYS = [
    {key: 'panel-height', lower: 30, upper: MAX_PANEL_HEIGHT},
    {key: 'icon-size', lower: 15, upper: MAX_ICON_SIZE},
    {key: 'icon-spacing', lower: -5, upper: 16},
    {key: 'panel-button-padding', lower: -1, upper: 20, automatic: -1},
    {key: 'start-button-padding', lower: 0, upper: 20},
];

const RANGES = new Map(SIZING_KEYS.map(entry => [entry.key, entry]));

// Stable key for one physical screen. Falls back to the connector when the
// display reports no usable identity, which is the case for the virtual
// monitors used in nested test sessions.
export function monitorKey({vendor, product, serial, connector} = {}) {
    const parts = [vendor, product, serial]
        .map(part => (part ?? '').trim());
    if (parts[0] && parts[1])
        return parts.join('|');

    return connector || null;
}

// Accepts either a full identity or a bare connector string, so callers that
// only know the connector still work.
export function asIdentity(value) {
    if (!value)
        return null;

    if (typeof value === 'string')
        return {key: value, connector: value};

    // Idempotent: an already-normalised identity carries no EDID fields, so
    // re-deriving its key would silently fall back to the connector.
    if (typeof value.key === 'string' && value.key)
        return value;

    const key = monitorKey(value);
    return key ? {key, connector: value.connector ?? null} : null;
}

// Human-readable form of a stored key, for monitors that are not attached.
export function describeMonitorKey(key) {
    const parts = String(key).split('|');
    return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : String(key);
}

function clampToRange(key, value) {
    const range = RANGES.get(key);
    return Math.min(Math.max(Math.round(value), range.lower), range.upper);
}

export function readMonitorSizing(settings) {
    let parsed;
    try {
        parsed = JSON.parse(settings.get_string(SIZING_SETTING_KEY));
    } catch {
        return {};
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return {};

    const data = {};
    for (const [connector, entry] of Object.entries(parsed)) {
        if (typeof connector !== 'string' || !connector)
            continue;

        const normalized = normalizeEntry(entry);
        if (normalized)
            data[connector] = normalized;
    }
    return data;
}

export function writeMonitorSizing(settings, data) {
    const cleaned = {};
    for (const [connector, entry] of Object.entries(data ?? {})) {
        const normalized = normalizeEntry(entry);
        if (normalized)
            cleaned[connector] = normalized;
    }

    const serialized = JSON.stringify(cleaned);
    if (settings.get_string(SIZING_SETTING_KEY) !== serialized)
        settings.set_string(SIZING_SETTING_KEY, serialized);
}

function normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        return null;

    const overrides = {};
    const rawOverrides = entry.overrides;
    if (rawOverrides && typeof rawOverrides === 'object') {
        for (const {key} of SIZING_KEYS) {
            const value = rawOverrides[key];
            if (Number.isFinite(value))
                overrides[key] = clampToRange(key, value);
        }
    }

    return {
        ...(typeof entry.label === 'string' && entry.label
            ? {label: entry.label} : {}),
        enabled: entry.enabled !== false,
        scale: Number.isFinite(entry.scale)
            ? Math.min(
                Math.max(Math.round(entry.scale), MINIMUM_SCALE),
                MAXIMUM_SCALE
            )
            : DEFAULT_SCALE,
        overrides,
    };
}

// Default state for a monitor that has never been customized: sizing
// follows the global settings until it is explicitly switched on.
export function emptyMonitorEntry() {
    return {enabled: false, scale: DEFAULT_SCALE, overrides: {}};
}

export function getMonitorEntry(data, identityOrConnector) {
    const identity = asIdentity(identityOrConnector);
    if (!identity)
        return emptyMonitorEntry();

    const direct = normalizeEntry(data?.[identity.key]);
    if (direct)
        return direct;

    // Written before sizing was keyed by monitor identity.
    if (identity.connector && identity.connector !== identity.key) {
        const legacy = normalizeEntry(data?.[identity.connector]);
        if (legacy)
            return legacy;
    }
    return emptyMonitorEntry();
}

// Sizing as configured in the global preference keys.
export function globalSizing(settings) {
    const sizing = {};
    for (const {key} of SIZING_KEYS)
        sizing[key] = settings.get_int(key);
    return sizing;
}

// Resolve the sizing that applies to a single monitor.
//
// `connector` may be null (monitor identity unknown), in which case the
// global sizing is used unchanged.
export function resolveSizing(settings, identityOrConnector, data = null) {
    const base = globalSizing(settings);
    // Both modes pick their own proportions on purpose, so the icon
    // reserve must not be enforced against them.
    const fixedProportions =
        settings.get_boolean('default-gnome-panel') ||
        settings.get_boolean('windows-xp-theme-enabled');
    const identity = asIdentity(identityOrConnector);
    const entry = identity
        ? getMonitorEntry(data ?? readMonitorSizing(settings), identity)
        : null;

    if (!entry || !entry.enabled)
        return reconcile(base, new Set(), fixedProportions);

    const factor = entry.scale / 100;
    const resolved = {};
    for (const {key, automatic} of SIZING_KEYS) {
        const value = base[key];
        resolved[key] = value === automatic
            ? value
            : clampToRange(key, value * factor);
    }

    const explicit = new Set();
    for (const {key} of SIZING_KEYS) {
        const override = entry.overrides[key];
        if (Number.isFinite(override)) {
            resolved[key] = clampToRange(key, override);
            explicit.add(key);
        }
    }

    return reconcile(resolved, explicit, fixedProportions);
}

// The panel must stay tall enough for its icons. When the height was set
// explicitly the icons give way, otherwise the panel grows -- the same
// preference the global settings express in WindowsXpModeController.
function reconcile(sizing, explicit, fixedProportions) {
    const result = {};
    for (const {key} of SIZING_KEYS)
        result[key] = clampToRange(key, sizing[key]);

    if (fixedProportions)
        return result;

    const minimumHeight = result['icon-size'] + ICON_VERTICAL_RESERVE;
    if (result['panel-height'] >= minimumHeight)
        return result;

    if (explicit.has('panel-height') && !explicit.has('icon-size')) {
        result['icon-size'] = clampToRange(
            'icon-size',
            result['panel-height'] - ICON_VERTICAL_RESERVE
        );
    } else {
        result['panel-height'] = clampToRange('panel-height', minimumHeight);
    }

    // The panel height is capped, so very large icons may still not fit.
    if (result['panel-height'] < result['icon-size'] + ICON_VERTICAL_RESERVE) {
        result['icon-size'] = clampToRange(
            'icon-size',
            result['panel-height'] - ICON_VERTICAL_RESERVE
        );
    }
    return result;
}

export function sizingEquals(a, b) {
    if (!a || !b)
        return false;

    return SIZING_KEYS.every(({key}) => a[key] === b[key]);
}
