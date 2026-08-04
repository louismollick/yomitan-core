import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { DictionaryDatabaseBackend } from '../src/database/backend';
import { DictionaryDB } from '../src/database/dictionary-database';
import { createNodeSqliteDictionaryDB } from '../src/database/node-sqlite';

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
        await interrupted.beginImport('Interrupted');
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
        await expect(recovered.beginImport('Interrupted')).resolves.toBeUndefined();
        await recovered.deleteDictionary('Interrupted');
        await cleanup(recovered, location);
    });
});
