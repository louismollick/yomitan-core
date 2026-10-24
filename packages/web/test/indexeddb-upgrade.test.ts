import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { createIndexedDbStorage } from '../src/indexeddb-storage';
import { createMemoryLockManager } from '../src/web-lock-sessions';

const INDICES: Record<string, string[]> = {
    terms: ['dictionary', 'expression', 'reading', 'sequence', 'expressionReverse', 'readingReverse'],
    kanji: ['dictionary', 'character'],
    tagMeta: ['dictionary', 'name'],
    dictionaries: ['title', 'version'],
    termMeta: ['dictionary', 'expression'],
    kanjiMeta: ['dictionary', 'character'],
    media: ['dictionary', 'path'],
};

test('a version 60 database (Yomitan schema) gains the kanjiTerms store and keeps its data', async () => {
    const locks = createMemoryLockManager();
    const name = 'upgrade-from-60';
    // A database as the previous release created it: version 60, without the kanjiTerms store.
    const downgraded = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 60);
        request.onupgradeneeded = () => {
            for (const [store, indices] of Object.entries(INDICES)) {
                const keyPath = store === 'terms' || store === 'media' ? { keyPath: 'id' } : {};
                const objectStore = request.result.createObjectStore(store, { autoIncrement: true, ...keyPath });
                for (const index of indices) objectStore.createIndex(index, index);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const write = downgraded.transaction(['dictionaries', 'termMeta'], 'readwrite');
    write.objectStore('dictionaries').add({ title: 'Old', version: 3, revision: '1', importSuccess: true });
    write.objectStore('termMeta').add({ expression: '学', mode: 'freq', data: 1, dictionary: 'Old' });
    await new Promise((resolve) => {
        write.oncomplete = resolve;
    });
    expect([...downgraded.objectStoreNames]).not.toContain('kanjiTerms');
    downgraded.close();

    const storage = createIndexedDbStorage({ name, locks });
    await storage.prepare();
    expect((await storage.getDictionaryInfo()).map(({ title }) => title)).toEqual(['Old']);
    expect(await storage.findKanjiTerms('学', 'Old')).toBeNull();
    await storage.buildKanjiTermIndex('Old', undefined);
    expect((await storage.findKanjiTerms('学', 'Old'))?.map(({ term }) => term)).toEqual(['学']);
    await storage.close();
});

function openRaw(name: string, version: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

test('an upgrade blocked by another tab rejects with an actionable error and leaves no connection open', async () => {
    const locks = createMemoryLockManager();
    const name = 'upgrade-blocked';
    // An older tab that keeps its version 60 connection open and ignores versionchange.
    const older = await openRaw(name, 60);
    const storage = createIndexedDbStorage({ name, locks });
    await expect(storage.prepare()).rejects.toThrow('Close other tabs of this app');
    // The old tab goes away, the upgrade completes late, and its connection is closed again.
    older.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const newer = await openRaw(name, 62);
    expect(newer.version).toBe(62);
    newer.close();
});

test('an open connection closes on versionchange so later upgrades are not blocked', async () => {
    const locks = createMemoryLockManager();
    const name = 'upgrade-versionchange';
    const storage = createIndexedDbStorage({ name, locks });
    await storage.prepare();
    let blocked = false;
    const request = indexedDB.open(name, 62);
    request.onblocked = () => {
        blocked = true;
    };
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    expect(blocked).toBe(false);
    upgraded.close();
});
