/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import Database from 'better-sqlite3';
import {
    type ArchiveReader,
    type SqlDictionaryStorage,
    type SqlDriver,
    type SqlStorageOptions,
    type SqlValue,
    createSqlStorage,
    createZipArchiveReader,
} from 'yomitan-core';

type BetterSqliteDatabase = InstanceType<typeof Database>;

function toBinding(value: SqlValue): SqlValue | Buffer {
    // better-sqlite3 binds Buffers but not plain Uint8Arrays.
    return value instanceof Uint8Array && !Buffer.isBuffer(value)
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : value;
}

/**
 * A {@link SqlDriver} over better-sqlite3. `openDatabase` is called on every open, so the storage can
 * be closed and reopened. Statements are prepared once per connection and cached.
 */
export function createBetterSqliteDriver(openDatabase: () => BetterSqliteDatabase): SqlDriver {
    type Statement = {
        run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
        all(...params: unknown[]): unknown[];
    };
    let database: BetterSqliteDatabase | null = null;
    const statements = new Map<string, Statement>();
    const connection = (): BetterSqliteDatabase => {
        if (database === null) {
            throw new Error('The database connection is not open');
        }
        return database;
    };
    const prepare = (sql: string): Statement => {
        let statement = statements.get(sql);
        if (statement === undefined) {
            statement = connection().prepare(sql) as unknown as Statement;
            statements.set(sql, statement);
        }
        return statement;
    };
    return {
        async open() {
            if (database === null) {
                database = openDatabase();
            }
        },
        async exec(sql) {
            connection().exec(sql);
        },
        async run(sql, params = []) {
            const { changes, lastInsertRowid } = prepare(sql).run(...params.map(toBinding));
            return { changes, lastInsertRowId: Number(lastInsertRowid) };
        },
        async all(sql, params = []) {
            return prepare(sql).all(...params.map(toBinding)) as never[];
        },
        async runMany(sql, paramsList) {
            const statement = prepare(sql);
            for (const params of paramsList) {
                statement.run(...params.map(toBinding));
            }
        },
        async close() {
            statements.clear();
            database?.close();
            database = null;
        },
    };
}

export type NodeStorageOptions = SqlStorageOptions & {
    /** Open without writing (for prebuilt databases). */
    readonly?: boolean;
};

/**
 * Dictionary storage in a SQLite file. The file format is shared with the React Native adapter, so a
 * database built here can be shipped to a phone (ADR-0004).
 */
export function createNodeStorage(path: string, options: NodeStorageOptions = {}): SqlDictionaryStorage {
    const readonly = options.readonly ?? false;
    const driver = createBetterSqliteDriver(() => {
        const database = new Database(path, { readonly });
        if (!readonly) {
            database.pragma('journal_mode = WAL');
        }
        database.pragma('synchronous = NORMAL');
        database.pragma('busy_timeout = 5000');
        return database;
    });
    return createSqlStorage(driver, options);
}

/**
 * Checkpoints the WAL and rebuilds the file to its minimum size. Run after building a database you
 * intend to ship.
 */
export function compactDatabase(path: string): void {
    const database = new Database(path);
    try {
        database.pragma('wal_checkpoint(TRUNCATE)');
        database.exec('VACUUM');
    } finally {
        database.close();
    }
}

/** Reads an unpacked dictionary archive from a directory; files are read on demand. */
export function createDirectoryArchiveReader(directory: string): ArchiveReader {
    return {
        async entries() {
            const names = (await readdir(directory, { recursive: true, withFileTypes: true }))
                .filter((entry) => entry.isFile())
                .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
                .sort();
            return names.map((name) => ({
                name,
                text: () => readFile(join(directory, name), 'utf8'),
                bytes: async () => new Uint8Array(await readFile(join(directory, name))),
            }));
        },
    };
}

/** Reads a `.zip` dictionary from disk. */
export async function createZipFileArchiveReader(path: string): Promise<ArchiveReader> {
    return createZipArchiveReader(new Uint8Array(await readFile(path)));
}
