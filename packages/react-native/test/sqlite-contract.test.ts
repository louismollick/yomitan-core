import { mkdtempSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, test } from 'vitest';
import { importDictionaryArchive } from 'yomitan-core';
import {
    readFixtureDictionaryFiles,
    runClientContract,
    runGeneratedGoldens,
    runImportContract,
    runStorageContract,
    runTranslatorParity,
    upstreamFixturesDir,
} from '../../contract-tests/src/index';
import { createNodeStorage } from '../../node/src/index';
import { createDirectoryArchiveReader, createReactNativeStorage } from '../src/index';
import { createOpSqliteDouble } from './op-sqlite-double';

const openDatabase = createOpSqliteDouble();
const fixtureDirectory = join(upstreamFixturesDir, 'dictionaries', 'valid-dictionary1');

function temporaryPath() {
    return join(mkdtempSync(join(tmpdir(), 'yomitan-rn-')), 'dictionaries.sqlite');
}

function createFileStorage() {
    return createReactNativeStorage(temporaryPath(), { openDatabase });
}

const fileSystem = {
    async list(dir: string) {
        return (await readdir(dir, { recursive: true, withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'));
    },
    readText: (path: string) => readFile(path, 'utf8'),
    readBytes: async (path: string) => new Uint8Array(await readFile(path)),
};

runStorageContract('op-sqlite double file', createFileStorage);
runStorageContract('op-sqlite double memory', () =>
    createReactNativeStorage('ignored', { location: ':memory:', openDatabase }),
);
runImportContract('op-sqlite double', createFileStorage, {
    directory: () => createDirectoryArchiveReader(fixtureDirectory, fileSystem),
});
runClientContract('op-sqlite double', createFileStorage);
runTranslatorParity('op-sqlite double', createFileStorage);
runGeneratedGoldens('op-sqlite double', createFileStorage);

describe('op-sqlite adapter', () => {
    test('double rejects a JS-thread BEGIN during a transaction and any executeBatch', async () => {
        const connection = (await openDatabase({ name: 'ignored', location: ':memory:' })) as Awaited<
            ReturnType<typeof openDatabase>
        > & { executeSync(sql: string): unknown; executeBatch(): never };
        await connection.execute('SAVEPOINT active');
        expect(() => connection.executeSync('BEGIN')).toThrow('JS-thread BEGIN');
        expect(() => connection.executeBatch()).toThrow('executeBatch is forbidden');
        await connection.execute('ROLLBACK TO active');
        await connection.execute('RELEASE active');
        await connection.closeAsync();
    });

    test('never calls executeBatch or executeSync', async () => {
        const storage = createFileStorage();
        await storage.prepare();
        await storage.bulkAdd('tagMeta', [{ dictionary: 'x', name: 'a' }], 0, 1);
        await storage.close();
    });

    test('keeps one connection per named file and allows reopen after close', async () => {
        const path = temporaryPath();
        const first = createReactNativeStorage(path, { openDatabase });
        const second = createReactNativeStorage(path, { openDatabase });
        await first.prepare();
        await expect(second.prepare()).rejects.toThrow('already open');
        await first.close();
        await second.prepare();
        await second.close();
    });

    test('rolls back a failed import and allows re-import', async () => {
        const storage = createFileStorage();
        await storage.prepare();
        let fail = true;
        const reader = () =>
            createDirectoryArchiveReader(fixtureDirectory, {
                ...fileSystem,
                async readText(path) {
                    if (fail && path.endsWith('/term_bank_2.json')) {
                        throw new Error('forced bank failure');
                    }
                    return fileSystem.readText(path);
                },
            });
        await expect(importDictionaryArchive(storage, reader())).rejects.toThrow('forced bank failure');
        expect(await storage.getDictionaryInfo()).toEqual([]);
        expect((await storage.getDictionaryCounts([], true)).total?.terms).toBe(0);
        fail = false;
        const { errors } = await importDictionaryArchive(storage, reader());
        expect(errors).toEqual([]);
        expect(
            (await storage.findTermsBulk(['打ち込む'], new Set(['Test Dictionary']), 'exact')).length,
        ).toBeGreaterThan(0);
        await storage.close();
    });

    test('opens a Node-built database with identical lookups', async () => {
        const path = temporaryPath();
        const node = createNodeStorage(path);
        await node.prepare();
        const files = readFixtureDictionaryFiles('valid-dictionary1');
        const { createFilesArchiveReader } = await import('yomitan-core');
        expect((await importDictionaryArchive(node, createFilesArchiveReader(files))).errors).toEqual([]);
        const expected = await node.findTermsBulk(['打ち込む', 'うつ'], new Set(['Test Dictionary']), 'exact');
        await node.close();
        const mobile = createReactNativeStorage(path, { openDatabase });
        await mobile.prepare();
        expect(await mobile.findTermsBulk(['打ち込む', 'うつ'], new Set(['Test Dictionary']), 'exact')).toEqual(
            expected,
        );
        await mobile.close();
    });

    test('can build the published entry without Node built-ins', async () => {
        const result = await build({
            entryPoints: [new URL('../dist/index.js', import.meta.url).pathname],
            bundle: true,
            write: false,
            platform: 'neutral',
            format: 'esm',
            external: ['@op-engineering/op-sqlite'],
            logLevel: 'silent',
        });
        expect(result.outputFiles[0].text.length).toBeGreaterThan(0);
    });
});
