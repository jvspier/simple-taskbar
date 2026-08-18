// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 sultech

export const MIN_PANEL_HEIGHT = 30;
export const STANDARD_MIN_PANEL_HEIGHT = 32;
export const ICON_VERTICAL_RESERVE = 17;

// Upper bounds are deliberately generous rather than tuned to any icon
// theme: scalable icons have no real ceiling, and which raster sizes exist
// differs per theme and per application.
export const MAX_PANEL_HEIGHT = 256;
export const MAX_ICON_SIZE = 256;

// Beyond this, an application that ships only traditional raster artwork
// (the 16/22/24/32/48 ladder) may be upscaled. Scalable icons are fine.
export const RASTER_ICON_LIMIT = 48;
