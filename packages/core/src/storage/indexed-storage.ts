/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Query semantics ported from Yomitan's ext/js/dictionary/dictionary-database.js so that every
 * non-IndexedDB adapter returns exactly what upstream's IndexedDB class returns, in the same order.
 */

import type {
    DDB,
    DictionarySet,
    DictionaryStorage,
    KeyRange,
    ObjectStoreName,
    StorageBackend,
    StoredRow,
    Summary,
} from './types';

/** The upper bound upstream appends for prefix ranges (`${item}￿`). */
const RANGE_SUFFIX = '￿';

const DICTIONARY_STORES: ObjectStoreName[] = ['kanji', 'kanjiMeta', 'terms', 'termMeta', 'tagMeta', 'media'];

type FindMultiBulkData<TItem> = { item: TItem; itemIndex: number; indexIndex: number };

function stringReverse(value: string): string {
    return [...value].reverse().join('');
}

function splitField(field: unknown): string[] {
    return typeof field === 'string' && field.length > 0 ? field.split(' ') : [];
}

/**
 * Mimics the `IDBRequest` that upstream's importer receives from `addWithResult`: it assigns
 * `onsuccess`/`onerror` after the call and reads `result`.
 */
class CompletedRequest {
    readonly result: number;

    constructor(result: number) {
        this.result = result;
    }

    set onsuccess(callback: (() => void) | null) {
        if (typeof callback === 'function') {
            void Promise.resolve().then(callback);
        }
    }

    set onerror(_callback: (() => void) | null) {
        // The add already succeeded.
    }
}

export class IndexedDictionaryStorage implements DictionaryStorage {
    private readonly backend: StorageBackend;
    private open = false;
    private opening: Promise<void> | null = null;

    constructor(backend: StorageBackend) {
        this.backend = backend;
    }

    async prepare(): Promise<void> {
        if (this.open || this.opening !== null) {
            throw new Error(this.open ? 'Database already open' : 'Already opening');
        }
        this.opening = this.backend.open();
        try {
            await this.opening;
            this.open = true;
        } finally {
            this.opening = null;
        }
    }

    /** Like upstream: rejects if the database is not open. Waits for an open that is in progress. */
    async close(): Promise<void> {
        if (this.opening !== null) {
            await this.opening.catch(() => {});
        }
        if (!this.open) {
            throw new Error('Database is not open');
        }
        this.open = false;
        await this.backend.close();
    }

    isPrepared(): boolean {
        return this.open;
    }

    async purge(): Promise<boolean> {
        if (this.opening !== null) {
            throw new Error('Cannot purge database while opening');
        }
        if (!this.open) {
            await this.prepare();
        }
        await this.backend.clear();
        return true;
    }

    async deleteDictionary(
        dictionaryName: string,
        progressRate: number,
        onProgress: DDB.DeleteDictionaryProgressCallback,
    ): Promise<void> {
        this.assertOpen();
        const targetGroups: [ObjectStoreName, string][][] = [
            DICTIONARY_STORES.map((store) => [store, 'dictionary']),
            [['dictionaries', 'title']],
        ];
        const progressData: DDB.DeleteDictionaryProgressData = {
            count: 0,
            processed: 0,
            storeCount: targetGroups.reduce((total, targets) => total + targets.length, 0),
            storesProcesed: 0,
        };
        for (const targets of targetGroups) {
            const counts = await Promise.all(
                targets.map(([store, index]) => this.backend.count(store, index, dictionaryName)),
            );
            for (const count of counts) {
                ++progressData.storesProcesed;
                progressData.count += count;
                onProgress(progressData);
            }
            for (let i = 0; i < targets.length; ++i) {
                const [store, index] = targets[i];
                const deleted = await this.backend.deleteWhere(store, index, dictionaryName);
                for (let j = 0; j < deleted; ++j) {
                    const processed = progressData.processed + 1;
                    progressData.processed = processed;
                    if (processed % progressRate === 0 || processed === progressData.count) {
                        onProgress(progressData);
                    }
                }
            }
        }
    }

    findTermsBulk(termList: string[], dictionaries: DictionarySet, matchType: DDB.MatchType): Promise<DDB.TermEntry[]> {
        const visited = new Set<number>();
        const predicate = (row: Record<string, unknown>) => {
            if (!dictionaries.has(row.dictionary as string)) {
                return false;
            }
            const id = row.id as number;
            if (visited.has(id)) {
                return false;
            }
            visited.add(id);
            return true;
        };
        const indexNames = matchType === 'suffix' ? ['expressionReverse', 'readingReverse'] : ['expression', 'reading'];
        const createQuery = (item: string): KeyRange => {
            switch (matchType) {
                case 'prefix':
                    return { kind: 'bound', lower: item, upper: `${item}${RANGE_SUFFIX}` };
                case 'suffix': {
                    const reversed = stringReverse(item);
                    return { kind: 'bound', lower: reversed, upper: `${reversed}${RANGE_SUFFIX}` };
                }
                default:
                    return { kind: 'only', value: item };
            }
        };
        return this.findMultiBulk('terms', indexNames, termList, createQuery, predicate, (row, data) => {
            const matchSourceIsTerm = data.indexIndex === 0;
            const matchSource = matchSourceIsTerm ? 'term' : 'reading';
            const matched = (matchSourceIsTerm ? row.expression : row.reading) === data.item;
            return this.createTerm(matchSource, matched ? 'exact' : matchType, row, data.itemIndex);
        });
    }

    findTermsExactBulk(termList: DDB.TermExactRequest[], dictionaries: DictionarySet): Promise<DDB.TermEntry[]> {
        return this.findMultiBulk(
            'terms',
            ['expression'],
            termList,
            (item) => ({ kind: 'only', value: item.term }),
            (row, item) => row.reading === item.reading && dictionaries.has(row.dictionary as string),
            (row, data) => this.createTerm('term', 'exact', row, data.itemIndex),
        );
    }

    findTermsBySequenceBulk(items: DDB.DictionaryAndQueryRequest[]): Promise<DDB.TermEntry[]> {
        return this.findMultiBulk(
            'terms',
            ['sequence'],
            items,
            (item) => ({ kind: 'only', value: item.query }),
            (row, item) => row.dictionary === item.dictionary,
            (row, data) => this.createTerm('sequence', 'exact', row, data.itemIndex),
        );
    }

    findTermMetaBulk(termList: string[], dictionaries: DictionarySet): Promise<DDB.TermMeta[]> {
        return this.findMultiBulk(
            'termMeta',
            ['expression'],
            termList,
            (item) => ({ kind: 'only', value: item }),
            (row) => dictionaries.has(row.dictionary as string),
            (row, { itemIndex: index }) => {
                const { expression: term, mode, data, dictionary } = row as unknown as DDB.DatabaseTermMeta;
                switch (mode) {
                    case 'freq':
                    case 'pitch':
                    case 'ipa':
                        return { index, term, mode, data, dictionary } as DDB.TermMeta;
                    default:
                        throw new Error(`Unknown mode: ${mode}`);
                }
            },
        );
    }

    findKanjiBulk(kanjiList: string[], dictionaries: DictionarySet): Promise<DDB.KanjiEntry[]> {
        return this.findMultiBulk(
            'kanji',
            ['character'],
            kanjiList,
            (item) => ({ kind: 'only', value: item }),
            (row) => dictionaries.has(row.dictionary as string),
            (row, { itemIndex: index }) => {
                const { stats } = row;
                return {
                    index,
                    character: row.character as string,
                    onyomi: splitField(row.onyomi),
                    kunyomi: splitField(row.kunyomi),
                    tags: splitField(row.tags),
                    definitions: row.meanings as string[],
                    stats: (typeof stats === 'object' && stats !== null ? stats : {}) as { [name: string]: string },
                    dictionary: row.dictionary as string,
                };
            },
        );
    }

    findKanjiMetaBulk(kanjiList: string[], dictionaries: DictionarySet): Promise<DDB.KanjiMeta[]> {
        return this.findMultiBulk(
            'kanjiMeta',
            ['character'],
            kanjiList,
            (item) => ({ kind: 'only', value: item }),
            (row) => dictionaries.has(row.dictionary as string),
            (row, { itemIndex: index }) => {
                const { character, mode, data, dictionary } = row as unknown as DDB.DatabaseKanjiMeta;
                return { index, character, mode, data, dictionary };
            },
        );
    }

    async findTagMetaBulk(items: DDB.DictionaryAndQueryRequest[]): Promise<(DDB.Tag | undefined)[]> {
        const results: (DDB.Tag | undefined)[] = new Array(items.length);
        if (items.length === 0) {
            return results;
        }
        this.assertOpen();
        await Promise.all(
            items.map(async (item, i) => {
                const rows = await this.backend.getAll('tagMeta', 'name', { kind: 'only', value: item.query });
                const found = rows.find(({ value }) => value.dictionary === item.dictionary);
                results[i] = found === undefined ? undefined : (found.value as unknown as DDB.Tag);
            }),
        );
        return results;
    }

    async findTagForTitle(name: string, dictionary: string): Promise<DDB.Tag | null> {
        this.assertOpen();
        const rows = await this.backend.getAll('tagMeta', 'name', { kind: 'only', value: name });
        const found = rows.find(({ value }) => value.dictionary === dictionary);
        return found === undefined ? null : (found.value as unknown as DDB.Tag);
    }

    getMedia(items: DDB.MediaRequest[]): Promise<DDB.Media[]> {
        return this.findMultiBulk(
            'media',
            ['path'],
            items,
            (item) => ({ kind: 'only', value: item.path }),
            (row, item) => row.dictionary === item.dictionary,
            (row, { itemIndex: index }) => {
                const { dictionary, path, mediaType, width, height, content } =
                    row as unknown as DDB.MediaDataArrayBufferContent;
                return { index, dictionary, path, mediaType, width, height, content };
            },
        );
    }

    async getDictionaryInfo(): Promise<Summary[]> {
        this.assertOpen();
        const rows = await this.backend.getAllRows('dictionaries');
        return rows.map(({ value }) => value as unknown as Summary);
    }

    async getDictionaryCounts(dictionaryNames: string[], getTotal: boolean): Promise<DDB.DictionaryCounts> {
        this.assertOpen();
        const countGroup = async (dictionaryName?: string) => {
            const group: DDB.DictionaryCountGroup = {};
            for (const store of DICTIONARY_STORES) {
                group[store] =
                    dictionaryName === undefined
                        ? await this.backend.count(store)
                        : await this.backend.count(store, 'dictionary', dictionaryName);
            }
            return group;
        };
        const total = getTotal ? await countGroup() : null;
        const counts: DDB.DictionaryCountGroup[] = [];
        for (const dictionaryName of dictionaryNames) {
            counts.push(await countGroup(dictionaryName));
        }
        return { total, counts };
    }

    async dictionaryExists(title: string): Promise<boolean> {
        this.assertOpen();
        const rows = await this.backend.getAll('dictionaries', 'title', { kind: 'only', value: title });
        return rows.length > 0;
    }

    async bulkAdd(objectStoreName: ObjectStoreName, items: unknown[], start: number, count: number): Promise<void> {
        const end = Math.min(start + count, items.length);
        if (start >= end) {
            return;
        }
        this.assertOpen();
        await this.backend.add(objectStoreName, items.slice(start, end) as Record<string, unknown>[]);
    }

    async addWithResult(objectStoreName: ObjectStoreName, item: unknown): Promise<unknown> {
        this.assertOpen();
        const [id] = await this.backend.add(objectStoreName, [item as Record<string, unknown>]);
        return new CompletedRequest(id);
    }

    async bulkUpdate(
        objectStoreName: ObjectStoreName,
        items: DDB.DatabaseUpdateItem[],
        start: number,
        count: number,
    ): Promise<void> {
        const end = Math.min(start + count, items.length);
        if (start >= end) {
            return;
        }
        this.assertOpen();
        for (let i = start; i < end; ++i) {
            const { primaryKey, data } = items[i];
            await this.backend.put(objectStoreName, primaryKey as number, data as unknown as Record<string, unknown>);
        }
    }

    private assertOpen(): void {
        if (!this.open) {
            throw new Error(this.opening !== null ? 'Database not ready' : 'Database not open');
        }
    }

    private async findMultiBulk<TItem, TResult>(
        store: ObjectStoreName,
        indexNames: string[],
        items: TItem[],
        createQuery: (item: TItem) => KeyRange,
        predicate: (row: Record<string, unknown>, item: TItem) => boolean,
        createResult: (row: Record<string, unknown>, data: FindMultiBulkData<TItem>) => TResult,
    ): Promise<TResult[]> {
        const results: TResult[] = [];
        if (items.length === 0 || indexNames.length === 0) {
            return results;
        }
        this.assertOpen();
        // Issue every request first, then consume them in request order, as upstream's single
        // IndexedDB transaction does.
        const requests: Promise<StoredRow[]>[] = [];
        for (const item of items) {
            const query = createQuery(item);
            for (const indexName of indexNames) {
                requests.push(this.backend.getAll(store, indexName, query));
            }
        }
        const responses = await Promise.all(requests);
        let responseIndex = 0;
        for (let itemIndex = 0; itemIndex < items.length; ++itemIndex) {
            const item = items[itemIndex];
            for (let indexIndex = 0; indexIndex < indexNames.length; ++indexIndex) {
                const data = { item, itemIndex, indexIndex };
                for (const { id, value } of responses[responseIndex++]) {
                    const row = store === 'terms' ? { ...value, id } : value;
                    if (predicate(row, item)) {
                        results.push(createResult(row, data));
                    }
                }
            }
        }
        return results;
    }

    private createTerm(
        matchSource: DDB.MatchSource,
        matchType: DDB.MatchType,
        row: Record<string, unknown>,
        index: number,
    ): DDB.TermEntry {
        const { sequence } = row;
        return {
            index,
            matchType,
            matchSource,
            term: row.expression as string,
            reading: row.reading as string,
            definitionTags: splitField(row.definitionTags || row.tags),
            termTags: splitField(row.termTags),
            rules: splitField(row.rules),
            definitions: row.glossary as DDB.TermEntry['definitions'],
            score: row.score as number,
            dictionary: row.dictionary as string,
            id: row.id as number,
            sequence: typeof sequence === 'number' ? sequence : -1,
        };
    }
}
