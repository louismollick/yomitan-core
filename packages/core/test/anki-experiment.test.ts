import { StringDocument, createStringWindow } from '../src/dom/string-dom';
import { expect, test } from 'vitest';
import { createFindKanjiOptions, createFindTermsOptions } from '../../contract-tests/src/translator-options';
import { createDictionaryArchive, readUpstreamJson } from '../../contract-tests/src/index';
import { importFixture } from '../../contract-tests/src/storage-contract';
import { createMemoryStorage } from '../src/storage/memory-storage';
import { fetchText } from '../src/upstream/ext/js/core/fetch-utilities.js';
import { AnkiNoteBuilder } from '../src/upstream/ext/js/data/anki-note-builder.js';
import { getStandardFieldMarkers } from '../src/upstream/ext/js/data/anki-template-util.js';
import { Translator } from '../src/upstream/ext/js/language/translator.js';
import { AnkiTemplateRenderer } from '../src/upstream/ext/js/templates/anki-template-renderer.js';

test('string DOM reproduces anki-note-builder goldens', async () => {
    const storage = createMemoryStorage();
    await storage.prepare();
    const { result } = await importFixture(storage, await createDictionaryArchive('valid-dictionary1', { title: 'Test Dictionary 2' }));
    const styles = result?.styles ?? '';
    const translator = new Translator(storage);
    translator.prepare();
    const document = new StringDocument();
    const window = createStringWindow(document);
    const renderer = new AnkiTemplateRenderer(document, window);
    await renderer.prepare();
    const template = await fetchText('/data/templates/default-anki-field-templates.handlebars');
    const { optionsPresets, tests } = readUpstreamJson<any>('translator-test-inputs.json');
    const expected = readUpstreamJson<any[]>('anki-note-builder-test-results.json');
    let mismatches = 0;
    let firstDiff = '';
    for (const [i, data] of tests.entries()) {
        let entries: any[];
        let mode: string;
        if (data.func === 'findTerms') {
            mode = data.mode;
            if (mode === 'simple') continue;
            entries = (await translator.findTerms(mode, data.text, createFindTermsOptions('Test Dictionary 2', optionsPresets, data.options))).dictionaryEntries;
        } else {
            mode = 'split';
            entries = await translator.findKanji(data.text, createFindKanjiOptions('Test Dictionary 2', optionsPresets, data.options));
        }
        const results = [];
        for (const entry of entries) {
            const source = entry.type === 'kanji' ? entry.character : entry.headwords[0]?.sources[0]?.originalText ?? '';
            const builder = new AnkiNoteBuilder({ injectAnkiNoteMedia: async () => { throw new Error('no'); }, parseText: async () => { throw new Error('no'); } }, renderer.templateRenderer);
            const fields: Record<string, unknown> = {};
            for (const marker of getStandardFieldMarkers(entry.type)) fields[marker] = { value: `{${marker}}`, overwriteMode: 'coalesce' };
            const dictionaryStylesMap = new Map<string, string>();
            if (data.func === 'findTerms' && styles) dictionaryStylesMap.set('Test Dictionary 2', styles);
            const { note } = await builder.createNote({
                dictionaryEntry: entry,
                cardFormat: { type: entry.type, name: 'test', deck: 'deckName', model: 'modelName', fields, icon: 'big-circle' },
                context: { url: 'url:', sentence: { text: `cloze-prefix${source}cloze-suffix`, offset: 'cloze-prefix'.length }, documentTitle: 'title', query: 'query', fullQuery: 'fullQuery' },
                template, tags: ['yomitan'], duplicateScope: 'collection', duplicateScopeCheckAllModels: false,
                resultOutputMode: mode, glossaryLayoutMode: 'default', compactTags: false, requirements: [], mediaOptions: null, dictionaryStylesMap,
            });
            results.push(note.fields);
        }
        const want = expected[i].results;
        for (let j = 0; j < (want ?? []).length; ++j) {
            for (const key of Object.keys(want[j])) {
                if (want[j][key] !== results[j]?.[key]) {
                    ++mismatches;
                    if (!firstDiff) firstDiff = `${data.name} [${j}] ${key}\nWANT ${JSON.stringify(want[j][key]).slice(0, 600)}\nGOT  ${JSON.stringify(results[j]?.[key]).slice(0, 600)}`;
                }
            }
        }
    }
    console.log('mismatches', mismatches, '\n', firstDiff);
    expect(mismatches).toBe(0);
});
