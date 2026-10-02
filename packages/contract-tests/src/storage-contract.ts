/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Port of Yomitan's test/database.test.js, parameterized over a storage adapter factory.
 */

import { describe, test } from 'vitest';
import { createZipArchiveReader } from '../../core/src/import/archive';
import { importDictionaryArchive } from '../../core/src/import/importer';
import type { DictionaryStorage } from '../../core/src/storage/types';
import { createDictionaryArchive, readUpstreamJson } from './fixtures';

export type CreateStorage = () => Promise<DictionaryStorage> | DictionaryStorage;

type CountPair = [string, number];
type DatabaseTestData = {
    expectedSummary: Record<string, unknown> & { importDate: number };
    expectedCounts: unknown;
    tests: {
        findTermsBulk: {
            inputs: { matchType: string; termList: string[] }[];
            expectedResults: { total: number; terms: CountPair[]; readings: CountPair[] };
        }[];
        findTermsExactBulk: {
            inputs: { termList: { term: string; reading: string }[] }[];
            expectedResults: { total: number; terms: CountPair[]; readings: CountPair[] };
        }[];
        findTermsBySequenceBulk: {
            inputs: { sequenceList: number[] }[];
            expectedResults: { total: number; terms: CountPair[]; readings: CountPair[] };
        }[];
        findTermMetaBulk: {
            inputs: { termList: string[] }[];
            expectedResults: { total: number; modes: CountPair[] };
        }[];
        findKanjiBulk: { inputs: { kanjiList: string[] }[]; expectedResults: { total: number; kanji: CountPair[] } }[];
        findKanjiMetaBulk: {
            inputs: { kanjiList: string[] }[];
            expectedResults: { total: number; modes: CountPair[] };
        }[];
        findTagForTitle: { inputs: { name: string }[]; expectedResults: { value: unknown } }[];
    };
};

/**
 * Imports with upstream's importer through a zip archive reader, and upstream's test media loader
 * (every image reports 100×100, as in upstream's golden fixtures).
 */
export function importFixture(
    storage: DictionaryStorage,
    archive: ArrayBuffer,
    onProgress?: (progress: { index: number; count: number }) => void,
) {
    return importDictionaryArchive(storage, createZipArchiveReader(archive), {
        imageInfoReader: testMediaLoader,
        onProgress,
    });
}

/** Upstream's test media loader: images are not decoded. */
export const testMediaLoader = {
    async getImageDetails(content: ArrayBuffer) {
        return { content, width: 100, height: 100 };
    },
};

function countBy<T>(items: T[], key: keyof T, value: unknown): number {
    return items.reduce((count, item) => count + (item[key] === value ? 1 : 0), 0);
}

export function runStorageContract(label: string, createStorage: CreateStorage): void {
    describe(`${label}: storage contract (upstream database.test.js)`, () => {
        test('rejects use before prepare and double prepare', async ({ expect }) => {
            const storage = await createStorage();
            const archive = await createDictionaryArchive('valid-dictionary1');
            const title = 'Test Dictionary';
            const titles = new Map([[title, { alias: title, allowSecondarySearches: false }]]);
            const notOpen = 'Database not open';
            await expect.soft(storage.deleteDictionary(title, 1000, () => {})).rejects.toThrow(notOpen);
            await expect.soft(storage.findTermsBulk(['?'], titles, 'exact')).rejects.toThrow(notOpen);
            await expect
                .soft(storage.findTermsExactBulk([{ term: '?', reading: '?' }], titles))
                .rejects.toThrow(notOpen);
            await expect
                .soft(storage.findTermsBySequenceBulk([{ query: 1, dictionary: title }]))
                .rejects.toThrow(notOpen);
            await expect.soft(storage.findTermMetaBulk(['?'], titles)).rejects.toThrow(notOpen);
            await expect.soft(storage.findKanjiBulk(['?'], titles)).rejects.toThrow(notOpen);
            await expect.soft(storage.findKanjiMetaBulk(['?'], titles)).rejects.toThrow(notOpen);
            await expect.soft(storage.findTagForTitle('tag', title)).rejects.toThrow(notOpen);
            await expect.soft(storage.getDictionaryInfo()).rejects.toThrow(notOpen);
            await expect.soft(storage.getDictionaryCounts([title], true)).rejects.toThrow(notOpen);
            await expect.soft(importFixture(storage, archive)).rejects.toThrow('Database is not ready');
            await storage.prepare();
            await expect.soft(storage.prepare()).rejects.toThrow('Database already open');
            await importFixture(storage, archive);
            expect.soft(await importFixture(storage, archive)).toEqual({
                result: null,
                errors: [new Error('Dictionary Test Dictionary is already imported, skipped it.')],
            });
            await storage.close();
        });

        test('close rejects when not open, and waits for an open in progress', async ({ expect }) => {
            const storage = await createStorage();
            await expect(storage.close()).rejects.toThrow('Database is not open');
            const opening = storage.prepare();
            await storage.close();
            await opening;
            expect(storage.isPrepared()).toBe(false);
        });

        test('orders equal index keys by primary key', async ({ expect }) => {
            const storage = await createStorage();
            await storage.prepare();
            const term = (glossary: string) => ({
                expression: '打つ',
                reading: 'うつ',
                definitionTags: '',
                rules: '',
                score: 0,
                glossary: [glossary],
                dictionary: 'D',
            });
            await storage.addWithResult('terms', term('second'));
            await storage.bulkUpdate('terms', [{ primaryKey: 0, data: term('first') as never }], 0, 1);
            const results = await storage.findTermsBulk(['打つ'], new Set(['D']), 'exact');
            expect(results.map(({ definitions }) => definitions[0])).toEqual(['first', 'second']);
            await storage.close();
        });

        test('a prepare() issued during close() opens after the close finishes', async ({ expect }) => {
            const storage = await createStorage();
            await storage.prepare();
            const closing = storage.close();
            const reopening = storage.prepare();
            await closing;
            await reopening;
            expect(storage.isPrepared()).toBe(true);
            expect(await storage.getDictionaryInfo()).toEqual([]);
            await storage.close();
        });

        test('returns dictionary summaries in primary key order', async ({ expect }) => {
            const storage = await createStorage();
            await storage.prepare();
            await storage.addWithResult('dictionaries', { title: 'B', version: 3 });
            await storage.bulkUpdate(
                'dictionaries',
                [{ primaryKey: 0, data: { title: 'A', version: 3 } as never }],
                0,
                1,
            );
            expect((await storage.getDictionaryInfo()).map(({ title }) => title)).toEqual(['A', 'B']);
            await storage.close();
        });

        for (const name of [
            'invalid-dictionary1',
            'invalid-dictionary2',
            'invalid-dictionary3',
            'invalid-dictionary4',
            'invalid-dictionary5',
            'invalid-dictionary6',
        ]) {
            test(`rejects ${name}`, async ({ expect }) => {
                const storage = await createStorage();
                await storage.prepare();
                const archive = await createDictionaryArchive(name);
                await expect.soft(importFixture(storage, archive)).rejects.toThrow('Dictionary has invalid data');
                await storage.close();
            });
        }

        test('imports valid-dictionary1 and answers every upstream query case', async ({ expect }) => {
            const testData = readUpstreamJson<DatabaseTestData>('database-test-cases.json');
            const storage = await createStorage();
            await storage.prepare();
            let progressed = false;
            const archive = await createDictionaryArchive('valid-dictionary1');
            const { result, errors } = await importFixture(
                storage,
                archive,
                ({ index, count }: { index: number; count: number }) => {
                    expect.soft(index <= count).toBe(true);
                    progressed = true;
                },
            );
            if (result) {
                result.importDate = testData.expectedSummary.importDate;
            }
            expect.soft(errors).toStrictEqual([]);
            expect.soft(result).toStrictEqual(testData.expectedSummary);
            expect.soft(progressed).toBe(true);

            const info = await storage.getDictionaryInfo();
            for (const item of info) {
                item.importDate = testData.expectedSummary.importDate;
            }
            expect.soft(info).toStrictEqual([testData.expectedSummary]);
            expect
                .soft(
                    await storage.getDictionaryCounts(
                        info.map((v) => v.title),
                        true,
                    ),
                )
                .toStrictEqual(testData.expectedCounts);

            const title = String(testData.expectedSummary.title);
            const titles = new Map([[title, { alias: title, allowSecondarySearches: false }]]);
            for (const { inputs, expectedResults } of testData.tests.findTermsBulk) {
                for (const { termList, matchType } of inputs) {
                    const results = await storage.findTermsBulk(termList, titles, matchType as 'exact');
                    expect.soft(results.length).toStrictEqual(expectedResults.total);
                    for (const [term, count] of expectedResults.terms) {
                        expect.soft(countBy(results, 'term', term)).toStrictEqual(count);
                    }
                    for (const [reading, count] of expectedResults.readings) {
                        expect.soft(countBy(results, 'reading', reading)).toStrictEqual(count);
                    }
                }
            }
            for (const { inputs, expectedResults } of testData.tests.findTermsExactBulk) {
                for (const { termList } of inputs) {
                    const results = await storage.findTermsExactBulk(termList, titles);
                    expect.soft(results.length).toStrictEqual(expectedResults.total);
                    for (const [term, count] of expectedResults.terms) {
                        expect.soft(countBy(results, 'term', term)).toStrictEqual(count);
                    }
                    for (const [reading, count] of expectedResults.readings) {
                        expect.soft(countBy(results, 'reading', reading)).toStrictEqual(count);
                    }
                }
            }
            for (const { inputs, expectedResults } of testData.tests.findTermsBySequenceBulk) {
                for (const { sequenceList } of inputs) {
                    const results = await storage.findTermsBySequenceBulk(
                        sequenceList.map((query) => ({ query, dictionary: title })),
                    );
                    expect.soft(results.length).toStrictEqual(expectedResults.total);
                    for (const [term, count] of expectedResults.terms) {
                        expect.soft(countBy(results, 'term', term)).toStrictEqual(count);
                    }
                    for (const [reading, count] of expectedResults.readings) {
                        expect.soft(countBy(results, 'reading', reading)).toStrictEqual(count);
                    }
                }
            }
            for (const { inputs, expectedResults } of testData.tests.findTermMetaBulk) {
                for (const { termList } of inputs) {
                    const results = await storage.findTermMetaBulk(termList, titles);
                    expect.soft(results.length).toStrictEqual(expectedResults.total);
                    for (const [mode, count] of expectedResults.modes) {
                        expect.soft(countBy(results, 'mode', mode)).toStrictEqual(count);
                    }
                }
            }
            for (const { inputs, expectedResults } of testData.tests.findKanjiBulk) {
                for (const { kanjiList } of inputs) {
                    const results = await storage.findKanjiBulk(kanjiList, titles);
                    expect.soft(results.length).toStrictEqual(expectedResults.total);
                    for (const [kanji, count] of expectedResults.kanji) {
                        expect.soft(countBy(results, 'character', kanji)).toStrictEqual(count);
                    }
                }
            }
            for (const { inputs, expectedResults } of testData.tests.findKanjiMetaBulk) {
                for (const { kanjiList } of inputs) {
                    const results = await storage.findKanjiMetaBulk(kanjiList, titles);
                    expect.soft(results.length).toStrictEqual(expectedResults.total);
                    for (const [mode, count] of expectedResults.modes) {
                        expect.soft(countBy(results, 'mode', mode)).toStrictEqual(count);
                    }
                }
            }
            for (const { inputs, expectedResults } of testData.tests.findTagForTitle) {
                for (const { name } of inputs) {
                    expect.soft(await storage.findTagForTitle(name, title)).toStrictEqual(expectedResults.value);
                }
            }
            await storage.close();
        });

        for (const clearMethod of ['purge', 'delete'] as const) {
            test(`empties the database with ${clearMethod}`, async ({ expect }) => {
                const storage = await createStorage();
                await storage.prepare();
                await importFixture(storage, await createDictionaryArchive('valid-dictionary1'));
                if (clearMethod === 'purge') {
                    await storage.purge();
                } else {
                    let progressed = false;
                    await storage.deleteDictionary('Test Dictionary', 1000, () => {
                        progressed = true;
                    });
                    expect(progressed).toBe(true);
                }
                expect.soft(await storage.getDictionaryInfo()).toStrictEqual([]);
                expect.soft(await storage.getDictionaryCounts([], true)).toStrictEqual({
                    counts: [],
                    total: { kanji: 0, kanjiMeta: 0, terms: 0, termMeta: 0, tagMeta: 0, media: 0 },
                });
                await storage.close();
            });
        }
    });
}
