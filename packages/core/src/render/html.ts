/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * HTML-string output of Yomitan's popup markup, for Node, WebViews and anywhere without a DOM.
 */

import type { StringElement } from '../dom/string-dom';
import type { ProfileOptions } from '../profile/profile';
import { fetchText } from '../upstream/ext/js/core/fetch-utilities.js';
import { type ThemeContext, getCustomCss, getDisplayAttributeEntries, getFontStyle } from './display-options';
import { findGlossImages } from './entry-renderer';

/** The stylesheets Yomitan's popup page loads, in its order. */
const POPUP_STYLESHEETS = ['/css/material.css', '/css/display.css', '/css/display-pronunciation.css', '/css/structured-content.css'];

let popupCss: Promise<string> | null = null;

/** Yomitan's popup CSS (icons inlined). It targets `:root[data-*]`, as in Yomitan. */
export function getPopupCss(): Promise<string> {
    popupCss ??= Promise.all(POPUP_STYLESHEETS.map((url) => fetchText(url))).then((sheets) => sheets.join('\n'));
    return popupCss;
}

/**
 * How dictionary images get their `src` in HTML output:
 * - `placeholder`: none; the image keeps `data-path`/`data-dictionary` on its link for the host to fill;
 * - `data-uri`: the image bytes inlined;
 * - `{ urlTemplate }`: a URL such as `app://media/{dictionary}/{path}` (values URL-encoded).
 */
export type HtmlMediaMode = 'placeholder' | 'data-uri' | { urlTemplate: string };

export type MediaLoader = (dictionary: string, path: string) => Promise<{ mediaType: string; content: Uint8Array } | null>;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without `btoa`, which some runtimes lack. */
export function encodeBase64(bytes: Uint8Array): string {
    let result = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = bytes[i + 1];
        const c = bytes[i + 2];
        result += BASE64[a >> 2] + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
        result += b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
        result += c === undefined ? '=' : BASE64[c & 63];
    }
    return result;
}

export async function resolveImages(root: StringElement, mode: HtmlMediaMode, loadMedia: MediaLoader): Promise<void> {
    if (mode === 'placeholder') {
        return;
    }
    for (const { image, dictionary, path } of findGlossImages(root)) {
        if (typeof mode === 'object') {
            image.setAttribute(
                'src',
                mode.urlTemplate
                    .replace(/\{dictionary\}/g, encodeURIComponent(dictionary))
                    .replace(/\{path\}/g, encodeURIComponent(path)),
            );
            continue;
        }
        const media = await loadMedia(dictionary, path);
        if (media !== null) {
            image.setAttribute('src', `data:${media.mediaType};base64,${encodeBase64(media.content)}`);
        }
    }
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** A standalone HTML document showing entries as Yomitan's popup would (for WebViews and previews). */
export async function renderHtmlDocument(entriesHtml: string, options: ProfileOptions, context: ThemeContext = {}): Promise<string> {
    const attributes = getDisplayAttributeEntries(options, context)
        .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
        .join('');
    const font = getFontStyle(options);
    const style = `font-family: ${font.fontFamily}; font-size: ${font.fontSize}; line-height: ${font.lineHeight};`;
    const css = `${await getPopupCss()}\n${getCustomCss(options)}`;
    return `<!DOCTYPE html><html${attributes} style="${escapeAttribute(style)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div class="content-outer"><div class="content"><div class="content-scroll" id="content-scroll"><div class="content-body" id="content-body"><div class="content-body-inner"><div id="dictionary-entries">${entriesHtml}</div></div></div></div></div></div></body></html>`;
}
