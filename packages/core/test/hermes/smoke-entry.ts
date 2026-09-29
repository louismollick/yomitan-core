/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bundled for Hermes by test/hermes-smoke.test.ts. Imports upstream's test dictionary from in-memory
 * files (no zip, no TextDecoder: the path React Native uses), then runs every upstream translator
 * fixture case and prints the results as JSON.
 */

import { createFindKanjiOptions, createFindTermsOptions } from '../../../contract-tests/src/translator-options';
import { createYomitan } from '../../src/client/yomitan';
import { createFilesArchiveReader } from '../../src/import/archive';
import { readImageSize } from '../../src/import/image-info';
import { importDictionaryArchive } from '../../src/import/importer';
import { createMemoryStorage } from '../../src/storage/memory-storage';
import { Translator } from '../../src/upstream/ext/js/language/translator.js';

type SmokeInput = {
    dictionaryName: string;
    files: Record<string, string | number[]>;
    optionsPresets: Record<string, never>;
    tests: { func: 'findTerms' | 'findKanji'; mode?: string; text: string; options: never }[];
};

declare const print: (value: string) => void;
declare const __SMOKE_INPUT__: SmokeInput;

async function main(): Promise<void> {
    const input = __SMOKE_INPUT__;
    const storage = createMemoryStorage();
    await storage.prepare();
    const files: Record<string, string | Uint8Array> = {};
    for (const [name, content] of Object.entries(input.files)) {
        files[name] = typeof content === 'string' ? content : new Uint8Array(content);
    }
    // Upstream's goldens were generated with a test media loader that reports every image as 100×100.
    const { errors, result } = await importDictionaryArchive(storage, createFilesArchiveReader(files), {
        imageInfoReader: {
            getImageDetails: async (content: ArrayBuffer) => ({ content, width: 100, height: 100 }),
        },
    });
    if (errors.length > 0 || result === null) {
        throw new Error(`Import failed: ${errors.map((error) => error.message).join('; ')}`);
    }
    const sizes = ['aosaba_auto.png', 'image.gif'].map((path) => {
        const size = readImageSize(files[path] as Uint8Array, path.endsWith('.png') ? 'image/png' : 'image/gif');
        return size === null ? null : [size.width, size.height];
    });
    print(`__SMOKE_MEDIA__${JSON.stringify(sizes)}`);
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

    // The client end to end: profile defaults (upstream OptionsUtil + JSON schema), a directory-style
    // import as on React Native, scan, parse and recommended dictionaries.
    const client = await createYomitan({
        storage: createMemoryStorage(),
        archiveReaders: { directory: () => createFilesArchiveReader(files) },
    });
    await client.dictionaries.import({ source: { directory: 'dictionary' } });
    const scan = await client.lookup.scan('今日は打ち込む。明日も', 3);
    const parse = await client.lookup.parse('打ち込む\n打つ');
    const recommended = await client.dictionaries.recommended('ja');
    print(
        `__SMOKE_CLIENT__${JSON.stringify({
            range: scan?.range,
            sentence: scan?.sentence,
            parse: parse.map((token) => token.text),
            recommended: recommended.length > 0,
        })}`,
    );
    await client.dispose();
}

main().catch((error: unknown) => {
    print(`__SMOKE_ERROR__${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`);
});
