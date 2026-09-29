import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import {
    SessionLostError,
    StorageBusyError,
    createFilesArchiveReader,
    createYomitan,
    importDictionaryArchive,
    recoverWriteSessions,
} from 'yomitan-core';
import { readFixtureDictionaryFiles } from '../../contract-tests/src/index';
import { compactDatabase, createNodeStorage } from '../src/index';

const TITLE = 'Test Dictionary';

function tempPath(): string {
    return join(mkdtempSync(join(tmpdir(), 'yomitan-node-')), 'dictionaries.sqlite');
}

async function importFixture(storage: ReturnType<typeof createNodeStorage>) {
    const { errors } = await importDictionaryArchive(
        storage,
        createFilesArchiveReader(readFixtureDictionaryFiles('valid-dictionary1')),
    );
    expect(errors).toEqual([]);
}

describe('SQLite storage', () => {
    test('prefix and suffix term queries use an index', async () => {
        const path = tempPath();
        const storage = createNodeStorage(path);
        await storage.prepare();
        await importFixture(storage);
        await storage.close();
        const database = new Database(path, { readonly: true });
        for (const column of ['expression', 'reading', 'expressionReverse', 'readingReverse']) {
            const plan = database
                .prepare(`EXPLAIN QUERY PLAN SELECT * FROM "terms" WHERE "${column}" >= ? AND "${column}" < ?`)
                .all('打', '打\u{10FFFF}') as { detail: string }[];
            expect(plan.map(({ detail }) => detail).join(' ')).toContain(`INDEX terms_${column}`);
        }
        database.close();
    });

    test('prefix matches follow IndexedDB order, including characters outside the BMP', async () => {
        const storage = createNodeStorage(':memory:');
        await storage.prepare();
        const rows = ['打\u{20000}', '打z', '打～', '打', '打a'].map((expression) => ({
            expression,
            reading: 'だ',
            definitionTags: '',
            rules: '',
            score: 0,
            glossary: ['x'],
            dictionary: TITLE,
        }));
        await storage.bulkAdd('terms', rows, 0, rows.length);
        const results = await storage.findTermsBulk(['打'], new Set([TITLE]), 'prefix');
        // UTF-16 code unit order: surrogate pairs (0xD8xx) sort before U+FF5E.
        expect(results.map(({ term }) => term)).toEqual(['打', '打a', '打z', '打\u{20000}', '打～']);
        await storage.close();
    });

    test('a database built in one process opens read-only after compaction, with identical results', async () => {
        const path = tempPath();
        const writer = createNodeStorage(path);
        await writer.prepare();
        await importFixture(writer);
        const expected = await writer.findTermsBulk(['打ち込む', 'うつ'], new Set([TITLE]), 'exact');
        await writer.close();
        compactDatabase(path);
        const reader = createNodeStorage(path, { readonly: true });
        await reader.prepare();
        expect(await reader.findTermsBulk(['打ち込む', 'うつ'], new Set([TITLE]), 'exact')).toEqual(expected);
        await reader.close();
    });

    test('a client opens a read-only prebuilt database and looks up terms', async () => {
        const path = tempPath();
        const builder = createNodeStorage(path);
        await builder.prepare();
        await importFixture(builder);
        await builder.close();
        compactDatabase(path);
        const reader = await createYomitan({ storage: createNodeStorage(path, { readonly: true }) });
        await reader.profile.syncDictionaries();
        expect((await reader.lookup.terms('打ち込む')).entries.length).toBeGreaterThan(0);
        await reader.dispose();
    });

    test('refuses a database written by a newer schema', async () => {
        const path = tempPath();
        const storage = createNodeStorage(path);
        await storage.prepare();
        await storage.close();
        const database = new Database(path);
        database.prepare("UPDATE yomitan_meta SET value = '999' WHERE key = 'schemaVersion'").run();
        database.close();
        await expect(createNodeStorage(path).prepare()).rejects.toThrow('newer than this yomitan-core supports');
    });
});

describe('SQLite write sessions', () => {
    test('a second connection is busy while a session is live', async () => {
        const path = tempPath();
        const a = createNodeStorage(path);
        const b = createNodeStorage(path);
        await a.prepare();
        await b.prepare();
        const session = await a.sessions.begin('import', TITLE);
        await expect(b.sessions.begin('import', 'Other')).rejects.toBeInstanceOf(StorageBusyError);
        await session.end();
        const next = await b.sessions.begin('delete', TITLE);
        await next.end();
        await a.close();
        await b.close();
    });

    test('recovery removes an interrupted import, and its owner cannot write afterwards', async () => {
        const path = tempPath();
        let now = 1_000_000;
        const clock = () => now;
        const owner = createNodeStorage(path, { sessions: { now: clock, heartbeatIntervalMs: 3_600_000 } });
        const recoverer = createNodeStorage(path, { sessions: { now: clock } });
        await owner.prepare();
        await recoverer.prepare();

        // The owner imports through its guarded view, then stalls (a suspended app, a killed process).
        const session = await owner.sessions.begin('import', TITLE);
        await importFixture(owner.withWriteGuard(session.guard) as ReturnType<typeof createNodeStorage>);
        expect(await recoverer.sessions.listLiveTitles()).toEqual(new Set([TITLE]));
        expect(await recoverWriteSessions(recoverer, recoverer.sessions)).toEqual([]);

        now += 121_000;
        expect(await recoverWriteSessions(recoverer, recoverer.sessions)).toEqual([TITLE]);
        expect(await recoverer.getDictionaryInfo()).toEqual([]);
        expect((await recoverer.getDictionaryCounts([], true)).total).toEqual({
            kanji: 0,
            kanjiMeta: 0,
            terms: 0,
            termMeta: 0,
            tagMeta: 0,
            media: 0,
        });

        // The stale owner resumes and tries to keep writing.
        const guarded = owner.withWriteGuard(session.guard);
        await expect(guarded.bulkAdd('tagMeta', [{ name: 'x', dictionary: TITLE }], 0, 1)).rejects.toBeInstanceOf(
            SessionLostError,
        );
        expect((await recoverer.getDictionaryCounts([], true)).total?.tagMeta).toBe(0);
        await session.end();
        await owner.close();
        await recoverer.close();
    });

    test('recovery skips a session that renewed its heartbeat after being listed as stale', async () => {
        const path = tempPath();
        let now = 1_000_000;
        const clock = () => now;
        const owner = createNodeStorage(path, { sessions: { now: clock, heartbeatIntervalMs: 3_600_000 } });
        const recoverer = createNodeStorage(path, { sessions: { now: clock } });
        await owner.prepare();
        await recoverer.prepare();
        const session = await owner.sessions.begin('import', TITLE);
        now += 121_000;
        const [stale] = await recoverer.sessions.listStale();
        await owner.withWriteGuard(session.guard).bulkAdd('tagMeta', [{ name: 'x', dictionary: TITLE }], 0, 1);
        expect(await recoverer.sessions.claimIfStale(stale.id)).toBeNull();
        await expect(
            owner.withWriteGuard(session.guard).bulkAdd('tagMeta', [{ name: 'y', dictionary: TITLE }], 0, 1),
        ).resolves.toBeUndefined();
        await session.end();
        await owner.close();
        await recoverer.close();
    });

    test('a recovered delete cannot resume and delete a newer import', async () => {
        const path = tempPath();
        let now = 1_000_000;
        const clock = () => now;
        const owner = createNodeStorage(path, { sessions: { now: clock, heartbeatIntervalMs: 3_600_000 } });
        const other = createNodeStorage(path, { sessions: { now: clock } });
        await owner.prepare();
        await other.prepare();
        const deleting = await owner.sessions.begin('delete', TITLE);
        now += 121_000;
        await recoverWriteSessions(other, other.sessions);
        const importing = await other.sessions.begin('import', TITLE);
        await importFixture(other.withWriteGuard(importing.guard) as ReturnType<typeof createNodeStorage>);
        await importing.end();
        await expect(
            owner.withWriteGuard(deleting.guard).deleteDictionary(TITLE, 1000, () => {}),
        ).rejects.toBeInstanceOf(SessionLostError);
        expect((await other.getDictionaryInfo()).map(({ title }) => title)).toEqual([TITLE]);
        await owner.close();
        await other.close();
    });

    test('a claimed stale session keeps other writers out until recovery ends', async () => {
        const path = tempPath();
        let now = 1_000_000;
        const clock = () => now;
        const owner = createNodeStorage(path, { sessions: { now: clock, heartbeatIntervalMs: 3_600_000 } });
        const recoverer = createNodeStorage(path, { sessions: { now: clock, heartbeatIntervalMs: 3_600_000 } });
        await owner.prepare();
        await recoverer.prepare();
        const session = await owner.sessions.begin('import', TITLE);
        now += 121_000;
        const [stale] = await recoverer.sessions.listStale();
        const claimed = await recoverer.sessions.claimIfStale(stale.id);
        expect(claimed?.record.title).toBe(TITLE);
        await expect(recoverer.sessions.begin('import', 'Other')).rejects.toBeInstanceOf(StorageBusyError);
        await expect(
            owner.withWriteGuard(session.guard).bulkAdd('tagMeta', [{ name: 'x', dictionary: TITLE }], 0, 1),
        ).rejects.toBeInstanceOf(SessionLostError);
        await claimed?.end();
        const next = await recoverer.sessions.begin('import', 'Other');
        await next.end();
        await owner.close();
        await recoverer.close();
    });

    test('a new session is refused while a stale one is unrecovered', async () => {
        const path = tempPath();
        let now = 1_000_000;
        const clock = () => now;
        const crashed = createNodeStorage(path, { sessions: { now: clock, heartbeatIntervalMs: 3_600_000 } });
        const next = createNodeStorage(path, { sessions: { now: clock } });
        await crashed.prepare();
        await next.prepare();
        await crashed.sessions.begin('import', TITLE);
        now += 121_000;
        await expect(next.sessions.begin('import', TITLE)).rejects.toBeInstanceOf(StorageBusyError);
        await recoverWriteSessions(next, next.sessions);
        const session = await next.sessions.begin('import', TITLE);
        await session.end();
        await crashed.close();
        await next.close();
    });

    test('the interrupted-import sweep waits while another write is live', async () => {
        const path = tempPath();
        const a = createNodeStorage(path);
        const b = createNodeStorage(path);
        await a.prepare();
        await b.prepare();
        await a.addWithResult('dictionaries', { title: 'In progress', importSuccess: false, version: 3 });
        const live = await a.sessions.begin('import', 'In progress');
        expect(await recoverWriteSessions(b, b.sessions)).toEqual([]);
        expect((await b.getDictionaryInfo()).map(({ title }) => title)).toEqual(['In progress']);
        await live.end();
        await a.close();
        await b.close();
    });

    test('recovery removes an import whose summary never completed, even without a session', async () => {
        const storage = createNodeStorage(':memory:');
        await storage.prepare();
        await storage.addWithResult('dictionaries', { title: 'Broken', importSuccess: false, version: 3 });
        await storage.bulkAdd('terms', [{ expression: 'a', reading: 'a', dictionary: 'Broken', glossary: [] }], 0, 1);
        expect(await recoverWriteSessions(storage, storage.sessions)).toEqual(['Broken']);
        expect(await storage.getDictionaryInfo()).toEqual([]);
        await storage.close();
    });

    test('a failed guard rolls back the whole batch', async () => {
        const storage = createNodeStorage(':memory:');
        await storage.prepare();
        const failing = storage.withWriteGuard(async () => {
            throw new SessionLostError();
        });
        await expect(
            failing.bulkAdd(
                'tagMeta',
                [
                    { name: 'a', dictionary: TITLE },
                    { name: 'b', dictionary: TITLE },
                ],
                0,
                2,
            ),
        ).rejects.toBeInstanceOf(SessionLostError);
        expect((await storage.getDictionaryCounts([], true)).total?.tagMeta).toBe(0);
        await storage.close();
    });
});
