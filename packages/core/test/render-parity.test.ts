/*
 * Presentation parity: Yomitan's DisplayGenerator renders every translator fixture entry identically
 * on the string DOM (used outside browsers) and on jsdom (a spec-compliant DOM).
 */

import { JSDOM } from 'jsdom';
import { describe, expect, test } from 'vitest';
import { createDictionaryArchive, readUpstreamJson } from '../../contract-tests/src/index';
import { importFixture } from '../../contract-tests/src/storage-contract';
import { createFindKanjiOptions, createFindTermsOptions } from '../../contract-tests/src/translator-options';
import type { StringElement } from '../src/dom/string-dom';
import { EntryRenderer, createStringDomEnvironment } from '../src/render/entry-renderer';
import { createMemoryStorage } from '../src/storage/memory-storage';
import { Translator } from '../src/upstream/ext/js/language/translator.js';

const DICTIONARY = 'Test Dictionary 2';

async function renderAll() {
    const storage = createMemoryStorage();
    await storage.prepare();
    await importFixture(storage, await createDictionaryArchive('valid-dictionary1', { title: DICTIONARY }));
    const dictionaryInfo = await storage.getDictionaryInfo();
    const translator = new Translator(storage);
    translator.prepare();
    const { optionsPresets, tests } = readUpstreamJson<any>('translator-test-inputs.json');

    const window = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>').window;
    const jsdomRenderer = await EntryRenderer.create<Element>({
        document: window.document,
        window,
        Node: window.Node,
        DocumentFragment: window.DocumentFragment,
        DOMParser: window.DOMParser,
        NodeFilter: window.NodeFilter,
    });
    const stringRenderer = await EntryRenderer.create<StringElement>(createStringDomEnvironment());

    const pairs: { name: string; expected: string; actual: string }[] = [];
    for (const data of tests) {
        const entries =
            data.func === 'findTerms'
                ? (await translator.findTerms(data.mode, data.text, createFindTermsOptions(DICTIONARY, optionsPresets, data.options))).dictionaryEntries
                : await translator.findKanji(data.text, createFindKanjiOptions(DICTIONARY, optionsPresets, data.options));
        for (const [i, entry] of entries.entries()) {
            pairs.push({
                name: `${data.name} #${i}`,
                expected: jsdomRenderer.render(entry, dictionaryInfo).outerHTML,
                actual: stringRenderer.render(entry, dictionaryInfo).outerHTML,
            });
        }
    }
    return pairs;
}

describe('presentation parity', async () => {
    const pairs = await renderAll();
    test('renders a meaningful number of entries', () => {
        expect(pairs.length).toBeGreaterThan(100);
        expect(pairs.some(({ expected }) => expected.includes('gloss-image'))).toBe(true);
        expect(pairs.some(({ expected }) => expected.includes('pronunciation-graph'))).toBe(true);
    });
    test.each(pairs)('$name', ({ expected, actual }) => {
        expect(actual).toBe(expected);
    });
});
