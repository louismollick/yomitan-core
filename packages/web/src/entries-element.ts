/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <yomitan-entries>: Yomitan's popup entries in a shadow root (ADR-0008). Markup comes from Yomitan's
 * own DisplayGenerator running on this document; styles are Yomitan's popup CSS, scoped to the shadow
 * root; the host carries the option attributes Yomitan puts on its document root. User intent is
 * reported with events; Anki buttons are wired to a display controller.
 */

import {
    type AnkiNoteContext,
    type DisplayController,
    EntryRenderer,
    type KanjiDictionaryEntry,
    type TermDictionaryEntry,
    type ThemeContext,
    type Yomitan,
    findGlossImages,
    setGlossImageSource,
} from 'yomitan-core';

export type DictionaryEntry = TermDictionaryEntry | KanjiDictionaryEntry;
export type KanjiClickDetail = { character: string };
export type LinkClickDetail = { query: string; href: string };
export type NoteAddedDetail = { entryIndex: number; cardFormatIndex: number; noteId: number; overwritten: boolean };
export type NoteErrorDetail = { entryIndex: number; cardFormatIndex: number; error: unknown };

/** Yomitan's CSS targets `:root[data-*]`; inside a shadow root the host plays that role. */
export function scopeCssToHost(css: string): string {
    return css.replace(/:root((?:\[[^\]]*\]|:not\((?:[^()]|\([^()]*\))*\))*)/g, (_match, qualifiers: string) =>
        qualifiers.length > 0 ? `:host(${qualifiers})` : ':host',
    );
}

/** Buttons Yomitan shows for features this element does not provide yet (audio, the entry menu). */
const HIDDEN_ACTIONS_CSS = `
.action-button[data-action="play-audio"],
.action-button[data-action="menu"] { display: none !important; }
:host { display: block; color: var(--text-color); background-color: var(--background-color); }
`;

/** Yomitan's kanji stroke-order font is 18 MB, so it is opt-in: pass the URL you host it at. */
function strokeOrderFontCss(url: string | null): string {
    return url === null ? '' : `@font-face { font-family: kanji-stroke-orders; src: url(${JSON.stringify(url)}); }\n`;
}

let sharedRenderer: Promise<EntryRenderer<HTMLElement>> | null = null;

function getRenderer(): Promise<EntryRenderer<HTMLElement>> {
    sharedRenderer ??= EntryRenderer.create<HTMLElement>({
        document,
        window,
        Node,
        DocumentFragment,
        DOMParser,
        NodeFilter,
    });
    return sharedRenderer;
}

const INTERNAL_LINK_PREFIX = 'yomitan://lookup/search.html';

export class YomitanEntriesElement extends HTMLElement {
    /** The client that owns the dictionaries and profile. Required before `entries` are shown. */
    client: Yomitan | null = null;
    /** Enables Anki buttons, following the profile's card formats. */
    controller: DisplayController | null = null;
    /** Sentence and page details for Anki notes (for example the text box a lookup came from). */
    noteContext: AnkiNoteContext = {};
    /** App-defined marker values for Anki notes (for example `{series}`). */
    extraMarkers: Record<string, string> | undefined = undefined;
    /** Theme inputs for Yomitan's `browser` and `site` themes. */
    themeContext: ThemeContext | undefined = undefined;
    /** Where you host Yomitan's `kanji-stroke-orders.ttf` (18 MB, not bundled); strokes show only if set. */
    strokeOrderFontUrl: string | null = null;

    private entryList: DictionaryEntry[] = [];
    private readonly root: ShadowRoot;
    private readonly container: HTMLElement;
    private readonly styleElement: HTMLStyleElement;
    private objectUrls: string[] = [];
    private renderToken = 0;

    constructor() {
        super();
        this.root = this.attachShadow({ mode: 'open' });
        this.styleElement = document.createElement('style');
        this.container = document.createElement('div');
        this.container.id = 'dictionary-entries';
        const wrapper = document.createElement('div');
        wrapper.className = 'content-body-inner';
        wrapper.setAttribute('part', 'entries');
        wrapper.appendChild(this.container);
        this.root.append(this.styleElement, wrapper);
        this.root.addEventListener('click', (event) => this.onClick(event as MouseEvent));
    }

    get entries(): DictionaryEntry[] {
        return this.entryList;
    }

    set entries(value: DictionaryEntry[]) {
        this.entryList = value;
        void this.render();
    }

    disconnectedCallback(): void {
        ++this.renderToken;
        this.revokeObjectUrls();
    }

    connectedCallback(): void {
        if (this.client !== null && this.entryList.length > 0) {
            void this.render();
        }
    }

    /** Renders the current entries; resolves once markup, images and Anki buttons are in place. */
    async render(): Promise<void> {
        const token = ++this.renderToken;
        const client = this.client;
        if (client === null) {
            throw new Error('<yomitan-entries> needs a `client` before it can render');
        }
        const [renderer, dictionaryInfo, css] = await Promise.all([
            getRenderer(),
            client.dictionaries.list(),
            client.render.css(),
        ]);
        if (token !== this.renderToken) {
            return;
        }
        const options = client.profile.get().options;
        this.applyHostOptions(client, options);
        this.styleElement.textContent =
            strokeOrderFontCss(this.strokeOrderFontUrl) + scopeCssToHost(css) + HIDDEN_ACTIONS_CSS;
        renderer.setLanguage(options.general.language);
        this.revokeObjectUrls();
        const nodes = this.entryList.map((entry, index) => {
            const node = renderer.render(entry, dictionaryInfo);
            node.dataset.index = `${index}`;
            return node;
        });
        this.container.replaceChildren(...nodes);
        await Promise.all([this.loadImages(client, nodes, token), this.updateNoteButtons(renderer, nodes, token)]);
        this.dispatchEvent(new CustomEvent('render', { detail: { count: nodes.length } }));
    }

    private applyHostOptions(client: Yomitan, options: ReturnType<Yomitan['profile']['get']>['options']): void {
        for (const name of this.getAttributeNames()) {
            if (name.startsWith('data-')) {
                this.removeAttribute(name);
            }
        }
        for (const [key, value] of Object.entries(client.render.attributes(this.themeContext))) {
            this.dataset[key] = value;
        }
        const { fontFamily, fontSize, lineHeight } = options.general;
        this.style.fontFamily = fontFamily;
        this.style.fontSize = `${fontSize}px`;
        this.style.lineHeight = lineHeight;
    }

    private async loadImages(client: Yomitan, nodes: HTMLElement[], token: number): Promise<void> {
        for (const node of nodes) {
            for (const glossImage of findGlossImages(node)) {
                const media = await client.dictionaries.getMedia(glossImage.dictionary, glossImage.path);
                if (token !== this.renderToken) {
                    return;
                }
                if (media === null) {
                    setGlossImageSource(glossImage, null);
                    continue;
                }
                const url = URL.createObjectURL(new Blob([media.content as BlobPart], { type: media.mediaType }));
                this.objectUrls.push(url);
                setGlossImageSource(glossImage, url);
            }
        }
    }

    private async updateNoteButtons(
        renderer: EntryRenderer<HTMLElement>,
        nodes: HTMLElement[],
        token: number,
    ): Promise<void> {
        const controller = this.controller;
        if (controller === null || nodes.length === 0) {
            return;
        }
        const states = await controller.getNoteStates(this.entryList, this.noteContext, this.extraMarkers);
        if (token !== this.renderToken) {
            return;
        }
        for (const { entryIndex, cardFormats } of states) {
            const container = nodes[entryIndex]?.querySelector('.note-actions-container');
            if (!container) {
                continue;
            }
            container.replaceChildren();
            for (const format of cardFormats) {
                // Upstream DisplayAnki._createSaveButtons / _updateSaveButtonForDuplicateBehavior.
                const group = renderer.instantiateTemplate('action-button-container');
                const button = group.querySelector<HTMLButtonElement>('.action-button');
                const icon = button?.querySelector<HTMLElement>('.action-icon');
                if (!button || !icon) {
                    continue;
                }
                group.dataset.cardFormatIndex = `${format.cardFormatIndex}`;
                button.dataset.cardFormatIndex = `${format.cardFormatIndex}`;
                button.dataset.entryIndex = `${entryIndex}`;
                button.dataset.action = 'save-note';
                const verb =
                    format.action === 'overwrite'
                        ? 'Overwrite'
                        : format.action === 'add-duplicate'
                          ? 'Add duplicate'
                          : 'Add';
                button.title = format.reason ?? `${verb} ${format.name} note`;
                icon.dataset.icon =
                    format.action === 'overwrite'
                        ? `overwrite-${format.icon}`
                        : format.action === 'add-duplicate'
                          ? `add-duplicate-${format.icon}`
                          : format.icon;
                button.disabled = format.action === 'disabled';
                if (format.viewNoteIds.length > 0) {
                    const view = renderer.instantiateTemplate('note-action-button-view-note') as HTMLButtonElement;
                    view.hidden = false;
                    view.disabled = false;
                    view.dataset.noteIds = format.viewNoteIds.join(' ');
                    group.appendChild(view);
                }
                container.appendChild(group);
            }
        }
    }

    private onClick(event: MouseEvent): void {
        const target = event.target instanceof Element ? event.target : null;
        if (target === null) {
            return;
        }
        const kanji = target.closest<HTMLElement>('.headword-kanji-link');
        if (kanji !== null) {
            event.preventDefault();
            this.dispatchEvent(
                new CustomEvent<KanjiClickDetail>('kanji-click', {
                    detail: { character: kanji.dataset.character ?? kanji.textContent ?? '' },
                }),
            );
            return;
        }
        const save = target.closest<HTMLButtonElement>('.action-button[data-action="save-note"]');
        if (save !== null) {
            event.preventDefault();
            void this.saveNote(save);
            return;
        }
        const view = target.closest<HTMLButtonElement>('.action-button[data-action="view-note"]');
        if (view !== null) {
            event.preventDefault();
            const ids = (view.dataset.noteIds ?? '').split(' ').filter(Boolean).map(Number);
            void this.controller?.viewNotes(ids);
            return;
        }
        const link = target.closest<HTMLAnchorElement>('a[href]');
        if (link?.getAttribute('href')?.startsWith(INTERNAL_LINK_PREFIX)) {
            event.preventDefault();
            const href = link.getAttribute('href') as string;
            const query = new URL(href).searchParams.get('query') ?? '';
            this.dispatchEvent(new CustomEvent<LinkClickDetail>('link-click', { detail: { query, href } }));
        }
    }

    private async saveNote(button: HTMLButtonElement): Promise<void> {
        const controller = this.controller;
        const entryIndex = Number(button.dataset.entryIndex);
        const cardFormatIndex = Number(button.dataset.cardFormatIndex);
        const entry = this.entryList[entryIndex];
        if (controller === null || entry === undefined) {
            return;
        }
        button.disabled = true;
        try {
            const { noteId, overwritten } = await controller.addNote(
                entry,
                cardFormatIndex,
                this.noteContext,
                this.extraMarkers,
            );
            this.dispatchEvent(
                new CustomEvent<NoteAddedDetail>('note-added', {
                    detail: { entryIndex, cardFormatIndex, noteId, overwritten },
                }),
            );
        } catch (error) {
            this.dispatchEvent(
                new CustomEvent<NoteErrorDetail>('note-error', { detail: { entryIndex, cardFormatIndex, error } }),
            );
        }
        await this.updateNoteButtons(
            await getRenderer(),
            [...this.container.children] as HTMLElement[],
            this.renderToken,
        );
    }

    private revokeObjectUrls(): void {
        for (const url of this.objectUrls) {
            URL.revokeObjectURL(url);
        }
        this.objectUrls = [];
    }
}

/** Registers the element (once) and returns its tag name. */
export function defineYomitanEntries(tagName = 'yomitan-entries'): string {
    if (customElements.get(tagName) === undefined) {
        customElements.define(tagName, class extends YomitanEntriesElement {});
    }
    return tagName;
}

declare global {
    interface HTMLElementEventMap {
        'kanji-click': CustomEvent<KanjiClickDetail>;
        'link-click': CustomEvent<LinkClickDetail>;
        'note-added': CustomEvent<NoteAddedDetail>;
        'note-error': CustomEvent<NoteErrorDetail>;
    }
}
