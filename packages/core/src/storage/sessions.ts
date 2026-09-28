/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Write sessions make dictionary imports and deletes exclusive per database and recoverable after a
 * crash (overhaul plan §3.3, "Import coordination"). A session is live while its owner keeps it
 * alive; recovery removes what a dead owner left behind.
 */

import type { DictionaryStorage, WriteGuard } from './types';

export type WriteKind = 'import' | 'delete';

export type WriteSessionRecord = {
    id: string;
    kind: WriteKind;
    title: string;
    startedAt: number;
};

export interface WriteSession {
    readonly record: WriteSessionRecord;
    /** Throws {@link SessionLostError} if this session was recovered by someone else. */
    readonly guard: WriteGuard;
    /** Ends the session. Safe to call more than once. */
    end(): Promise<void>;
    /**
     * Stops keeping the session alive without ending it, after a failure that left partial writes.
     * The session becomes stale and recovery cleans up after it.
     */
    abandon(): void;
}

export interface WriteSessionStore {
    /**
     * Starts a session, or throws {@link StorageBusyError} while any other session exists, live or
     * stale (stale ones must be recovered first).
     */
    begin(kind: WriteKind, title: string): Promise<WriteSession>;
    /** Sessions whose owner is gone. */
    listStale(): Promise<WriteSessionRecord[]>;
    /** Titles with a live session (imports or deletes in progress). */
    listLiveTitles(): Promise<Set<string>>;
    /**
     * Takes over a session if it is still stale, atomically: its old owner can no longer write, and
     * no other writer can start until the returned session ends. Returns null if the session renewed
     * its heartbeat (or is gone) in the meantime.
     */
    claimIfStale(id: string): Promise<WriteSession | null>;
}

export class StorageBusyError extends Error {
    readonly code = 'busy';

    constructor(message = 'Another dictionary import or delete is in progress') {
        super(message);
        this.name = 'StorageBusyError';
    }
}

export class SessionLostError extends Error {
    readonly code = 'session-lost';

    constructor(message = 'The dictionary write session was recovered by another process') {
        super(message);
        this.name = 'SessionLostError';
    }
}

export function createSessionId(): string {
    let id = '';
    for (let i = 0; i < 4; ++i) {
        id += Math.floor(Math.random() * 0x100000000)
            .toString(16)
            .padStart(8, '0');
    }
    return id;
}

/**
 * Removes whatever dead sessions and interrupted imports left behind:
 *  1. every stale session is removed first (locking its owner out), then its dictionary is deleted;
 *  2. any dictionary whose summary still says `importSuccess: false` and that has no live session is
 *     an interrupted import (for example if recovery itself crashed after step 1) and is deleted too.
 */
export async function recoverWriteSessions(
    storage: YomitanStorageLike,
    sessions: WriteSessionStore,
): Promise<string[]> {
    const recovered: string[] = [];
    for (const stale of await sessions.listStale()) {
        const claimed = await sessions.claimIfStale(stale.id);
        if (claimed === null) {
            continue;
        }
        try {
            await storage.withWriteGuard(claimed.guard).deleteDictionary(stale.title, 1000, () => {});
        } catch (error) {
            claimed.abandon();
            throw error;
        }
        await claimed.end();
        recovered.push(stale.title);
    }
    // Interrupted imports without a session: only sweep while no other write is in progress, holding
    // a session so no import can start in between. Nothing to sweep means no write at all, so
    // read-only databases open fine.
    if (!(await storage.getDictionaryInfo()).some((summary) => summary.importSuccess === false)) {
        return recovered;
    }
    let sweep: WriteSession;
    try {
        sweep = await sessions.begin('delete', '');
    } catch (error) {
        if (error instanceof StorageBusyError) {
            return recovered;
        }
        throw error;
    }
    try {
        const guarded = storage.withWriteGuard(sweep.guard);
        for (const summary of await storage.getDictionaryInfo()) {
            if (summary.importSuccess === false) {
                await guarded.deleteDictionary(summary.title, 1000, () => {});
                recovered.push(summary.title);
            }
        }
    } finally {
        await sweep.end();
    }
    return recovered;
}

type YomitanStorageLike = DictionaryStorage & { withWriteGuard(guard: WriteGuard): DictionaryStorage };

/** Sessions for storage that lives in one JavaScript realm; nothing survives a crash to recover. */
export class InProcessWriteSessions implements WriteSessionStore {
    private active: WriteSessionRecord | null = null;

    async begin(kind: WriteKind, title: string): Promise<WriteSession> {
        if (this.active !== null) {
            throw new StorageBusyError();
        }
        const record: WriteSessionRecord = { id: createSessionId(), kind, title, startedAt: Date.now() };
        this.active = record;
        return {
            record,
            guard: async () => {
                if (this.active?.id !== record.id) {
                    throw new SessionLostError();
                }
            },
            end: async () => {
                if (this.active?.id === record.id) {
                    this.active = null;
                }
            },
            abandon: () => {
                // Nothing survives the realm, so there is nothing to recover later.
                if (this.active?.id === record.id) {
                    this.active = null;
                }
            },
        };
    }

    async listStale(): Promise<WriteSessionRecord[]> {
        return [];
    }

    async listLiveTitles(): Promise<Set<string>> {
        return new Set(this.active === null ? [] : [this.active.title]);
    }

    async claimIfStale(_id: string): Promise<WriteSession | null> {
        return null;
    }
}
