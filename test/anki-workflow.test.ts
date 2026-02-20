import { describe, expect, it } from 'vitest';

import {
    AnkiConnect,
    buildAnkiNoteFromDictionaryEntry,
    getDefaultAnkiFieldTemplates,
    getDynamicFieldMarkers,
    getDynamicTemplates,
    getStandardFieldMarkers,
} from '../src/anki';
import type { Tag, TermDictionaryEntry } from '../src/types/dictionary';
import type { Summary } from '../src/types/dictionary-importer';

function createTag(name: string, category = 'partOfSpeech'): Tag {
    return {
        name,
        category,
        order: 0,
        score: 0,
        content: [name],
        dictionaries: ['Jitendex'],
        redundant: false,
    };
}

function createTermEntry(): TermDictionaryEntry {
    return {
        type: 'term',
        isPrimary: true,
        textProcessorRuleChainCandidates: [],
        inflectionRuleChainCandidates: [],
        score: 0,
        frequencyOrder: 0,
        dictionaryIndex: 0,
        dictionaryAlias: 'Jitendex',
        sourceTermExactMatchCount: 1,
        matchPrimaryReading: false,
        maxOriginalTextLength: 3,
        headwords: [
            {
                index: 0,
                term: '会わせる',
                reading: 'あわせる',
                sources: [
                    {
                        originalText: '会わせる',
                        transformedText: '会わせる',
                        deinflectedText: '会わせる',
                        matchType: 'exact',
                        matchSource: 'term',
                        isPrimary: true,
                    },
                ],
                tags: [createTag('1-dan')],
                wordClasses: [],
            },
        ],
        definitions: [
            {
                index: 0,
                headwordIndices: [0],
                dictionary: 'Jitendex',
                dictionaryIndex: 0,
                dictionaryAlias: 'Jitendex',
                id: 1,
                score: 0,
                frequencyOrder: 0,
                sequences: [1],
                isPrimary: true,
                tags: [createTag('intransitive')],
                entries: ['to make (someone) meet'],
            },
        ],
        pronunciations: [],
        frequencies: [],
    };
}

function createStructuredTermEntry(): TermDictionaryEntry {
    const entry = createTermEntry();
    entry.definitions[0].entries = [
        {
            type: 'structured-content',
            content: [
                {
                    tag: 'div',
                    content: [
                        'to transform',
                        { tag: 'br' },
                        {
                            tag: 'ruby',
                            content: ['異形', { tag: 'rt', content: 'いぎょう' }],
                        },
                    ],
                },
            ],
        },
    ];
    return entry;
}

describe('anki integration helpers', () => {
    it('exposes standard term markers', () => {
        const markers = getStandardFieldMarkers('term', 'ja');
        expect(markers).toContain('expression');
        expect(markers).toContain('reading');
        expect(markers).toContain('glossary');
    });

    it('computes dynamic marker names from dictionaries', () => {
        const dictionaries = [
            { name: 'JPDB v2', enabled: true },
            { name: 'Disabled Dict', enabled: false },
        ];

        const dictionaryInfo: Summary[] = [
            {
                title: 'JPDB v2',
                revision: '1',
                sequenced: true,
                version: 3,
                importDate: Date.now(),
                prefixWildcardsSupported: false,
                styles: '',
                counts: {
                    terms: { total: 1 },
                    termMeta: { freq: 2 },
                    kanji: { total: 0 },
                    kanjiMeta: {},
                    tagMeta: { total: 0 },
                    media: { total: 0 },
                },
            },
        ];

        const markers = getDynamicFieldMarkers(dictionaries, dictionaryInfo);
        expect(markers).toContain('single-glossary-jpdb-v2');
        expect(markers).toContain('single-frequency-number-jpdb-v2');
    });

    it('builds an anki note from dictionary entry and marker mappings', async () => {
        const result = await buildAnkiNoteFromDictionaryEntry({
            dictionaryEntry: createTermEntry(),
            cardFormat: {
                deck: 'Default',
                model: 'Basic',
                fields: {
                    Front: { value: '{expression}' },
                    Back: { value: '{reading}' },
                },
            },
            context: {
                url: 'https://reader.local',
                query: '会わせる',
                fullQuery: '会わせる',
                documentTitle: 'Reader',
            },
        });

        expect(result.note.deckName).toBe('Default');
        expect(result.note.modelName).toBe('Basic');
        expect(result.note.fields.Front).toBe('会わせる');
        expect(result.note.fields.Back).toBe('あわせる');
        expect(result.errors).toHaveLength(0);
    });

    it('renders structured-content glossary entries as readable text', async () => {
        const result = await buildAnkiNoteFromDictionaryEntry({
            dictionaryEntry: createStructuredTermEntry(),
            cardFormat: {
                deck: 'Default',
                model: 'Basic',
                fields: {
                    Front: { value: '{glossary}' },
                },
            },
            context: {
                url: 'https://reader.local',
                query: '異形',
                fullQuery: '異形',
                documentTitle: 'Reader',
            },
        });

        expect(result.note.fields.Front).toContain('to transform');
        expect(result.note.fields.Front).toContain('異形');
        expect(result.note.fields.Front).not.toContain('[structured content]');
    });

    it('adds separators for structured-content list-style output', async () => {
        const entry = createTermEntry();
        entry.definitions[0].entries = [
            {
                type: 'structured-content',
                content: [
                    {
                        tag: 'ul',
                        content: [
                            { tag: 'li', content: ['no-adj'] },
                            { tag: 'li', content: ['na-adj'] },
                            { tag: 'li', content: ['fantastic'] },
                        ],
                    },
                ],
            },
        ];

        const result = await buildAnkiNoteFromDictionaryEntry({
            dictionaryEntry: entry,
            cardFormat: {
                deck: 'Default',
                model: 'Basic',
                fields: {
                    Front: { value: '{glossary}' },
                },
            },
            context: {
                url: 'https://reader.local',
                query: '異形',
                fullQuery: '異形',
                documentTitle: 'Reader',
            },
        });

        expect(result.note.fields.Front).toContain('no-adj');
        expect(result.note.fields.Front).toContain('na-adj');
        expect(result.note.fields.Front).toContain('fantastic');
        expect(result.note.fields.Front).not.toContain('no-adjna-adj');
    });

    it('reports template errors for unknown markers', async () => {
        const result = await buildAnkiNoteFromDictionaryEntry({
            dictionaryEntry: createTermEntry(),
            cardFormat: {
                deck: 'Default',
                model: 'Basic',
                fields: {
                    Front: { value: '{does-not-exist}' },
                },
            },
            context: {
                url: 'https://reader.local',
                query: '会わせる',
                fullQuery: '会わせる',
                documentTitle: 'Reader',
            },
        });

        expect(result.note.fields.Front).toContain('{does-not-exist-render-error}');
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns default templates payload', () => {
        const template = getDefaultAnkiFieldTemplates();
        expect(template).toContain('{{~> (lookup . "marker") ~}}');
    });

    it('injects dynamic dictionary templates before marker dispatch', () => {
        const dictionaries = [{ name: 'Jitendex.org [2026-02-05]', enabled: true }];
        const dictionaryInfo: Summary[] = [
            {
                title: 'Jitendex.org [2026-02-05]',
                revision: '1',
                sequenced: true,
                version: 3,
                importDate: Date.now(),
                prefixWildcardsSupported: false,
                styles: '',
                counts: {
                    terms: { total: 1 },
                    termMeta: { freq: 2 },
                    kanji: { total: 0 },
                    kanjiMeta: {},
                    tagMeta: { total: 0 },
                    media: { total: 0 },
                },
            },
        ];

        const dynamic = getDynamicTemplates(dictionaries, dictionaryInfo);
        const template = getDefaultAnkiFieldTemplates(dynamic);

        expect(template).toContain('single-glossary-jitendexorg-2026-02-05');
        expect(template).toContain("selectedDictionary='Jitendex.org [2026-02-05]'");
        expect(template).toContain('{{~> (lookup . "marker") ~}}');
    });

    it('normalizes anki action wrapper responses', async () => {
        const anki = new AnkiConnect({ server: 'http://127.0.0.1:8765' });
        anki.enabled = true;

        const ankiInternals = anki as unknown as {
            _checkVersion: () => Promise<void>;
            _invoke: (action: string, params: Record<string, unknown>) => Promise<unknown>;
        };

        ankiInternals._checkVersion = async () => {};
        ankiInternals._invoke = async (action: string) => {
            if (action === 'deckNames') {
                return ['Default'];
            }
            if (action === 'modelNames') {
                return ['Basic'];
            }
            if (action === 'modelFieldNames') {
                return ['Front', 'Back'];
            }
            return null;
        };

        await expect(anki.getDeckNames()).resolves.toEqual(['Default']);
        await expect(anki.getModelNames()).resolves.toEqual(['Basic']);
        await expect(anki.getModelFieldNames('Basic')).resolves.toEqual(['Front', 'Back']);
    });
});
