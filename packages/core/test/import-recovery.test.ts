import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { DictionaryDatabaseBackend } from '../src/database/backend';
import { DictionaryDB } from '../src/database/dictionary-database';
import { createNodeSqliteDictionaryDB } from '../src/database/node-sqlite';
import { DictionaryImporterClass } from '../src/import/dictionary-importer';
import { createArchive } from './helpers/consumer-e2e-fixtures';

const backends = [
    {
        name: 'indexeddb',
        create: (location: string) => new DictionaryDB(location),
        location: () => `import-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        cleanup: async (database: DictionaryDatabaseBackend) => {
            await database.purge();
            database.close();
        },
    },
    {
        name: 'sqlite',
        create: (location: string) => createNodeSqliteDictionaryDB({ path: location }),
        location: () => join(tmpdir(), `import-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`),
        cleanup: async (database: DictionaryDatabaseBackend, location: string) => {
            database.close();
            await Promise.all([
                rm(location, { force: true }),
                rm(`${location}-wal`, { force: true }),
                rm(`${location}-shm`, { force: true }),
            ]);
        },
    },
];

describe.each(backends)('import recovery ($name)', ({ create, location: createLocation, cleanup }) => {
    it('deletes staged rows left by process death before activation', async () => {
        const location = createLocation();
        const interrupted = create(location);
        await interrupted.open();
        await expect(interrupted.beginImport('Interrupted')).resolves.toBe(true);
        await interrupted.bulkAdd(
            'terms',
            [
                {
                    dictionary: 'Interrupted',
                    expression: '未完了',
                    reading: 'みかんりょう',
                    definitionTags: '',
                    termTags: '',
                    rules: '',
                    score: 1,
                    glossary: ['incomplete'],
                    sequence: 1,
                },
            ],
            0,
            1,
        );
        await expect(interrupted.findTermsBulk(['未完了'], new Set(['Interrupted']), 'exact')).resolves.toEqual([]);
        interrupted.close();

        const recovered = create(location);
        await recovered.open();
        const counts = await recovered.getDictionaryCounts(['Interrupted'], false);

        expect(counts.counts[0]?.terms).toBe(0);
        await expect(recovered.getDictionaryInfo()).resolves.toEqual([]);
        await expect(recovered.beginImport('Interrupted')).resolves.toBe(true);
        await recovered.deleteDictionary('Interrupted');
        await cleanup(recovered, location);
    });

    it('keeps the first reservation when the same title starts importing twice', async () => {
        const location = createLocation();
        const database = create(location);
        await database.open();

        await expect(database.beginImport('Concurrent')).resolves.toBe(true);
        await expect(database.beginImport('Concurrent')).resolves.toBe(false);

        await database.bulkAdd(
            'terms',
            [
                {
                    dictionary: 'Concurrent',
                    expression: '予約',
                    reading: 'よやく',
                    definitionTags: '',
                    termTags: '',
                    rules: '',
                    score: 1,
                    glossary: ['reservation'],
                    sequence: 1,
                },
            ],
            0,
            1,
        );
        await expect(database.findTermsBulk(['予約'], new Set(['Concurrent']), 'exact')).resolves.toEqual([]);

        await database.deleteDictionary('Concurrent');
        await cleanup(database, location);
    });

    it("does not clean up another importer's same-title reservation", async () => {
        const location = createLocation();
        const database = create(location);
        await database.open();
        const archive = await createArchive({
            index: { title: 'Concurrent', revision: '1', format: 3 },
            termBank: [['予約', 'よやく', '', '', 1, ['reservation'], 1, '']],
        });

        const originalBeginImport = database.beginImport.bind(database);
        let releaseFirstImport = () => {};
        const firstImportCanContinue = new Promise<void>((resolve) => {
            releaseFirstImport = resolve;
        });
        let signalFirstReservation = () => {};
        const firstImportReserved = new Promise<void>((resolve) => {
            signalFirstReservation = resolve;
        });
        let isFirstReservation = true;
        database.beginImport = async (title) => {
            const started = await originalBeginImport(title);
            if (isFirstReservation) {
                isFirstReservation = false;
                signalFirstReservation();
                await firstImportCanContinue;
            }
            return started;
        };

        const originalDeleteDictionary = database.deleteDictionary.bind(database);
        let deleteCount = 0;
        database.deleteDictionary = async (...args) => {
            deleteCount += 1;
            return await originalDeleteDictionary(...args);
        };

        const firstImport = new DictionaryImporterClass().importDictionary(database, archive, details());
        await firstImportReserved;
        const secondImport = await new DictionaryImporterClass().importDictionary(database, archive, details());

        expect(secondImport.result).toBeNull();
        expect(secondImport.errors[0]?.message).toContain('being imported');
        expect(deleteCount).toBe(0);

        releaseFirstImport();
        await expect(firstImport).resolves.toMatchObject({ errors: [], result: { title: 'Concurrent' } });
        await expect(database.findTermsBulk(['予約'], new Set(['Concurrent']), 'exact')).resolves.toHaveLength(1);
        await cleanup(database, location);
    });
});

function details() {
    return { prefixWildcardsSupported: false, yomitanVersion: '0.0.0' };
}
