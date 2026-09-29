/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type SqlValue = string | number | null | Uint8Array;

export type SqlRunResult = { changes: number; lastInsertRowId: number };

/**
 * The minimal SQLite connection yomitan-core needs. Node wraps better-sqlite3; React Native wraps
 * op-sqlite. SQL storage issues its own `BEGIN`/`COMMIT` through `exec` and never relies on a
 * driver's implicit batch transaction, because those differ between drivers.
 *
 * BLOB columns must come back as `Uint8Array` (a Node `Buffer` qualifies).
 */
export interface SqlDriver {
    /** Opens (or reopens after `close`) the connection. */
    open(): Promise<void>;
    /** Runs one or more statements without parameters or results. */
    exec(sql: string): Promise<void>;
    run(sql: string, params?: SqlValue[]): Promise<SqlRunResult>;
    all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
    /**
     * Optional fast path for inserting many rows with one statement. Called inside a transaction the
     * storage already opened, so it must not open its own.
     */
    runMany?(sql: string, paramsList: SqlValue[][]): Promise<void>;
    close(): Promise<void>;
}
