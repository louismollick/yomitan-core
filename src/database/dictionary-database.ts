import type * as DictionaryDatabase from '../types/dictionary-database';
import type * as DictionaryImporter from '../types/dictionary-importer';
import { log } from '../util/log';
import { stringReverse } from '../util/utilities';
import { OBJECT_STORE_NAMES, YomitanDatabase } from './schema';

export class DictionaryDB {
    private _db: YomitanDatabase;
    private _isOpen: boolean;

    constructor(dbName = 'dict') {
        this._db = new YomitanDatabase(dbName);
        this._isOpen = false;
    }

    async open(): Promise<void> {
        await this._db.open();
        this._isOpen = true;
    }

    close(): void {
        this._db.close();
        this._isOpen = false;
    }

    get isOpen(): boolean {
        return this._isOpen;
    }

    get dexie(): YomitanDatabase {
        return this._db;
    }

    async purge(): Promise<boolean> {
        if (this._isOpen) {
            this.close();
        }
        try {
            await this._db.delete();
        } catch (e) {
            log.error(e);
            return false;
        }
        this._db = new YomitanDatabase(this._db.name);
        await this.open();
        return true;
    }

    async deleteDictionary(
        dictionaryName: string,
        onProgress?: DictionaryDatabase.DeleteDictionaryProgressCallback,
    ): Promise<void> {
        const targets: [string, string][] = [
            ['kanji', 'dictionary'],
            ['kanjiMeta', 'dictionary'],
            ['terms', 'dictionary'],
            ['termMeta', 'dictionary'],
            ['tagMeta', 'dictionary'],
            ['media', 'dictionary'],
        ];

        const progressData: DictionaryDatabase.DeleteDictionaryProgressData = {
            count: 0,
            processed: 0,
            storeCount: targets.length + 1,
            storesProcesed: 0,
        };

        for (const [storeName] of targets) {
            const table = this._db.table(storeName);
            const keys = await table.where('dictionary').equals(dictionaryName).primaryKeys();
            progressData.storesProcesed++;
            progressData.count += keys.length;
            onProgress?.(progressData);

            const batchSize = 1000;
            for (let i = 0; i < keys.length; i += batchSize) {
                const batch = keys.slice(i, i + batchSize);
                await table.bulkDelete(batch);
                progressData.processed += batch.length;
                onProgress?.(progressData);
            }
        }

        // Delete from dictionaries store
        await this._db.dictionaries.where('title').equals(dictionaryName).delete();
        progressData.storesProcesed++;
        onProgress?.(progressData);
    }

    async findTermsBulk(
        termList: string[],
        dictionaries: DictionaryDatabase.DictionarySet,
        matchType: DictionaryDatabase.MatchType,
    ): Promise<DictionaryDatabase.TermEntry[]> {
        if (termList.length === 0) {
            return [];
        }

        const visited = new Set<number>();
        const results: DictionaryDatabase.TermEntry[] = [];

        const indexNames = matchType === 'suffix' ? ['expressionReverse', 'readingReverse'] : ['expression', 'reading'];

        for (let itemIndex = 0; itemIndex < termList.length; itemIndex++) {
            const item = termList[itemIndex];

            for (let indexIndex = 0; indexIndex < indexNames.length; indexIndex++) {
                const indexName = indexNames[indexIndex];

                let query;
                switch (matchType) {
                    case 'prefix':
                        query = this._db.terms.where(indexName).startsWith(item);
                        break;
                    case 'suffix': {
                        const reversed = stringReverse(item);
                        query = this._db.terms.where(indexName).startsWith(reversed);
                        break;
                    }
                    default:
                        query = this._db.terms.where(indexName).equals(item);
                        break;
                }

                const rows = await query.toArray();

                for (const row of rows) {
                    if (!dictionaries.has(row.dictionary)) {
                        continue;
                    }
                    const { id } = row;
                    if (visited.has(id)) {
                        continue;
                    }
                    visited.add(id);

                    const matchSourceIsTerm = indexIndex === 0;
                    const matchSource: DictionaryDatabase.MatchSource = matchSourceIsTerm ? 'term' : 'reading';
                    const actualMatchType: DictionaryDatabase.MatchType =
                        (matchSourceIsTerm ? row.expression : row.reading) === item ? 'exact' : matchType;

                    results.push(this._createTerm(matchSource, actualMatchType, row, itemIndex));
                }
            }
        }

        return results;
    }

    async findTermsExactBulk(
        termList: DictionaryDatabase.TermExactRequest[],
        dictionaries: DictionaryDatabase.DictionarySet,
    ): Promise<DictionaryDatabase.TermEntry[]> {
        if (termList.length === 0) {
            return [];
        }

        const results: DictionaryDatabase.TermEntry[] = [];

        for (let itemIndex = 0; itemIndex < termList.length; itemIndex++) {
            const item = termList[itemIndex];
            const rows = await this._db.terms.where('expression').equals(item.term).toArray();

            for (const row of rows) {
                if (row.reading !== item.reading || !dictionaries.has(row.dictionary)) {
                    continue;
                }
                results.push(this._createTerm('term', 'exact', row, itemIndex));
            }
        }

        return results;
    }

    async findTermsBySequenceBulk(
        items: DictionaryDatabase.DictionaryAndQueryRequest[],
    ): Promise<DictionaryDatabase.TermEntry[]> {
        if (items.length === 0) {
            return [];
        }

        const results: DictionaryDatabase.TermEntry[] = [];

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            const item = items[itemIndex];
            const rows = await this._db.terms.where('sequence').equals(item.query).toArray();

            for (const row of rows) {
                if (row.dictionary !== item.dictionary) {
                    continue;
                }
                results.push(this._createTerm('sequence', 'exact', row, itemIndex));
            }
        }

        return results;
    }

    async findTermMetaBulk(
        termList: string[],
        dictionaries: DictionaryDatabase.DictionarySet,
    ): Promise<DictionaryDatabase.TermMeta[]> {
        if (termList.length === 0) {
            return [];
        }

        const results: DictionaryDatabase.TermMeta[] = [];

        for (let itemIndex = 0; itemIndex < termList.length; itemIndex++) {
            const term = termList[itemIndex];
            const rows = await this._db.termMeta.where('expression').equals(term).toArray();

            for (const row of rows) {
                if (!dictionaries.has(row.dictionary)) {
                    continue;
                }
                results.push(this._createTermMeta(row, itemIndex));
            }
        }

        return results;
    }

    async findKanjiBulk(
        kanjiList: string[],
        dictionaries: DictionaryDatabase.DictionarySet,
    ): Promise<DictionaryDatabase.KanjiEntry[]> {
        if (kanjiList.length === 0) {
            return [];
        }

        const results: DictionaryDatabase.KanjiEntry[] = [];

        for (let itemIndex = 0; itemIndex < kanjiList.length; itemIndex++) {
            const character = kanjiList[itemIndex];
            const rows = await this._db.kanji.where('character').equals(character).toArray();

            for (const row of rows) {
                if (!dictionaries.has(row.dictionary)) {
                    continue;
                }
                results.push(this._createKanji(row, itemIndex));
            }
        }

        return results;
    }

    async findKanjiMetaBulk(
        kanjiList: string[],
        dictionaries: DictionaryDatabase.DictionarySet,
    ): Promise<DictionaryDatabase.KanjiMeta[]> {
        if (kanjiList.length === 0) {
            return [];
        }

        const results: DictionaryDatabase.KanjiMeta[] = [];

        for (let itemIndex = 0; itemIndex < kanjiList.length; itemIndex++) {
            const character = kanjiList[itemIndex];
            const rows = await this._db.kanjiMeta.where('character').equals(character).toArray();

            for (const row of rows) {
                if (!dictionaries.has(row.dictionary)) {
                    continue;
                }
                results.push({
                    index: itemIndex,
                    character: row.character,
                    mode: row.mode,
                    data: row.data,
                    dictionary: row.dictionary,
                });
            }
        }

        return results;
    }

    async findTagMetaBulk(
        items: DictionaryDatabase.DictionaryAndQueryRequest[],
    ): Promise<(DictionaryDatabase.Tag | undefined)[]> {
        const results: (DictionaryDatabase.Tag | undefined)[] = new Array(items.length);

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const row = await this._db.tagMeta
                .where('name')
                .equals(item.query)
                .and((r: DictionaryDatabase.Tag) => r.dictionary === item.dictionary)
                .first();
            results[i] = row;
        }

        return results;
    }

    async findTagForTitle(name: string, dictionary: string): Promise<DictionaryDatabase.Tag | undefined> {
        return await this._db.tagMeta
            .where('name')
            .equals(name)
            .and((row: DictionaryDatabase.Tag) => row.dictionary === dictionary)
            .first();
    }

    async getMedia(items: DictionaryDatabase.MediaRequest[]): Promise<DictionaryDatabase.Media[]> {
        if (items.length === 0) {
            return [];
        }

        const results: DictionaryDatabase.Media[] = [];

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            const item = items[itemIndex];
            const rows = await this._db.media.where('path').equals(item.path).toArray();

            for (const row of rows) {
                if (row.dictionary !== item.dictionary) {
                    continue;
                }
                results.push({
                    index: itemIndex,
                    dictionary: row.dictionary,
                    path: row.path,
                    mediaType: row.mediaType,
                    width: row.width,
                    height: row.height,
                    content: row.content,
                });
            }
        }

        return results;
    }

    async getDictionaryInfo(): Promise<DictionaryImporter.Summary[]> {
        return await this._db.dictionaries.toArray();
    }

    async getDictionaryCounts(
        dictionaryNames: string[],
        getTotal: boolean,
    ): Promise<DictionaryDatabase.DictionaryCounts> {
        const storeNames: [string, string][] = [
            ['kanji', 'dictionary'],
            ['kanjiMeta', 'dictionary'],
            ['terms', 'dictionary'],
            ['termMeta', 'dictionary'],
            ['tagMeta', 'dictionary'],
            ['media', 'dictionary'],
        ];

        const counts: DictionaryDatabase.DictionaryCountGroup[] = [];

        let total: DictionaryDatabase.DictionaryCountGroup | null = null;
        if (getTotal) {
            const totalGroup: DictionaryDatabase.DictionaryCountGroup = {};
            for (const [storeName] of storeNames) {
                totalGroup[storeName] = await this._db.table(storeName).count();
            }
            total = totalGroup;
        }

        for (const dictionaryName of dictionaryNames) {
            const countGroup: DictionaryDatabase.DictionaryCountGroup = {};
            for (const [storeName] of storeNames) {
                countGroup[storeName] = await this._db
                    .table(storeName)
                    .where('dictionary')
                    .equals(dictionaryName)
                    .count();
            }
            counts.push(countGroup);
        }

        return { total, counts };
    }

    async dictionaryExists(title: string): Promise<boolean> {
        const result = await this._db.dictionaries.where('title').equals(title).first();
        return result !== undefined;
    }

    async bulkAdd(
        objectStoreName: DictionaryDatabase.ObjectStoreName,
        items: unknown[],
        start: number,
        count: number,
    ): Promise<void> {
        if (start + count > items.length) {
            count = items.length - start;
        }
        if (count <= 0) {
            return;
        }

        const table = this._db.table(objectStoreName);
        const batch = items.slice(start, start + count);
        await table.bulkAdd(batch);
    }

    async addWithResult(objectStoreName: DictionaryDatabase.ObjectStoreName, item: unknown): Promise<number> {
        const table = this._db.table(objectStoreName);
        return (await table.add(item)) as number;
    }

    async bulkUpdate(
        objectStoreName: DictionaryDatabase.ObjectStoreName,
        items: { primaryKey: number; data: unknown }[],
        start: number,
        count: number,
    ): Promise<void> {
        if (start + count > items.length) {
            count = items.length - start;
        }
        if (count <= 0) {
            return;
        }

        const table = this._db.table(objectStoreName);
        const batch = items.slice(start, start + count);
        await table.bulkPut(batch.map((item) => item.data), batch.map((item) => item.primaryKey));
    }

    // Private result creators

    private _createTerm(
        matchSource: DictionaryDatabase.MatchSource,
        matchType: DictionaryDatabase.MatchType,
        row: DictionaryDatabase.DatabaseTermEntryWithId,
        index: number,
    ): DictionaryDatabase.TermEntry {
        const { sequence } = row;
        return {
            index,
            matchType,
            matchSource,
            term: row.expression,
            reading: row.reading,
            definitionTags: this._splitField(row.definitionTags || row.tags),
            termTags: this._splitField(row.termTags),
            rules: this._splitField(row.rules),
            definitions: row.glossary,
            score: row.score,
            dictionary: row.dictionary,
            id: row.id,
            sequence: typeof sequence === 'number' ? sequence : -1,
        };
    }

    private _createTermMeta(row: DictionaryDatabase.DatabaseTermMeta, index: number): DictionaryDatabase.TermMeta {
        const { expression: term, mode, data, dictionary } = row;
        switch (mode) {
            case 'freq':
                return { index, term, mode, data, dictionary };
            case 'pitch':
                return { index, term, mode, data, dictionary };
            case 'ipa':
                return { index, term, mode, data, dictionary };
            default:
                throw new Error(`Unknown mode: ${mode}`);
        }
    }

    private _createKanji(row: DictionaryDatabase.DatabaseKanjiEntry, index: number): DictionaryDatabase.KanjiEntry {
        const { stats } = row;
        return {
            index,
            character: row.character,
            onyomi: this._splitField(row.onyomi),
            kunyomi: this._splitField(row.kunyomi),
            tags: this._splitField(row.tags),
            definitions: row.meanings,
            stats: typeof stats === 'object' && stats !== null ? stats : {},
            dictionary: row.dictionary,
        };
    }

    private _splitField(field: unknown): string[] {
        return typeof field === 'string' && field.length > 0 ? field.split(' ') : [];
    }
}
