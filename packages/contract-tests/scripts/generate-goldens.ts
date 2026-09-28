/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Generates goldens that upstream does not ship (overhaul plan §4), by running upstream's own code at
 * the pinned commit:
 *   - profile-mapping.json: Backend._getTranslatorFindTermsOptions / _getTranslatorFindKanjiOptions
 *     (with _getTranslatorEnabledDictionaryMap and _getTranslatorTextReplacements) over a set of
 *     profiles;
 *   - parse.json: Backend._textParseScanning over sample texts, with upstream's translator and
 *     upstream's test dictionary.
 * The methods are extracted verbatim from ext/js/background/backend.js with acorn.
 *
 * Usage: YOMITAN_UPSTREAM_DIR=/path/to/yomitan npx vite-node scripts/generate-goldens.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { createZipArchiveReader } from '../../core/src/import/archive';
import { importDictionaryArchive } from '../../core/src/import/importer';
import { ProfileFormat } from '../../core/src/profile/profile';
import { createMemoryStorage } from '../../core/src/storage/memory-storage';
import {
    distributeFuriganaInflected,
    isCodePointJapanese,
} from '../../core/src/upstream/ext/js/language/ja/japanese.js';
import { Translator } from '../../core/src/upstream/ext/js/language/translator.js';
import config from '../../core/upstream.config.json' with { type: 'json' };
import { createDictionaryArchive } from '../src/fixtures';
import { GOLDEN_PARSE_TEXTS, createGoldenProfiles, serializeOptions } from '../src/golden-inputs';

const here = dirname(fileURLToPath(import.meta.url));
const upstreamDir = process.env.YOMITAN_UPSTREAM_DIR;
if (!upstreamDir) {
    throw new Error('Set YOMITAN_UPSTREAM_DIR to a Yomitan checkout at the pinned commit');
}

const METHODS = [
    '_getTranslatorFindTermsOptions',
    '_getTranslatorFindKanjiOptions',
    '_getTranslatorEnabledDictionaryMap',
    '_getTranslatorTextReplacements',
    '_textParseScanning',
];

function extractBackendMethods(): Record<string, string> {
    const source = readFileSync(join(upstreamDir as string, 'ext/js/background/backend.js'), 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as {
        body: {
            type: string;
            declaration?: {
                type: string;
                body: { body: { type: string; key: { name: string }; start: number; end: number }[] };
            };
        }[];
    };
    const methods: Record<string, string> = {};
    for (const node of ast.body) {
        const declaration = node.declaration;
        if (declaration?.type !== 'ClassDeclaration') {
            continue;
        }
        for (const member of declaration.body.body) {
            if (member.type === 'MethodDefinition' && METHODS.includes(member.key.name)) {
                methods[member.key.name] = source.slice(member.start, member.end);
            }
        }
    }
    for (const name of METHODS) {
        if (!(name in methods)) {
            throw new Error(`Upstream Backend has no ${name}`);
        }
    }
    return methods;
}

/** A stand-in Backend holding only the verbatim upstream methods. */
function createUpstreamBackend(profileOptions: unknown, translator: unknown) {
    const methods = extractBackendMethods();
    const classSource = `return class UpstreamBackend {\n${Object.values(methods).join('\n\n')}\n}`;
    const UpstreamBackend = new Function('distributeFuriganaInflected', 'isCodePointJapanese', classSource)(
        distributeFuriganaInflected,
        isCodePointJapanese,
    );
    const backend = new UpstreamBackend();
    backend._getProfileOptions = () => profileOptions;
    backend._translator = translator;
    backend._textParseCache = new Map();
    return backend;
}

async function main(): Promise<void> {
    const format = new ProfileFormat();
    const profiles = createGoldenProfiles((await format.defaults()).options);

    const profileMapping = profiles.map(({ name, options }) => {
        const backend = createUpstreamBackend(options, null);
        return {
            name,
            terms: Object.fromEntries(
                (['group', 'merge', 'split', 'simple'] as const).map((mode) => [
                    mode,
                    serializeOptions(backend._getTranslatorFindTermsOptions(mode, { primaryReading: 'よみ' }, options)),
                ]),
            ),
            kanji: serializeOptions(backend._getTranslatorFindKanjiOptions(options)),
        };
    });

    const storage = createMemoryStorage();
    await storage.prepare();
    const { errors } = await importDictionaryArchive(
        storage,
        createZipArchiveReader(await createDictionaryArchive('valid-dictionary1')),
    );
    if (errors.length > 0) {
        throw new Error(errors.map(String).join('\n'));
    }
    const translator = new Translator(storage);
    translator.prepare();
    const parseProfile = profiles.find(({ name }) => name === 'test-dictionary-enabled');
    if (parseProfile === undefined) {
        throw new Error('Missing parse profile');
    }
    const backend = createUpstreamBackend(parseProfile.options, translator);
    const parse = [];
    for (const text of GOLDEN_PARSE_TEXTS) {
        parse.push({
            text,
            result: await backend._textParseScanning(text, parseProfile.options.scanning.length, {}, false),
        });
    }

    const outDir = join(here, '..', 'fixtures', 'generated');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'profile-mapping.json'), `${JSON.stringify(profileMapping, null, 2)}\n`);
    writeFileSync(join(outDir, 'parse.json'), `${JSON.stringify(parse, null, 2)}\n`);
    writeFileSync(
        join(outDir, 'PROVENANCE.md'),
        `# Generated goldens\n\nGenerated by \`packages/contract-tests/scripts/generate-goldens.ts\` from upstream Yomitan \`${config.commit}\`, running \`Backend\` methods extracted verbatim from \`ext/js/background/backend.js\`: ${METHODS.map((m) => `\`${m}\``).join(', ')}.\n\nRe-run whenever the pin moves.\n`,
    );
    console.log(`Wrote ${profileMapping.length} profile mappings and ${parse.length} parse goldens`);
}

await main();
