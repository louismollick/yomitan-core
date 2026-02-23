import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { DISPLAY_TEMPLATES, DisplayGenerator, NoOpContentManager, createTermEntryRenderer } from '../src/render';
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

function createDictionaryInfo(styles = ''): Summary[] {
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

describe('createTermEntryRenderer', () => {
    it('prepares host and injects styles only once per document', () => {
        const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="host"></div></body></html>', {
            url: 'https://example.com',
        });
        const host = window.document.getElementById('host') as HTMLDivElement;

        const renderer1 = createTermEntryRenderer({ document: window.document });
        renderer1.prepareHost(host);

        const renderer2 = createTermEntryRenderer({ document: window.document });
        renderer2.prepareHost(host);

        const styleNodes = window.document.querySelectorAll('style[data-yomitan-popup-style=true]');
        expect(styleNodes.length).toBe(1);
        expect(styleNodes[0].textContent).toContain('.yomitan-popup-root');
    });

    it('applies host defaults and theme data attributes in light DOM mode', () => {
        const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="host"></div></body></html>', {
            url: 'https://example.com',
        });
        const host = window.document.getElementById('host') as HTMLDivElement;

        const renderer = createTermEntryRenderer({
            document: window.document,
            theme: 'dark',
            language: 'ja',
            glossaryLayoutMode: 'default',
            resultOutputMode: 'group',
        });
        renderer.prepareHost(host);
        renderer.renderTermEntries([createTermEntry()], createDictionaryInfo());

        expect(host.classList.contains('yomitan-popup-root')).toBe(true);
        expect(host.dataset.theme).toBe('dark');
        expect(host.dataset.themeRaw).toBe('dark');
        expect(host.dataset.language).toBe('ja');
        expect(host.dataset.glossaryLayoutMode).toBe('default');
        expect(host.dataset.resultOutputMode).toBe('group');
    });

    it('returns entry nodes only and does not render slot/action wrappers', () => {
        const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="host"></div></body></html>', {
            url: 'https://example.com',
        });
        const host = window.document.getElementById('host') as HTMLDivElement;

        const renderer = createTermEntryRenderer({ document: window.document });
        renderer.prepareHost(host);
        const renderedEntries = renderer.renderTermEntries([createTermEntry()], createDictionaryInfo());

        expect(renderedEntries).toHaveLength(1);
        expect(renderedEntries[0].entryNode).toBeInstanceOf(window.HTMLElement);
        expect(host.querySelector('.yomitan-popup-actions')).toBeNull();
        expect(host.querySelector('.yomitan-popup-row')).toBeNull();
    });

    it('updates host defaults without duplicating style nodes', () => {
        const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="host"></div></body></html>', {
            url: 'https://example.com',
        });
        const host = window.document.getElementById('host') as HTMLDivElement;

        const renderer = createTermEntryRenderer({ document: window.document });
        renderer.prepareHost(host, { theme: 'dark' });
        renderer.updateHost(host, { theme: 'light', language: 'ja' });
        renderer.renderTermEntries([createTermEntry(), createTermEntry()], createDictionaryInfo());

        const styleNodes = window.document.querySelectorAll('style[data-yomitan-popup-style=true]');
        expect(styleNodes.length).toBe(1);
        expect(host.dataset.theme).toBe('light');
        expect(host.dataset.language).toBe('ja');
    });

    it('uses upstream display css and keeps term entry parity with DisplayGenerator', () => {
        const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="host"></div></body></html>', {
            url: 'https://example.com',
        });
        const host = window.document.getElementById('host') as HTMLDivElement;

        const entry = createTermEntry();
        const dictionaryInfo = createDictionaryInfo('.gloss-item{background:#eee}');

        const renderer = createTermEntryRenderer({ document: window.document });
        renderer.prepareHost(host);
        const renderedEntries = renderer.renderTermEntries([entry], dictionaryInfo);

        const styleNodes = window.document.querySelectorAll('style[data-yomitan-popup-style=true]');
        expect(styleNodes).toHaveLength(1);
        const styleText = styleNodes[0].textContent ?? '';
        expect(styleText).toContain('.yomitan-popup-root');
        expect(styleText).not.toContain('.yomitan-popup-actions');
        expect(styleText).not.toContain('.yomitan-popup-row');

        const directGenerator = new DisplayGenerator(window.document, new NoOpContentManager(), DISPLAY_TEMPLATES);
        const directNode = directGenerator.createTermEntry(createTermEntry(), dictionaryInfo);

        expect(renderedEntries).toHaveLength(1);
        expect(renderedEntries[0].entryNode.outerHTML).toBe(directNode.outerHTML);
    });
});
