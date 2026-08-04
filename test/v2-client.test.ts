import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDictionaryDB } from '../src/database/node-sqlite';
import { type YomitanClient, createYomitan } from '../src/index';
import {
    KANJI_DICTIONARY_TITLE,
    META_DICTIONARY_TITLE,
    TERM_DICTIONARY_TITLE,
    getConsumerE2eFixtures,
} from './helpers/consumer-e2e-fixtures';

const databasePaths: string[] = [];
const clients: YomitanClient[] = [];

afterEach(async () => {
    while (clients.length > 0) {
        await clients.pop()?.dispose();
    }
    while (databasePaths.length > 0) {
        const databasePath = databasePaths.pop() as string;
        await Promise.all([
            rm(databasePath, { force: true }),
            rm(`${databasePath}-wal`, { force: true }),
            rm(`${databasePath}-shm`, { force: true }),
        ]);
    }
});

describe('YomitanClient v2', () => {
    it('scans lyric text and returns serializable UTF-16 source ranges', async () => {
        const client = await createPopulatedClient();
        const dictionaries = [{ id: TERM_DICTIONARY_TITLE, index: 0 }];
        const text = '🙂食べた、食べたe\u0301';

        const tokens = await client.lookup.scanLine({
            text,
            language: 'ja',
            dictionaries,
            options: { scanLength: 10 },
        });

        expect(
            tokens.map(({ text: tokenText, range, selectable }) => ({ text: tokenText, range, selectable })),
        ).toEqual([
            { text: '🙂', range: { startUtf16: 0, endUtf16: 2 }, selectable: false },
            { text: '食べた', range: { startUtf16: 2, endUtf16: 5 }, selectable: true },
            { text: '、', range: { startUtf16: 5, endUtf16: 6 }, selectable: false },
            { text: '食べた', range: { startUtf16: 6, endUtf16: 9 }, selectable: true },
            { text: 'e\u0301', range: { startUtf16: 9, endUtf16: 11 }, selectable: false },
        ]);
        expect(tokens[1].headwords.some((headword) => headword.term === '食べる')).toBe(true);
        expect(() => JSON.stringify(tokens)).not.toThrow();
    });

    it('looks up the term beginning at an exact UTF-16 offset', async () => {
        const client = await createPopulatedClient();
        const request = {
            text: '🙂食べた、食べた',
            language: 'ja',
            dictionaries: [{ id: TERM_DICTIONARY_TITLE, index: 0 }],
        };

        const result = await client.lookup.termAt({ ...request, utf16Offset: 2 });

        expect(result?.range).toEqual({ startUtf16: 2, endUtf16: 5 });
        expect(result?.entries[0].headwords.some((headword) => headword.term === '食べる')).toBe(true);
        await expect(client.lookup.termAt({ ...request, utf16Offset: 1 })).resolves.toBeNull();
        await expect(client.lookup.termAt({ ...request, utf16Offset: request.text.length + 1 })).resolves.toBeNull();
    });

    it('cancels an import without exposing a partial dictionary', async () => {
        const client = await createClient();
        const { chunkedImport } = await getConsumerE2eFixtures();
        const controller = new AbortController();

        await expect(
            client.dictionaries.import({
                source: chunkedImport,
                signal: controller.signal,
                onProgress: (progress) => {
                    if (progress.index > 0) {
                        controller.abort();
                    }
                },
            }),
        ).rejects.toThrow();

        await expect(client.dictionaries.list()).resolves.toEqual([]);
    });

    it('exposes serializable dictionary, term, kanji, frequency, and removal operations', async () => {
        const client = await createPopulatedClient();
        const { consumerKanji, consumerMeta } = await getConsumerE2eFixtures();
        await client.dictionaries.import({ source: consumerMeta });
        await client.dictionaries.import({ source: consumerKanji });

        const dictionaries = await client.dictionaries.list();
        expect(dictionaries.map(({ id }) => id)).toContain(TERM_DICTIONARY_TITLE);
        const duplicate = await client.dictionaries.import({ source: (await getConsumerE2eFixtures()).consumerTerms });
        expect(duplicate.result).toBeNull();
        expect(duplicate.errors[0].message).toContain('already imported');

        const termResult = await client.lookup.terms({
            text: '食べた',
            language: 'ja',
            dictionaries: [{ id: TERM_DICTIONARY_TITLE, index: 0 }],
        });
        expect(termResult.entries[0].headwords[0].term).toBe('食べる');

        const frequency = await client.lookup.frequency({
            term: '食べる',
            reading: 'たべる',
            dictionaries: [{ id: META_DICTIONARY_TITLE, index: 0 }],
        });
        expect(frequency.frequencies[0].frequency).toBe(42);

        const kanji = await client.lookup.kanji({
            text: '食',
            dictionaries: [{ id: KANJI_DICTIONARY_TITLE, index: 0 }],
        });
        expect(kanji[0].character).toBe('食');

        await expect(client.dictionaries.checkUpdates([TERM_DICTIONARY_TITLE])).resolves.toEqual([]);
        await client.dictionaries.remove(TERM_DICTIONARY_TITLE);
        expect((await client.dictionaries.list()).map(({ id }) => id)).not.toContain(TERM_DICTIONARY_TITLE);
    });
});

async function createPopulatedClient(): Promise<YomitanClient> {
    const client = await createClient();
    const { consumerTerms } = await getConsumerE2eFixtures();
    const imported = await client.dictionaries.import({ source: consumerTerms });
    expect(imported.errors).toEqual([]);
    return client;
}

async function createClient(): Promise<YomitanClient> {
    const databasePath = join(tmpdir(), `yomitan-v2-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    databasePaths.push(databasePath);
    const client = createYomitan({ storage: createNodeSqliteDictionaryDB({ path: databasePath }) });
    clients.push(client);
    await client.initialize();
    return client;
}
