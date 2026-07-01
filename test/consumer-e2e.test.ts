import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import {
    buildAnkiNoteFromDictionaryEntry,
    getDefaultAnkiFieldTemplates,
    getDynamicFieldMarkers,
    getDynamicTemplates,
    getStandardFieldMarkers,
} from '../src/anki';
import type { DictionaryDatabaseBackend } from '../src/database';
import { createNodeSqliteDictionaryDB } from '../src/database/node-sqlite';
import YomitanCore from '../src/index';
import { createKanjiEntryRenderer, createTermEntryRenderer } from '../src/render';
import type { Summary } from '../src/types/dictionary-importer';
import {
    ALT_KANJI_DICTIONARY_TITLE,
    KANJI_DICTIONARY_TITLE,
    META_DICTIONARY_TITLE,
    STYLED_TERM_DICTIONARY_TITLE,
    TERM_DICTIONARY_TITLE,
    getConsumerE2eFixtures,
} from './helpers/consumer-e2e-fixtures';

type EnabledTermDictionary = {
    index: number;
    priority: number;
    alias: string;
    allowSecondarySearches: boolean;
    partsOfSpeechFilter: boolean;
    useDeinflections: boolean;
};

type EnabledKanjiDictionary = {
    index: number;
    alias: string;
};

type StorageBackend = {
    name: string;
    createDbName(name: string): string;
    createStorageAdapter?(dbName: string): DictionaryDatabaseBackend;
    cleanup?(dbName: string): Promise<void>;
};

const storageBackends: StorageBackend[] = [
    {
        name: 'indexeddb',
        createDbName,
    },
    {
        name: 'sqlite',
        createDbName: (name) => join(tmpdir(), `${createDbName(name)}.sqlite`),
        createStorageAdapter: (dbName) => createNodeSqliteDictionaryDB({ path: dbName }),
        cleanup: async (dbName) => {
            // WAL mode can leave sidecar files behind after close; clean them so backend parametrization
            // does not leak state between test cases.
            await Promise.all([
                rm(dbName, { force: true }),
                rm(`${dbName}-wal`, { force: true }),
                rm(`${dbName}-shm`, { force: true }),
            ]);
        },
    },
];

const activeCores: { core: YomitanCore; storageBackend: StorageBackend; dbName: string }[] = [];

afterEach(async () => {
    while (activeCores.length > 0) {
        const { core, storageBackend, dbName } = activeCores.pop() as {
            core: YomitanCore;
            storageBackend: StorageBackend;
            dbName: string;
        };
        try {
            if (core.isReady) {
                await core.database.purge();
            }
        } catch {
            // Ignore cleanup failures in tests.
        }
        try {
            await core.dispose();
        } catch {
            // Ignore cleanup failures in tests.
        }
        try {
            await storageBackend.cleanup?.(dbName);
        } catch {
            // Ignore cleanup failures in tests.
        }
    }
});

describe.each(storageBackends)('consumer-driven e2e contracts ($name)', (storageBackend) => {
    it('imports multiple consumer-style dictionaries and builds consumer maps', async () => {
        const { consumerTerms, styledTerms, consumerMeta, consumerKanji, consumerKanjiAlt } =
            await getConsumerE2eFixtures();
        const core = await createCore(storageBackend, 'consumer-install');

        const firstImportProgress: { index: number; count: number; nextStep?: boolean }[] = [];
        await core.importDictionary(consumerTerms, {
            onProgress: (progress) => {
                firstImportProgress.push(progress);
            },
        });
        await core.importDictionary(styledTerms);
        await core.importDictionary(consumerMeta);
        await core.importDictionary(consumerKanji);
        await core.importDictionary(consumerKanjiAlt);

        const dictionaryInfo = await core.getDictionaryInfo();
        expect(dictionaryInfo).toHaveLength(5);

        const installedTitles = dictionaryInfo.map((item) => item.title).sort();
        expect(installedTitles).toEqual(
            [
                ALT_KANJI_DICTIONARY_TITLE,
                KANJI_DICTIONARY_TITLE,
                META_DICTIONARY_TITLE,
                STYLED_TERM_DICTIONARY_TITLE,
                TERM_DICTIONARY_TITLE,
            ].sort(),
        );

        const termDictionaryMap = buildTermDictionaryMap(dictionaryInfo);
        const kanjiDictionaryMap = buildKanjiDictionaryMap(dictionaryInfo);
        const dictionaryStylesMap = buildDictionaryStylesMap(dictionaryInfo);

        expect([...termDictionaryMap.keys()].sort()).toEqual(
            [META_DICTIONARY_TITLE, STYLED_TERM_DICTIONARY_TITLE, TERM_DICTIONARY_TITLE].sort(),
        );
        expect([...kanjiDictionaryMap.keys()].sort()).toEqual(
            [ALT_KANJI_DICTIONARY_TITLE, KANJI_DICTIONARY_TITLE].sort(),
        );
        expect(dictionaryStylesMap.get(TERM_DICTIONARY_TITLE)).toContain('.gloss-sc-div');
        expect(dictionaryStylesMap.get(STYLED_TERM_DICTIONARY_TITLE)).toContain('.gloss-item');

        const consumerTermsSummary = getSummary(dictionaryInfo, TERM_DICTIONARY_TITLE);
        expect(consumerTermsSummary.styles).toContain('.gloss-sc-div');
        expect(consumerTermsSummary.counts?.terms.total).toBe(3);
        expect(consumerTermsSummary.counts?.media.total).toBe(1);

        expect(firstImportProgress.length).toBeGreaterThan(0);
        expect(firstImportProgress.some((item) => item.nextStep)).toBe(true);
    });

    it('supports grouped and deinflected term lookup across multiple dictionaries', async () => {
        const core = await createPopulatedCore(storageBackend, 'consumer-grouped-lookup');
        const dictionaryInfo = await core.getDictionaryInfo();
        const termDictionaryMap = buildTermDictionaryMap(dictionaryInfo);

        const grouped = await core.findTerms('食べた', {
            mode: 'group',
            language: 'ja',
            enabledDictionaryMap: termDictionaryMap,
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });

        expect(grouped.originalTextLength).toBeGreaterThan(0);
        expect(grouped.entries.length).toBeGreaterThan(0);
        expect(grouped.entries[0].headwords.map((item) => item.term)).toContain('食べる');
        expect(grouped.entries[0].definitions.map((item) => item.dictionary).sort()).toEqual(
            [STYLED_TERM_DICTIONARY_TITLE, TERM_DICTIONARY_TITLE].sort(),
        );
        expect(grouped.entries[0].frequencies.some((item) => item.dictionary === META_DICTIONARY_TITLE)).toBe(true);
        expect(grouped.entries[0].frequencies.some((item) => item.frequency === 42)).toBe(true);
        expect(
            grouped.entries[0].pronunciations.some((item) =>
                item.pronunciations.some((pronunciation) => pronunciation.type === 'pitch-accent'),
            ),
        ).toBe(true);
        expect(
            grouped.entries[0].pronunciations.some((item) =>
                item.pronunciations.some((pronunciation) => pronunciation.type === 'phonetic-transcription'),
            ),
        ).toBe(true);

        const mixedText = await core.findTerms('食べる!', {
            mode: 'group',
            language: 'ja',
            enabledDictionaryMap: termDictionaryMap,
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });
        expect(mixedText.entries.length).toBeGreaterThan(0);
        expect(mixedText.originalTextLength).toBe('食べる'.length);
    });

    it('tokenizes text like mokuro-reader using parseText', async () => {
        const core = await createPopulatedCore(storageBackend, 'consumer-tokenize');
        const dictionaryInfo = await core.getDictionaryInfo();
        const termDictionaryMap = buildTermDictionaryMap(dictionaryInfo);

        const parsed = await core.parseText('食べた、猫', {
            language: 'ja',
            enabledDictionaryMap: termDictionaryMap,
            scanLength: 10,
            searchResolution: 'letter',
            removeNonJapaneseCharacters: false,
            deinflect: true,
            textReplacements: [null],
        });
        const tokens = parsed.flatMap((block) =>
            (block.content ?? []).flatMap((line) =>
                line
                    .filter((segment) => segment.text.trim().length > 0)
                    .map((segment) => ({
                        text: segment.text.trim(),
                        reading: segment.reading,
                        selectable: Array.isArray(segment.headwords) && segment.headwords.length > 0,
                    })),
            ),
        );

        expect(tokens).toEqual([
            { text: '食べた', reading: 'たべる', selectable: true },
            { text: '、', reading: '', selectable: false },
            { text: '猫', reading: 'ねこ', selectable: true },
        ]);
    });

    it('supports kanji lookup and metadata across installed dictionaries', async () => {
        const core = await createPopulatedCore(storageBackend, 'consumer-kanji');
        const dictionaryInfo = await core.getDictionaryInfo();
        const kanjiDictionaryMap = buildKanjiDictionaryMap(dictionaryInfo);

        const entries = await core.findKanji('食', {
            enabledDictionaryMap: kanjiDictionaryMap,
            removeNonJapaneseCharacters: true,
        });

        expect(entries.map((entry) => entry.dictionaryAlias).sort()).toEqual(
            [ALT_KANJI_DICTIONARY_TITLE, KANJI_DICTIONARY_TITLE].sort(),
        );

        const primaryEntry = entries.find((entry) => entry.dictionary === KANJI_DICTIONARY_TITLE);
        expect(primaryEntry).toBeTruthy();
        expect(primaryEntry?.definitions).toContain('eat');
        expect(primaryEntry?.stats.misc.map((item) => item.name).sort()).toEqual(['grade', 'strokes']);
        expect(primaryEntry?.frequencies[0]?.frequency).toBe(100);
    });

    it('builds lapis-style anki notes from term lookups and handles no-entry', async () => {
        const core = await createPopulatedCore(storageBackend, 'consumer-lapis-note');
        const dictionaryInfo = await core.getDictionaryInfo();
        const termDictionaryMap = buildTermDictionaryMap(dictionaryInfo);
        const dictionaryStylesMap = buildDictionaryStylesMap(dictionaryInfo);
        const dictionaries = buildEnabledDictionaries(dictionaryInfo);

        const result = await core.buildAnkiNoteFromTerm({
            term: '食べた',
            enabledDictionaryMap: termDictionaryMap,
            dictionaries,
            dictionaryInfo,
            resultOutputMode: 'group',
            dictionaryStylesMap,
            cardFormat: {
                deck: 'Lapis',
                model: 'Lapis+Lookup',
                fields: {
                    Expression: { value: '{expression}' },
                    ExpressionFurigana: { value: '{furigana-plain}' },
                    ExpressionReading: { value: '{reading}' },
                    ExpressionAudio: { value: '{audio}' },
                    Glossary: { value: '{glossary}' },
                    PitchPosition: { value: '{pitch-accent-positions}' },
                    Frequency: { value: '{frequencies}' },
                    FreqSort: { value: '{frequency-harmonic-rank}' },
                },
            },
            context: {
                url: '',
                query: '食べた',
                fullQuery: '食べた',
                documentTitle: 'Reader',
            },
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });

        expect(result.status).toBe('ok');
        if (result.status !== 'ok') {
            throw new Error('expected ok note result');
        }
        expect(result.fields.Expression).toBe('食べる');
        expect(result.fields.ExpressionFurigana).toContain('食');
        expect(result.fields.ExpressionReading).toBe('たべる');
        expect(result.fields.ExpressionAudio).toBeTypeOf('string');
        expect(result.fields.Glossary).toContain('to eat');
        expect(result.fields.Glossary).toContain('consume nourishment');
        expect(result.fields.PitchPosition).toBeTypeOf('string');
        expect(result.fields.Frequency).toContain('42');
        expect(result.fields.FreqSort).toMatch(/\d/);

        const noEntry = await core.buildAnkiNoteFromTerm({
            term: '不存在',
            enabledDictionaryMap: termDictionaryMap,
            dictionaries,
            dictionaryInfo,
            resultOutputMode: 'group',
            dictionaryStylesMap,
            cardFormat: {
                deck: 'Lapis',
                model: 'Lapis+Lookup',
                fields: {
                    Expression: { value: '{expression}' },
                },
            },
            context: {
                url: '',
                query: '不存在',
                fullQuery: '不存在',
                documentTitle: 'Reader',
            },
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });

        expect(noEntry).toEqual({ status: 'no-entry', errors: [] });
    });

    it('builds popup-style anki notes and dynamic templates from imported dictionaries', async () => {
        const core = await createPopulatedCore(storageBackend, 'consumer-popup-note');
        const dictionaryInfo = await core.getDictionaryInfo();
        const termDictionaryMap = buildTermDictionaryMap(dictionaryInfo);
        const dictionaryStylesMap = buildDictionaryStylesMap(dictionaryInfo);
        const dictionaries = buildEnabledDictionaries(dictionaryInfo);

        const markers = getStandardFieldMarkers('term', 'ja');
        expect(markers).toContain('furigana-plain');
        expect(markers).toContain('pitch-accent-positions');
        expect(markers).toContain('frequency-harmonic-rank');

        const dynamicMarkers = getDynamicFieldMarkers(dictionaries, dictionaryInfo);
        expect(dynamicMarkers).toContain('single-frequency-number-consumer-meta');

        const dynamicTemplates = getDynamicTemplates(dictionaries, dictionaryInfo);
        expect(dynamicTemplates).toContain('single-frequency-number-consumer-meta');

        const mediaLookup = await core.findTerms('見る', {
            mode: 'group',
            language: 'ja',
            enabledDictionaryMap: termDictionaryMap,
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });

        const mediaResult = await buildAnkiNoteFromDictionaryEntry({
            dictionaryEntry: mediaLookup.entries[0],
            cardFormat: {
                deck: 'Popup',
                model: 'Popup',
                fields: {
                    Glossary: { value: '{glossary}' },
                    DynamicFreq: { value: '{single-frequency-number-consumer-meta}' },
                },
            },
            context: {
                url: 'https://reader.local',
                query: '見る',
                fullQuery: '見る',
                documentTitle: 'Reader',
            },
            resultOutputMode: 'split',
            glossaryLayoutMode: 'default',
            compactTags: false,
            template: getDefaultAnkiFieldTemplates(dynamicTemplates),
            dictionaryStylesMap,
        });

        expect(mediaResult.note.fields.Glossary).toContain('to see');
        expect(mediaResult.note.fields.Glossary).toContain('images/sample.png');
        expect(mediaResult.note.fields.Glossary).toContain('sample title');
        expect(mediaResult.note.fields.Glossary).toContain('structured-content');
        expect(mediaResult.note.fields.Glossary).toContain('data-dictionary="Consumer Terms"');
        expect(mediaResult.note.fields.DynamicFreq).toBe('7');

        const pitchLookup = await core.findTerms('食べる', {
            mode: 'group',
            language: 'ja',
            enabledDictionaryMap: termDictionaryMap,
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });
        const pitchResult = await buildAnkiNoteFromDictionaryEntry({
            dictionaryEntry: pitchLookup.entries[0],
            cardFormat: {
                deck: 'Popup',
                model: 'Popup',
                fields: {
                    PitchPosition: { value: '{pitch-accent-positions}' },
                    DynamicFreq: { value: '{single-frequency-number-consumer-meta}' },
                },
            },
            context: {
                url: 'https://reader.local',
                query: '食べる',
                fullQuery: '食べる',
                documentTitle: 'Reader',
            },
            resultOutputMode: 'split',
            glossaryLayoutMode: 'default',
            compactTags: false,
            template: getDefaultAnkiFieldTemplates(dynamicTemplates),
            dictionaryStylesMap,
        });
        expect(pitchResult.note.fields.PitchPosition).toBeTypeOf('string');
        expect(pitchResult.note.fields.DynamicFreq).toBe('42');
    });

    it('renders imported entries with styles, media, and stable kanji payloads', async () => {
        const core = await createPopulatedCore(storageBackend, 'consumer-render');
        const dictionaryInfo = await core.getDictionaryInfo();
        const termDictionaryMap = buildTermDictionaryMap(dictionaryInfo);
        const kanjiDictionaryMap = buildKanjiDictionaryMap(dictionaryInfo);

        const groupedTerms = await core.findTerms('食べる', {
            mode: 'group',
            language: 'ja',
            enabledDictionaryMap: termDictionaryMap,
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });
        const mediaTerms = await core.findTerms('見る', {
            mode: 'group',
            language: 'ja',
            enabledDictionaryMap: termDictionaryMap,
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });
        const kanjiEntries = await core.findKanji('食', {
            enabledDictionaryMap: kanjiDictionaryMap,
            removeNonJapaneseCharacters: true,
        });

        const { window } = new JSDOM(
            '<!doctype html><html><head></head><body><div id="term"></div><div id="kanji"></div></body></html>',
            {
                url: 'https://example.com',
            },
        );
        const termHost = window.document.getElementById('term') as HTMLDivElement;
        const kanjiHost = window.document.getElementById('kanji') as HTMLDivElement;

        const termRenderer = createTermEntryRenderer({ document: window.document });
        termRenderer.prepareHost(termHost, { theme: 'dark', language: 'ja', resultOutputMode: 'group' });
        const renderedTermEntries = termRenderer.renderTermEntries(groupedTerms.entries, dictionaryInfo, {
            theme: 'dark',
            language: 'ja',
            resultOutputMode: 'group',
        });
        expect(renderedTermEntries).toHaveLength(1);
        const termStyle = renderedTermEntries[0].entryNode.querySelector('style.dictionary-entry-styles');
        expect(termStyle?.textContent ?? '').toContain(TERM_DICTIONARY_TITLE);
        expect(termStyle?.textContent ?? '').toContain(STYLED_TERM_DICTIONARY_TITLE);
        expect(
            [...renderedTermEntries[0].entryNode.querySelectorAll('.headword-kanji-link')].map(
                (node) => (node as HTMLElement).dataset.character,
            ),
        ).toEqual(['食']);

        const renderedMediaEntries = termRenderer.renderTermEntries(mediaTerms.entries, dictionaryInfo, {
            theme: 'dark',
            language: 'ja',
            resultOutputMode: 'group',
        });
        expect(renderedMediaEntries[0].entryNode.outerHTML).toContain('sample description');
        expect(renderedMediaEntries[0].entryNode.outerHTML).toContain('images/sample.png');

        const kanjiRenderer = createKanjiEntryRenderer({ document: window.document });
        kanjiRenderer.prepareHost(kanjiHost, { theme: 'dark', language: 'ja' });
        const renderedKanjiEntries = kanjiRenderer.renderKanjiEntries(kanjiEntries, dictionaryInfo, {
            theme: 'dark',
            language: 'ja',
        });
        expect(renderedKanjiEntries.length).toBeGreaterThan(0);
        expect(renderedKanjiEntries[0].entryNode.outerHTML).toContain('eat');
    });

    it('deletes one dictionary without breaking remaining lookups and supports reopen', async () => {
        const dbName = storageBackend.createDbName('consumer-reopen');
        const core = await createPopulatedCore(storageBackend, dbName, dbName);
        const dictionaryInfo = await core.getDictionaryInfo();
        const termDictionaryMap = buildTermDictionaryMap(dictionaryInfo);

        await core.deleteDictionary(STYLED_TERM_DICTIONARY_TITLE);

        const remaining = await core.getDictionaryInfo();
        expect(remaining.map((item) => item.title)).not.toContain(STYLED_TERM_DICTIONARY_TITLE);

        const afterDelete = await core.findTerms('食べる', {
            mode: 'group',
            language: 'ja',
            enabledDictionaryMap: buildTermDictionaryMap(remaining),
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });
        expect(afterDelete.entries[0].definitions.map((item) => item.dictionary)).toEqual([TERM_DICTIONARY_TITLE]);

        await core.dispose();

        const reopened = await createCore(storageBackend, dbName, dbName);
        const reopenedInfo = await reopened.getDictionaryInfo();
        expect(reopenedInfo.map((item) => item.title)).not.toContain(STYLED_TERM_DICTIONARY_TITLE);
        const reopenedLookup = await reopened.findTerms('猫', {
            mode: 'group',
            language: 'ja',
            enabledDictionaryMap: buildTermDictionaryMap(reopenedInfo),
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });
        expect(reopenedLookup.entries[0].headwords[0].term).toBe('猫');

        const initialLookup = await reopened.findTerms('食べる', {
            mode: 'group',
            language: 'ja',
            enabledDictionaryMap: termDictionaryMap,
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });
        expect(initialLookup.entries.length).toBeGreaterThan(0);
    });

    it('exercises importer chunking and reports failed imports honestly', async () => {
        const { chunkedImport, partialFailure, missingIndex } = await getConsumerE2eFixtures();
        const chunkedCore = await createCore(storageBackend, 'consumer-chunked');

        const chunkedResult = await chunkedCore.importDictionary(chunkedImport);
        expect(chunkedResult.errors).toHaveLength(0);
        expect(chunkedResult.result?.counts?.terms.total).toBe(1001);

        const chunkedInfo = await chunkedCore.getDictionaryInfo();
        const chunkedLookup = await chunkedCore.findTerms('単語1000', {
            mode: 'group',
            language: 'ja',
            enabledDictionaryMap: buildTermDictionaryMap(chunkedInfo),
            options: {
                matchType: 'exact',
                deinflect: true,
                removeNonJapaneseCharacters: false,
                searchResolution: 'letter',
            },
        });
        expect(chunkedLookup.entries[0].headwords[0].term).toBe('単語1000');

        const brokenCore = await createCore(storageBackend, 'consumer-broken');
        const brokenResult = await brokenCore.importDictionary(partialFailure);
        expect(brokenResult.errors.length).toBeGreaterThan(0);
        expect(brokenResult.result?.importSuccess).toBe(false);
        const brokenInfo = await brokenCore.getDictionaryInfo();
        expect(brokenInfo[0].importSuccess).toBe(false);

        const missingIndexCore = await createCore(storageBackend, 'consumer-missing-index');
        await expect(missingIndexCore.importDictionary(missingIndex)).rejects.toThrow('No dictionary index found');
    });
});

function createDbName(name: string): string {
    return `consumer-e2e-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createCore(
    storageBackend: StorageBackend,
    name: string,
    dbName = storageBackend.createDbName(name),
): Promise<YomitanCore> {
    const core = new YomitanCore({
        databaseName: dbName,
        storageAdapter: storageBackend.createStorageAdapter?.(dbName),
    });
    activeCores.push({ core, storageBackend, dbName });
    await core.initialize();
    return core;
}

async function createPopulatedCore(
    storageBackend: StorageBackend,
    name: string,
    dbName?: string,
): Promise<YomitanCore> {
    const { consumerTerms, styledTerms, consumerMeta, consumerKanji, consumerKanjiAlt } =
        await getConsumerE2eFixtures();
    const core = await createCore(storageBackend, name, dbName);
    await core.importDictionary(consumerTerms);
    await core.importDictionary(styledTerms);
    await core.importDictionary(consumerMeta);
    await core.importDictionary(consumerKanji);
    await core.importDictionary(consumerKanjiAlt);
    return core;
}

function buildTermDictionaryMap(dictionaryInfo: Summary[]): Map<string, EnabledTermDictionary> {
    const map = new Map<string, EnabledTermDictionary>();

    dictionaryInfo.forEach((dictionary, index) => {
        const termCount = dictionary.counts?.terms?.total ?? 0;
        const termMetaCount = Object.values(dictionary.counts?.termMeta ?? {}).reduce(
            (total, value) => total + value,
            0,
        );
        if (termCount === 0 && termMetaCount === 0) {
            return;
        }

        map.set(dictionary.title, {
            index,
            priority: 0,
            alias: dictionary.title,
            allowSecondarySearches: true,
            partsOfSpeechFilter: false,
            useDeinflections: true,
        });
    });

    return map;
}

function buildKanjiDictionaryMap(dictionaryInfo: Summary[]): Map<string, EnabledKanjiDictionary> {
    const map = new Map<string, EnabledKanjiDictionary>();
    let index = 0;
    for (const dictionary of dictionaryInfo) {
        if ((dictionary.counts?.kanji?.total ?? 0) <= 0) {
            continue;
        }
        map.set(dictionary.title, {
            index,
            alias: dictionary.title,
        });
        index += 1;
    }
    return map;
}

function buildDictionaryStylesMap(dictionaryInfo: Summary[]): Map<string, string> {
    return new Map(dictionaryInfo.map((dictionary) => [dictionary.title, dictionary.styles ?? '']));
}

function buildEnabledDictionaries(dictionaryInfo: Summary[]): { name: string; enabled: boolean }[] {
    return dictionaryInfo.map((dictionary) => ({ name: dictionary.title, enabled: true }));
}

function getSummary(dictionaryInfo: Summary[], title: string): Summary {
    const summary = dictionaryInfo.find((item) => item.title === title);
    if (!summary) {
        throw new Error(`Missing summary for ${title}`);
    }
    return summary;
}
