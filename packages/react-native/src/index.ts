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

/** Split statement boundaries without treating quoted text, identifiers or comments as SQL. */
function splitStatements(sql: string): string[] {
    const statements: string[] = [];
    let start = 0;
    let quote = '';
    let comment = '';
    let hasSql = false;
    for (let i = 0; i < sql.length; i++) {
        const char = sql[i];
        const next = sql[i + 1];
        if (comment === '--') {
            if (char === '\n' || char === '\r') comment = '';
        } else if (comment === '/*') {
            if (char === '*' && next === '/') {
                comment = '';
                i++;
            }
        } else if (quote) {
            if (char === quote) {
                if (next === quote && quote !== ']') i++;
                else quote = '';
            }
        } else if ((char === '-' && next === '-') || (char === '/' && next === '*')) {
            comment = char + next;
            i++;
        } else if (char === ';') {
            if (hasSql) statements.push(sql.slice(start, i));
            start = i + 1;
            hasSql = false;
        } else if (!/\s/.test(char)) {
            hasSql = true;
            if (char === "'" || char === '"' || char === '`') quote = char;
            else if (char === '[') quote = ']';
        }
    }
    if (hasSql) statements.push(sql.slice(start));
    return statements;
}

/** One connection for one file. All statements, including transaction control, use the async queue. */
export function createOpSqliteDriver(
    openDatabase: () => OpSqliteConnection | Promise<OpSqliteConnection>,
    options: { readOnly?: boolean } = {},
): SqlDriver {
    let database: OpSqliteConnection | null = null;
    const connection = (): OpSqliteConnection => {
        if (database === null) {
            throw new Error('The database connection is not open');
        }
        return database;
    };
    return {
        writeTransaction: 'savepoint',
        async open() {
            if (database !== null) {
                return;
            }
            try {
                database = await openDatabase();
                await database.execute('PRAGMA busy_timeout = 5000');
                if (!options.readOnly) {
                    await database.execute('PRAGMA journal_mode = WAL');
                }
            } catch (error) {
                const current = database;
                database = null;
                await current?.closeAsync().catch(() => {});
                throw error;
            }
        },
        async exec(sql) {
            // The schema contains several statements; execute accepts one statement per call.
            for (const statement of splitStatements(sql)) {
                await connection().execute(statement);
            }
        },
        async run(sql, params = []) {
            const result = await connection().execute(sql, params);
            return { changes: result.rowsAffected, lastInsertRowId: result.insertId ?? 0 };
        },
        async all<T>(sql: string, params: SqlValue[] = []) {
            const { rows } = await connection().execute(sql, params);
            return rows.map((row) =>
                Object.fromEntries(
                    Object.entries(row).map(([key, value]) => [
                        key,
                        value instanceof ArrayBuffer ? new Uint8Array(value) : value,
                    ]),
                ),
            ) as T[];
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
    const driver = createOpSqliteDriver(
        async () => {
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
                        try {
                            await database.closeAsync();
                        } finally {
                            if (key !== null) {
                                openFiles.delete(key);
                            }
                        }
                    },
                };
            } catch (error) {
                if (key !== null) {
                    openFiles.delete(key);
                }
                throw error;
            }
        },
        { readOnly },
    );
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
            for (const name of names) {
                if (
                    name.startsWith('/') ||
                    /^[a-z]:/i.test(name) ||
                    name.includes('\\') ||
                    name.split('/').includes('..')
                ) {
                    throw new Error(`Unsafe archive entry name: ${name}`);
                }
            }
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
