/*
 * Copyright (C) 2023-2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

export type PopupTheme = 'light' | 'dark' | 'browser' | 'site';
export type ResolvedTheme = 'light' | 'dark';

export type PopupThemeResolveOptions = {
    theme?: PopupTheme;
    siteTheme?: ResolvedTheme | null;
    siteOverride?: boolean;
    document?: Document;
    browserTheme?: ResolvedTheme;
};

export type ResolvedPopupThemeInfo = {
    theme: ResolvedTheme;
    siteTheme: ResolvedTheme;
    browserTheme: ResolvedTheme;
    themeRaw: PopupTheme;
};

/**
 * Resolves popup theme modes into a concrete light/dark theme value.
 * Mirrors the extension behavior used by ThemeController for popup content.
 */
export function resolvePopupTheme(options: PopupThemeResolveOptions = {}): ResolvedPopupThemeInfo {
    const themeRaw: PopupTheme = options.theme ?? 'site';
    const siteOverride = options.siteOverride ?? false;
    const view = _getView(options.document);
    const browserTheme = options.browserTheme ?? _computeBrowserTheme(view);
    const siteTheme = options.siteTheme ?? _computeSiteTheme(options.document, view);
    const theme = _resolveThemeValue(themeRaw, siteTheme, browserTheme, siteOverride);
    return { theme, siteTheme, browserTheme, themeRaw };
}

/**
 * Applies resolved popup theme attributes to a document element.
 */
export function applyPopupTheme(
    documentElement: HTMLElement,
    options: PopupThemeResolveOptions = {},
): ResolvedPopupThemeInfo {
    const resolved = resolvePopupTheme({
        ...options,
        document: options.document ?? documentElement.ownerDocument,
    });
    const data = documentElement.dataset;
    data.theme = resolved.theme;
    data.siteTheme = resolved.siteTheme;
    data.browserTheme = resolved.browserTheme;
    data.themeRaw = resolved.themeRaw;
    return resolved;
}

function _resolveThemeValue(
    theme: PopupTheme,
    computedSiteTheme: ResolvedTheme,
    browserTheme: ResolvedTheme,
    siteOverride: boolean,
): ResolvedTheme {
    switch (theme) {
        case 'site':
            return siteOverride ? browserTheme : computedSiteTheme;
        case 'browser':
            return browserTheme;
        default:
            return theme;
    }
}

function _computeBrowserTheme(view: Window | null): ResolvedTheme {
    if (view === null || typeof view.matchMedia !== 'function') {
        return 'light';
    }
    return view.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function _computeSiteTheme(doc: Document | undefined, view: Window | null): ResolvedTheme {
    if (view === null || typeof view.getComputedStyle !== 'function' || typeof doc === 'undefined') {
        return 'light';
    }

    const color = [255, 255, 255];
    const { documentElement, body } = doc;
    if (documentElement !== null) {
        _addColor(color, view.getComputedStyle(documentElement).backgroundColor);
    }
    if (body !== null) {
        _addColor(color, view.getComputedStyle(body).backgroundColor);
    }

    return color[0] < 128 && color[1] < 128 && color[2] < 128 ? 'dark' : 'light';
}

function _getView(doc?: Document): Window | null {
    if (typeof doc?.defaultView !== 'undefined' && doc.defaultView !== null) {
        return doc.defaultView;
    }
    if (typeof window !== 'undefined') {
        return window;
    }
    return null;
}

function _addColor(target: number[], cssColor: string | null | undefined): void {
    if (typeof cssColor !== 'string') {
        return;
    }
    const color = _getColorInfo(cssColor);
    if (color === null) {
        return;
    }

    const a = color[3];
    if (a <= 0) {
        return;
    }

    const aInv = 1 - a;
    for (let i = 0; i < 3; ++i) {
        target[i] = target[i] * aInv + color[i] * a;
    }
}

function _getColorInfo(cssColor: string): [number, number, number, number] | null {
    const m = /^\s*rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)\s*$/.exec(cssColor);
    if (m === null) {
        return null;
    }

    const alphaRaw = m[4];
    const alpha = alphaRaw ? Math.max(0, Math.min(1, Number.parseFloat(alphaRaw))) : 1;
    return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10), Number.parseInt(m[3], 10), alpha];
}
