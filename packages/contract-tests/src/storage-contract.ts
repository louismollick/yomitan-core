/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Port of Yomitan's test/database.test.js, parameterized over a storage adapter factory.
 */

import { describe, test } from 'vitest';
import type { DictionaryStorage } from '../../core/src/storage/types';
import { DictionaryImporter } from '../../core/src/upstream/ext/js/dictionary/dictionary-importer.js';
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

/** Upstream's test media loader: images are not decoded. */
export const testMediaLoader = {
    async getImageDetails(content: ArrayBuffer) {
        return { content, width: 100, height: 100 };
    },
};

const importDetails = { prefixWildcardsSupported: true, yomitanVersion: '0.0.0.0' };

function countBy<T>(items: T[], key: keyof T, value: unknown): number {
    return items.reduce((count, item) => count + (item[key] === value ? 1 : 0), 0);
}

export function runStorageContract(label: string, createStorage: CreateStorage): void {
    describe(`${label}: storage contract (upstream database.test.js)`, () => {
        test('rejects use before prepare and double prepare', async ({ expect }) => {
            const storage = await createStorage();
            const archive = await createDictionaryArchive('valid-dictionary1');
            const titles = new Map([['Test Dictionary', { alias: 'Test Dictionary', allowSecondarySearches: false }]]);
            await expect.soft(storage.findTermsBulk(['?'], titles, 'exact')).rejects.toThrow('Database not open');
            await expect.soft(storage.getDictionaryInfo()).rejects.toThrow('Database not open');
            await expect
                .soft(new DictionaryImporter(testMediaLoader).importDictionary(storage, archive, importDetails))
                .rejects.toThrow('Database is not ready');
            await storage.prepare();
            await expect.soft(storage.prepare()).rejects.toThrow('Database already open');
            await new DictionaryImporter(testMediaLoader).importDictionary(storage, archive, importDetails);
            expect
                .soft(await new DictionaryImporter(testMediaLoader).importDictionary(storage, archive, importDetails))
                .toEqual({
                    result: null,
                    errors: [new Error('Dictionary Test Dictionary is already imported, skipped it.')],
                });
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
                await expect
                    .soft(new DictionaryImporter(testMediaLoader).importDictionary(storage, archive, importDetails))
                    .rejects.toThrow('Dictionary has invalid data');
                await storage.close();
            });
        }

        test('imports valid-dictionary1 and answers every upstream query case', async ({ expect }) => {
            const testData = readUpstreamJson<DatabaseTestData>('database-test-cases.json');
            const storage = await createStorage();
            await storage.prepare();
            let progressed = false;
            const importer = new DictionaryImporter(
                testMediaLoader,
                ({ index, count }: { index: number; count: number }) => {
                    expect.soft(index <= count).toBe(true);
                    progressed = true;
                },
            );
            const archive = await createDictionaryArchive('valid-dictionary1');
            const { result, errors } = await importer.importDictionary(storage, archive, importDetails);
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
                await new DictionaryImporter(testMediaLoader).importDictionary(
                    storage,
                    await createDictionaryArchive('valid-dictionary1'),
                    importDetails,
                );
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
