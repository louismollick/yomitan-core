/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Renders dictionary entries with Yomitan's own DisplayGenerator (ADR-0009). The DOM it builds into
 * is pluggable: a browser document for `<yomitan-entries>`, or the built-in string DOM for HTML
 * strings (Node, WebViews, React Native previews).
 */

import {
    NODE_TYPES,
    StringDOMParser,
    StringDocument,
    StringDocumentFragment,
    type StringElement,
    createStringWindow,
} from '../dom/string-dom';
import { type UpstreamEnv, withUpstreamEnv } from '../platform/upstream-env';
import type { Summary } from '../storage/types';
import { fetchText } from '../upstream/ext/js/core/fetch-utilities.js';
import { DisplayGenerator } from '../upstream/ext/js/display/display-generator.js';
import type { KanjiDictionaryEntry, TermDictionaryEntry } from '../upstream/types/ext/dictionary';

/** The globals DisplayGenerator and its helpers use. */
export type DomEnvironment = Pick<UpstreamEnv, 'document' | 'window' | 'Node' | 'DocumentFragment' | 'DOMParser' | 'NodeFilter'>;

const NODE_FILTER = { SHOW_ALL: 0xffffffff, SHOW_ELEMENT: 0x1, SHOW_TEXT: 0x4 };

export function createStringDomEnvironment(): DomEnvironment & { document: StringDocument } {
    const document = new StringDocument();
    return {
        document,
        window: createStringWindow(document),
        Node: NODE_TYPES,
        DocumentFragment: StringDocumentFragment,
        DOMParser: StringDOMParser,
        NodeFilter: NODE_FILTER,
    };
}

export type LinkHandler = (element: unknown, href: string, internal: boolean) => void;

/**
 * The content manager DisplayGenerator talks to. Images are emitted as `<img class="gloss-image">`
 * inside `a.gloss-image-link[data-path][data-dictionary]`; renderers resolve their `src`.
 */
class RendererContentManager {
    private readonly onLink: LinkHandler | undefined;

    constructor(onLink?: LinkHandler) {
        this.onLink = onLink;
    }

    loadMedia(): void {
        // Images are resolved by the renderer after generation.
    }

    unloadAll(): void {}

    async executeMediaRequests(): Promise<void> {}

    /** Mirrors upstream DisplayContentManager.prepareLink, minus the extension click handling. */
    prepareLink(element: { href: string; target: string; rel: string }, href: string, internal: boolean): void {
        // Upstream relies on the import schema to allow only http(s) and internal links; prebuilt
        // databases skip import validation, so unsafe schemes are dropped here.
        if (!internal && !/^https?:/i.test(href)) {
            return;
        }
        element.href = href;
        if (!internal) {
            element.target = '_blank';
            element.rel = 'noreferrer noopener';
        }
        this.onLink?.(element, href, internal);
    }
}

type Generator = {
    _templates: { load(source: unknown): void };
    updateLanguage(language: string): void;
    createTermEntry(entry: TermDictionaryEntry, dictionaryInfo: Summary[]): unknown;
    createKanjiEntry(entry: KanjiDictionaryEntry, dictionaryInfo: Summary[]): unknown;
};

let templatesHtml: Promise<string> | null = null;

export class EntryRenderer<TElement = unknown> {
    private readonly env: DomEnvironment;
    private readonly generator: Generator;

    private constructor(env: DomEnvironment, generator: Generator) {
        this.env = env;
        this.generator = generator;
    }

    static async create<TElement = unknown>(env: DomEnvironment, options: { onLink?: LinkHandler } = {}): Promise<EntryRenderer<TElement>> {
        templatesHtml ??= fetchText('/templates-display.html');
        const html = await templatesHtml;
        const generator = withUpstreamEnv(env, () => {
            const Generator = DisplayGenerator as unknown as new (contentManager: unknown, hotkeys: null) => Generator;
            const instance = new Generator(new RendererContentManager(options.onLink), null);
            const Parser = env.DOMParser as new () => { parseFromString(html: string, type: string): unknown };
            instance._templates.load(new Parser().parseFromString(html, 'text/html'));
            return instance;
        });
        return new EntryRenderer<TElement>(env, generator);
    }

    setLanguage(language: string): void {
        this.generator.updateLanguage(language);
    }

    renderTerm(entry: TermDictionaryEntry, dictionaryInfo: Summary[]): TElement {
        return withUpstreamEnv(this.env, () => this.generator.createTermEntry(entry, dictionaryInfo)) as TElement;
    }

    renderKanji(entry: KanjiDictionaryEntry, dictionaryInfo: Summary[]): TElement {
        return withUpstreamEnv(this.env, () => this.generator.createKanjiEntry(entry, dictionaryInfo)) as TElement;
    }

    render(entry: TermDictionaryEntry | KanjiDictionaryEntry, dictionaryInfo: Summary[]): TElement {
        return entry.type === 'kanji' ? this.renderKanji(entry, dictionaryInfo) : this.renderTerm(entry, dictionaryInfo);
    }
}

/** Every `img.gloss-image` with the dictionary and path of the image it shows. */
export function findGlossImages(root: StringElement): { image: StringElement; dictionary: string; path: string }[] {
    const results: { image: StringElement; dictionary: string; path: string }[] = [];
    for (const link of root.querySelectorAll('a.gloss-image-link')) {
        const image = link.querySelector('.gloss-image');
        const dictionary = link.getAttribute('data-dictionary');
        const path = link.getAttribute('data-path');
        if (image !== null && dictionary !== null && path !== null) {
            results.push({ image, dictionary, path });
        }
    }
    return results;
}
