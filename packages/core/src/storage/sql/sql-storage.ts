/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IndexedDictionaryStorage } from '../indexed-storage';
import {
    SessionLostError,
    StorageBusyError,
    type WriteKind,
    type WriteSession,
    type WriteSessionRecord,
    type WriteSessionStore,
    createSessionId,
} from '../sessions';
import type { KeyRange, ObjectStoreName, StorageBackend, StoredRow, WriteGuard } from '../types';
import type { SqlDriver, SqlValue } from './driver';

/**
 * Bump when the schema changes. A database written by a newer schema is refused rather than
 * misread; older schemas are migrated by `MIGRATIONS`.
 */
export const SQL_SCHEMA_VERSION = 1;

type StoreSchema = { columns: string[]; blob?: string };

/** Indexed columns per store; they mirror upstream's IndexedDB indices. The full row lives in `data`. */
const STORES: Record<ObjectStoreName, StoreSchema> = {
    dictionaries: { columns: ['title', 'version'] },
    terms: { columns: ['dictionary', 'expression', 'reading', 'sequence', 'expressionReverse', 'readingReverse'] },
    termMeta: { columns: ['dictionary', 'expression'] },
    kanji: { columns: ['dictionary', 'character'] },
    kanjiMeta: { columns: ['dictionary', 'character'] },
    tagMeta: { columns: ['dictionary', 'name'] },
    media: { columns: ['dictionary', 'path'], blob: 'content' },
};

const STORE_NAMES = Object.keys(STORES) as ObjectStoreName[];

/** Largest code point; with `>=`/`<` it bounds every key that starts with a prefix, in UTF-8 order. */
const MAX_CODE_POINT = '\u{10FFFF}';

function quote(identifier: string): string {
    return `"${identifier}"`;
}

function createSchemaSql(): string {
    const statements: string[] = [
        'CREATE TABLE IF NOT EXISTS yomitan_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS yomitan_write_sessions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, owner TEXT NOT NULL, startedAt INTEGER NOT NULL, heartbeatAt INTEGER NOT NULL)',
    ];
    for (const store of STORE_NAMES) {
        const { columns, blob } = STORES[store];
        const columnSql = columns.map((column) => `${quote(column)}`).join(', ');
        statements.push(
            `CREATE TABLE IF NOT EXISTS ${quote(store)} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${columnSql}, data TEXT NOT NULL${blob === undefined ? '' : `, ${quote(blob)} BLOB`})`,
        );
        for (const column of columns) {
            statements.push(
                `CREATE INDEX IF NOT EXISTS ${quote(`${store}_${column}`)} ON ${quote(store)} (${quote(column)})`,
            );
        }
    }
    return `${statements.join(';\n')};`;
}

/** IndexedDB only indexes valid keys; anything else is stored as NULL and never matches. */
function toIndexValue(value: unknown): SqlValue {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' && !Number.isNaN(value)) {
        return value;
    }
    return null;
}

function compareKeys(a: unknown, b: unknown): number {
    if (typeof a !== typeof b) {
        return typeof a === 'number' ? -1 : 1;
    }
    return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
}

function toArrayBuffer(value: unknown): ArrayBuffer {
    if (value instanceof ArrayBuffer) {
        return value;
    }
    if (value instanceof Uint8Array) {
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
    }
    throw new Error('Expected BLOB content');
}

function toUint8Array(value: unknown): Uint8Array | null {
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    return null;
}

/** Serializes backend calls: a single SQLite connection can only have one transaction open. */
class Mutex {
    private tail: Promise<void> = Promise.resolve();

    run<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.tail.then(fn);
        this.tail = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
}

type RawRow = Record<string, SqlValue>;

export class SqlBackend implements StorageBackend {
    readonly driver: SqlDriver;
    private readonly mutex = new Mutex();

    constructor(driver: SqlDriver) {
        this.driver = driver;
    }

    open(): Promise<void> {
        return this.mutex.run(async () => {
            try {
                await this.driver.open();
                await this.driver.exec(createSchemaSql());
                const rows = await this.driver.all<{ value: string }>(
                    "SELECT value FROM yomitan_meta WHERE key = 'schemaVersion'",
                );
                if (rows.length === 0) {
                    await this.driver.run("INSERT INTO yomitan_meta (key, value) VALUES ('schemaVersion', ?)", [
                        String(SQL_SCHEMA_VERSION),
                    ]);
                    return;
                }
                const version = Number(rows[0].value);
                if (version > SQL_SCHEMA_VERSION) {
                    throw new Error(
                        `Dictionary database schema version ${version} is newer than this yomitan-core supports (${SQL_SCHEMA_VERSION})`,
                    );
                }
            } catch (error) {
                await this.driver.close().catch(() => {});
                throw error;
            }
        });
    }

    close(): Promise<void> {
        return this.mutex.run(() => this.driver.close());
    }

    clear(): Promise<void> {
        return this.transaction(async () => {
            for (const store of STORE_NAMES) {
                await this.driver.run(`DELETE FROM ${quote(store)}`);
            }
            await this.driver.run('DELETE FROM sqlite_sequence');
        });
    }

    getAll(store: ObjectStoreName, index: string, range: KeyRange): Promise<StoredRow[]> {
        this.assertColumn(store, index);
        return this.mutex.run(async () => {
            if (range.kind === 'only') {
                const rows = await this.driver.all<RawRow>(
                    `SELECT * FROM ${quote(store)} WHERE ${quote(index)} = ? ORDER BY id`,
                    [range.value],
                );
                return rows.map((row) => this.toStoredRow(store, row));
            }
            const rows = await this.driver.all<RawRow>(
                `SELECT * FROM ${quote(store)} WHERE ${quote(index)} >= ? AND ${quote(index)} < ?`,
                [range.value, `${range.value}${MAX_CODE_POINT}`],
            );
            // SQLite orders text by UTF-8 bytes; IndexedDB by UTF-16 code units. Sort like IndexedDB.
            return rows
                .filter((row) => typeof row[index] === 'string' && (row[index] as string).startsWith(range.value))
                .sort((a, b) => compareKeys(a[index], b[index]) || (a.id as number) - (b.id as number))
                .map((row) => this.toStoredRow(store, row));
        });
    }

    getAllRows(store: ObjectStoreName): Promise<StoredRow[]> {
        return this.mutex.run(async () => {
            const rows = await this.driver.all<RawRow>(`SELECT * FROM ${quote(store)} ORDER BY id`);
            return rows.map((row) => this.toStoredRow(store, row));
        });
    }

    count(store: ObjectStoreName, index?: string, value?: string): Promise<number> {
        if (index !== undefined) {
            this.assertColumn(store, index);
        }
        return this.mutex.run(async () => {
            const rows =
                index === undefined
                    ? await this.driver.all<{ count: number }>(`SELECT COUNT(*) AS count FROM ${quote(store)}`)
                    : await this.driver.all<{ count: number }>(
                          `SELECT COUNT(*) AS count FROM ${quote(store)} WHERE ${quote(index)} = ?`,
                          [value ?? null],
                      );
            return Number(rows[0].count);
        });
    }

    add(store: ObjectStoreName, rows: Record<string, unknown>[], guard?: WriteGuard): Promise<number[]> {
        const { columns, blob } = STORES[store];
        const allColumns = [...columns, 'data', ...(blob === undefined ? [] : [blob])];
        const sql = `INSERT INTO ${quote(store)} (${allColumns.map(quote).join(', ')}) VALUES (${allColumns.map(() => '?').join(', ')})`;
        return this.transaction(async () => {
            if (guard !== undefined) {
                await guard();
            }
            const ids: number[] = [];
            for (const row of rows) {
                const result = await this.driver.run(sql, this.toParams(store, row));
                ids.push(result.lastInsertRowId);
            }
            return ids;
        });
    }

    put(store: ObjectStoreName, id: number, row: Record<string, unknown>, guard?: WriteGuard): Promise<void> {
        const { columns, blob } = STORES[store];
        const allColumns = ['id', ...columns, 'data', ...(blob === undefined ? [] : [blob])];
        const sql = `INSERT OR REPLACE INTO ${quote(store)} (${allColumns.map(quote).join(', ')}) VALUES (${allColumns.map(() => '?').join(', ')})`;
        return this.transaction(async () => {
            if (guard !== undefined) {
                await guard();
            }
            await this.driver.run(sql, [id, ...this.toParams(store, row)]);
        });
    }

    deleteWhere(store: ObjectStoreName, index: string, value: string, guard?: WriteGuard): Promise<number> {
        this.assertColumn(store, index);
        return this.transaction(async () => {
            if (guard !== undefined) {
                await guard();
            }
            const result = await this.driver.run(`DELETE FROM ${quote(store)} WHERE ${quote(index)} = ?`, [value]);
            return result.changes;
        });
    }

    /** Runs `fn` serialized with every other backend call, without a write transaction. */
    read<T>(fn: () => Promise<T>): Promise<T> {
        return this.mutex.run(fn);
    }

    /** Runs `fn` in one write transaction, serialized with every other backend call. */
    transaction<T>(fn: () => Promise<T>): Promise<T> {
        return this.mutex.run(async () => {
            const savepoint = this.driver.writeTransaction === 'savepoint';
            await this.driver.exec(savepoint ? 'SAVEPOINT yomitan_write' : 'BEGIN IMMEDIATE');
            try {
                const result = await fn();
                await this.driver.exec(savepoint ? 'RELEASE yomitan_write' : 'COMMIT');
                return result;
            } catch (error) {
                try {
                    if (savepoint) {
                        await this.driver.exec('ROLLBACK TO yomitan_write');
                        await this.driver.exec('RELEASE yomitan_write');
                    } else {
                        await this.driver.exec('ROLLBACK');
                    }
                } catch {
                    // End the outer transaction if savepoint cleanup fails; preserve the write error.
                    await this.driver.exec('ROLLBACK').catch(() => {});
                }
                throw error;
            }
        });
    }

    private assertColumn(store: ObjectStoreName, column: string): void {
        if (!STORES[store].columns.includes(column)) {
            throw new Error(`No index ${column} on ${store}`);
        }
    }

    private toParams(store: ObjectStoreName, row: Record<string, unknown>): SqlValue[] {
        const { columns, blob } = STORES[store];
        const params: SqlValue[] = columns.map((column) => toIndexValue(row[column]));
        if (blob === undefined) {
            params.push(JSON.stringify(row));
        } else {
            const { [blob]: content, ...rest } = row;
            params.push(JSON.stringify(rest), toUint8Array(content));
        }
        return params;
    }

    private toStoredRow(store: ObjectStoreName, row: RawRow): StoredRow {
        const value = JSON.parse(row.data as string) as Record<string, unknown>;
        const { blob } = STORES[store];
        if (blob !== undefined) {
            value[blob] = toArrayBuffer(row[blob]);
        }
        return { id: Number(row.id), value };
    }
}

export type SqlWriteSessionOptions = {
    /** How often a live session renews its heartbeat. Default 10 s. */
    heartbeatIntervalMs?: number;
    /** A session whose heartbeat is older than this is stale. Default 2 minutes. */
    staleAfterMs?: number;
    now?: () => number;
};

type SessionRow = WriteSessionRecord & { owner: string; heartbeatAt: number };

/**
 * Write sessions stored in the dictionary database itself, so they work across processes that share
 * the file (for example a CLI that runs several Node processes). There is no cross-process lock:
 * liveness is a heartbeat, and every guarded write re-checks ownership inside its transaction.
 */
export class SqlWriteSessions implements WriteSessionStore {
    private readonly backend: SqlBackend;
    private readonly heartbeatIntervalMs: number;
    private readonly staleAfterMs: number;
    private readonly now: () => number;

    constructor(backend: SqlBackend, options: SqlWriteSessionOptions = {}) {
        this.backend = backend;
        this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
        this.staleAfterMs = options.staleAfterMs ?? 120_000;
        this.now = options.now ?? (() => Date.now());
    }

    async begin(kind: WriteKind, title: string): Promise<WriteSession> {
        const { driver } = this.backend;
        const owner = createSessionId();
        const record: WriteSessionRecord = { id: createSessionId(), kind, title, startedAt: this.now() };
        await this.backend.transaction(async () => {
            // Stale sessions count too: they must be recovered first, or recovery could later delete
            // rows this session writes under the same title.
            const existing = await driver.all<{ id: string }>('SELECT id FROM yomitan_write_sessions');
            if (existing.length > 0) {
                throw new StorageBusyError();
            }
            await driver.run(
                'INSERT INTO yomitan_write_sessions (id, kind, title, owner, startedAt, heartbeatAt) VALUES (?, ?, ?, ?, ?, ?)',
                [record.id, kind, title, owner, record.startedAt, this.now()],
            );
        });

        return this.createHandle(record, owner);
    }

    /** The live handle for a session this process owns: guard, heartbeat timer, end and abandon. */
    private createHandle(record: WriteSessionRecord, owner: string): WriteSession {
        const { driver } = this.backend;
        // Runs inside a transaction the backend already holds, so it talks to the driver directly.
        const guard: WriteGuard = async () => {
            const { changes } = await driver.run(
                'UPDATE yomitan_write_sessions SET heartbeatAt = ? WHERE id = ? AND owner = ?',
                [this.now(), record.id, owner],
            );
            if (changes === 0) {
                throw new SessionLostError();
            }
        };

        let ended = false;
        const timer = setInterval(() => {
            // Covers long phases without writes (validation, media decoding). A failed heartbeat is
            // surfaced by the next guarded write.
            void this.backend.transaction(guard).catch(() => {});
        }, this.heartbeatIntervalMs);
        (timer as { unref?: () => void }).unref?.();

        return {
            record,
            guard,
            end: async () => {
                if (ended) {
                    return;
                }
                ended = true;
                clearInterval(timer);
                await this.backend.transaction(async () => {
                    await driver.run('DELETE FROM yomitan_write_sessions WHERE id = ? AND owner = ?', [
                        record.id,
                        owner,
                    ]);
                });
            },
            abandon: () => {
                ended = true;
                clearInterval(timer);
            },
        };
    }

    async listStale(): Promise<WriteSessionRecord[]> {
        const rows = await this.backend.read(() =>
            this.backend.driver.all<SessionRow>(
                'SELECT id, kind, title, startedAt FROM yomitan_write_sessions WHERE heartbeatAt <= ? ORDER BY startedAt',
                [this.now() - this.staleAfterMs],
            ),
        );
        return rows.map(({ id, kind, title, startedAt }) => ({ id, kind, title, startedAt: Number(startedAt) }));
    }

    async listLiveTitles(): Promise<Set<string>> {
        const rows = await this.backend.read(() =>
            this.backend.driver.all<{ title: string }>(
                'SELECT title FROM yomitan_write_sessions WHERE heartbeatAt > ?',
                [this.now() - this.staleAfterMs],
            ),
        );
        return new Set(rows.map(({ title }) => title));
    }

    async claimIfStale(id: string): Promise<WriteSession | null> {
        const owner = createSessionId();
        const claimed = await this.backend.transaction(async () => {
            const { changes } = await this.backend.driver.run(
                'UPDATE yomitan_write_sessions SET owner = ?, heartbeatAt = ? WHERE id = ? AND heartbeatAt <= ?',
                [owner, this.now(), id, this.now() - this.staleAfterMs],
            );
            if (changes === 0) {
                return null;
            }
            const [row] = await this.backend.driver.all<SessionRow>(
                'SELECT id, kind, title, startedAt FROM yomitan_write_sessions WHERE id = ?',
                [id],
            );
            return row;
        });
        if (claimed === null || claimed === undefined) {
            return null;
        }
        const { kind, title, startedAt } = claimed;
        return this.createHandle({ id, kind, title, startedAt: Number(startedAt) }, owner);
    }
}

export type SqlStorageOptions = { sessions?: SqlWriteSessionOptions };

export class SqlDictionaryStorage extends IndexedDictionaryStorage {
    readonly sql: SqlBackend;
    readonly sessions: SqlWriteSessions;

    constructor(driver: SqlDriver, options: SqlStorageOptions = {}) {
        const backend = new SqlBackend(driver);
        super(backend);
        this.sql = backend;
        this.sessions = new SqlWriteSessions(backend, options.sessions);
    }
}

/** Dictionary storage in SQLite through any {@link SqlDriver}. The schema is shared by every driver. */
export function createSqlStorage(driver: SqlDriver, options?: SqlStorageOptions): SqlDictionaryStorage {
    return new SqlDictionaryStorage(driver, options);
}
