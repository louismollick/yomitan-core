/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    type ArchiveReader,
    type SqlDriver,
    type SqlStorageOptions,
    type SqlValue,
    createSqlStorage,
} from 'yomitan-core';

type QueryResult = {
    rows: Record<string, unknown>[];
    rowsAffected: number;
    insertId?: number;
};

/** The op-sqlite 17.1 calls used by this adapter. */
export type OpSqliteConnection = {
    execute(sql: string, params?: SqlValue[]): Promise<QueryResult>;
    closeAsync(): Promise<void>;
};

export type OpenDatabase = (options: { name: string; location?: string; readOnly?: boolean }) =>
    | OpSqliteConnection
    | Promise<OpSqliteConnection>;

/** One connection for one file. All statements, including transaction control, use the async queue. */
export function createOpSqliteDriver(openDatabase: () => OpSqliteConnection | Promise<OpSqliteConnection>): SqlDriver {
    let database: OpSqliteConnection | null = null;
    const connection = (): OpSqliteConnection => {
        if (database === null) {
            throw new Error('The database connection is not open');
        }
        return database;
    };
    return {
        async open() {
            database ??= await openDatabase();
        },
        async exec(sql) {
            // The schema contains several statements; execute accepts one statement per call.
            for (const statement of sql.split(';')) {
                if (statement.trim()) {
                    await connection().execute(statement);
                }
            }
        },
        async run(sql, params = []) {
            const result = await connection().execute(sql, params);
            return { changes: result.rowsAffected, lastInsertRowId: result.insertId ?? 0 };
        },
        async all<T>(sql: string, params: SqlValue[] = []) {
            return (await connection().execute(sql, params)).rows as T[];
        },
        async runMany(sql, paramsList) {
            for (const params of paramsList) {
                await connection().execute(sql, params);
            }
        },
        async close() {
            const current = database;
            database = null;
            await current?.closeAsync();
        },
    };
}

export type ReactNativeStorageOptions = SqlStorageOptions & {
    location?: string;
    readOnly?: boolean;
    /** Defaults to op-sqlite's open; injection also supports native-free contract tests. */
    openDatabase?: OpenDatabase;
};

const openFiles = new Set<string>();

/** SQLite storage using the same schema as @yomitan-core/node. */
export function createReactNativeStorage(name: string, options: ReactNativeStorageOptions = {}) {
    const { location, readOnly, openDatabase, ...storageOptions } = options;
    const key = location === ':memory:' ? null : JSON.stringify([location ?? '', name]);
    const driver = createOpSqliteDriver(async () => {
        if (key !== null) {
            if (openFiles.has(key)) {
                throw new Error(`A connection to ${name} is already open`);
            }
            openFiles.add(key);
        }
        try {
            const database =
                openDatabase === undefined
                    ? (await import('@op-engineering/op-sqlite')).open({ name, location, readOnly })
                    : await openDatabase({ name, location, readOnly });
            return {
                execute: (sql: string, params?: SqlValue[]) => database.execute(sql, params),
                async closeAsync() {
                    await database.closeAsync();
                    if (key !== null) {
                        openFiles.delete(key);
                    }
                },
            };
        } catch (error) {
            if (key !== null) {
                openFiles.delete(key);
            }
            throw error;
        }
    });
    return createSqlStorage(driver, storageOptions);
}

export interface DirectoryFileSystem {
    /** Return file paths relative to dir, including files in nested directories. */
    list(dir: string): Promise<string[]>;
    readText(path: string): Promise<string>;
    readBytes(path: string): Promise<Uint8Array>;
}

/** Reads an unpacked archive on demand. Only the file list is held in memory. */
export function createDirectoryArchiveReader(directory: string, fileSystem: DirectoryFileSystem): ArchiveReader {
    return {
        async entries() {
            const names = (await fileSystem.list(directory)).sort();
            return names.map((name) => {
                const path = `${directory.replace(/\/$/, '')}/${name}`;
                return {
                    name,
                    text: () => fileSystem.readText(path),
                    bytes: () => fileSystem.readBytes(path),
                };
            });
        },
    };
}
