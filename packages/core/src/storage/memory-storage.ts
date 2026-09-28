/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IndexedDictionaryStorage } from './indexed-storage';
import { InProcessWriteSessions } from './sessions';
import type { KeyRange, ObjectStoreName, StorageBackend, StoredRow, WriteGuard } from './types';

type Store = {
    rows: Map<number, Record<string, unknown>>;
    nextId: number;
    indexes: Map<string, Map<unknown, number[]>>;
};

const STORE_NAMES: ObjectStoreName[] = ['dictionaries', 'terms', 'termMeta', 'kanji', 'kanjiMeta', 'tagMeta', 'media'];

/** IndexedDB copies values on write and read; callers may mutate what they get back. */
function cloneValue<T>(value: T): T {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return value.slice(0) as T;
    }
    if (ArrayBuffer.isView(value)) {
        const view = value as unknown as Uint8Array;
        return new (view.constructor as Uint8ArrayConstructor)(view) as unknown as T;
    }
    if (Array.isArray(value)) {
        return value.map(cloneValue) as T;
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        result[key] = cloneValue(item);
    }
    return result as T;
}

function isValidKey(value: unknown): value is string | number {
    return typeof value === 'string' || (typeof value === 'number' && !Number.isNaN(value));
}

/** IndexedDB key order: numbers before strings, strings by UTF-16 code unit. */
function compareKeys(a: string | number, b: string | number): number {
    if (typeof a !== typeof b) {
        return typeof a === 'number' ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

class MemoryBackend implements StorageBackend {
    private stores = new Map<ObjectStoreName, Store>();

    async open(): Promise<void> {
        if (this.stores.size === 0) {
            this.reset();
        }
    }

    async close(): Promise<void> {
        // Data stays in memory for as long as the storage object lives, like a closed IndexedDB.
    }

    async clear(): Promise<void> {
        this.reset();
    }

    async getAll(store: ObjectStoreName, index: string, range: KeyRange): Promise<StoredRow[]> {
        const target = this.getStore(store);
        if (range.kind === 'only') {
            const ids = this.getIndex(target, index).get(range.value) ?? [];
            return ids.map((id) => ({ id, value: cloneValue(target.rows.get(id) as Record<string, unknown>) }));
        }
        const matches: [string | number, number][] = [];
        for (const [id, row] of target.rows) {
            const key = row[index];
            if (typeof key === 'string' && key.startsWith(range.value)) {
                matches.push([key, id]);
            }
        }
        matches.sort((a, b) => compareKeys(a[0], b[0]) || a[1] - b[1]);
        return matches.map(([, id]) => ({ id, value: cloneValue(target.rows.get(id) as Record<string, unknown>) }));
    }

    async getAllRows(store: ObjectStoreName): Promise<StoredRow[]> {
        // Primary key order, like IndexedDB (a put() can insert a key lower than existing ones).
        return [...this.getStore(store).rows]
            .sort((a, b) => a[0] - b[0])
            .map(([id, value]) => ({ id, value: cloneValue(value) }));
    }

    async count(store: ObjectStoreName, index?: string, value?: string): Promise<number> {
        const target = this.getStore(store);
        if (index === undefined) {
            return target.rows.size;
        }
        return this.getIndex(target, index).get(value)?.length ?? 0;
    }

    async add(store: ObjectStoreName, rows: Record<string, unknown>[], guard?: WriteGuard): Promise<number[]> {
        await guard?.();
        const target = this.getStore(store);
        const ids: number[] = [];
        for (const row of rows) {
            const id = target.nextId++;
            target.rows.set(id, cloneValue(row));
            ids.push(id);
        }
        target.indexes.clear();
        return ids;
    }

    async put(store: ObjectStoreName, id: number, row: Record<string, unknown>, guard?: WriteGuard): Promise<void> {
        await guard?.();
        const target = this.getStore(store);
        target.rows.set(id, cloneValue(row));
        target.nextId = Math.max(target.nextId, id + 1);
        target.indexes.clear();
    }

    async deleteWhere(store: ObjectStoreName, index: string, value: string): Promise<number> {
        const target = this.getStore(store);
        const ids = this.getIndex(target, index).get(value) ?? [];
        for (const id of ids) {
            target.rows.delete(id);
        }
        target.indexes.clear();
        return ids.length;
    }

    private reset(): void {
        this.stores = new Map(STORE_NAMES.map((name) => [name, { rows: new Map(), nextId: 1, indexes: new Map() }]));
    }

    private getStore(name: ObjectStoreName): Store {
        const store = this.stores.get(name);
        if (store === undefined) {
            throw new Error(`Unknown object store: ${name}`);
        }
        return store;
    }

    private getIndex(store: Store, index: string): Map<unknown, number[]> {
        let map = store.indexes.get(index);
        if (map === undefined) {
            map = new Map();
            for (const [id, row] of store.rows) {
                const key = row[index];
                if (!isValidKey(key)) {
                    continue;
                }
                const ids = map.get(key);
                if (ids === undefined) {
                    map.set(key, [id]);
                } else {
                    ids.push(id);
                }
            }
            // Equal keys are ordered by primary key, as in IndexedDB (a put() can insert a lower key).
            for (const ids of map.values()) {
                ids.sort((a, b) => a - b);
            }
            store.indexes.set(index, map);
        }
        return map;
    }
}

export class MemoryDictionaryStorage extends IndexedDictionaryStorage {
    readonly sessions = new InProcessWriteSessions();

    constructor() {
        super(new MemoryBackend());
    }
}

/**
 * Dictionary storage held in memory. Useful for tests, short-lived processes, and environments
 * without a database.
 */
export function createMemoryStorage(): MemoryDictionaryStorage {
    return new MemoryDictionaryStorage();
}
