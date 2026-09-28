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
}

export interface WriteSessionStore {
    /** Starts a session, or throws {@link StorageBusyError} while another live session exists. */
    begin(kind: WriteKind, title: string): Promise<WriteSession>;
    /** Sessions whose owner is gone. */
    listStale(): Promise<WriteSessionRecord[]>;
    /** Titles with a live session (imports or deletes in progress). */
    listLiveTitles(): Promise<Set<string>>;
    /** Removes a stale session. Afterwards its owner can no longer write. */
    remove(id: string): Promise<void>;
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
export async function recoverWriteSessions(storage: DictionaryStorage, sessions: WriteSessionStore): Promise<string[]> {
    const recovered: string[] = [];
    for (const session of await sessions.listStale()) {
        await sessions.remove(session.id);
        await storage.deleteDictionary(session.title, 1000, () => {});
        recovered.push(session.title);
    }
    const live = await sessions.listLiveTitles();
    for (const summary of await storage.getDictionaryInfo()) {
        if (summary.importSuccess === false && !live.has(summary.title)) {
            await storage.deleteDictionary(summary.title, 1000, () => {});
            recovered.push(summary.title);
        }
    }
    return recovered;
}

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
        };
    }

    async listStale(): Promise<WriteSessionRecord[]> {
        return [];
    }

    async listLiveTitles(): Promise<Set<string>> {
        return new Set(this.active === null ? [] : [this.active.title]);
    }

    async remove(id: string): Promise<void> {
        if (this.active?.id === id) {
            this.active = null;
        }
    }
}
