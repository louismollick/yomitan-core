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
    tokenAt,
} from 'yomitan-core';
import { createFilesArchiveReader } from '../../core/src/import/archive';
import type { YomitanStorage } from '../../core/src/storage/types';
import { createDictionaryArchive, zipFiles } from './fixtures';
import { readFixtureDictionaryFiles } from './import-contract';

export type CreateClientStorage = () => Promise<YomitanStorage> | YomitanStorage;

const TITLE = 'Test Dictionary';

/**
 * A tiny dictionary where the longest match is the wrong split: そのバー (その場 matches through the
 * kana variants) and からん (下欄). With `frequencyMode`, term_meta ranks the short words well.
 */
async function createSegmentationArchive(frequencyMode?: 'rank-based' | 'occurrence-based'): Promise<ArrayBuffer> {
    const terms = [
        ['見る', 'みる', 'v1'],
        ['くせに', 'くせに'],
        ['Tシャツ', 'てぃーしゃつ'],
        ['シャツ', 'しゃつ'],
        ['その', 'その'],
        ['バー', 'ばー'],
        ['その場', 'そのば'],
        ['から', 'から'],
        ['ん', 'ん'],
        ['下欄', 'からん'],
        ['あ', 'あ'],
        ['あい', 'あい'],
        ['あいう', 'あいう'],
        ['いうえ', 'いうえ'],
    ];
    const ranks: Record<string, number> = {
        見る: 36,
        くせに: 500,
        Tシャツ: 2000,
        シャツ: 3000,
        その: 10,
        バー: 800,
        その場: 3000,
        から: 10,
        ん: 10,
        下欄: 150000,
    };
    const files: Record<string, string> = {
        'index.json': JSON.stringify({
            title: 'Segment Test',
            format: 3,
            revision: '1',
            sequenced: false,
            ...(frequencyMode === undefined ? {} : { frequencyMode }),
        }),
        'term_bank_1.json': JSON.stringify(
            terms.map(([term, reading, rules = '']) => [term, reading, '', rules, 0, ['def'], -1, '']),
        ),
    };
    if (frequencyMode !== undefined) {
        files['term_meta_bank_1.json'] = JSON.stringify(
            Object.entries(ranks).map(([term, rank]) => [term, 'freq', rank]),
        );
    }
    return await zipFiles(files);
}

async function withSegmentation(
    createStorage: CreateClientStorage,
    makeClient: (options: CreateYomitanOptions) => Promise<Yomitan>,
    frequencyMode?: 'rank-based' | 'occurrence-based',
): Promise<Yomitan> {
    const client = await makeClient({ storage: await createStorage() });
    await client.dictionaries.import({ source: await createSegmentationArchive(frequencyMode) });
    return client;
}

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
    makeClient: (options: CreateYomitanOptions) => Promise<Yomitan> = createYomitan,
): Promise<Yomitan> {
    const client = await makeClient({ storage: await createStorage(), ...options });
    await client.dictionaries.import({ source: await createDictionaryArchive('valid-dictionary1', { level: 6 }) });
    return client;
}

export function runClientContract(
    label: string,
    createStorage: CreateClientStorage,
    makeClient: (options: CreateYomitanOptions) => Promise<Yomitan> = createYomitan,
): void {
    describe(`${label}: client contract`, () => {
        test('imports a dictionary, enables it in the profile, and looks up terms and kanji', async ({ expect }) => {
            const client = await makeClient({ storage: await createStorage() });
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
            const client = await withImported(createStorage, {}, makeClient);
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
            const client = await withImported(createStorage, {}, makeClient);
            const text = '今日は打ち込む。明日も';
            const result = await client.lookup.scan(text, 3);
            expect(result?.range).toEqual({ start: 3, end: 7 });
            expect(result?.sentence).toEqual({ text: '今日は打ち込む。', offset: 3 });
            expect(result?.entries[0].headwords[0].term).toBe('打ち込む');
            expect(await client.lookup.scan(text, text.length)).toBeNull();
            await client.dispose();
        });

        test('parses the whole text into tokens with ranges and furigana, across lines', async ({ expect }) => {
            const client = await withImported(createStorage, {}, makeClient);
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

        test('segments by the cheapest frequency-scored path where parse takes the longest match', async ({
            expect,
        }) => {
            const client = await withSegmentation(createStorage, makeClient, 'rank-based');
            const spans = async (text: string) =>
                (await client.lookup.segment(text)).map(({ text: token, entries }) => [token, entries.length > 0]);
            // parse swallows the next word (そのバ matches その場) and leaves ー over; the lattice splits その | バー.
            expect((await client.lookup.parse('そのバー')).map(({ text }) => text)).toEqual(['そのバ', 'ー']);
            expect(await spans('そのバー')).toEqual([
                ['その', true],
                ['バー', true],
            ]);
            expect(await spans('からん')).toEqual([
                ['から', true],
                ['ん', true],
            ]);
            // Unmatched characters merge into one entry-less token, ranges cover the whole text.
            const tokens = await client.lookup.segment('そのxyバー');
            expect(tokens.map(({ text }) => text)).toEqual(['その', 'xy', 'バー']);
            expect(tokens[1]).toMatchObject({ range: { start: 2, end: 4 }, entries: [] });
            await client.dispose();
        });

        test('segment tokens carry the entries and furigana for exactly their span', async ({ expect }) => {
            const client = await withSegmentation(createStorage, makeClient, 'rank-based');
            const tokens = await client.lookup.segment('そのバー');
            const [first, second] = tokens;
            expect(first.entries.map(({ headwords }) => headwords[0].term)).toEqual(['その']);
            expect(second.range).toEqual({ start: 2, end: 4 });
            expect(second.entries.map(({ headwords }) => headwords[0].term)).toEqual(['バー']);
            expect(second.segments).toEqual([{ text: 'バー', reading: '' }]);
            expect(second.headwords?.[0][0]).toMatchObject({ term: 'バー', reading: 'ばー' });
            // The same entries a lookup of just the span shows.
            const looked = await client.lookup.terms('バー', { mode: 'group' });
            expect(second.entries.map(({ headwords }) => headwords[0].term)).toEqual(
                looked.entries
                    .filter(({ headwords }) =>
                        headwords.some(({ sources }) => sources.some(({ originalText }) => originalText === 'バー')),
                    )
                    .map(({ headwords }) => headwords[0].term),
            );
            expect(tokenAt(tokens, 3)).toBe(second);
            expect(tokenAt(tokens, 4)).toBeUndefined();
            await client.dispose();
        });

        test('segment sees the shorter matches of an entry the longest match also covers', async ({ expect }) => {
            const client = await withSegmentation(createStorage, makeClient, 'rank-based');
            // 見る matches as 見た and as 見たく; the Translator lists it once, as 見たく, for a grouped lookup.
            const tokens = await client.lookup.segment('見たくせに');
            expect(tokens.map(({ text }) => text)).toEqual(['見た', 'くせに']);
            const looked = await client.lookup.terms('見た', { mode: 'group' });
            expect(tokens[0].entries).toEqual(looked.entries);
            await client.dispose();
        });

        test('segment keeps mixed-script words whole when alphanumeric scanning is on', async ({ expect }) => {
            const client = await withSegmentation(createStorage, makeClient, 'rank-based');
            expect((await client.lookup.segment('Ｔシャツ')).map(({ text }) => text)).toEqual(['Ｔシャツ']);
            expect((await client.lookup.segment('abcシャツ')).map(({ text }) => text)).toEqual(['abc', 'シャツ']);
            const profile = client.profile.get();
            profile.options.scanning.alphanumeric = false;
            await client.profile.set(profile);
            expect((await client.lookup.segment('Tシャツ')).map(({ text }) => text)).toEqual(['T', 'シャツ']);
            await client.dispose();
        });

        test('segment only ranks by a usable sort frequency dictionary', async ({ expect }) => {
            const split = async (client: Yomitan) => (await client.lookup.segment('からん')).map(({ text }) => text);
            const set = async (client: Yomitan, name: string | null, enabled = true) => {
                const profile = client.profile.get();
                profile.options.general.sortFrequencyDictionary = name;
                profile.options.dictionaries[0].enabled = enabled;
                await client.profile.set(profile);
            };
            const ranked = await withSegmentation(createStorage, makeClient, 'rank-based');
            // A missing name falls through to the dictionary that has frequencies.
            await set(ranked, 'Missing');
            expect(await split(ranked)).toEqual(['から', 'ん']);
            // A disabled one has nothing to rank with, so the fewest words win.
            await set(ranked, 'Segment Test', false);
            expect(await split(ranked)).toEqual(['からん']);
            await ranked.dispose();
            // Occurrence-based counts are not ranks.
            const counted = await withSegmentation(createStorage, makeClient, 'occurrence-based');
            await set(counted, 'Segment Test');
            expect(await split(counted)).toEqual(['からん']);
            await counted.dispose();
            // No term frequencies at all.
            const plain = await withSegmentation(createStorage, makeClient);
            await set(plain, 'Segment Test');
            expect(await split(plain)).toEqual(['からん']);
            await plain.dispose();
        });

        test('segment falls back to the fewest words without a rank-based frequency dictionary', async ({ expect }) => {
            for (const frequencyMode of [undefined, 'occurrence-based'] as const) {
                const client = await withSegmentation(createStorage, makeClient, frequencyMode);
                const split = async (text: string) => (await client.lookup.segment(text)).map(({ text: t }) => t);
                // Fewest words: the single word 下欄 beats から | ん, and あ | いうえ beats あいう | え.
                expect(await split('からん')).toEqual(['からん']);
                expect(await split('あいうえ')).toEqual(['あ', 'いうえ']);
                await client.dispose();
            }
        });

        test('deletes a dictionary and drops it from the profile', async ({ expect }) => {
            const client = await withImported(createStorage, {}, makeClient);
            await client.dictionaries.delete(TITLE);
            expect(await client.dictionaries.list()).toEqual([]);
            expect(client.profile.get().options.dictionaries).toEqual([]);
            expect((await client.lookup.terms('打ち込む')).entries).toEqual([]);
            await client.dispose();
        });

        test('a failed import leaves nothing behind', async ({ expect }) => {
            const client = await makeClient({ storage: await createStorage() });
            const files = readFixtureDictionaryFiles('valid-dictionary1');
            files['term_bank_1.json'] = '[["broken"]]';
            await expect(client.dictionaries.import({ source: { directory: 'unused' } })).rejects.toThrow(
                'no directory archive reader',
            );
            const failing = await makeClient({
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
            const client = await makeClient({ storage: await createStorage() });
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
            const client = await withImported(createStorage, {}, makeClient);
            await expect(
                client.dictionaries.import({ source: await createDictionaryArchive('valid-dictionary1') }),
            ).rejects.toThrow('already imported');
            expect((await client.lookup.terms('打ち込む')).entries.length).toBeGreaterThan(0);
            await client.dispose();
        });

        test('a malformed archive with an installed title leaves the installed dictionary alone', async ({
            expect,
        }) => {
            const files = readFixtureDictionaryFiles('valid-dictionary1');
            const index = JSON.parse(files['index.json'] as string);
            index.revision = undefined;
            files['index.json'] = JSON.stringify(index);
            const client = await withImported(
                createStorage,
                {
                    archiveReaders: { directory: () => createFilesArchiveReader(files) },
                },
                makeClient,
            );
            await expect(client.dictionaries.import({ source: { directory: 'broken' } })).rejects.toThrow(
                'already imported',
            );
            expect((await client.lookup.terms('打ち込む')).entries.length).toBeGreaterThan(0);
            await client.dispose();
        });

        test('a throwing progress listener does not break an import', async ({ expect }) => {
            const client = await makeClient({ storage: await createStorage() });
            await client.dictionaries.import({
                source: await createDictionaryArchive('valid-dictionary1'),
                onProgress: () => {
                    throw new Error('listener bug');
                },
            });
            expect((await client.dictionaries.list()).map(({ title }) => title)).toEqual([TITLE]);
            await client.dispose();
        });

        test('aborting at the last progress event still aborts the import', async ({ expect }) => {
            const counting = await makeClient({ storage: await createStorage() });
            let events = 0;
            await counting.dictionaries.import({
                source: await createDictionaryArchive('valid-dictionary1'),
                onProgress: () => {
                    ++events;
                },
            });
            await counting.dispose();
            const client = await makeClient({ storage: await createStorage() });
            const controller = new AbortController();
            let seen = 0;
            await expect(
                client.dictionaries.import({
                    source: await createDictionaryArchive('valid-dictionary1'),
                    signal: controller.signal,
                    onProgress: () => {
                        if (++seen === events) {
                            controller.abort();
                        }
                    },
                }),
            ).rejects.toBeInstanceOf(YomitanAbortError);
            expect(await client.dictionaries.list()).toEqual([]);
            await client.dispose();
        });

        test('a failed update download keeps the installed dictionary', async ({ expect }) => {
            const files = readFixtureDictionaryFiles('valid-dictionary1');
            const updatable = {
                ...JSON.parse(files['index.json'] as string),
                isUpdatable: true,
                indexUrl: 'https://example.test/index.json',
                downloadUrl: 'https://example.test/d.zip',
            };
            files['index.json'] = JSON.stringify(updatable);
            const client = await makeClient({
                storage: await createStorage(),
                fetch: async (url) =>
                    url.endsWith('index.json')
                        ? jsonResponse({ ...updatable, revision: 'test2' })
                        : {
                              ok: false,
                              status: 500,
                              json: async () => ({}),
                              arrayBuffer: async () => new ArrayBuffer(0),
                          },
                archiveReaders: { directory: () => createFilesArchiveReader(files) },
            });
            await client.dictionaries.import({ source: { directory: 'main' } });
            await expect(client.dictionaries.update(TITLE)).rejects.toThrow('HTTP 500');
            expect((await client.dictionaries.list()).map(({ title }) => title)).toEqual([TITLE]);
            expect(client.profile.get().options.dictionaries.map(({ name }) => name)).toEqual([TITLE]);
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
            const client = await makeClient({
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

            const urlClient = await makeClient({ storage: await createStorage(), fetch });
            await urlClient.dictionaries.import({ source: { url: 'https://example.test/d.zip' } });
            expect(requested).toContain('https://example.test/d.zip');
            expect((await urlClient.dictionaries.list()).map(({ title }) => title)).toEqual([TITLE]);
            await urlClient.dispose();
        });

        test('an update with a broken data bank keeps the installed dictionary', async ({ expect }) => {
            const files = readFixtureDictionaryFiles('valid-dictionary1');
            const updatable = {
                ...JSON.parse(files['index.json'] as string),
                isUpdatable: true,
                indexUrl: 'https://example.test/index.json',
                downloadUrl: 'https://example.test/d.zip',
            };
            files['index.json'] = JSON.stringify(updatable);
            const brokenArchive = await zipFiles({
                ...files,
                'index.json': JSON.stringify({ ...updatable, revision: 'test2' }),
                'term_bank_1.json': '[["x"]]',
            });
            const client = await makeClient({
                storage: await createStorage(),
                fetch: async (url) =>
                    url.endsWith('index.json')
                        ? jsonResponse({ ...updatable, revision: 'test2' })
                        : { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => brokenArchive },
                archiveReaders: { directory: () => createFilesArchiveReader(files) },
            });
            await client.dictionaries.import({ source: { directory: 'main' } });
            await expect(client.dictionaries.update(TITLE)).rejects.toBeInstanceOf(DictionaryImportError);
            expect((await client.dictionaries.list()).map(({ title, revision }) => [title, revision])).toEqual([
                [TITLE, 'test'],
            ]);
            expect(client.profile.get().options.dictionaries.map(({ name }) => name)).toEqual([TITLE]);
            expect((await client.lookup.terms('打ち込む')).entries.length).toBeGreaterThan(0);
            await client.dispose();
        });

        test('an update with a missing image keeps the installed dictionary (full dry run)', async ({ expect }) => {
            const files = readFixtureDictionaryFiles('valid-dictionary1');
            const updatable = {
                ...JSON.parse(files['index.json'] as string),
                isUpdatable: true,
                indexUrl: 'https://example.test/index.json',
                downloadUrl: 'https://example.test/d.zip',
            };
            files['index.json'] = JSON.stringify(updatable);
            const brokenArchive = await zipFiles({
                ...files,
                'index.json': JSON.stringify({ ...updatable, revision: 'test2' }),
            });
            // A schema-valid archive that references an image it does not contain fails only during media
            // loading, after upstream's first write.
            const withoutImage = await zipFiles(
                Object.fromEntries(
                    Object.entries({
                        ...files,
                        'index.json': JSON.stringify({ ...updatable, revision: 'test2' }),
                    }).filter(([name]) => name !== 'image.gif'),
                ),
            );
            const client = await makeClient({
                storage: await createStorage(),
                fetch: async (url) =>
                    url.endsWith('index.json')
                        ? jsonResponse({ ...updatable, revision: 'test2' })
                        : { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => withoutImage },
                archiveReaders: { directory: () => createFilesArchiveReader(files) },
            });
            await client.dictionaries.import({ source: { directory: 'main' } });
            await expect(client.dictionaries.update(TITLE)).rejects.toBeInstanceOf(DictionaryImportError);
            expect((await client.dictionaries.list()).map(({ title, revision }) => [title, revision])).toEqual([
                [TITLE, 'test'],
            ]);
            expect(client.profile.get().options.dictionaries.map(({ name }) => name)).toEqual([TITLE]);
            expect((await client.lookup.terms('打ち込む')).entries.length).toBeGreaterThan(0);
            await client.dispose();
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
            const client = await makeClient({
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
            const client = await withImported(createStorage, {}, makeClient);
            const media = await client.dictionaries.getMedia(TITLE, 'aosaba_auto.png');
            expect(media).toMatchObject({ mediaType: 'image/png', width: 64, height: 64 });
            expect(media?.content.byteLength).toBeGreaterThan(0);
            expect(await client.dictionaries.getMedia(TITLE, 'missing.png')).toBeNull();
            await client.dispose();
        });

        test('lists recommended dictionaries from Yomitan', async ({ expect }) => {
            const client = await makeClient({ storage: await createStorage() });
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
            const client = await withImported(createStorage, {}, makeClient);
            const stored = client.profile.get();
            stored.options.general.maxResults = 7;
            await client.dispose();
            const restored = await makeClient({ storage: await createStorage(), profile: stored });
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
