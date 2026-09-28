/*
 * Upstream's Anki goldens (test/data/anki-note-builder-test-results.json and
 * translator-test-results-note-data1.json), reproduced with Yomitan's note builder and template
 * renderer running on the string DOM. Setup mirrors upstream's test/utilities/anki.js.
 */

import { describe, expect, test } from 'vitest';
import { createDictionaryArchive, readUpstreamJson } from '../../contract-tests/src/index';
import { importFixture } from '../../contract-tests/src/storage-contract';
import { createFindKanjiOptions, createFindTermsOptions } from '../../contract-tests/src/translator-options';
import { StringDocument, createStringWindow } from '../src/dom/string-dom';
import { createMemoryStorage } from '../src/storage/memory-storage';
import { fetchText } from '../src/upstream/ext/js/core/fetch-utilities.js';
import { AnkiNoteBuilder } from '../src/upstream/ext/js/data/anki-note-builder.js';
import { createAnkiNoteData } from '../src/upstream/ext/js/data/anki-note-data-creator.js';
import { getStandardFieldMarkers } from '../src/upstream/ext/js/data/anki-template-util.js';
import { Translator } from '../src/upstream/ext/js/language/translator.js';
import { AnkiTemplateRenderer } from '../src/upstream/ext/js/templates/anki-template-renderer.js';

const DICTIONARY = 'Test Dictionary 2';

describe('Anki parity (upstream anki-note-builder and note-data goldens)', async () => {
    const storage = createMemoryStorage();
    await storage.prepare();
    const { result } = await importFixture(storage, await createDictionaryArchive('valid-dictionary1', { title: DICTIONARY }));
    const styles = result?.styles ?? '';
    const translator = new Translator(storage);
    translator.prepare();
    const document = new StringDocument();
    const renderer = new (AnkiTemplateRenderer as any)(document, createStringWindow(document));
    await renderer.prepare();
    const template = await fetchText('/data/templates/default-anki-field-templates.handlebars');
    const { optionsPresets, tests } = readUpstreamJson<any>('translator-test-inputs.json');
    const expectedFields = readUpstreamJson<any[]>('anki-note-builder-test-results.json');
    const expectedNoteData = readUpstreamJson<any[]>('translator-test-results-note-data1.json');

    const cases: { data: any; fields: any; noteData: any }[] = tests.map((data: any, i: number) => ({
        data,
        fields: expectedFields[i],
        noteData: expectedNoteData[i],
    }));

    test.each(cases)('$data.name', async ({ data, fields, noteData }) => {
        const isTerms = data.func === 'findTerms';
        const mode = isTerms ? data.mode : 'split';
        const entries = isTerms
            ? (await translator.findTerms(mode, data.text, createFindTermsOptions(DICTIONARY, optionsPresets, data.options))).dictionaryEntries
            : await translator.findKanji(data.text, createFindKanjiOptions(DICTIONARY, optionsPresets, data.options));
        if (mode === 'simple') {
            expect(fields.results).toBeNull();
            return;
        }
        const entryStyles = isTerms ? styles : '';
        const dictionaryStylesMap = new Map<string, string>(entryStyles ? [[DICTIONARY, entryStyles]] : []);
        const noteDataList = entries.map((entry: any) =>
            createAnkiNoteData('{marker}', {
                dictionaryEntry: entry,
                resultOutputMode: mode,
                cardFormat: { type: 'term', name: 'test', deck: 'deck', model: 'model', fields: {}, icon: 'big-circle' },
                glossaryLayoutMode: 'default',
                compactTags: false,
                context: { url: 'url:', sentence: { text: '', offset: 0 }, documentTitle: 'title', query: 'query', fullQuery: 'fullQuery' },
                media: {},
                dictionaryStylesMap,
            }),
        );
        expect(noteDataList).toEqual(noteData.noteDataList);

        const results = [];
        for (const entry of entries) {
            const source = entry.type === 'kanji' ? entry.character : (entry.headwords[0]?.sources[0]?.originalText ?? '');
            const cardFields: Record<string, unknown> = {};
            for (const marker of getStandardFieldMarkers(entry.type)) {
                cardFields[marker] = { value: `{${marker}}`, overwriteMode: 'coalesce' };
            }
            const builder = new (AnkiNoteBuilder as any)(
                { injectAnkiNoteMedia: async () => { throw new Error('Not supported'); }, parseText: async () => { throw new Error('Not supported'); } },
                renderer.templateRenderer,
            );
            const { note, errors } = await builder.createNote({
                dictionaryEntry: entry,
                cardFormat: { type: entry.type, name: 'test', deck: 'deckName', model: 'modelName', fields: cardFields, icon: 'big-circle' },
                context: { url: 'url:', sentence: { text: `cloze-prefix${source}cloze-suffix`, offset: 'cloze-prefix'.length }, documentTitle: 'title', query: 'query', fullQuery: 'fullQuery' },
                template,
                tags: ['yomitan'],
                duplicateScope: 'collection',
                duplicateScopeCheckAllModels: false,
                resultOutputMode: mode,
                glossaryLayoutMode: 'default',
                compactTags: false,
                requirements: [],
                mediaOptions: null,
                dictionaryStylesMap,
            });
            expect(errors).toEqual([]);
            results.push(note.fields);
        }
        expect(results).toStrictEqual(fields.results);
    });
});
