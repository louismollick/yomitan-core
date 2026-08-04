import { afterEach, describe, expect, it } from 'vitest';

import { DictionaryDB } from '../src/database/dictionary-database';
import { DictionaryImporterClass } from '../src/import/dictionary-importer';
import { createArchive } from './helpers/consumer-e2e-fixtures';

const databases: DictionaryDB[] = [];

afterEach(async () => {
    while (databases.length > 0) {
        const database = databases.pop() as DictionaryDB;
        await database.purge();
        database.close();
    }
});

describe('DictionaryImporter edge cases', () => {
    it('rejects missing and closed databases', async () => {
        const archive = await createArchive({
            index: { title: 'Minimal', revision: '1', format: 3 },
        });
        const importer = new DictionaryImporterClass();

        await expect(importer.importDictionary(null as never, archive, details())).rejects.toThrow('Invalid database');
        const closed = new DictionaryDB(uniqueName());
        databases.push(closed);
        await expect(importer.importDictionary(closed, archive, details())).rejects.toThrow('Database is not ready');
    });

    it('validates CSS, schemas, and nested indexes before staging rows', async () => {
        const database = await createDatabase();
        const importer = new DictionaryImporterClass();
        const emptyCss = await createArchive({
            index: { title: 'Empty CSS', revision: '1', format: 3 },
            styles: '',
        });
        const invalidBank = await createArchive({
            index: { title: 'Invalid bank', revision: '1', format: 3 },
            termBank: [['invalid'] as never],
        });
        const nested = await createArchive(
            { index: { title: 'Nested', revision: '1', format: 3 } },
            { pathPrefix: 'dictionary/' },
        );

        await expect(importer.importDictionary(database, emptyCss, details())).resolves.toMatchObject({ result: null });
        await expect(importer.importDictionary(database, invalidBank, details())).rejects.toThrow(
            'Dictionary has invalid data',
        );
        await expect(importer.importDictionary(database, nested, details())).rejects.toThrow(
            'nested in redundant directories',
        );
        await expect(database.getDictionaryInfo()).resolves.toEqual([]);
    });

    it('imports v1 banks, prefix indexes, legacy tags, and update metadata', async () => {
        const database = await createDatabase();
        const progress: number[] = [];
        const importer = new DictionaryImporterClass(undefined, ({ index }) => progress.push(index));
        const archive = await createArchive({
            index: {
                title: 'Legacy',
                revision: '1',
                version: 1,
                sequenced: true,
                minimumYomitanVersion: '0.0.0',
                author: 'Yomitan Authors',
                url: 'https://example.com',
                description: 'Legacy fixture',
                attribution: 'Test data',
                frequencyMode: 'occurrence-based',
                sourceLanguage: 'ja',
                targetLanguage: 'en',
                isUpdatable: true,
                indexUrl: 'https://example.com/index.json',
                downloadUrl: 'https://example.com/dictionary.zip',
                tagMeta: { n: { category: 'partOfSpeech', order: 0, notes: 'noun', score: 0 } },
            } as never,
            termBank: [['旧', 'きゅう', 'n', '', 1] as never],
            kanjiBank: [['旧', 'キュウ', 'ふる.い', 'joyo'] as never],
            tagBank: [],
        });

        const result = await importer.importDictionary(database, archive, {
            prefixWildcardsSupported: true,
            yomitanVersion: '0.0.0.0',
        });

        expect(result.errors).toEqual([]);
        expect(result.result).toMatchObject({
            title: 'Legacy',
            author: 'Yomitan Authors',
            isUpdatable: true,
            importSuccess: true,
        });
        expect(progress.length).toBeGreaterThan(0);
        expect((await database.findTermsBulk(['旧'], new Set(['Legacy']), 'suffix'))[0].term).toBe('旧');
        expect((await database.findTagForTitle('n', 'Legacy'))?.notes).toBe('noun');
    });

    it('rejects invalid update URLs before staging', async () => {
        const database = await createDatabase();
        const archive = await createArchive({
            index: {
                title: 'Bad update',
                revision: '1',
                format: 3,
                isUpdatable: true,
                indexUrl: 'file:///tmp/index.json',
                downloadUrl: 'not a url',
            },
        });

        await expect(new DictionaryImporterClass().importDictionary(database, archive, details())).rejects.toThrow(
            'Invalid index data for updatable dictionary',
        );
        await expect(database.getDictionaryInfo()).resolves.toEqual([]);
    });
});

function details() {
    return { prefixWildcardsSupported: false, yomitanVersion: '0.0.0' };
}

async function createDatabase(): Promise<DictionaryDB> {
    const database = new DictionaryDB(uniqueName());
    databases.push(database);
    await database.open();
    return database;
}

function uniqueName(): string {
    return `importer-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
