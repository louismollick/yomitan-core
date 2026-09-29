/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Rendering, Anki notes and the display controller through the client, on any storage adapter.
 */

import { describe, test } from 'vitest';
import {
    type AnkiNote,
    type AnkiNoteInfo,
    type AnkiTransport,
    createAnkiConnectTransport,
} from '../../core/src/anki/anki';
import { type Yomitan, createYomitan } from '../../core/src/client/yomitan';
import { DuplicateNoteError, createDisplayController } from '../../core/src/display/display-controller';
import type { CreateClientStorage } from './client-contract';
import { createDictionaryArchive } from './fixtures';

const TITLE = 'Test Dictionary';

async function importedClient(createStorage: CreateClientStorage): Promise<Yomitan> {
    const client = await createYomitan({ storage: await createStorage() });
    await client.dictionaries.import({ source: await createDictionaryArchive('valid-dictionary1') });
    return client;
}

async function withTermCardFormat(
    client: Yomitan,
    fields: Record<string, string>,
    extra: Record<string, unknown> = {},
) {
    const profile = client.profile.get();
    profile.options.anki.cardFormats[0] = {
        ...profile.options.anki.cardFormats[0],
        deck: 'Mining::{series}',
        model: 'Basic',
        fields: Object.fromEntries(
            Object.entries(fields).map(([name, value]) => [name, { value, overwriteMode: 'coalesce' }]),
        ),
    } as never;
    profile.options.anki.tags = ['yomitan', '{series}'];
    Object.assign(profile.options.anki, extra);
    await client.profile.set(profile);
}

/** An in-memory Anki with the AnkiConnect duplicate semantics the display controller relies on. */
export function createFakeAnki(options: { errorDetail?: boolean; browse?: boolean } = {}) {
    const notes = new Map<number, AnkiNote>();
    let nextId = 1;
    const firstFieldKey = (note: AnkiNote) => `${note.modelName}\u0000${Object.values(note.fields)[0] ?? ''}`;
    const isDuplicate = (note: AnkiNote) =>
        [...notes.values()].some((existing) => firstFieldKey(existing) === firstFieldKey(note));
    const browsed: number[][] = [];
    const transport: AnkiTransport = {
        async addNote(note) {
            const id = nextId++;
            notes.set(id, structuredClone(note));
            return id;
        },
        async updateNoteFields(note) {
            const existing = notes.get(note.id);
            if (existing === undefined) {
                throw new Error('missing note');
            }
            notes.set(note.id, { ...existing, fields: { ...note.fields } });
        },
        async canAddNotes(list) {
            return list.map((note) => (note.options.allowDuplicate === true ? true : !isDuplicate(note)));
        },
        async findNoteIds(list) {
            return list.map((note) =>
                [...notes.entries()]
                    .filter(([, existing]) => firstFieldKey(existing) === firstFieldKey(note))
                    .map(([id]) => id),
            );
        },
        async notesInfo(ids) {
            return ids.map((id) => {
                const note = notes.get(id);
                if (note === undefined) {
                    return null;
                }
                const fields = Object.fromEntries(
                    Object.entries(note.fields).map(([name, value], order) => [name, { value, order }]),
                );
                return { noteId: id, fields } as AnkiNoteInfo;
            });
        },
    };
    if (options.errorDetail !== false) {
        transport.canAddNotesWithErrorDetail = async (list) =>
            list.map((note) =>
                note.options.allowDuplicate !== true && isDuplicate(note)
                    ? { canAdd: false, error: 'cannot create note because it is a duplicate' }
                    : { canAdd: true, error: null },
            );
    }
    if (options.browse !== false) {
        transport.guiBrowseNotes = async (ids) => {
            browsed.push(ids);
        };
    }
    return { transport, notes, browsed };
}

export function runRenderAnkiContract(label: string, createStorage: CreateClientStorage): void {
    describe(`${label}: rendering and Anki`, () => {
        test('renders entries as Yomitan popup markup, with images resolved as asked', async ({ expect }) => {
            const client = await importedClient(createStorage);
            const { entries } = await client.lookup.terms('画像');
            expect(entries.length).toBeGreaterThan(0);
            const placeholder = await client.render.html(entries);
            expect(placeholder).toContain('class="entry"');
            expect(placeholder).toContain(`data-dictionary="${TITLE}"`);
            expect(placeholder).toMatch(/<a [^>]*class="gloss-image-link"[^>]*data-path="image.gif"/);
            expect(placeholder).not.toMatch(/<img[^>]*src=/);
            const inlined = await client.render.html(entries, { media: 'data-uri' });
            expect(inlined).toContain('src="data:image/gif;base64,R0lGOD');
            const templated = await client.render.html(entries, {
                media: { urlTemplate: 'app://m/{dictionary}/{path}' },
            });
            expect(templated).toContain('src="app://m/Test%20Dictionary/image.gif"');
            await client.dispose();
        });

        test('renders a standalone document with the popup CSS and root attributes', async ({ expect }) => {
            const client = await importedClient(createStorage);
            const { entries } = await client.lookup.terms('打つ');
            const profile = client.profile.get();
            profile.options.general.popupTheme = 'dark';
            await client.profile.set(profile);
            const html = await client.render.document(entries);
            expect(html).toMatch(/^<!DOCTYPE html><html [^>]*data-theme="dark"/);
            expect(html).toContain('data-glossary-layout-mode="default"');
            expect(html).toContain('.entry');
            expect(html).toContain(`[data-dictionary="${TITLE}"] {`);
            expect(client.render.attributes({ browserTheme: 'dark' }).theme).toBe('dark');
            await client.dispose();
        });

        test('lists markers including per-dictionary ones', async ({ expect }) => {
            const client = await importedClient(createStorage);
            const markers = await client.anki.markers('term');
            expect(markers).toContain('glossary');
            expect(markers).toContain('cloze-body');
            expect(markers).toContain('single-glossary-test-dictionary');
            expect(await client.anki.markers('kanji')).toContain('character');
            await client.dispose();
        });

        test('builds notes from the profile card format, with sentence context and app markers', async ({ expect }) => {
            const client = await importedClient(createStorage);
            await withTermCardFormat(client, {
                Word: '{expression}',
                Glossary: '{single-glossary-test-dictionary}',
                Sentence: '{cloze-prefix}<b>{cloze-body}</b>{cloze-suffix}',
                Source: '{series} vol. {volume}',
            });
            const { entries } = await client.lookup.terms('打ち込む');
            const { note, errors } = await client.anki.buildNote(entries[0], {
                context: { sentence: { text: '今日は打ち込む。', offset: 3 } },
                extraMarkers: { series: 'Yotsuba', volume: '3' },
            });
            expect(errors).toEqual([]);
            expect(note.fields.Word).toBe('打ち込む');
            expect(note.fields.Glossary).toContain('<ol>');
            expect(note.fields.Sentence).toBe('今日は<b>打ち込む</b>。');
            expect(note.fields.Source).toBe('Yotsuba vol. 3');
            expect(note.deckName).toBe('Mining::Yotsuba');
            expect(note.tags).toEqual(['yomitan', 'Yotsuba']);
            await client.dispose();
        });

        test('never emits script-capable markup from hostile dictionary content', async ({ expect }) => {
            const storage = await createStorage();
            await storage.prepare();
            await storage.addWithResult('dictionaries', {
                title: 'Evil',
                revision: '1',
                version: 3,
                sequenced: false,
                importDate: 0,
                importSuccess: true,
                prefixWildcardsSupported: true,
                counts: { terms: { total: 1 } },
                styles: '',
            });
            const glossary = [
                '<script>alert(1)</script> "quoted" & <b>',
                {
                    type: 'structured-content',
                    content: [
                        { tag: 'a', href: 'javascript:alert(1)', content: 'js link' },
                        { tag: 'a', href: 'data:text/html,<script>alert(1)</script>', content: 'data link' },
                        { tag: 'span', title: '"><img src=x onerror=alert(1)>', content: 'attribute' },
                    ],
                },
            ];
            await storage.bulkAdd(
                'terms',
                [
                    {
                        expression: '悪',
                        reading: 'あく',
                        definitionTags: '',
                        rules: '',
                        score: 0,
                        glossary,
                        dictionary: 'Evil',
                        expressionReverse: '悪',
                        readingReverse: 'くあ',
                    },
                ],
                0,
                1,
            );
            await storage.close();
            const client = await createYomitan({ storage: await (async () => storage)() });
            await client.profile.syncDictionaries();
            const { entries } = await client.lookup.terms('悪');
            expect(entries).toHaveLength(1);
            const html = await client.render.html(entries);
            expect(html).not.toContain('<script');
            expect(html).not.toContain('javascript:');
            expect(html).not.toMatch(/href="data:/);
            // The payload stays inside a quoted attribute (only & and " are escaped there, as in browsers).
            expect(html).toContain('title="&quot;><img src=x onerror=alert(1)>"');
            expect(html).toContain('&lt;script&gt;');
            await withTermCardFormat(client, { Glossary: '{glossary}' });
            const { note } = await client.anki.buildNote(entries[0]);
            expect(note.fields.Glossary).not.toContain('<script');
            expect(note.fields.Glossary).not.toContain('javascript:');
            expect(note.fields.Glossary).toContain('title="&quot;><img src=x onerror=alert(1)>"');
            await client.dispose();
        });

        test('dictionary CSS stays inside its scope and its style element', async ({ expect }) => {
            const client = await importedClient(createStorage);
            const profile = client.profile.get();
            profile.options.dictionaries[0].styles =
                '.gloss { color: red; }\n} .action-button { display: none } /*\n.x { content: "</style><img src=x onerror=alert(1)>"; }';
            await client.profile.set(profile);
            const css = await client.render.css();
            expect(css).toContain('.gloss { color: red; }');
            expect(css).not.toContain('.action-button { display: none }');
            expect(css).not.toContain('</style');
            const { entries } = await client.lookup.terms('打ち込む');
            profile.options.dictionaries[0].styles = '.x { content: "</style><img src=x onerror=alert(1)>"; }';
            await client.profile.set(profile);
            await withTermCardFormat(client, { Glossary: '{glossary}' });
            const { note } = await client.anki.buildNote(entries[0]);
            expect(note.fields.Glossary).toContain('<style>');
            expect(note.fields.Glossary).not.toContain('</style><img');
            await client.dispose();
        });

        test('app marker values are literal text', async ({ expect }) => {
            const client = await importedClient(createStorage);
            await withTermCardFormat(client, { Source: '{series}' });
            const { entries } = await client.lookup.terms('打ち込む');
            const series = 'ACME $& $$ {expression} {{glossary}} {volume}';
            const { note } = await client.anki.buildNote(entries[0], { extraMarkers: { series, volume: '3' } });
            expect(note.fields.Source).toBe(series);
            expect(note.deckName).toBe(`Mining::${series}`);
            expect(note.tags).toEqual(['yomitan', series]);
            const profile = client.profile.get();
            profile.options.anki.tags = ['{expression}'];
            await client.profile.set(profile);
            const reserved = await client.anki.buildNote(entries[0], { extraMarkers: { expression: 'app' } });
            expect(reserved.note.tags).toEqual(['{expression}']);
            await client.dispose();
        });

        test('structured content cannot add attributes or style declarations', async ({ expect }) => {
            const storage = await createStorage();
            await storage.prepare();
            await storage.addWithResult('dictionaries', {
                title: 'Evil',
                revision: '1',
                version: 3,
                sequenced: false,
                importDate: 0,
                importSuccess: true,
                prefixWildcardsSupported: true,
                counts: { terms: { total: 1 } },
                styles: '',
            });
            const glossary = [
                {
                    type: 'structured-content',
                    content: [
                        { tag: 'span', data: { 'x onmouseover': 'alert(1)', ok: 'yes' }, content: 'data' },
                        { tag: 'span', style: { color: 'red; position: fixed; inset: 0' }, content: 'style' },
                    ],
                },
            ];
            await storage.bulkAdd(
                'terms',
                [
                    {
                        expression: '悪',
                        reading: 'あく',
                        definitionTags: '',
                        rules: '',
                        score: 0,
                        glossary,
                        dictionary: 'Evil',
                        expressionReverse: '悪',
                        readingReverse: 'くあ',
                    },
                ],
                0,
                1,
            );
            await storage.close();
            const client = await createYomitan({ storage });
            await client.profile.syncDictionaries();
            const html = await client.render.html((await client.lookup.terms('悪')).entries);
            expect(html).toContain('data-sc-ok="yes"');
            expect(html).not.toContain('onmouseover');
            expect(html).not.toContain('position: fixed');
            await client.dispose();
        });

        test('overwrite is unavailable when the transport cannot read notes', async ({ expect }) => {
            const client = await importedClient(createStorage);
            await withTermCardFormat(client, { Word: '{expression}' }, { duplicateBehavior: 'overwrite' });
            const { transport } = createFakeAnki();
            transport.notesInfo = undefined;
            const controller = createDisplayController(client, { anki: transport });
            const { entries } = await client.lookup.terms('打ち込む');
            await transport.addNote((await client.anki.buildNote(entries[0])).note);
            const [states] = await controller.getNoteStates([entries[0]]);
            expect(states.cardFormats[0]).toMatchObject({ action: 'disabled' });
            await expect(controller.addNote(entries[0], 0)).rejects.toThrow('cannot read notes');
            await client.dispose();
        });

        test('each AnkiConnect transport uses its own fetch', async ({ expect }) => {
            const calls: string[] = [];
            const makeFetch = (label: string) => async (_url: string, init?: object) => {
                const { action } = JSON.parse((init as { body: string }).body);
                calls.push(`${label}:${action}`);
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify(action === 'version' ? 6 : ['Default']),
                };
            };
            const client = await createYomitan({ storage: await createStorage(), fetch: makeFetch('client') as never });
            const a = createAnkiConnectTransport({ fetch: makeFetch('a') as never });
            const b = createAnkiConnectTransport({ fetch: makeFetch('b') as never });
            await a.getDeckNames();
            await b.getDeckNames();
            expect(calls.filter((call) => call.endsWith(':deckNames'))).toEqual(['a:deckNames', 'b:deckNames']);
            expect(calls.every((call) => !call.startsWith('client:'))).toBe(true);
            await client.dispose();
        });

        test('the display controller adds, reports duplicates, and follows duplicate behaviour', async ({ expect }) => {
            const client = await importedClient(createStorage);
            await withTermCardFormat(client, { Word: '{expression}', Meaning: '{glossary-brief}' });
            const { transport, notes, browsed } = createFakeAnki();
            const controller = createDisplayController(client, { anki: transport });
            const { entries } = await client.lookup.terms('打ち込む');
            const entry = entries[0];

            let [states] = await controller.getNoteStates([entry]);
            expect(states.cardFormats.map(({ cardFormatIndex, action }) => [cardFormatIndex, action])).toEqual([
                [0, 'add'],
                [1, 'disabled'],
            ]);
            const first = await controller.addNote(entry, 0);
            expect(first.overwritten).toBe(false);
            [states] = await controller.getNoteStates([entry]);
            expect(states.cardFormats[0]).toMatchObject({ action: 'add-duplicate', viewNoteIds: [first.noteId] });
            await controller.viewNotes([first.noteId]);
            expect(browsed).toEqual([[first.noteId]]);

            const second = await controller.addNote(entry, 0);
            expect(second.noteId).not.toBe(first.noteId);

            await withTermCardFormat(
                client,
                { Word: '{expression}', Meaning: '{glossary-brief}' },
                { duplicateBehavior: 'prevent' },
            );
            [states] = await controller.getNoteStates([entry]);
            expect(states.cardFormats[0]).toMatchObject({ action: 'disabled', reason: 'Duplicate notes are disabled' });
            await expect(controller.addNote(entry, 0)).rejects.toBeInstanceOf(DuplicateNoteError);

            await withTermCardFormat(
                client,
                { Word: '{expression}', Meaning: '{glossary-brief}' },
                { duplicateBehavior: 'overwrite' },
            );
            const existing = notes.get(first.noteId);
            if (existing !== undefined) {
                existing.fields.Meaning = '';
            }
            const overwritten = await controller.addNote(entry, 0);
            expect(overwritten).toEqual({ noteId: first.noteId, overwritten: true });
            expect(notes.get(first.noteId)?.fields.Meaning).not.toBe('');
            await client.dispose();
        });

        test('the display controller falls back without error details and browsing (AnkiConnect Android)', async ({
            expect,
        }) => {
            const client = await importedClient(createStorage);
            await withTermCardFormat(client, { Word: '{expression}' });
            const { transport } = createFakeAnki({ errorDetail: false, browse: false });
            const controller = createDisplayController(client, { anki: transport });
            const { entries } = await client.lookup.terms('打ち込む');
            await controller.addNote(entries[0], 0);
            const [states] = await controller.getNoteStates([entries[0]]);
            expect(states.cardFormats[0]).toMatchObject({ action: 'add-duplicate', viewNoteIds: [] });
            await expect(controller.viewNotes([1])).rejects.toThrow('cannot open the note browser');
            await client.dispose();
        });
    });
}
