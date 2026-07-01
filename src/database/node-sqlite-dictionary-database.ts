import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type * as DictionaryDatabase from '../types/dictionary-database';
import type * as DictionaryImporter from '../types/dictionary-importer';
import { log } from '../util/log';
import { stringReverse } from '../util/utilities';
import type { DictionaryDatabaseBackend } from './backend';

type NodeSqliteDictionaryDBOptions = {
    path: string;
};

type Row = {
    id: number;
    dictionary?: string;
    title?: string;
    data?: string;
    content?: Buffer;
};

const DELETE_TARGETS: DictionaryDatabase.ObjectStoreName[] = [
    'kanji',
    'kanjiMeta',
    'terms',
    'termMeta',
    'tagMeta',
    'media',
];

export class NodeSqliteDictionaryDB implements DictionaryDatabaseBackend {
    private _path: string;
    private _db: BetterSqliteDatabase | null = null;
    private _isOpen = false;

    constructor(options: NodeSqliteDictionaryDBOptions | string) {
        this._path = typeof options === 'string' ? options : options.path;
    }

    async open(): Promise<void> {
        if (this._isOpen) {
            return;
        }
        this._db = new Database(this._path);
        this._db.pragma('journal_mode = WAL');
        this._db.pragma('foreign_keys = ON');
        this._createSchema();
        this._isOpen = true;
    }

    close(): void {
        if (this._db !== null) {
            this._db.close();
        }
        this._db = null;
        this._isOpen = false;
    }

    get isOpen(): boolean {
        return this._isOpen;
    }

    async purge(): Promise<boolean> {
        try {
            const db = this._getDb();
            const purge = db.transaction(() => {
                for (const storeName of ['dictionaries', ...DELETE_TARGETS]) {
                    db.prepare(`DELETE FROM ${storeName}`).run();
                    // Reset rowids so reopen/repoulate behavior stays aligned with a fresh IndexedDB database.
                    db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(storeName);
                }
            });
            purge();
            return true;
        } catch (e) {
            log.error(e);
            return false;
        }
    }

    async deleteDictionary(
        dictionaryName: string,
        onProgress?: DictionaryDatabase.DeleteDictionaryProgressCallback,
    ): Promise<void> {
        const db = this._getDb();
        const progressData: DictionaryDatabase.DeleteDictionaryProgressData = {
            count: 0,
            processed: 0,
            storeCount: DELETE_TARGETS.length + 1,
            storesProcesed: 0,
        };

        for (const storeName of DELETE_TARGETS) {
            const ids = db
                .prepare(`SELECT id FROM ${storeName} WHERE dictionary = ? ORDER BY id`)
                .all(dictionaryName)
                .map((row) => (row as { id: number }).id);

            progressData.storesProcesed += 1;
            progressData.count += ids.length;
            onProgress?.(progressData);

            const deleteById = db.prepare(`DELETE FROM ${storeName} WHERE id = ?`);
            const deleteBatch = db.transaction((batch: number[]) => {
                for (const id of batch) {
                    deleteById.run(id);
                }
            });

            const batchSize = 1000;
            for (let i = 0; i < ids.length; i += batchSize) {
                const batch = ids.slice(i, i + batchSize);
                deleteBatch(batch);
                progressData.processed += batch.length;
                onProgress?.(progressData);
            }
        }

        db.prepare('DELETE FROM dictionaries WHERE title = ?').run(dictionaryName);
        progressData.storesProcesed += 1;
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

        for (let itemIndex = 0; itemIndex < termList.length; itemIndex += 1) {
            const item = termList[itemIndex];
            for (let indexIndex = 0; indexIndex < indexNames.length; indexIndex += 1) {
                const indexName = indexNames[indexIndex];
                const queryText = matchType === 'suffix' ? stringReverse(item) : item;
                // LIKE uses the index for the prefix scan; startsWith then trims off SQLite's default
                // case-insensitive matching so results stay byte-for-byte with the IndexedDB adapter.
                const rows =
                    matchType === 'exact'
                        ? this._selectTerms(`${indexName} = ?`, [queryText])
                        : this._selectTerms(`${indexName} LIKE ? ESCAPE '\\'`, [`${escapeLike(queryText)}%`]).filter(
                              (row) =>
                                  String(row[indexName as keyof DictionaryDatabase.DatabaseTermEntry] ?? '').startsWith(
                                      queryText,
                                  ),
                          );

                for (const row of rows) {
                    if (!dictionaries.has(row.dictionary) || visited.has(row.id)) {
                        continue;
                    }
                    visited.add(row.id);

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
        const results: DictionaryDatabase.TermEntry[] = [];
        for (let itemIndex = 0; itemIndex < termList.length; itemIndex += 1) {
            const item = termList[itemIndex];
            const rows = this._selectTerms('expression = ?', [item.term]);
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
        const results: DictionaryDatabase.TermEntry[] = [];
        for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
            const item = items[itemIndex];
            const rows = this._selectTerms('sequence = ?', [item.query]);
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
        const results: DictionaryDatabase.TermMeta[] = [];
        for (let itemIndex = 0; itemIndex < termList.length; itemIndex += 1) {
            const rows = this._selectJsonRows<DictionaryDatabase.DatabaseTermMeta>('termMeta', 'expression = ?', [
                termList[itemIndex],
            ]);
            for (const row of rows) {
                if (dictionaries.has(row.dictionary)) {
                    results.push(this._createTermMeta(row, itemIndex));
                }
            }
        }
        return results;
    }

    async findKanjiBulk(
        kanjiList: string[],
        dictionaries: DictionaryDatabase.DictionarySet,
    ): Promise<DictionaryDatabase.KanjiEntry[]> {
        const results: DictionaryDatabase.KanjiEntry[] = [];
        for (let itemIndex = 0; itemIndex < kanjiList.length; itemIndex += 1) {
            const rows = this._selectJsonRows<DictionaryDatabase.DatabaseKanjiEntry>('kanji', 'character = ?', [
                kanjiList[itemIndex],
            ]);
            for (const row of rows) {
                if (dictionaries.has(row.dictionary)) {
                    results.push(this._createKanji(row, itemIndex));
                }
            }
        }
        return results;
    }

    async findKanjiMetaBulk(
        kanjiList: string[],
        dictionaries: DictionaryDatabase.DictionarySet,
    ): Promise<DictionaryDatabase.KanjiMeta[]> {
        const results: DictionaryDatabase.KanjiMeta[] = [];
        for (let itemIndex = 0; itemIndex < kanjiList.length; itemIndex += 1) {
            const rows = this._selectJsonRows<DictionaryDatabase.DatabaseKanjiMeta>('kanjiMeta', 'character = ?', [
                kanjiList[itemIndex],
            ]);
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
        for (let i = 0; i < items.length; i += 1) {
            const item = items[i];
            results[i] = this._selectJsonRows<DictionaryDatabase.Tag>('tagMeta', 'name = ? AND dictionary = ?', [
                item.query,
                item.dictionary,
            ])[0];
        }
        return results;
    }

    async findTagForTitle(name: string, dictionary: string): Promise<DictionaryDatabase.Tag | undefined> {
        return this._selectJsonRows<DictionaryDatabase.Tag>('tagMeta', 'name = ? AND dictionary = ?', [
            name,
            dictionary,
        ])[0];
    }

    async getMedia(items: DictionaryDatabase.MediaRequest[]): Promise<DictionaryDatabase.Media[]> {
        const results: DictionaryDatabase.Media[] = [];
        const db = this._getDb();
        const statement = db.prepare('SELECT * FROM media WHERE path = ? ORDER BY id');

        for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
            const item = items[itemIndex];
            const rows = statement.all(item.path) as Array<
                Row & {
                    mediaType: string;
                    width: number;
                    height: number;
                }
            >;
            for (const row of rows) {
                if (row.dictionary !== item.dictionary || typeof row.content === 'undefined') {
                    continue;
                }
                results.push({
                    index: itemIndex,
                    dictionary: row.dictionary,
                    path: item.path,
                    mediaType: row.mediaType,
                    width: row.width,
                    height: row.height,
                    content: bufferToArrayBuffer(row.content),
                });
            }
        }
        return results;
    }

    async getDictionaryInfo(): Promise<DictionaryImporter.Summary[]> {
        return this._selectJsonRows<DictionaryImporter.Summary>('dictionaries');
    }

    async getDictionaryCounts(
        dictionaryNames: string[],
        getTotal: boolean,
    ): Promise<DictionaryDatabase.DictionaryCounts> {
        const db = this._getDb();
        const storeNames: DictionaryDatabase.ObjectStoreName[] = [
            'kanji',
            'kanjiMeta',
            'terms',
            'termMeta',
            'tagMeta',
            'media',
        ];
        const counts: DictionaryDatabase.DictionaryCountGroup[] = [];

        let total: DictionaryDatabase.DictionaryCountGroup | null = null;
        if (getTotal) {
            total = {};
            for (const storeName of storeNames) {
                total[storeName] = getCount(db, storeName);
            }
        }

        for (const dictionaryName of dictionaryNames) {
            const countGroup: DictionaryDatabase.DictionaryCountGroup = {};
            for (const storeName of storeNames) {
                countGroup[storeName] = getCount(db, storeName, dictionaryName);
            }
            counts.push(countGroup);
        }

        return { total, counts };
    }

    async dictionaryExists(title: string): Promise<boolean> {
        const row = this._getDb().prepare('SELECT id FROM dictionaries WHERE title = ? LIMIT 1').get(title);
        return typeof row !== 'undefined';
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

        const batch = items.slice(start, start + count);
        const insert = this._getInsertStatement(objectStoreName);
        const addBatch = this._getDb().transaction((entries: unknown[]) => {
            for (const item of entries) {
                insert(item);
            }
        });
        addBatch(batch);
    }

    async addWithResult(objectStoreName: DictionaryDatabase.ObjectStoreName, item: unknown): Promise<number> {
        return this._getInsertStatement(objectStoreName)(item);
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

        const batch = items.slice(start, start + count);
        const update = this._getUpdateStatement(objectStoreName);
        const updateBatch = this._getDb().transaction((entries: { primaryKey: number; data: unknown }[]) => {
            for (const item of entries) {
                update(item.primaryKey, item.data);
            }
        });
        updateBatch(batch);
    }

    private _getDb(): BetterSqliteDatabase {
        if (this._db === null) {
            throw new Error('Database is not ready');
        }
        return this._db;
    }

    private _createSchema(): void {
        const db = this._getDb();
        db.exec(`
            CREATE TABLE IF NOT EXISTS dictionaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                version INTEGER,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS dictionaries_title_idx ON dictionaries(title);

            CREATE TABLE IF NOT EXISTS terms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dictionary TEXT NOT NULL,
                expression TEXT NOT NULL,
                reading TEXT NOT NULL,
                sequence INTEGER,
                expressionReverse TEXT,
                readingReverse TEXT,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS terms_expression_idx ON terms(expression);
            CREATE INDEX IF NOT EXISTS terms_reading_idx ON terms(reading);
            CREATE INDEX IF NOT EXISTS terms_sequence_idx ON terms(sequence);
            CREATE INDEX IF NOT EXISTS terms_expression_reverse_idx ON terms(expressionReverse);
            CREATE INDEX IF NOT EXISTS terms_reading_reverse_idx ON terms(readingReverse);
            CREATE INDEX IF NOT EXISTS terms_dictionary_idx ON terms(dictionary);

            CREATE TABLE IF NOT EXISTS termMeta (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dictionary TEXT NOT NULL,
                expression TEXT NOT NULL,
                mode TEXT NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS term_meta_expression_idx ON termMeta(expression);
            CREATE INDEX IF NOT EXISTS term_meta_dictionary_idx ON termMeta(dictionary);

            CREATE TABLE IF NOT EXISTS kanji (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dictionary TEXT NOT NULL,
                character TEXT NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS kanji_character_idx ON kanji(character);
            CREATE INDEX IF NOT EXISTS kanji_dictionary_idx ON kanji(dictionary);

            CREATE TABLE IF NOT EXISTS kanjiMeta (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dictionary TEXT NOT NULL,
                character TEXT NOT NULL,
                mode TEXT NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS kanji_meta_character_idx ON kanjiMeta(character);
            CREATE INDEX IF NOT EXISTS kanji_meta_dictionary_idx ON kanjiMeta(dictionary);

            CREATE TABLE IF NOT EXISTS tagMeta (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dictionary TEXT NOT NULL,
                name TEXT NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS tag_meta_name_idx ON tagMeta(name);
            CREATE INDEX IF NOT EXISTS tag_meta_dictionary_idx ON tagMeta(dictionary);

            CREATE TABLE IF NOT EXISTS media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dictionary TEXT NOT NULL,
                path TEXT NOT NULL,
                mediaType TEXT NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                content BLOB NOT NULL
            );
            CREATE INDEX IF NOT EXISTS media_path_idx ON media(path);
            CREATE INDEX IF NOT EXISTS media_dictionary_idx ON media(dictionary);
        `);
    }

    private _selectTerms(whereClause: string, parameters: unknown[]): DictionaryDatabase.DatabaseTermEntryWithId[] {
        return this._selectJsonRows<DictionaryDatabase.DatabaseTermEntryWithId>('terms', whereClause, parameters);
    }

    private _selectJsonRows<T>(table: string, whereClause?: string, parameters: unknown[] = []): T[] {
        const sql = `SELECT id, data FROM ${table}${whereClause ? ` WHERE ${whereClause}` : ''} ORDER BY id`;
        // Scalar columns exist for indexed lookup; the canonical object still lives in `data` so importer and
        // translator logic can reuse the existing in-memory shapes without a second SQLite-specific model.
        return (
            this._getDb()
                .prepare(sql)
                .all(...parameters) as Row[]
        ).map((row) => ({
            ...parseJsonObject<T>(row.data),
            id: row.id,
        }));
    }

    private _getInsertStatement(objectStoreName: DictionaryDatabase.ObjectStoreName): (item: unknown) => number {
        const db = this._getDb();
        switch (objectStoreName) {
            case 'dictionaries': {
                const statement = db.prepare('INSERT INTO dictionaries (title, version, data) VALUES (?, ?, ?)');
                return (item) => {
                    const row = item as DictionaryImporter.Summary;
                    return Number(statement.run(row.title, row.version, JSON.stringify(row)).lastInsertRowid);
                };
            }
            case 'terms': {
                const statement = db.prepare(
                    `INSERT INTO terms
                    (dictionary, expression, reading, sequence, expressionReverse, readingReverse, data)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                );
                return (item) => {
                    const row = item as DictionaryDatabase.DatabaseTermEntry;
                    return Number(
                        statement.run(
                            row.dictionary,
                            row.expression,
                            row.reading,
                            row.sequence ?? null,
                            row.expressionReverse ?? null,
                            row.readingReverse ?? null,
                            JSON.stringify(row),
                        ).lastInsertRowid,
                    );
                };
            }
            case 'termMeta': {
                const statement = db.prepare(
                    'INSERT INTO termMeta (dictionary, expression, mode, data) VALUES (?, ?, ?, ?)',
                );
                return (item) => {
                    const row = item as DictionaryDatabase.DatabaseTermMeta;
                    return Number(
                        statement.run(row.dictionary, row.expression, row.mode, JSON.stringify(row)).lastInsertRowid,
                    );
                };
            }
            case 'kanji': {
                const statement = db.prepare('INSERT INTO kanji (dictionary, character, data) VALUES (?, ?, ?)');
                return (item) => {
                    const row = item as DictionaryDatabase.DatabaseKanjiEntry;
                    return Number(statement.run(row.dictionary, row.character, JSON.stringify(row)).lastInsertRowid);
                };
            }
            case 'kanjiMeta': {
                const statement = db.prepare(
                    'INSERT INTO kanjiMeta (dictionary, character, mode, data) VALUES (?, ?, ?, ?)',
                );
                return (item) => {
                    const row = item as DictionaryDatabase.DatabaseKanjiMeta;
                    return Number(
                        statement.run(row.dictionary, row.character, row.mode, JSON.stringify(row)).lastInsertRowid,
                    );
                };
            }
            case 'tagMeta': {
                const statement = db.prepare('INSERT INTO tagMeta (dictionary, name, data) VALUES (?, ?, ?)');
                return (item) => {
                    const row = item as DictionaryDatabase.Tag;
                    return Number(statement.run(row.dictionary, row.name, JSON.stringify(row)).lastInsertRowid);
                };
            }
            case 'media': {
                const statement = db.prepare(
                    `INSERT INTO media
                    (dictionary, path, mediaType, width, height, content)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                );
                return (item) => {
                    const row = item as DictionaryDatabase.MediaDataArrayBufferContent;
                    return Number(
                        statement.run(
                            row.dictionary,
                            row.path,
                            row.mediaType,
                            row.width,
                            row.height,
                            Buffer.from(new Uint8Array(row.content)),
                        ).lastInsertRowid,
                    );
                };
            }
        }
    }

    private _getUpdateStatement(
        objectStoreName: DictionaryDatabase.ObjectStoreName,
    ): (primaryKey: number, item: unknown) => void {
        const db = this._getDb();
        switch (objectStoreName) {
            case 'dictionaries': {
                const statement = db.prepare('UPDATE dictionaries SET title = ?, version = ?, data = ? WHERE id = ?');
                return (primaryKey, item) => {
                    const row = item as DictionaryImporter.Summary;
                    statement.run(row.title, row.version, JSON.stringify(row), primaryKey);
                };
            }
            case 'terms':
            case 'termMeta':
            case 'kanji':
            case 'kanjiMeta':
            case 'tagMeta':
            case 'media':
                throw new Error(`Unsupported update store: ${objectStoreName}`);
        }
    }

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
            definitionTags: splitField(row.definitionTags || row.tags),
            termTags: splitField(row.termTags),
            rules: splitField(row.rules),
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
            onyomi: splitField(row.onyomi),
            kunyomi: splitField(row.kunyomi),
            tags: splitField(row.tags),
            definitions: row.meanings,
            stats: typeof stats === 'object' && stats !== null ? stats : {},
            dictionary: row.dictionary,
        };
    }
}

export function createNodeSqliteDictionaryDB(options: NodeSqliteDictionaryDBOptions | string): NodeSqliteDictionaryDB {
    return new NodeSqliteDictionaryDB(options);
}

function getCount(
    db: BetterSqliteDatabase,
    storeName: DictionaryDatabase.ObjectStoreName,
    dictionaryName?: string,
): number {
    const row =
        typeof dictionaryName === 'string'
            ? db.prepare(`SELECT COUNT(*) AS count FROM ${storeName} WHERE dictionary = ?`).get(dictionaryName)
            : db.prepare(`SELECT COUNT(*) AS count FROM ${storeName}`).get();
    return (row as { count: number }).count;
}

function parseJsonObject<T>(value: string | undefined): T {
    return JSON.parse(value ?? '{}') as T;
}

function splitField(field: unknown): string[] {
    return typeof field === 'string' && field.length > 0 ? field.split(' ') : [];
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
    return Uint8Array.from(buffer).buffer;
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
