/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Renders dictionary entries with Yomitan's own DisplayGenerator (ADR-0009). The DOM it builds into
 * is pluggable: a browser document for `<yomitan-entries>`, or the built-in string DOM for HTML
 * strings (Node, WebViews, React Native previews).
 */

import { NODE_TYPES, StringDOMParser, StringDocument, StringDocumentFragment, createStringWindow } from '../dom/string-dom';
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
    instantiateTemplate(name: string): unknown;
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

    /** An element from Yomitan's display templates (e.g. `action-button-container`). */
    instantiateTemplate(name: string): TElement {
        return withUpstreamEnv(this.env, () => this.generator.instantiateTemplate(name)) as TElement;
    }

    render(entry: TermDictionaryEntry | KanjiDictionaryEntry, dictionaryInfo: Summary[]): TElement {
        return entry.type === 'kanji' ? this.renderKanji(entry, dictionaryInfo) : this.renderTerm(entry, dictionaryInfo);
    }
}

type ElementLike = {
    querySelectorAll(selector: string): ArrayLike<ElementLike> & Iterable<ElementLike>;
    querySelector(selector: string): ElementLike | null;
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    style: { setProperty(name: string, value: string): void; removeProperty(name: string): string };
};

export type GlossImage<T extends ElementLike = ElementLike> = { link: T; image: T; background: T | null; dictionary: string; path: string };

/** Every dictionary image (`a.gloss-image-link` with its `img.gloss-image`) in rendered entries. */
export function findGlossImages<T extends ElementLike>(root: T): GlossImage<T>[] {
    const results: GlossImage<T>[] = [];
    for (const link of root.querySelectorAll('a.gloss-image-link') as Iterable<T>) {
        const image = link.querySelector('.gloss-image') as T | null;
        const dictionary = link.getAttribute('data-dictionary');
        const path = link.getAttribute('data-path');
        if (image !== null && dictionary !== null && path !== null) {
            results.push({ link, image, background: link.querySelector('.gloss-image-background') as T | null, dictionary, path });
        }
    }
    return results;
}

/**
 * Upstream `StructuredContentGenerator._setImageData`: shows an image (or marks it failed). The
 * `--image` variable drives monochrome images. `linkToImage: false` keeps large data URIs out of `href`.
 */
export function setGlossImageSource(
    { link, image, background }: GlossImage,
    url: string | null,
    { linkToImage = true }: { linkToImage?: boolean } = {},
): void {
    if (url !== null) {
        image.setAttribute('src', url);
        if (linkToImage) {
            link.setAttribute('href', url);
        }
        link.setAttribute('data-image-load-state', 'loaded');
        background?.style.setProperty('--image', `url("${url}")`);
    } else {
        image.removeAttribute('src');
        link.removeAttribute('href');
        link.setAttribute('data-image-load-state', 'load-error');
        background?.style.removeProperty('--image');
    }
}
