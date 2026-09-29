/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Anki notes built by Yomitan's own AnkiNoteBuilder and template renderer, running on the string DOM
 * so output is identical on every target. Duplicate detection and overwriting follow upstream's
 * Backend.partitionAddibleNotes / _onApiGetAnkiNoteInfo and DisplayAnki._getOverwrittenNote.
 */

import { StringDocument, createStringWindow } from '../dom/string-dom';
import { type Fetch, startWithUpstreamEnv } from '../platform/upstream-env';
import type { ProfileOptions } from '../profile/profile';
import { escapeCssForStyleElement, sanitizeCssWithoutCssom } from '../render/display-options';
import type { Summary } from '../storage/types';
import { AnkiConnect } from '../upstream/ext/js/comm/anki-connect.js';
import { fetchText } from '../upstream/ext/js/core/fetch-utilities.js';
import { AnkiNoteBuilder } from '../upstream/ext/js/data/anki-note-builder.js';
import {
    getDynamicFieldMarkers,
    getDynamicTemplates,
    getStandardFieldMarkers,
} from '../upstream/ext/js/data/anki-template-util.js';
import { INVALID_NOTE_ID, isNoteDataValid } from '../upstream/ext/js/data/anki-util.js';
import { AnkiTemplateRenderer } from '../upstream/ext/js/templates/anki-template-renderer.js';
import type { DictionaryEntry } from '../upstream/types/ext/dictionary';

export type AnkiNote = {
    fields: Record<string, string>;
    tags: string[];
    deckName: string;
    modelName: string;
    options: Record<string, unknown>;
};

export type AnkiNoteInfo = { noteId: number; fields: Record<string, { value: string; order: number }> } & Record<
    string,
    unknown
>;

/**
 * How notes reach Anki. `createAnkiConnectTransport` talks to AnkiConnect; apps can supply their own
 * (for example to reuse their connection settings or support AnkiConnect Android). Optional methods
 * are capabilities: without them, duplicate checks fall back and "view note" is unavailable, as in
 * Yomitan.
 */
export interface AnkiTransport {
    addNote(note: AnkiNote): Promise<number | null>;
    updateNoteFields(note: AnkiNote & { id: number }): Promise<void>;
    canAddNotes(notes: AnkiNote[]): Promise<boolean[]>;
    findNoteIds(notes: AnkiNote[]): Promise<number[][]>;
    canAddNotesWithErrorDetail?(notes: AnkiNote[]): Promise<{ canAdd: boolean; error: string | null }[]>;
    notesInfo?(noteIds: number[]): Promise<(AnkiNoteInfo | null)[]>;
    guiBrowseNotes?(noteIds: number[]): Promise<unknown>;
}

export type AnkiConnectOptions = {
    server?: string;
    apiKey?: string | null;
    /** Used for AnkiConnect requests. Defaults to the global `fetch`. */
    fetch?: Fetch;
};

type UpstreamAnkiConnect = AnkiTransport & {
    enabled: boolean;
    server: string | null;
    apiKey: string | null;
    guiBrowseNotes(noteIds: number[]): Promise<unknown>;
    getDeckNames(): Promise<string[]>;
    getModelNames(): Promise<string[]>;
    getModelFieldNames(model: string): Promise<string[]>;
};

/** Yomitan's AnkiConnect client. Requests go through `options.fetch`, or the global `fetch`. */
export function createAnkiConnectTransport(options: AnkiConnectOptions = {}) {
    const connection = new AnkiConnect() as unknown as UpstreamAnkiConnect & {
        _invoke(action: string, params: unknown): Promise<unknown>;
    };
    // Bound per transport, so clients with different fetches never share one.
    const fetch =
        options.fetch ?? ((...args: Parameters<Fetch>) => (globalThis as unknown as { fetch: Fetch }).fetch(...args));
    const invoke = connection._invoke.bind(connection);
    connection._invoke = (action, params) => startWithUpstreamEnv({ fetch }, () => invoke(action, params));
    connection.server = options.server ?? 'http://127.0.0.1:8765';
    connection.apiKey = options.apiKey ?? null;
    connection.enabled = true;
    const transport: AnkiTransport & {
        getDeckNames(): Promise<string[]>;
        getModelNames(): Promise<string[]>;
        getModelFieldNames(model: string): Promise<string[]>;
    } = {
        addNote: (note) => connection.addNote(note),
        updateNoteFields: (note) => connection.updateNoteFields(note),
        canAddNotes: (notes) => connection.canAddNotes(notes),
        canAddNotesWithErrorDetail: (notes) =>
            (connection.canAddNotesWithErrorDetail as NonNullable<AnkiTransport['canAddNotesWithErrorDetail']>)(notes),
        findNoteIds: (notes) => connection.findNoteIds(notes),
        notesInfo: (ids) => (connection.notesInfo as NonNullable<AnkiTransport['notesInfo']>)(ids),
        guiBrowseNotes: (ids) => connection.guiBrowseNotes(ids),
        getDeckNames: () => connection.getDeckNames(),
        getModelNames: () => connection.getModelNames(),
        getModelFieldNames: (model) => connection.getModelFieldNames(model),
    };
    return transport;
}

export type AnkiNoteContext = {
    /** The sentence around the looked-up text (from `lookup.scan`), for `{sentence}` and `{cloze-*}`. */
    sentence?: { text: string; offset: number };
    url?: string;
    documentTitle?: string;
    query?: string;
    fullQuery?: string;
};

export type BuildNoteOptions = {
    /** Index into `profile.anki.cardFormats`. Default 0. */
    cardFormatIndex?: number;
    context?: AnkiNoteContext;
    /**
     * Values for app-defined markers such as `{series}`, substituted in fields, the deck name and
     * tags. Yomitan's own markers take precedence when names clash.
     */
    extraMarkers?: Record<string, string>;
};

export type BuiltNote = { note: AnkiNote; errors: Error[] };

type NoteBuilder = {
    createNote(details: Record<string, unknown>): Promise<{ note: AnkiNote; errors: Error[] }>;
    getDictionaryStylesMap(dictionaries: ProfileOptions['dictionaries']): Map<string, string>;
};

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class AnkiNotes {
    private builder: Promise<NoteBuilder> | null = null;
    private defaultTemplates: Promise<string> | null = null;

    private getBuilder(): Promise<NoteBuilder> {
        this.builder ??= (async () => {
            const document = new StringDocument();
            const Renderer = AnkiTemplateRenderer as unknown as new (
                document: unknown,
                window: unknown,
            ) => { prepare(): Promise<void>; templateRenderer: unknown };
            const renderer = new Renderer(document, createStringWindow(document)) as unknown as {
                prepare(): Promise<void>;
                templateRenderer: unknown;
            };
            await renderer.prepare();
            const api = {
                injectAnkiNoteMedia: async () => {
                    throw new Error('Anki media is not supported yet');
                },
                parseText: async () => {
                    throw new Error('Text parsing requirements are not supported yet');
                },
            };
            return new AnkiNoteBuilder(api, renderer.templateRenderer) as unknown as NoteBuilder;
        })();
        return this.builder;
    }

    /** Yomitan's default field templates (`default-anki-field-templates.handlebars`). */
    getDefaultTemplates(): Promise<string> {
        this.defaultTemplates ??= fetchText('/data/templates/default-anki-field-templates.handlebars');
        return this.defaultTemplates;
    }

    /** The markers a field can use for this entry type, including per-dictionary ones. */
    getMarkers(type: 'term' | 'kanji', options: ProfileOptions, dictionaryInfo: Summary[]): string[] {
        const standard = getStandardFieldMarkers(type, options.general.language) as string[];
        return type === 'term'
            ? [...standard, ...(getDynamicFieldMarkers(options.dictionaries, dictionaryInfo) as string[])]
            : standard;
    }

    /** Upstream `DisplayAnki._getAnkiFieldTemplates`: the profile's templates plus dynamic ones. */
    async getTemplates(options: ProfileOptions, dictionaryInfo: Summary[]): Promise<string> {
        const configured = options.anki.fieldTemplates;
        const staticTemplates = typeof configured === 'string' ? configured : await this.getDefaultTemplates();
        return staticTemplates + (getDynamicTemplates(options, dictionaryInfo) as string);
    }

    async buildNote(
        entry: DictionaryEntry,
        options: ProfileOptions,
        dictionaryInfo: Summary[],
        { cardFormatIndex = 0, context = {}, extraMarkers = {} }: BuildNoteOptions = {},
    ): Promise<BuiltNote> {
        const baseFormat = options.anki.cardFormats[cardFormatIndex];
        if (baseFormat === undefined) {
            throw new RangeError(`The profile has no card format ${cardFormatIndex}`);
        }
        const { cardFormat, restoreBraces, markers } = this.applyExtraMarkers(
            baseFormat,
            entry.type,
            options,
            dictionaryInfo,
            extraMarkers,
        );
        const source = this.getSource(entry);
        const builder = await this.getBuilder();
        // Upstream sanitizes dictionary CSS with the browser's CSSOM before it reaches Anki fields.
        const dictionaryStylesMap =
            typeof (globalThis as { CSSStyleSheet?: unknown }).CSSStyleSheet === 'function'
                ? builder.getDictionaryStylesMap(options.dictionaries)
                : new Map(
                      options.dictionaries
                          .filter(({ styles }) => typeof styles === 'string')
                          .map(({ name, styles }) => [name, sanitizeCssWithoutCssom(styles as string)]),
                  );
        // The glossary template puts these in a <style> element; `<` never needs to be literal in CSS.
        for (const [name, css] of dictionaryStylesMap) {
            dictionaryStylesMap.set(name, escapeCssForStyleElement(css));
        }
        const { note, errors } = await builder.createNote({
            dictionaryEntry: entry,
            cardFormat,
            context: {
                url: context.url ?? '',
                sentence: context.sentence ?? { text: source, offset: 0 },
                documentTitle: context.documentTitle ?? '',
                query: context.query ?? source,
                fullQuery: context.fullQuery ?? context.query ?? source,
            },
            template: await this.getTemplates(options, dictionaryInfo),
            tags: this.substitute(options.anki.tags, markers),
            duplicateScope: options.anki.duplicateScope,
            duplicateScopeCheckAllModels: options.anki.duplicateScopeCheckAllModels,
            resultOutputMode: options.general.resultOutputMode,
            glossaryLayoutMode: options.general.glossaryLayoutMode,
            compactTags: options.general.compactTags,
            mediaOptions: null,
            requirements: [],
            dictionaryStylesMap,
        });
        for (const [name, value] of Object.entries(note.fields)) {
            note.fields[name] = restoreBraces(value);
        }
        return { note, errors };
    }

    private getSource(entry: DictionaryEntry): string {
        if (entry.type === 'kanji') {
            return entry.character;
        }
        return entry.headwords[0]?.sources[0]?.originalText ?? '';
    }

    /** Replaces every `{name}` in one pass, so a value is never itself read as a marker. */
    private substitute<T extends string | string[]>(value: T, extraMarkers: Record<string, string>): T {
        const names = Object.keys(extraMarkers);
        if (names.length === 0) {
            return value;
        }
        const pattern = new RegExp(`\\{(${names.map(escapeRegExp).join('|')})\\}`, 'g');
        const replace = (text: string) => text.replace(pattern, (_match, name: string) => extraMarkers[name]);
        return (Array.isArray(value) ? value.map(replace) : replace(value)) as T;
    }

    private applyExtraMarkers(
        cardFormat: ProfileOptions['anki']['cardFormats'][number],
        type: 'term' | 'kanji',
        options: ProfileOptions,
        dictionaryInfo: Summary[],
        extraMarkers: Record<string, string>,
    ): {
        cardFormat: ProfileOptions['anki']['cardFormats'][number];
        restoreBraces(text: string): string;
        markers: Record<string, string>;
    } {
        const reserved = new Set(this.getMarkers(type, options, dictionaryInfo));
        const markers = Object.fromEntries(Object.entries(extraMarkers).filter(([name]) => !reserved.has(name)));
        if (Object.keys(markers).length === 0) {
            return { cardFormat, restoreBraces: (text) => text, markers };
        }
        // Field values are marker templates: braces in app values are swapped for tokens unique to this
        // call and restored after the note is built, so a value like `{glossary}` stays literal text.
        const nonce = Math.random().toString(36).slice(2);
        const open = `yomitan-open-brace-${nonce}`;
        const close = `yomitan-close-brace-${nonce}`;
        const protectedMarkers = Object.fromEntries(
            Object.entries(markers).map(([name, value]) => [name, value.replace(/\{/g, open).replace(/\}/g, close)]),
        );
        const fields: typeof cardFormat.fields = {};
        for (const [name, field] of Object.entries(cardFormat.fields)) {
            fields[name] = { ...field, value: this.substitute(field.value, protectedMarkers) };
        }
        return {
            cardFormat: { ...cardFormat, deck: this.substitute(cardFormat.deck, markers), fields },
            restoreBraces: (text) => text.split(open).join('{').split(close).join('}'),
            markers,
        };
    }
}

export type NoteState = {
    /** Whether a note can be added (valid fields, and not blocked as a duplicate). */
    canAdd: boolean;
    valid: boolean;
    /** IDs of existing notes that this one duplicates (`-1` when Anki reports a duplicate it can't find). */
    duplicateNoteIds: number[];
    noteInfos: (AnkiNoteInfo | null)[];
};

function stripToFirstField(note: AnkiNote): AnkiNote {
    const entries = Object.entries(note.fields);
    return entries.length === 0 ? note : { ...note, fields: { [entries[0][0]]: entries[0][1] } };
}

/** Upstream `Backend.partitionAddibleNotes` + `_onApiGetAnkiNoteInfo`. */
export async function getNoteStates(
    transport: AnkiTransport,
    notes: AnkiNote[],
    fetchNoteInfo: boolean,
): Promise<NoteState[]> {
    const stripped = notes.map(stripToFirstField);
    const noDuplicates = stripped.map((note) => ({ ...note, options: { ...note.options, allowDuplicate: false } }));
    let isDuplicate: boolean[];
    let usedErrorDetail = false;
    if (transport.canAddNotesWithErrorDetail !== undefined) {
        try {
            const details = await transport.canAddNotesWithErrorDetail(noDuplicates);
            isDuplicate = details.map(({ error }) =>
                (error ?? '').includes('cannot create note because it is a duplicate'),
            );
            usedErrorDetail = true;
        } catch (error) {
            if (!(error instanceof Error && error.message.includes('unsupported action'))) {
                throw error;
            }
            isDuplicate = [];
        }
    } else {
        isDuplicate = [];
    }
    if (!usedErrorDetail) {
        const [withDuplicates, withoutDuplicates] = await Promise.all([
            transport.canAddNotes(stripped),
            transport.canAddNotes(noDuplicates),
        ]);
        isDuplicate = withDuplicates.map((value, i) => value !== withoutDuplicates[i]);
    }
    const duplicateNotes = notes.filter((_, i) => isDuplicate[i]);
    const duplicateIds = duplicateNotes.length > 0 ? await transport.findNoteIds(duplicateNotes) : [];
    const states: NoteState[] = [];
    let duplicateIndex = 0;
    for (const [i, note] of notes.entries()) {
        const valid = isNoteDataValid(note) as boolean;
        let duplicateNoteIds: number[] = [];
        if (isDuplicate[i]) {
            duplicateNoteIds = duplicateIds[duplicateIndex++] ?? [];
            if (duplicateNoteIds.length === 0) {
                duplicateNoteIds = [INVALID_NOTE_ID as number];
            }
        }
        const knownIds = duplicateNoteIds.filter((id) => id !== INVALID_NOTE_ID);
        const noteInfos =
            fetchNoteInfo && knownIds.length > 0 && transport.notesInfo !== undefined
                ? await transport.notesInfo(knownIds)
                : [];
        states.push({ canAdd: valid, valid, duplicateNoteIds, noteInfos });
    }
    return states;
}

export type FieldOverwriteMode = 'overwrite' | 'skip' | 'append' | 'prepend' | 'coalesce' | 'coalesce-new';

/** Upstream `DisplayAnki._getOverwrittenField`. */
export function getOverwrittenField(existingValue: string, newValue: string, mode: FieldOverwriteMode): string {
    switch (mode) {
        case 'overwrite':
            return newValue;
        case 'skip':
            return existingValue;
        case 'append':
            return existingValue + newValue;
        case 'prepend':
            return newValue + existingValue;
        case 'coalesce':
            return existingValue || newValue;
        case 'coalesce-new':
            return newValue || existingValue;
        default:
            return newValue;
    }
}
