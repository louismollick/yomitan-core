/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Runs Yomitan's translator golden fixtures (test/data/translator-test-*.json) against the vendored
 * translator backed by a storage adapter. Option presets are converted exactly as upstream's
 * test/utilities/translator.js does. These fixtures are phrased as translator options, so they run at
 * the lookup engine's internal translator seam (overhaul plan §4).
 */

import { beforeAll, describe, test } from 'vitest';
import { DictionaryImporter } from '../../core/src/upstream/ext/js/dictionary/dictionary-importer.js';
import { Translator } from '../../core/src/upstream/ext/js/language/translator.js';
import { createDictionaryArchive, readUpstreamJson } from './fixtures';
import { type CreateStorage, testMediaLoader } from './storage-contract';
import {
    type Preset,
    type TranslatorTestCase,
    createFindKanjiOptions,
    createFindTermsOptions,
} from './translator-options';

export { createFindKanjiOptions, createFindTermsOptions };

export const TRANSLATOR_FIXTURE_DICTIONARY = 'Test Dictionary 2';

type TranslatorTestInputs = { optionsPresets: Record<string, Preset>; tests: TranslatorTestCase[] };
type TranslatorTestResult = { name: string; originalTextLength?: number; dictionaryEntries: unknown[] };

export type TranslatorParityOptions = {
    /** Restricts the run to cases in these languages (fixture default language is `ja`). */
    languages?: string[];
};

export function getTranslatorCaseLanguage(testCase: TranslatorTestCase): string {
    let language = 'ja';
    for (const entry of Array.isArray(testCase.options) ? testCase.options : [testCase.options]) {
        if (typeof entry === 'object' && typeof entry.language === 'string') {
            language = entry.language;
        }
    }
    return language;
}

export function runTranslatorParity(
    label: string,
    createStorage: CreateStorage,
    options: TranslatorParityOptions = {},
): void {
    const { optionsPresets, tests } = readUpstreamJson<TranslatorTestInputs>('translator-test-inputs.json');
    const expected = readUpstreamJson<TranslatorTestResult[]>('translator-test-results.json');
    const cases = tests
        .map((data, i) => ({ data, expected: expected[i] }))
        .filter(
            ({ data }) =>
                options.languages === undefined || options.languages.includes(getTranslatorCaseLanguage(data)),
        );

    describe(`${label}: translator parity (upstream translator-test-results.json)`, () => {
        let translator: InstanceType<typeof Translator>;
        beforeAll(async () => {
            const storage = await createStorage();
            await storage.prepare();
            const archive = await createDictionaryArchive('valid-dictionary1', {
                title: TRANSLATOR_FIXTURE_DICTIONARY,
            });
            const { errors } = await new DictionaryImporter(testMediaLoader).importDictionary(storage, archive, {
                prefixWildcardsSupported: true,
                yomitanVersion: '0.0.0.0',
            });
            if (errors.length > 0) {
                throw new Error(`Fixture import failed: ${errors.map(String).join(', ')}`);
            }
            translator = new Translator(storage);
            translator.prepare();
        });

        test.each(cases)('$data.name', async ({ data, expected: expectedResult }) => {
            const { expect } = await import('vitest');
            if (data.func === 'findTerms') {
                const findOptions = createFindTermsOptions(TRANSLATOR_FIXTURE_DICTIONARY, optionsPresets, data.options);
                const { dictionaryEntries, originalTextLength } = await translator.findTerms(
                    data.mode,
                    data.text,
                    findOptions,
                );
                expect.soft(originalTextLength).toStrictEqual(expectedResult.originalTextLength);
                expect.soft(dictionaryEntries).toStrictEqual(expectedResult.dictionaryEntries);
            } else {
                const findOptions = createFindKanjiOptions(TRANSLATOR_FIXTURE_DICTIONARY, optionsPresets, data.options);
                const dictionaryEntries = await translator.findKanji(data.text, findOptions);
                expect.soft(dictionaryEntries).toStrictEqual(expectedResult.dictionaryEntries);
            }
        });
    });
}
