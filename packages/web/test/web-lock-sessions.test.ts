import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { SessionLostError, StorageBusyError } from 'yomitan-core';
import { createMemoryLockManager, createWebLockSessions } from '../src/web-lock-sessions';

describe('Web Lock sessions', () => {
    let sequence = 0;
    const createPair = () => {
        const name = `web-sessions-${++sequence}`;
        const locks = createMemoryLockManager();
        return [createWebLockSessions({ name, locks }), createWebLockSessions({ name, locks })] as const;
    };

    test('begin refuses a live lock and any leftover record', async () => {
        const [first, second] = createPair();
        const active = await first.begin('import', 'A');
        await expect(second.begin('delete', 'B')).rejects.toBeInstanceOf(StorageBusyError);
        active.abandon();
        await expect(second.begin('delete', 'B')).rejects.toBeInstanceOf(StorageBusyError);
    });

    test('claims a stale session and locks out its old handle', async () => {
        const [first, second] = createPair();
        const old = await first.begin('import', 'A');
        old.abandon();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect((await second.listStale()).map(({ id }) => id)).toEqual([old.record.id]);
        const claim = await second.claimIfStale(old.record.id);
        expect(claim).not.toBeNull();
        await expect(old.guard()).rejects.toBeInstanceOf(SessionLostError);
        await expect(first.claimIfStale(old.record.id)).resolves.toBeNull();
        await claim?.end();
        expect(await first.listStale()).toEqual([]);
        await (await first.begin('delete', 'B')).end();
    });
});
