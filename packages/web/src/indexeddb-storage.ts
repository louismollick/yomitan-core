/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * IndexedDB storage with Yomitan's own database schema (ADR-0006; stores and indices from
 * ext/js/dictionary/dictionary-database.js at version 60). Query semantics come from the shared
 * IndexedDictionaryStorage, like every other adapter.
 */

import {
    IndexedDictionaryStorage,
    type KeyRange,
    type StorageBackend,
    type StoredRow,
    type WriteGuard,
    type WriteSessionStore,
} from 'yomitan-core';
import { createWebLockSessions } from './web-lock-sessions';

type ObjectStoreName = Parameters<StorageBackend['getAll']>[0];

/** Yomitan's database version and final structure. */
export const YOMITAN_DATABASE_VERSION = 60;

const STRUCTURE: Record<ObjectStoreName, { keyPath: string | null; indices: string[] }> = {
    terms: {
        keyPath: 'id',
        indices: ['dictionary', 'expression', 'reading', 'sequence', 'expressionReverse', 'readingReverse'],
    },
    kanji: { keyPath: null, indices: ['dictionary', 'character'] },
    tagMeta: { keyPath: null, indices: ['dictionary', 'name'] },
    dictionaries: { keyPath: null, indices: ['title', 'version'] },
    termMeta: { keyPath: null, indices: ['dictionary', 'expression'] },
    kanjiMeta: { keyPath: null, indices: ['dictionary', 'character'] },
    media: { keyPath: 'id', indices: ['dictionary', 'path'] },
};

const STORE_NAMES = Object.keys(STRUCTURE) as ObjectStoreName[];

function promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));
    });
}

function toIdbRange(range: KeyRange): IDBKeyRange {
    return range.kind === 'only' ? IDBKeyRange.only(range.value) : IDBKeyRange.bound(range.value, `${range.value}￿`);
}

export type IndexedDbStorageOptions = {
    /** IndexedDB database name. Yomitan uses `dict`. */
    name?: string;
    /** Defaults to the global `indexedDB`. */
    indexedDB?: IDBFactory;
};

class IndexedDbBackend implements StorageBackend {
    private pendingReads: {
        store: ObjectStoreName;
        index: string;
        range: KeyRange;
        resolve(rows: StoredRow[]): void;
        reject(error: unknown): void;
    }[] = [];
    private readonly name: string;
    private readonly factory: () => IDBFactory;
    private database: IDBDatabase | null = null;

    constructor(options: IndexedDbStorageOptions) {
        this.name = options.name ?? 'dict';
        this.factory = () => options.indexedDB ?? indexedDB;
    }

    async open(): Promise<void> {
        const request = this.factory().open(this.name, YOMITAN_DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            const transaction = request.transaction as IDBTransaction;
            for (const name of STORE_NAMES) {
                const { keyPath, indices } = STRUCTURE[name];
                const store = database.objectStoreNames.contains(name)
                    ? transaction.objectStore(name)
                    : database.createObjectStore(
                          name,
                          keyPath === null ? { autoIncrement: true } : { keyPath, autoIncrement: true },
                      );
                for (const index of indices) {
                    if (!store.indexNames.contains(index)) {
                        store.createIndex(index, index, { unique: false });
                    }
                }
            }
        };
        this.database = await promisify(request);
    }

    async close(): Promise<void> {
        this.database?.close();
        this.database = null;
    }

    async clear(): Promise<void> {
        const transaction = this.db().transaction(STORE_NAMES, 'readwrite');
        for (const name of STORE_NAMES) {
            transaction.objectStore(name).clear();
        }
        await transactionDone(transaction);
    }

    /**
     * Index reads issued in the same tick share one read-only transaction, as upstream's bulk queries
     * do, so a lookup never mixes rows from before and after another tab's write.
     */
    getAll(store: ObjectStoreName, index: string, range: KeyRange): Promise<StoredRow[]> {
        return new Promise((resolve, reject) => {
            this.pendingReads.push({ store, index, range, resolve, reject });
            if (this.pendingReads.length === 1) {
                queueMicrotask(() => this.flushReads());
            }
        });
    }

    private flushReads(): void {
        const batch = this.pendingReads;
        this.pendingReads = [];
        let transaction: IDBTransaction;
        try {
            transaction = this.db().transaction([...new Set(batch.map(({ store }) => store))], 'readonly');
        } catch (error) {
            for (const { reject } of batch) {
                reject(error);
            }
            return;
        }
        for (const { store, index, range, resolve, reject } of batch) {
            const source = transaction.objectStore(store).index(index);
            const query = toIdbRange(range);
            Promise.all([promisify(source.getAll(query)), promisify(source.getAllKeys(query))]).then(
                ([values, keys]) =>
                    resolve(
                        values.map((value, i) => ({ id: keys[i] as number, value: value as Record<string, unknown> })),
                    ),
                reject,
            );
        }
    }

    async getAllRows(store: ObjectStoreName): Promise<StoredRow[]> {
        const source = this.db().transaction([store], 'readonly').objectStore(store);
        const [values, keys] = await Promise.all([promisify(source.getAll()), promisify(source.getAllKeys())]);
        return values.map((value, i) => ({ id: keys[i] as number, value: value as Record<string, unknown> }));
    }

    async count(store: ObjectStoreName, index?: string, value?: string): Promise<number> {
        const source = this.db().transaction([store], 'readonly').objectStore(store);
        return await promisify(
            index === undefined ? source.count() : source.index(index).count(IDBKeyRange.only(value as string)),
        );
    }

    /*
     * Writes check `guard` just before opening their transaction, not inside it: an IndexedDB
     * transaction commits as soon as it awaits anything else. That is still safe across tabs, because
     * a live session holds its Web Lock, so no other tab can claim it in between.
     */
    async add(store: ObjectStoreName, rows: Record<string, unknown>[], guard?: WriteGuard): Promise<number[]> {
        await guard?.();
        const transaction = this.db().transaction([store], 'readwrite');
        const objectStore = transaction.objectStore(store);
        const requests = rows.map((row) => objectStore.add(row));
        await transactionDone(transaction);
        return requests.map((request) => request.result as number);
    }

    async put(store: ObjectStoreName, id: number, row: Record<string, unknown>, guard?: WriteGuard): Promise<void> {
        await guard?.();
        const transaction = this.db().transaction([store], 'readwrite');
        const objectStore = transaction.objectStore(store);
        if (STRUCTURE[store].keyPath === null) {
            objectStore.put(row, id);
        } else {
            objectStore.put({ ...row, [STRUCTURE[store].keyPath as string]: id });
        }
        await transactionDone(transaction);
    }

    async deleteWhere(store: ObjectStoreName, index: string, value: string, guard?: WriteGuard): Promise<number> {
        await guard?.();
        const transaction = this.db().transaction([store], 'readwrite');
        const source = transaction.objectStore(store).index(index);
        let deleted = 0;
        await new Promise<void>((resolve, reject) => {
            const request = source.openKeyCursor(IDBKeyRange.only(value));
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor === null) {
                    resolve();
                    return;
                }
                transaction.objectStore(store).delete(cursor.primaryKey);
                ++deleted;
                cursor.continue();
            };
        });
        await transactionDone(transaction);
        return deleted;
    }

    private db(): IDBDatabase {
        if (this.database === null) {
            throw new Error('Database not open');
        }
        return this.database;
    }
}

export class IndexedDbDictionaryStorage extends IndexedDictionaryStorage {
    readonly sessions: WriteSessionStore;

    constructor(options: IndexedDbStorageOptions & { locks?: LockManager } = {}) {
        super(new IndexedDbBackend(options));
        this.sessions = createWebLockSessions({
            name: options.name ?? 'dict',
            indexedDB: options.indexedDB,
            locks: options.locks,
        });
    }
}

/** Dictionary storage in IndexedDB, with Yomitan's database schema (ADR-0006). */
export function createIndexedDbStorage(
    options: IndexedDbStorageOptions & { locks?: LockManager } = {},
): IndexedDbDictionaryStorage {
    return new IndexedDbDictionaryStorage(options);
}
