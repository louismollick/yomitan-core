/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as DDB from '../upstream/types/ext/dictionary-database';
import type { Summary } from '../upstream/types/ext/dictionary-importer';

export type { DDB, Summary };

export type ObjectStoreName = DDB.ObjectStoreName;

/**
 * The dictionary storage interface. It is Yomitan's own `DictionaryDatabase` interface, because the
 * vendored translator and importer consume it directly (ADR-0009). The browser adapter is upstream's
 * IndexedDB class; every other adapter extends {@link IndexedDictionaryStorage}.
 */
export interface DictionaryStorage {
    prepare(): Promise<void>;
    close(): Promise<void>;
    isPrepared(): boolean;
    purge(): Promise<boolean>;
    deleteDictionary(
        dictionaryName: string,
        progressRate: number,
        onProgress: DDB.DeleteDictionaryProgressCallback,
    ): Promise<void>;
    findTermsBulk(termList: string[], dictionaries: DictionarySet, matchType: DDB.MatchType): Promise<DDB.TermEntry[]>;
    findTermsExactBulk(termList: DDB.TermExactRequest[], dictionaries: DictionarySet): Promise<DDB.TermEntry[]>;
    findTermsBySequenceBulk(items: DDB.DictionaryAndQueryRequest[]): Promise<DDB.TermEntry[]>;
    findTermMetaBulk(termList: string[], dictionaries: DictionarySet): Promise<DDB.TermMeta[]>;
    findKanjiBulk(kanjiList: string[], dictionaries: DictionarySet): Promise<DDB.KanjiEntry[]>;
    findKanjiMetaBulk(kanjiList: string[], dictionaries: DictionarySet): Promise<DDB.KanjiMeta[]>;
    findTagMetaBulk(items: DDB.DictionaryAndQueryRequest[]): Promise<(DDB.Tag | undefined)[]>;
    findTagForTitle(name: string, dictionary: string): Promise<DDB.Tag | null>;
    getMedia(items: DDB.MediaRequest[]): Promise<DDB.Media[]>;
    getDictionaryInfo(): Promise<Summary[]>;
    getDictionaryCounts(dictionaryNames: string[], getTotal: boolean): Promise<DDB.DictionaryCounts>;
    dictionaryExists(title: string): Promise<boolean>;
    bulkAdd(objectStoreName: ObjectStoreName, items: unknown[], start: number, count: number): Promise<void>;
    addWithResult(objectStoreName: ObjectStoreName, item: unknown): Promise<unknown>;
    bulkUpdate(
        objectStoreName: ObjectStoreName,
        items: DDB.DatabaseUpdateItem[],
        start: number,
        count: number,
    ): Promise<void>;
}

/**
 * What the client needs from a storage adapter: Yomitan's query interface, write sessions for
 * exclusive recoverable imports and deletes, and a guarded view for session writes.
 */
export interface YomitanStorage extends DictionaryStorage {
    readonly sessions: import('./sessions').WriteSessionStore;
    withWriteGuard(guard: WriteGuard): DictionaryStorage;
}

export type DictionarySet = { has(value: string): boolean };

/**
 * A key range over one index. `prefix` matches keys starting with `value`, which is what upstream's
 * IndexedDB range `[value, value + '\uffff']` selects for dictionary keys.
 */
export type KeyRange = { kind: 'only'; value: string | number } | { kind: 'prefix'; value: string };

/** Checked atomically with a write; throws to abort it (for example when an import session was lost). */
export type WriteGuard = () => Promise<void>;

export type StoredRow = { id: number; value: Record<string, unknown> };

/**
 * The small interface a non-IndexedDB adapter implements. Everything else about storage semantics
 * lives in {@link IndexedDictionaryStorage}, shared by every adapter.
 */
export interface StorageBackend {
    open(): Promise<void>;
    close(): Promise<void>;
    /** Deletes all data and leaves the backend open. */
    clear(): Promise<void>;
    /**
     * Rows whose `index` field matches `range`, ordered by index key (UTF-16 code unit order) then
     * primary key, which is the order IndexedDB returns them in.
     */
    getAll(store: ObjectStoreName, index: string, range: KeyRange): Promise<StoredRow[]>;
    /** All rows of a store in primary key order. */
    getAllRows(store: ObjectStoreName): Promise<StoredRow[]>;
    count(store: ObjectStoreName, index?: string, value?: string): Promise<number>;
    /**
     * Adds rows in order and returns their primary keys. `guard` runs first, inside the same write
     * transaction; if it throws, nothing is written.
     */
    add(store: ObjectStoreName, rows: Record<string, unknown>[], guard?: WriteGuard): Promise<number[]>;
    put(store: ObjectStoreName, id: number, row: Record<string, unknown>, guard?: WriteGuard): Promise<void>;
    /** Deletes rows whose `index` field equals `value`; returns how many were deleted. */
    deleteWhere(store: ObjectStoreName, index: string, value: string): Promise<number>;
}
