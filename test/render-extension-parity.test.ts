import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import type { Summary } from '../src/types/dictionary-importer';
import type { Tag, TermDictionaryEntry } from '../src/types/dictionary';
import {
    DISPLAY_CSS,
    DISPLAY_TEMPLATES,
    DisplayGenerator,
    NoOpContentManager,
    applyExtensionDisplayDefaults,
} from '../src/render';

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

function createDictionaryInfo(styles: string): Summary[] {
    return [
        {
            title: 'Jitendex',
            revision: '1',
            sequenced: false,
            version: 3,
            importDate: Date.now(),
            prefixWildcardsSupported: false,
            styles,
        },
    ];
}

describe('render extension parity contracts', () => {
    it('DISPLAY_CSS includes base + structured-content + pronunciation selectors', () => {
        expect(DISPLAY_CSS).toContain('.definition-list');
        expect(DISPLAY_CSS).toContain('.tag[data-category=partOfSpeech]');
        expect(DISPLAY_CSS).toContain('.gloss-sc-ul');
        expect(DISPLAY_CSS).toContain('.gloss-image-link');
        expect(DISPLAY_CSS).toContain('.pronunciation-mora');
        expect(DISPLAY_CSS).toContain('.pronunciation-graph');
    });

    it('applyExtensionDisplayDefaults sets extension-equivalent root dataset values', () => {
        const { window } = new JSDOM('<!doctype html><html><body></body></html>');
        applyExtensionDisplayDefaults(window.document.documentElement);

        const data = window.document.documentElement.dataset;
        expect(data.resultOutputMode).toBe('group');
        expect(data.glossaryLayoutMode).toBe('default');
        expect(data.frequencyDisplayMode).toBe('split-tags-grouped');
        expect(data.termDisplayMode).toBe('ruby');
        expect(data.averageFrequency).toBe('false');
        expect(data.enableSearchTags).toBe('false');
        expect(data.popupActionBarLocation).toBe('top');
    });

    it('injects dictionary-scoped styles for dictionaries used in rendered definitions', () => {
        const { window } = new JSDOM('<!doctype html><html><body></body></html>');
        const generator = new DisplayGenerator(
            window.document,
            new NoOpContentManager(),
            DISPLAY_TEMPLATES,
        );

        const node = generator.createTermEntry(
            createTermEntry(),
            createDictionaryInfo('.gloss-item{background:#eee}.tag{border:1px solid #666}'),
        );

        const styleNode = node.querySelector('style.dictionary-entry-styles');
        expect(styleNode).not.toBeNull();
        expect(styleNode?.textContent ?? '').toContain('[data-dictionary="Jitendex"] {');
        expect(styleNode?.textContent ?? '').toContain('.gloss-item{background:#eee}');
    });

    it('does not inject dictionary style node when dictionary styles are empty', () => {
        const { window } = new JSDOM('<!doctype html><html><body></body></html>');
        const generator = new DisplayGenerator(
            window.document,
            new NoOpContentManager(),
            DISPLAY_TEMPLATES,
        );

        const node = generator.createTermEntry(createTermEntry(), createDictionaryInfo(''));
        expect(node.querySelector('style.dictionary-entry-styles')).toBeNull();
    });

    it('hides average frequency unless data-average-frequency=true', () => {
        expect(DISPLAY_CSS).toContain(":root:not([data-average-frequency=true]) .frequency-group-item[data-details='Average']");
    });
});

