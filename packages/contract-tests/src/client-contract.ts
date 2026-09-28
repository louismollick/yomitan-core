/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Behaviour every client must show, whatever the storage adapter or transport.
 */

import { describe, test } from 'vitest';
import {
    type CreateYomitanOptions,
    DictionaryImportError,
    type Yomitan,
    YomitanAbortError,
    createYomitan,
} from '../../core/src/client/yomitan';
import { createFilesArchiveReader } from '../../core/src/import/archive';
import type { YomitanStorage } from '../../core/src/storage/types';
import { createDictionaryArchive } from './fixtures';
import { readFixtureDictionaryFiles } from './import-contract';

export type CreateClientStorage = () => Promise<YomitanStorage> | YomitanStorage;

const TITLE = 'Test Dictionary';

type Fetch = NonNullable<CreateYomitanOptions['fetch']>;

function jsonResponse(value: unknown) {
    return {
        ok: true,
        status: 200,
        json: async () => value,
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer,
    };
}

async function withImported(
    createStorage: CreateClientStorage,
    options: Partial<CreateYomitanOptions> = {},
): Promise<Yomitan> {
    const client = await createYomitan({ storage: await createStorage(), ...options });
    await client.dictionaries.import({ source: await createDictionaryArchive('valid-dictionary1', { level: 6 }) });
    return client;
}

export function runClientContract(label: string, createStorage: CreateClientStorage): void {
    describe(`${label}: client contract`, () => {
        test('imports a dictionary, enables it in the profile, and looks up terms and kanji', async ({ expect }) => {
            const client = await createYomitan({ storage: await createStorage() });
            const progress: number[] = [];
            const summary = await client.dictionaries.import({
                source: await createDictionaryArchive('valid-dictionary1', { level: 6 }),
                onProgress: ({ index }) => progress.push(index),
            });
            expect(summary.title).toBe(TITLE);
            expect(progress.length).toBeGreaterThan(0);
            expect((await client.dictionaries.list()).map(({ title }) => title)).toEqual([TITLE]);
            expect(client.profile.get().options.dictionaries).toMatchObject([{ name: TITLE, enabled: true }]);

            const { entries, originalTextLength } = await client.lookup.terms('打ち込む');
            expect(originalTextLength).toBe(4);
            expect(entries.length).toBeGreaterThan(0);
            expect(entries[0].headwords[0].term).toBe('打ち込む');
            const kanji = await client.lookup.kanji('打');
            expect(kanji.map(({ character }) => character)).toEqual(['打']);
            await client.dispose();
        });

        test('respects the profile: disabled dictionaries, result mode and maxResults', async ({ expect }) => {
            const client = await withImported(createStorage);
            const profile = client.profile.get();
            profile.options.dictionaries[0].enabled = false;
            await client.profile.set(profile);
            expect((await client.lookup.terms('打ち込む')).entries).toEqual([]);
            profile.options.dictionaries[0].enabled = true;
            profile.options.general.resultOutputMode = 'split';
            profile.options.general.maxResults = 1;
            await client.profile.set(profile);
            const { entries } = await client.lookup.terms('打');
            expect(entries).toHaveLength(1);
            await client.dispose();
        });

        test('scans from an offset and returns the matched range and sentence', async ({ expect }) => {
            const client = await withImported(createStorage);
            const text = '今日は打ち込む。明日も';
            const result = await client.lookup.scan(text, 3);
            expect(result?.range).toEqual({ start: 3, end: 7 });
            expect(result?.sentence).toEqual({ text: '今日は打ち込む。', offset: 3 });
            expect(result?.entries[0].headwords[0].term).toBe('打ち込む');
            expect(await client.lookup.scan(text, text.length)).toBeNull();
            await client.dispose();
        });

        test('parses the whole text into tokens with ranges and furigana, across lines', async ({ expect }) => {
            const client = await withImported(createStorage);
            const text = '打ち込む\n打つ';
            const tokens = await client.lookup.parse(text);
            expect(tokens.map(({ text: token, range }) => [token, range.start, range.end])).toEqual([
                ['打ち込む', 0, 4],
                ['\n', 4, 5],
                ['打つ', 5, 7],
            ]);
            expect(tokens[0].segments[0]).toEqual({ text: '打', reading: 'う' });
            expect(tokens.map(({ text: token }) => token).join('')).toBe(text);
            await client.dispose();
        });

        test('deletes a dictionary and drops it from the profile', async ({ expect }) => {
            const client = await withImported(createStorage);
            await client.dictionaries.delete(TITLE);
            expect(await client.dictionaries.list()).toEqual([]);
            expect(client.profile.get().options.dictionaries).toEqual([]);
            expect((await client.lookup.terms('打ち込む')).entries).toEqual([]);
            await client.dispose();
        });

        test('a failed import leaves nothing behind', async ({ expect }) => {
            const client = await createYomitan({ storage: await createStorage() });
            const files = readFixtureDictionaryFiles('valid-dictionary1');
            files['term_bank_1.json'] = '[["broken"]]';
            await expect(client.dictionaries.import({ source: { directory: 'unused' } })).rejects.toThrow(
                'no directory archive reader',
            );
            const failing = await createYomitan({
                storage: await createStorage(),
                archiveReaders: { directory: () => createFilesArchiveReader(files) },
            });
            await expect(failing.dictionaries.import({ source: { directory: 'x' } })).rejects.toBeInstanceOf(
                DictionaryImportError,
            );
            expect(await failing.dictionaries.list()).toEqual([]);
            await client.dispose();
            await failing.dispose();
        });

        test('an aborted import is removed and reports AbortError', async ({ expect }) => {
            const client = await createYomitan({ storage: await createStorage() });
            const controller = new AbortController();
            const promise = client.dictionaries.import({
                source: await createDictionaryArchive('valid-dictionary1'),
                signal: controller.signal,
                onProgress: () => controller.abort(),
            });
            await expect(promise).rejects.toBeInstanceOf(YomitanAbortError);
            expect(await client.dictionaries.list()).toEqual([]);
            // The title is free again.
            await client.dictionaries.import({ source: await createDictionaryArchive('valid-dictionary1') });
            expect((await client.dictionaries.list()).map(({ title }) => title)).toEqual([TITLE]);
            await client.dispose();
        });

        test('importing the same dictionary twice fails without touching the installed one', async ({ expect }) => {
            const client = await withImported(createStorage);
            await expect(
                client.dictionaries.import({ source: await createDictionaryArchive('valid-dictionary1') }),
            ).rejects.toThrow('already imported');
            expect((await client.lookup.terms('打ち込む')).entries.length).toBeGreaterThan(0);
            await client.dispose();
        });

        test('imports from a URL and checks for updates through the injected fetch', async ({ expect }) => {
            const archive = await createDictionaryArchive('valid-dictionary1', { level: 6 });
            const files = readFixtureDictionaryFiles('valid-dictionary1');
            const index = JSON.parse(files['index.json'] as string);
            const updatable = {
                ...index,
                isUpdatable: true,
                indexUrl: 'https://example.test/index.json',
                downloadUrl: 'https://example.test/d.zip',
            };
            files['index.json'] = JSON.stringify(updatable);
            const requested: string[] = [];
            const fetch: Fetch = async (url) => {
                requested.push(url);
                if (url.endsWith('index.json')) {
                    return jsonResponse({ ...updatable, revision: 'test2' });
                }
                return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => archive };
            };
            const client = await createYomitan({
                storage: await createStorage(),
                fetch,
                archiveReaders: { directory: () => createFilesArchiveReader(files) },
            });
            await client.dictionaries.import({ source: { directory: 'local' } });
            expect(await client.dictionaries.checkUpdates()).toEqual([
                {
                    title: TITLE,
                    currentRevision: 'test',
                    latestRevision: 'test2',
                    downloadUrl: 'https://example.test/d.zip',
                },
            ]);
            await client.dispose();

            const urlClient = await createYomitan({ storage: await createStorage(), fetch });
            await urlClient.dictionaries.import({ source: { url: 'https://example.test/d.zip' } });
            expect(requested).toContain('https://example.test/d.zip');
            expect((await urlClient.dictionaries.list()).map(({ title }) => title)).toEqual([TITLE]);
            await urlClient.dispose();
        });

        test('updates keep the dictionary position and settings in the profile', async ({ expect }) => {
            const archive = await createDictionaryArchive('valid-dictionary1', { level: 6 });
            const files = readFixtureDictionaryFiles('valid-dictionary1');
            const updatable = {
                ...JSON.parse(files['index.json'] as string),
                isUpdatable: true,
                indexUrl: 'https://example.test/index.json',
                downloadUrl: 'https://example.test/d.zip',
            };
            files['index.json'] = JSON.stringify(updatable);
            const other = readFixtureDictionaryFiles('valid-dictionary1');
            other['index.json'] = JSON.stringify({ ...JSON.parse(other['index.json'] as string), title: 'Other' });
            const client = await createYomitan({
                storage: await createStorage(),
                fetch: async (url) =>
                    url.endsWith('index.json')
                        ? jsonResponse({ ...updatable, revision: 'test2' })
                        : { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => archive },
                archiveReaders: { directory: (name) => createFilesArchiveReader(name === 'other' ? other : files) },
            });
            await client.dictionaries.import({ source: { directory: 'main' } });
            await client.dictionaries.import({ source: { directory: 'other' } });
            const profile = client.profile.get();
            profile.options.dictionaries[0].alias = 'Mine';
            profile.options.dictionaries[0].allowSecondarySearches = true;
            await client.profile.set(profile);
            await client.dictionaries.update(TITLE);
            expect(
                client.profile
                    .get()
                    .options.dictionaries.map(({ name, alias, allowSecondarySearches }) => [
                        name,
                        alias,
                        allowSecondarySearches,
                    ]),
            ).toEqual([
                [TITLE, 'Mine', true],
                ['Other', 'Other', false],
            ]);
            await client.dispose();
        });

        test('reports media with real image sizes', async ({ expect }) => {
            const client = await withImported(createStorage);
            const media = await client.dictionaries.getMedia(TITLE, 'aosaba_auto.png');
            expect(media).toMatchObject({ mediaType: 'image/png', width: 64, height: 64 });
            expect(media?.content.byteLength).toBeGreaterThan(0);
            expect(await client.dictionaries.getMedia(TITLE, 'missing.png')).toBeNull();
            await client.dispose();
        });

        test('lists recommended dictionaries from Yomitan', async ({ expect }) => {
            const client = await createYomitan({ storage: await createStorage() });
            const recommended = await client.dictionaries.recommended('ja');
            expect(recommended.length).toBeGreaterThan(0);
            expect(
                recommended.every(
                    ({ downloadUrl, kind }) => downloadUrl.startsWith('http') && typeof kind === 'string',
                ),
            ).toBe(true);
            expect(await client.dictionaries.recommended('xx')).toEqual([]);
            await client.dispose();
        });

        test('restores a stored profile and migrates an old one', async ({ expect }) => {
            const client = await withImported(createStorage);
            const stored = client.profile.get();
            stored.options.general.maxResults = 7;
            await client.dispose();
            const restored = await createYomitan({ storage: await createStorage(), profile: stored });
            expect(restored.profile.get().options.general.maxResults).toBe(7);
            const defaults = await restored.profile.defaults();
            expect(defaults.version).toBeGreaterThan(0);
            const migrated = await restored.profile.migrate({ version: 0, options: {} });
            expect(migrated.version).toBe(defaults.version);
            expect(migrated.options.general.language).toBe(defaults.options.general.language);
            await restored.dispose();
        });
    });
}
