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
