import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { createSqlStorage } from 'yomitan-core';
import { createDirectoryArchiveReader, createOpSqliteDriver, createReactNativeStorage } from '../src/index';
import { createOpSqliteDouble } from './op-sqlite-double';

const openDatabase = createOpSqliteDouble();
const memory = () => openDatabase({ name: 'ignored', location: ':memory:' });
const temporaryPath = () => join(mkdtempSync(join(tmpdir(), 'yomitan-rn-review-')), 'test.sqlite');

test('sets timeout and WAL on a file connection', async () => {
    const driver = createOpSqliteDriver(() => openDatabase({ name: temporaryPath() }));
    await driver.open();
    expect(await driver.all('PRAGMA busy_timeout')).toEqual([{ timeout: 5000 }]);
    expect(await driver.all('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
    await driver.close();
});

test('skips journal mode changes for read-only connections', async () => {
    const connection = await memory();
    const execute = vi.spyOn(connection, 'execute');
    const driver = createOpSqliteDriver(() => connection, { readOnly: true });
    await driver.open();
    expect(execute.mock.calls.map(([sql]) => sql)).toEqual(['PRAGMA busy_timeout = 5000']);
    await driver.close();
});

test('normalizes native ArrayBuffer BLOB rows to Uint8Array', async () => {
    const connection = await memory();
    const driver = createOpSqliteDriver(() => connection);
    await driver.open();
    const sql = "SELECT x'0001ff' AS content";
    expect((await connection.execute(sql)).rows[0].content).toBeInstanceOf(ArrayBuffer);
    expect(await driver.all(sql)).toEqual([{ content: new Uint8Array([0, 1, 255]) }]);
    await driver.close();
});

test('exec respects strings, escaped quotes, identifiers and comments', async () => {
    const driver = createOpSqliteDriver(memory);
    await driver.open();
    await driver.exec(`
        -- comment ;
        CREATE TABLE "a;""b" ([c;d] TEXT, \`e;f\` TEXT);
        /* comment ; ' " */ INSERT INTO "a;""b" VALUES ('a;''b', 'c;d');
        INSERT INTO "a;""b" VALUES ('second', 'row');
        -- trailing comment ;
    `);
    expect(await driver.all('SELECT * FROM "a;""b"')).toEqual([
        { 'c;d': "a;'b", 'e;f': 'c;d' },
        { 'c;d': 'second', 'e;f': 'row' },
    ]);
    await driver.close();
});

test.each(['ROLLBACK TO yomitan_write', 'RELEASE yomitan_write'])(
    'falls back to ROLLBACK when %s fails and preserves the original error',
    async (failedStatement) => {
        const driver = createOpSqliteDriver(memory);
        const storage = createSqlStorage(driver);
        await storage.prepare();
        const exec = driver.exec.bind(driver);
        const calls: string[] = [];
        driver.exec = async (sql) => {
            calls.push(sql);
            if (sql === failedStatement) throw new Error('cleanup failed');
            await exec(sql);
        };
        const original = new Error('write failed');
        await expect(
            storage.sql.transaction(async () => {
                await driver.run("INSERT INTO yomitan_meta VALUES ('rollback-test', 'x')");
                throw original;
            }),
        ).rejects.toBe(original);
        expect(calls[0]).toBe('SAVEPOINT yomitan_write');
        expect(calls).toContain(failedStatement);
        expect(calls.at(-1)).toBe('ROLLBACK');
        expect(await driver.all("SELECT * FROM yomitan_meta WHERE key = 'rollback-test'")).toEqual([]);
        driver.exec = exec;
        await storage.sql.transaction(async () => {
            await driver.run("INSERT INTO yomitan_meta VALUES ('next-write', 'ok')");
        });
        await storage.close();
    },
);

test.each(['open', 'pragma', 'schema'])('releases the file and connection after a %s failure', async (failure) => {
    const name = temporaryPath();
    const close = vi.fn();
    const original = new Error('open failed');
    const failing = createReactNativeStorage(name, {
        async openDatabase(options) {
            if (failure === 'open') throw original;
            const connection = await openDatabase(options);
            if (failure === 'schema') {
                await connection.execute('CREATE TABLE yomitan_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
                await connection.execute("INSERT INTO yomitan_meta VALUES ('schemaVersion', '999')");
            }
            return {
                execute(sql, params) {
                    if (failure === 'pragma') return Promise.reject(original);
                    return connection.execute(sql, params);
                },
                async closeAsync() {
                    close();
                    await connection.closeAsync();
                },
            };
        },
    });
    await expect(failing.prepare()).rejects.toThrow(failure === 'schema' ? 'newer than' : 'open failed');
    expect(close).toHaveBeenCalledTimes(failure === 'open' ? 0 : 1);
    if (failure === 'schema') {
        const repair = await openDatabase({ name });
        await repair.execute("UPDATE yomitan_meta SET value = '1'");
        await repair.closeAsync();
    }
    const next = createReactNativeStorage(name, { openDatabase });
    await next.prepare();
    await next.close();
});

test.each(['/absolute', '../outside', 'nested/../outside', 'nested\\outside', 'C:/absolute'])(
    'rejects unsafe archive entry %s before any reads',
    async (name) => {
        const readText = vi.fn();
        const readBytes = vi.fn();
        const reader = createDirectoryArchiveReader('/archive', {
            list: async () => ['safe.json', name],
            readText,
            readBytes,
        });
        await expect(reader.entries()).rejects.toThrow('Unsafe archive entry');
        expect(readText).not.toHaveBeenCalled();
        expect(readBytes).not.toHaveBeenCalled();
    },
);
