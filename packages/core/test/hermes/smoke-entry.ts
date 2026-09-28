/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bundled for Hermes by test/hermes-smoke.test.ts. Loads storage rows produced in Node, then runs
 * every upstream translator fixture case and prints the results as JSON.
 */

import { createFindKanjiOptions, createFindTermsOptions } from '../../../contract-tests/src/translator-options';
import { createMemoryStorage } from '../../src/storage/memory-storage';
import type { ObjectStoreName } from '../../src/storage/types';
import { Translator } from '../../src/upstream/ext/js/language/translator.js';

type SmokeInput = {
    dictionaryName: string;
    rows: Record<string, Record<string, unknown>[]>;
    optionsPresets: Record<string, never>;
    tests: { func: 'findTerms' | 'findKanji'; mode?: string; text: string; options: never }[];
};

declare const print: (value: string) => void;
declare const __SMOKE_INPUT__: SmokeInput;

async function main(): Promise<void> {
    const input = __SMOKE_INPUT__;
    const storage = createMemoryStorage();
    await storage.prepare();
    for (const [store, rows] of Object.entries(input.rows)) {
        await storage.bulkAdd(store as ObjectStoreName, rows, 0, rows.length);
    }
    const translator = new Translator(storage);
    translator.prepare();
    const results: unknown[] = [];
    for (const testCase of input.tests) {
        if (testCase.func === 'findTerms') {
            const options = createFindTermsOptions(input.dictionaryName, input.optionsPresets, testCase.options);
            const { dictionaryEntries, originalTextLength } = await translator.findTerms(
                testCase.mode,
                testCase.text,
                options,
            );
            results.push({ originalTextLength, dictionaryEntries });
        } else {
            const options = createFindKanjiOptions(input.dictionaryName, input.optionsPresets, testCase.options);
            results.push({ dictionaryEntries: await translator.findKanji(testCase.text, options) });
        }
    }
    print(`__SMOKE_RESULT__${JSON.stringify(results)}`);
}

main().catch((error: unknown) => {
    print(`__SMOKE_ERROR__${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`);
});
