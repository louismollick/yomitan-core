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

import type { Summary } from '../types/dictionary-importer.js';
import type { KanjiDictionaryEntry, TermDictionaryEntry } from '../types/dictionary.js';
import { NoOpContentManager } from './content-manager.js';
import { DisplayGenerator } from './display-generator.js';
import { applyExtensionDisplayDefaults } from './display-render-preset.js';
import { applyPopupTheme } from './popup-theme.js';
import type { PopupTheme } from './popup-theme.js';
import { DISPLAY_CSS } from './styles/display-styles.js';
import { DISPLAY_TEMPLATES } from './templates/display-templates.js';

export type RenderHostOptions = {
    theme?: PopupTheme;
    language?: string;
    glossaryLayoutMode?: string;
    resultOutputMode?: string;
};

export type TermEntryRendererCreateOptions = RenderHostOptions & {
    document?: Document;
};

export type KanjiEntryRendererCreateOptions = TermEntryRendererCreateOptions;

export type RenderedTermEntry = {
    index: number;
    entry: TermDictionaryEntry;
    entryNode: HTMLElement;
};

export type RenderedKanjiEntry = {
    index: number;
    entry: KanjiDictionaryEntry;
    entryNode: HTMLElement;
};

export type TermEntryRenderer = {
    prepareHost(host: HTMLElement, options?: RenderHostOptions): void;
    renderTermEntries(
        entries: TermDictionaryEntry[],
        dictionaryInfo: Summary[],
        options?: RenderHostOptions,
    ): RenderedTermEntry[];
    updateHost(host: HTMLElement, options?: RenderHostOptions): void;
    destroy(): void;
};

export type KanjiEntryRenderer = {
    prepareHost(host: HTMLElement, options?: RenderHostOptions): void;
    renderKanjiEntries(
        entries: KanjiDictionaryEntry[],
        dictionaryInfo: Summary[],
        options?: RenderHostOptions,
    ): RenderedKanjiEntry[];
    updateHost(host: HTMLElement, options?: RenderHostOptions): void;
    destroy(): void;
};

const POPUP_ROOT_CLASS = 'yomitan-popup-root';
const POPUP_STYLE_ATTR = 'data-yomitan-popup-style';

const scopedDisplayCss = DISPLAY_CSS.replaceAll(':root', `.${POPUP_ROOT_CLASS}`);

const styleRegistry = new WeakMap<Document, HTMLStyleElement>();

class EntryRendererBase {
    private readonly document: Document;
    protected readonly displayGenerator: DisplayGenerator;
    private options: RenderHostOptions;

    constructor(options?: TermEntryRendererCreateOptions, documentArg?: Document) {
        const { document: createDocument, ...renderOptions } = options ?? {};
        this.options = {
            theme: 'dark',
            ...renderOptions,
        };

        this.document = documentArg ?? createDocument ?? _getDefaultDocument();
        this.displayGenerator = new DisplayGenerator(this.document, new NoOpContentManager(), DISPLAY_TEMPLATES);
    }

    prepareHost(host: HTMLElement, options?: RenderHostOptions): void {
        this._mergeOptions(options);
        host.classList.add(POPUP_ROOT_CLASS);
        this._injectStylesOnce(host.ownerDocument);
        this._applyHostDefaults(host);
    }

    updateHost(host: HTMLElement, options?: RenderHostOptions): void {
        this._mergeOptions(options);
        host.classList.add(POPUP_ROOT_CLASS);
        this._injectStylesOnce(host.ownerDocument);
        this._applyHostDefaults(host);
    }

    destroy(): void {
        // No-op: stylesheet dedupe is global-per-document and reused across instances.
    }

    protected _prepareRender(options?: RenderHostOptions): void {
        this._mergeOptions(options);

        if (typeof this.options.language === 'string') {
            this.displayGenerator.updateLanguage(this.options.language);
        }
    }

    private _mergeOptions(options?: RenderHostOptions): void {
        if (typeof options !== 'undefined') {
            this.options = { ...this.options, ...options };
        }
    }

    private _injectStylesOnce(document: Document): void {
        const existing = styleRegistry.get(document);
        if (existing?.isConnected) {
            return;
        }

        const style = document.createElement('style');
        style.setAttribute(POPUP_STYLE_ATTR, 'true');
        style.textContent = scopedDisplayCss;

        if (document.head) {
            document.head.appendChild(style);
        } else {
            document.documentElement.appendChild(style);
        }

        styleRegistry.set(document, style);
    }

    private _applyHostDefaults(host: HTMLElement): void {
        const theme = this.options.theme ?? 'dark';
        applyExtensionDisplayDefaults(host, {
            popupTheme: { theme },
        });
        applyPopupTheme(host, { theme });

        if (typeof this.options.language === 'string') {
            host.dataset.language = this.options.language;
        } else {
            delete host.dataset.language;
        }

        if (typeof this.options.glossaryLayoutMode === 'string') {
            host.dataset.glossaryLayoutMode = this.options.glossaryLayoutMode;
        } else {
            delete host.dataset.glossaryLayoutMode;
        }

        if (typeof this.options.resultOutputMode === 'string') {
            host.dataset.resultOutputMode = this.options.resultOutputMode;
        } else {
            delete host.dataset.resultOutputMode;
        }
    }
}

class TermEntryRendererImpl extends EntryRendererBase implements TermEntryRenderer {
    renderTermEntries(
        entries: TermDictionaryEntry[],
        dictionaryInfo: Summary[],
        options?: RenderHostOptions,
    ): RenderedTermEntry[] {
        this._prepareRender(options);

        return entries.map((entry, index) => ({
            index,
            entry,
            entryNode: this.displayGenerator.createTermEntry(entry, dictionaryInfo),
        }));
    }
}

class KanjiEntryRendererImpl extends EntryRendererBase implements KanjiEntryRenderer {
    renderKanjiEntries(
        entries: KanjiDictionaryEntry[],
        dictionaryInfo: Summary[],
        options?: RenderHostOptions,
    ): RenderedKanjiEntry[] {
        this._prepareRender(options);

        return entries.map((entry, index) => ({
            index,
            entry,
            entryNode: this.displayGenerator.createKanjiEntry(entry, dictionaryInfo),
        }));
    }
}

export function createTermEntryRenderer(options?: TermEntryRendererCreateOptions): TermEntryRenderer {
    return new TermEntryRendererImpl(options);
}

export function createKanjiEntryRenderer(options?: KanjiEntryRendererCreateOptions): KanjiEntryRenderer {
    return new KanjiEntryRendererImpl(options);
}

function _getDefaultDocument(): Document {
    if (typeof globalThis.document === 'undefined') {
        throw new Error('Entry renderers require a DOM Document. Pass options.document in non-browser environments.');
    }
    return globalThis.document;
}
