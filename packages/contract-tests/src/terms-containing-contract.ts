/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `lookup.termsContaining` and the kanji-term index behind it, through the client on any adapter.
 */

import { describe, test } from 'vitest';
import {
    type CreateYomitanOptions,
    type Yomitan,
    createYomitan,
    createZipArchiveReader,
    importDictionaryArchive,
} from 'yomitan-core';
import type { YomitanStorage } from '../../core/src/storage/types';
import type { CreateClientStorage } from './client-contract';
import { zipFiles } from './fixtures';

type Meta = [expression: string, mode: 'freq', data: unknown];

/** A tiny frequency dictionary: kana-spelling rows (㋕), a kanji in the middle, 々, no-reading rows. */
function frequencyArchive(title: string, frequencyMode: string, meta: Meta[], terms: string[][] = []) {
    return zipFiles({
        'index.json': JSON.stringify({ title, format: 3, revision: '1', frequencyMode }),
        'term_bank_1.json': JSON.stringify(
            terms.map(([term, reading]) => [term, reading, '', '', 0, ['gloss'], 1, '']),
        ),
        'term_meta_bank_1.json': JSON.stringify(meta),
    });
}

const rank = (reading: string, value: number, displayValue = `${value}`): unknown => ({
    reading,
    frequency: { value, displayValue },
});

const RANK_META: Meta[] = [
    ['入学式', 'freq', rank('にゅうがくしき', 8790)],
    ['入学式', 'freq', rank('にゅうがくしき', 150092, '150092㋕')],
    ['学校', 'freq', rank('がっこう', 5, '5㋕')],
    ['学校', 'freq', rank('がっこう', 200)],
    ['学期', 'freq', 700],
    ['学ぶ', 'freq', rank('まなぶ', 900)],
    ['学', 'freq', rank('がく', 50)],
    ['大学', 'freq', rank('だいがく', 100)],
    ['人々', 'freq', rank('ひとびと', 400)],
    ['の', 'freq', { value: 1, displayValue: '1㋕' }],
    ['々', 'freq', 3],
];
const RANK_TERMS = [['学期', 'がっき']];

const COUNT_META: Meta[] = [
    ['学校', 'freq', rank('がっこう', 10)],
    ['大学', 'freq', rank('だいがく', 90)],
    ['学', 'freq', rank('がく', 5)],
];

const RANK = 'Freq Rank';
const COUNT = 'Freq Count';

export function runTermsContainingContract(
    label: string,
    createStorage: CreateClientStorage,
    makeClient: (options: CreateYomitanOptions) => Promise<Yomitan> = createYomitan,
): void {
    describe(`${label}: terms containing a kanji`, () => {
        async function clientWith(...archives: ArrayBuffer[]) {
            const storage = await createStorage();
            const client = await makeClient({ storage });
            for (const source of archives) {
                await client.dictionaries.import({ source });
            }
            return { storage, client };
        }

        test('ranks terms by their best non-kana frequency, with the kanji anywhere in the term', async ({
            expect,
        }) => {
            const { client } = await clientWith(await frequencyArchive(RANK, 'rank-based', RANK_META, RANK_TERMS));
            const terms = await client.lookup.termsContaining('学');
            expect(terms.map(({ term, reading, frequency }) => [term, reading, frequency])).toEqual([
                ['学', 'がく', 50],
                ['大学', 'だいがく', 100],
                ['学校', 'がっこう', 200],
                // No reading in the frequency data: taken from the term dictionaries.
                ['学期', 'がっき', 700],
                ['学ぶ', 'まなぶ', 900],
                ['入学式', 'にゅうがくしき', 8790],
            ]);
            expect(terms[2].displayValue).toBe('200');
            expect(await client.lookup.termsContaining('学', { limit: 2 })).toEqual(terms.slice(0, 2));
            expect((await client.lookup.termsContaining('人')).map(({ term }) => term)).toEqual(['人々']);
            await client.dispose();
        });

        test('returns nothing for 々, kana, several characters, or without frequencies', async ({ expect }) => {
            const { client } = await clientWith(await frequencyArchive(RANK, 'rank-based', RANK_META));
            for (const text of ['々', 'の', '学校', '', 'a', '字']) {
                expect(await client.lookup.termsContaining(text)).toEqual([]);
            }
            const empty = await clientWith();
            expect(await empty.client.lookup.termsContaining('学')).toEqual([]);
            await client.dispose();
            await empty.client.dispose();
        });

        test('ranks occurrence-based dictionaries highest first, and picks the dictionary', async ({ expect }) => {
            const plain = await zipFiles({
                'index.json': JSON.stringify({ title: 'Plain', format: 3, revision: '1' }),
                'term_bank_1.json': JSON.stringify([['学', 'がく', '', '', 0, ['x'], 1, '']]),
            });
            const { client } = await clientWith(
                plain,
                await frequencyArchive(RANK, 'rank-based', RANK_META),
                await frequencyArchive(COUNT, 'occurrence-based', COUNT_META),
            );
            const names = async (options?: { dictionary?: string }) =>
                (await client.lookup.termsContaining('学', options)).map(({ term }) => term);
            // The first enabled dictionary with term frequencies (not Plain).
            expect((await names()).slice(0, 2)).toEqual(['学', '大学']);
            expect(await names({ dictionary: COUNT })).toEqual(['大学', '学校', '学']);
            expect((await client.lookup.termsContaining('学', { dictionary: COUNT }))[0].frequency).toBe(90);

            const profile = client.profile.get();
            profile.options.general.sortFrequencyDictionary = COUNT;
            await client.profile.set(profile);
            expect(await names()).toEqual(['大学', '学校', '学']);

            profile.options.general.sortFrequencyDictionary = null;
            profile.options.dictionaries.find(({ name }) => name === RANK)!.enabled = false;
            await client.profile.set(profile);
            expect(await names()).toEqual(['大学', '学校', '学']);

            await expect(client.lookup.termsContaining('学', { dictionary: 'Plain' })).rejects.toThrow('Plain');
            await expect(client.lookup.termsContaining('学', { dictionary: 'Missing' })).rejects.toThrow('Missing');
            await client.dispose();
        });

        test('ignores a sort frequency dictionary that is disabled', async ({ expect }) => {
            const { client } = await clientWith(
                await frequencyArchive(RANK, 'rank-based', RANK_META),
                await frequencyArchive(COUNT, 'occurrence-based', COUNT_META),
            );
            const profile = client.profile.get();
            profile.options.general.sortFrequencyDictionary = COUNT;
            profile.options.dictionaries.find(({ name }) => name === COUNT)!.enabled = false;
            await client.profile.set(profile);
            expect((await client.lookup.termsContaining('学')).slice(0, 2).map(({ term }) => term)).toEqual([
                '学',
                '大学',
            ]);
            // An explicit dictionary is still honoured.
            expect((await client.lookup.termsContaining('学', { dictionary: COUNT }))[0].term).toBe('大学');
            await client.dispose();
        });

        describe('lazy index builds', () => {
            /** A frequency dictionary imported without the index, and a client on the same storage. */
            async function unindexed() {
                const storage = await createStorage();
                await storage.prepare();
                const { errors } = await importDictionaryArchive(
                    storage,
                    createZipArchiveReader(await frequencyArchive(RANK, 'rank-based', RANK_META, RANK_TERMS)),
                );
                if (errors.length > 0) {
                    throw errors[0];
                }
                const client = await makeClient({ storage });
                await client.profile.syncDictionaries();
                return { storage, client };
            }

            /** Runs `action` right after the index build has taken its write session. */
            function afterIndexSessionBegins(storage: YomitanStorage, action: () => Promise<void>) {
                const { sessions } = storage;
                const begin = sessions.begin.bind(sessions);
                sessions.begin = async (kind, title) => {
                    const session = await begin(kind, title);
                    if (kind === 'index') {
                        await action();
                    }
                    return session;
                };
            }

            test('take the write session, so they wait out imports and deletes', async ({ expect }) => {
                const { storage, client } = await unindexed();
                const held = await storage.sessions.begin('import', 'Elsewhere');
                await expect(client.lookup.termsContaining('学')).rejects.toMatchObject({ code: 'busy' });
                expect(await storage.findKanjiTerms('学', RANK)).toBeNull();
                await held.end();
                expect(await client.lookup.termsContaining('学')).toHaveLength(6);
                await client.dispose();
            });

            test('write nothing for a dictionary deleted before the session was held', async ({ expect }) => {
                const { storage, client } = await unindexed();
                afterIndexSessionBegins(storage, () => storage.deleteDictionary(RANK, 1000, () => {}));
                expect(await client.lookup.termsContaining('学')).toEqual([]);
                expect(await storage.findKanjiTerms('学', RANK)).toBeNull();
                expect(await storage.getDictionaryInfo()).toEqual([]);
                await client.dispose();
            });

            test('index the dictionary that is installed once the session is held', async ({ expect }) => {
                const { storage, client } = await unindexed();
                afterIndexSessionBegins(storage, async () => {
                    await storage.deleteDictionary(RANK, 1000, () => {});
                    const replacement = await frequencyArchive(RANK, 'rank-based', [['学', 'freq', 1]]);
                    await importDictionaryArchive(storage, createZipArchiveReader(replacement));
                });
                expect((await client.lookup.termsContaining('学')).map(({ term }) => term)).toEqual(['学']);
                expect((await storage.findKanjiTerms('学', RANK))?.length).toBe(1);
                await client.dispose();
            });
        });

        test('builds the index at import, and deletes it with the dictionary', async ({ expect }) => {
            const { storage, client } = await clientWith(await frequencyArchive(RANK, 'rank-based', RANK_META));
            expect((await storage.findKanjiTerms('学', RANK))?.length).toBe(6);
            await client.dictionaries.delete(RANK);
            expect(await storage.findKanjiTerms('学', RANK)).toBeNull();
            // Importing again indexes the new data.
            await client.dictionaries.import({
                source: await frequencyArchive(RANK, 'rank-based', [['学', 'freq', 1]]),
            });
            expect((await storage.findKanjiTerms('学', RANK))?.map(({ term }) => term)).toEqual(['学']);
            await client.dispose();
        });

        test('indexes a dictionary imported without the index on first use', async ({ expect }) => {
            const storage = await createStorage();
            await storage.prepare();
            // The importer alone (what earlier versions did) writes no index.
            const { errors } = await importDictionaryArchive(
                storage,
                createZipArchiveReader(await frequencyArchive(RANK, 'rank-based', RANK_META, RANK_TERMS)),
            );
            expect(errors).toEqual([]);
            expect(await storage.findKanjiTerms('学', RANK)).toBeNull();

            const client = await makeClient({ storage });
            await client.profile.syncDictionaries();
            const [first, second] = await Promise.all([
                client.lookup.termsContaining('学'),
                client.lookup.termsContaining('大'),
            ]);
            expect(first).toHaveLength(6);
            expect(second.map(({ term }) => term)).toEqual(['大学']);
            expect((await storage.findKanjiTerms('学', RANK))?.length).toBe(6);
            await client.dispose();
        });
    });
}
