import { test } from 'vitest';
import { createYomitan } from '../../core/src/client/yomitan';
import { createFilesArchiveReader } from '../../core/src/import/archive';
import { createMemoryStorage } from '../../core/src/storage/memory-storage';
import { recoverWriteSessions } from '../../core/src/storage/sessions';
import type { StorageBackend } from '../../core/src/storage/types';
import {
    createDictionaryArchive,
    importFixture,
    readFixtureDictionaryFiles,
    runClientContract,
    runGeneratedGoldens,
    runImportContract,
    runRenderAnkiContract,
    runStorageContract,
    runTranslatorParity,
} from '../src/index';

runStorageContract('memory', createMemoryStorage);
runTranslatorParity('memory', createMemoryStorage);
runImportContract('memory', createMemoryStorage);
runClientContract('memory', createMemoryStorage);
runGeneratedGoldens('memory', createMemoryStorage);
runRenderAnkiContract('memory', createMemoryStorage);

test('memory: recovery removes a dictionary after replacement deletion fails', async ({ expect }) => {
    const TITLE = 'Test Dictionary';
    const archive = await createDictionaryArchive('valid-dictionary1', { level: 6 });
    const files = readFixtureDictionaryFiles('valid-dictionary1');
    const updatable = {
        ...JSON.parse(files['index.json'] as string),
        isUpdatable: true,
        indexUrl: 'https://example.test/index.json',
        downloadUrl: 'https://example.test/d.zip',
    };
    files['index.json'] = JSON.stringify(updatable);
    const storage = createMemoryStorage();
    const client = await createYomitan({
        storage,
        fetch: async (url) => ({
            ok: true,
            status: 200,
            json: async () => (url.endsWith('index.json') ? { ...updatable, revision: 'test2' } : {}),
            arrayBuffer: async () => archive,
        }),
        archiveReaders: { directory: () => createFilesArchiveReader(files) },
    });
    const { backend } = storage as unknown as { backend: StorageBackend };
    const deleteWhere = backend.deleteWhere;
    try {
        await client.dictionaries.import({ source: { directory: 'main' } });
        expect(await backend.count('terms', 'dictionary', TITLE)).toBeGreaterThan(0);
        const failure = new Error('termMeta deletion failed');
        let failOnce = true;
        backend.deleteWhere = async (store, ...args) => {
            if (store === 'termMeta' && failOnce) {
                failOnce = false;
                throw failure;
            }
            return deleteWhere.call(backend, store, ...args);
        };

        await expect(client.dictionaries.update(TITLE)).rejects.toBe(failure);
        // The summary goes first, so the half-deleted dictionary is no longer listed as intact.
        expect(await storage.getDictionaryInfo()).toEqual([]);
        expect(await backend.count('termMeta', 'dictionary', TITLE)).toBeGreaterThan(0);
        expect(await storage.sessions.listStale()).toMatchObject([{ title: TITLE }]);

        await recoverWriteSessions(storage, storage.sessions);
        expect(await client.dictionaries.list()).toEqual([]);
        expect(await backend.count('termMeta', 'dictionary', TITLE)).toBe(0);
    } finally {
        backend.deleteWhere = deleteWhere;
        await client.dispose();
    }
});

test('memory: recovery keeps an installed dictionary when a same-title import died before writing', async ({
    expect,
}) => {
    const storage = createMemoryStorage();
    const client = await createYomitan({ storage });
    await client.dictionaries.import({ source: await createDictionaryArchive('valid-dictionary1') });
    const session = await storage.sessions.begin('import', 'Test Dictionary');
    session.abandon();
    expect(await recoverWriteSessions(storage, storage.sessions)).toEqual([]);
    expect((await client.dictionaries.list()).map(({ title }) => title)).toEqual(['Test Dictionary']);
    expect(await storage.sessions.listStale()).toEqual([]);
    await client.dispose();
});

test('memory: recovery keeps a replacement that finished before its session ended', async ({ expect }) => {
    const storage = createMemoryStorage();
    const client = await createYomitan({ storage });
    const session = await storage.sessions.begin('replace', 'Test Dictionary');
    await importFixture(storage.withWriteGuard(session.guard), await createDictionaryArchive('valid-dictionary1'));
    session.abandon();
    expect(await recoverWriteSessions(storage, storage.sessions)).toEqual([]);
    expect((await client.dictionaries.list()).map(({ title }) => title)).toEqual(['Test Dictionary']);
    await client.dispose();
});
