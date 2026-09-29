/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The popup's option attributes and custom CSS, ported from Yomitan's ext/js/display/display.js
 * (_updateDocumentOptions, _getCustomCss) and ext/js/app/theme-controller.js. Yomitan puts these on
 * the document root; renderers put them on their own root (a shadow host or a wrapper element).
 */

import type { ProfileOptions } from '../profile/profile';

export type ThemeContext = {
    /** The system colour scheme, for the `browser` theme. Default `light`. */
    browserTheme?: 'light' | 'dark';
    /** The host page's scheme, for the `site` theme. Default `light`. */
    siteTheme?: 'light' | 'dark';
    /** Yomitan's page type; `popup` (default) or `search`. */
    pageType?: 'popup' | 'search';
};

function resolveTheme(theme: string, browserTheme: string, siteTheme: string): string {
    switch (theme) {
        case 'site':
            return siteTheme;
        case 'browser':
            return browserTheme;
        default:
            return theme;
    }
}

/** `data-*` attributes (camelCase keys, as on `dataset`) that Yomitan's CSS keys off. */
export function getDisplayAttributes(options: ProfileOptions, context: ThemeContext = {}): Record<string, string> {
    const { general, anki, scanning } = options;
    const browserTheme = context.browserTheme ?? 'light';
    const siteTheme = context.siteTheme ?? 'light';
    return {
        pageType: context.pageType ?? 'popup',
        ankiEnabled: `${anki.enable}`,
        language: general.language,
        resultOutputMode: `${general.resultOutputMode}`,
        glossaryLayoutMode: `${general.glossaryLayoutMode}`,
        compactTags: `${general.compactTags}`,
        averageFrequency: `${general.averageFrequency}`,
        frequencyDisplayMode: `${general.frequencyDisplayMode}`,
        termDisplayMode: `${general.termDisplayMode}`,
        enableSearchTags: `${scanning.enableSearchTags}`,
        showPronunciationText: `${general.showPitchAccentDownstepNotation}`,
        showPronunciationDownstepPosition: `${general.showPitchAccentPositionNotation}`,
        showPronunciationGraph: `${general.showPitchAccentGraph}`,
        debug: `${general.debugInfo}`,
        popupDisplayMode: `${general.popupDisplayMode}`,
        popupCurrentIndicatorMode: `${general.popupCurrentIndicatorMode}`,
        popupActionBarVisibility: `${general.popupActionBarVisibility}`,
        popupActionBarLocation: `${general.popupActionBarLocation}`,
        theme: resolveTheme(general.popupTheme, browserTheme, siteTheme),
        outerTheme: resolveTheme(general.popupOuterTheme, browserTheme, siteTheme),
        siteTheme,
        browserTheme,
        themeRaw: general.popupTheme,
        outerThemeRaw: general.popupOuterTheme,
    };
}

function camelToKebab(name: string): string {
    return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/** The same attributes as `data-*` attribute names. */
export function getDisplayAttributeEntries(options: ProfileOptions, context?: ThemeContext): [string, string][] {
    return Object.entries(getDisplayAttributes(options, context)).map(([key, value]) => [
        `data-${camelToKebab(key)}`,
        value,
    ]);
}

/** Upstream's `addScopeToCss`: CSS nesting under a scope selector. */
export function addScopeToCss(css: string, scopeSelector: string): string {
    return `${scopeSelector} {${css}\n}`;
}

/** The profile's custom popup CSS plus each enabled dictionary's styles, scoped to its entries. */
export function getCustomCss(options: ProfileOptions): string {
    let customCss = options.general.customPopupCss;
    for (const { name, enabled, styles = '' } of options.dictionaries) {
        if (enabled) {
            const escapedTitle = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            customCss += `\n${addScopeToCss(styles, `[data-dictionary="${escapedTitle}"]`)}`;
        }
    }
    return customCss;
}

/** Inline style Yomitan applies to the popup root (`Display.setFontOptions`). */
export function getFontStyle(options: ProfileOptions): { fontFamily: string; fontSize: string; lineHeight: string } {
    const { fontFamily, fontSize, lineHeight } = options.general;
    return { fontFamily, fontSize: `${fontSize}px`, lineHeight };
}
