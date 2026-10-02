/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Write sessions for IndexedDB across tabs and workers (overhaul plan §3.3): the writing context holds
 * the Web Lock `yomitan-core-write:<database>` for the whole session. The browser releases it when the
 * tab or worker dies, while a suspended tab keeps it, so a session is stale exactly when nobody holds
 * the lock. Session records live in a separate small database so Yomitan's schema stays untouched.
 */

import {
    SessionLostError,
    StorageBusyError,
    type WriteKind,
    type WriteSession,
    type WriteSessionRecord,
    type WriteSessionStore,
} from 'yomitan-core';

type Release = () => void;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function createId(): string {
    let id = '';
    for (let i = 0; i < 4; ++i) {
        id += Math.floor(Math.random() * 0x100000000)
            .toString(16)
            .padStart(8, '0');
    }
    return id;
}

/** A single-realm LockManager, for environments without `navigator.locks` (tests, old browsers). */
export function createMemoryLockManager(): LockManager {
    const held = new Set<string>();
    const manager = {
        async request(name: string, optionsOrCallback: unknown, maybeCallback?: unknown) {
            const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as (
                lock: Lock | null,
            ) => unknown;
            const options = (typeof optionsOrCallback === 'object' ? optionsOrCallback : {}) as LockOptions;
            if (held.has(name)) {
                if (options.ifAvailable) {
                    return await callback(null);
                }
                throw new Error('Blocking lock requests are not supported by the memory lock manager');
            }
            held.add(name);
            try {
                return await callback({ name, mode: 'exclusive' } as Lock);
            } finally {
                held.delete(name);
            }
        },
        async query() {
            return { held: [...held].map((name) => ({ name, mode: 'exclusive' as const, clientId: '' })), pending: [] };
        },
    };
    return manager as unknown as LockManager;
}

export type WebLockSessionOptions = { name: string; indexedDB?: IDBFactory; locks?: LockManager };

export function createWebLockSessions(options: WebLockSessionOptions): WriteSessionStore {
    const lockName = `yomitan-core-write:${options.name}`;
    const getLocks = (): LockManager => {
        const locks = options.locks ?? (globalThis.navigator as Navigator | undefined)?.locks;
        if (locks === undefined) {
            throw new Error('Web Locks are required for IndexedDB dictionary writes');
        }
        return locks;
    };
    let database: Promise<IDBDatabase> | null = null;

    const openRecords = (): Promise<IDBDatabase> => {
        database ??= new Promise((resolve, reject) => {
            const request = (options.indexedDB ?? indexedDB).open(`${options.name}-yomitan-core-sessions`, 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('sessions', { keyPath: 'id' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return database;
    };
    const records = async (mode: IDBTransactionMode) =>
        (await openRecords()).transaction(['sessions'], mode).objectStore('sessions');
    const allRecords = async (): Promise<WriteSessionRecord[]> => await promisify((await records('readonly')).getAll());

    /** Acquires the write lock if nobody holds it; resolves with its release function, or null. */
    const tryAcquire = (): Promise<Release | null> =>
        new Promise((resolve, reject) => {
            getLocks()
                .request(lockName, { ifAvailable: true }, (lock) => {
                    if (lock === null) {
                        resolve(null);
                        return;
                    }
                    return new Promise<void>((release) => resolve(release));
                })
                .catch(reject);
        });

    const isHeld = async (): Promise<boolean> => {
        const { held = [] } = await getLocks().query();
        return held.some(({ name }) => name === lockName);
    };

    const createHandle = (record: WriteSessionRecord, release: Release): WriteSession => {
        let state: 'active' | 'ended' | 'abandoned' = 'active';
        return {
            record,
            guard: async () => {
                if (state !== 'active') {
                    throw new SessionLostError('The dictionary write session has ended');
                }
            },
            end: async () => {
                if (state !== 'active') {
                    return;
                }
                state = 'ended';
                try {
                    await promisify((await records('readwrite')).delete(record.id));
                } finally {
                    release();
                }
            },
            abandon: () => {
                if (state === 'active') {
                    state = 'abandoned';
                    release();
                }
            },
        };
    };

    return {
        async begin(kind: WriteKind, title: string): Promise<WriteSession> {
            const release = await tryAcquire();
            if (release === null) {
                throw new StorageBusyError();
            }
            const record: WriteSessionRecord = { id: createId(), kind, title, startedAt: Date.now() };
            try {
                // Leftover records mean a writer died: they must be recovered first (see WriteSessionStore).
                if ((await allRecords()).length > 0) {
                    throw new StorageBusyError();
                }
                await promisify((await records('readwrite')).put(record));
            } catch (error) {
                release();
                throw error;
            }
            return createHandle(record, release);
        },
        async listStale(): Promise<WriteSessionRecord[]> {
            return (await isHeld()) ? [] : await allRecords();
        },
        async listLiveTitles(): Promise<Set<string>> {
            return new Set((await isHeld()) ? (await allRecords()).map(({ title }) => title) : []);
        },
        async claimIfStale(id: string): Promise<WriteSession | null> {
            const release = await tryAcquire();
            if (release === null) {
                return null;
            }
            try {
                const record = (await promisify((await records('readonly')).get(id))) as WriteSessionRecord | undefined;
                if (record !== undefined) {
                    return createHandle(record, release);
                }
                release();
                return null;
            } catch (error) {
                release();
                throw error;
            }
        },
    };
}
