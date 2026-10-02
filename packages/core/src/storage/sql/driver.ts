/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type SqlValue = string | number | null | Uint8Array;

export type SqlRunResult = { changes: number; lastInsertRowId: number };

/**
 * The minimal SQLite connection yomitan-core needs. Node wraps better-sqlite3; React Native wraps
 * op-sqlite. SQL storage controls transactions through `exec`, never implicit batch transactions.
 * Writes default to BEGIN IMMEDIATE to take the multi-process write lock up front. A deferred
 * outermost savepoint can hit SQLITE_BUSY when upgrading a read lock to a write lock. op-sqlite
 * uses savepoints per docs/overhaul-plan.md §3.3; one connection per file makes that safe.
 *
 * BLOB columns must come back as `Uint8Array` (a Node `Buffer` qualifies).
 */
export interface SqlDriver {
    /** Write transaction control. Defaults to 'immediate'. */
    writeTransaction?: 'immediate' | 'savepoint';
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
