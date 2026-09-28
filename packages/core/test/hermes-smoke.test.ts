/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Runs the engine on Hermes the way a React Native app would:
 *   1. esbuild bundles test/hermes/smoke-entry.ts;
 *   2. React Native 0.86's hermesc must accept the bundle after Babel's `hermes-stable` profile
 *      (what Metro emits for Hermes apps);
 *   3. the Hermes CLI runs the bundle after the default React Native Babel transform, and must
 *      reproduce every upstream translator golden result.
 *
 * Set HERMES_BIN to a Hermes CLI (e.g. `npx jsvu --engines=hermes`). Without it the runtime step is
 * skipped locally; CI sets REQUIRE_HERMES=1.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import { build } from 'esbuild';
import { describe, expect, test } from 'vitest';
import {
    TRANSLATOR_FIXTURE_DICTIONARY,
    readFixtureDictionaryFiles,
    readUpstreamJson,
} from '../../contract-tests/src/index';

const here = dirname(fileURLToPath(import.meta.url));
const hermesBin = process.env.HERMES_BIN ?? join(homedir(), '.jsvu', 'bin', 'hermes');
const hasHermes = existsSync(hermesBin);
const hermescBin = join(
    dirname(createRequire(import.meta.url).resolve('hermes-compiler/package.json')),
    'hermesc',
    process.platform === 'darwin' ? 'osx-bin' : process.platform === 'win32' ? 'win64-bin' : 'linux64-bin',
    process.platform === 'win32' ? 'hermesc.exe' : 'hermesc',
);

function createSmokeInput() {
    const files: Record<string, string | number[]> = {};
    for (const [name, content] of Object.entries(readFixtureDictionaryFiles('valid-dictionary1'))) {
        if (name === 'index.json') {
            files[name] = JSON.stringify({ ...JSON.parse(content as string), title: TRANSLATOR_FIXTURE_DICTIONARY });
        } else {
            files[name] = typeof content === 'string' ? content : [...content];
        }
    }
    const { optionsPresets, tests } = readUpstreamJson<{ optionsPresets: unknown; tests: unknown[] }>(
        'translator-test-inputs.json',
    );
    return { dictionaryName: TRANSLATOR_FIXTURE_DICTIONARY, files, optionsPresets, tests };
}

async function bundle(profile: 'default' | 'hermes-stable'): Promise<string> {
    const result = await build({
        entryPoints: [join(here, 'hermes', 'smoke-entry.ts')],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'neutral',
        mainFields: ['module', 'main'],
        target: 'es2020',
        logLevel: 'silent',
    });
    const babel = transformSync(result.outputFiles[0].text, {
        babelrc: false,
        configFile: false,
        compact: false,
        sourceType: 'script',
        presets: [
            [
                '@react-native/babel-preset',
                profile === 'hermes-stable' ? { unstable_transformProfile: 'hermes-stable' } : {},
            ],
        ],
    });
    if (babel?.code == null) {
        throw new Error('Babel produced no output');
    }
    // Babel's React Native preset imports helpers from @babel/runtime; Metro bundles them, so do the same.
    const linked = await build({
        stdin: { contents: babel.code, resolveDir: here, loader: 'js' },
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'neutral',
        mainFields: ['main'],
        // No syntax lowering here: Babel already produced what Metro would.
        target: 'esnext',
        logLevel: 'silent',
    });
    return linked.outputFiles[0].text;
}

describe('Hermes smoke test', () => {
    test("React Native 0.86's hermesc accepts the Metro-style bundle", async () => {
        const directory = mkdtempSync(join(tmpdir(), 'yomitan-hermesc-'));
        const source = join(directory, 'bundle.js');
        writeFileSync(source, `var __SMOKE_INPUT__ = {};\n${await bundle('hermes-stable')}`);
        execFileSync(hermescBin, ['-emit-binary', '-out', join(directory, 'bundle.hbc'), source], { stdio: 'pipe' });
        expect(existsSync(join(directory, 'bundle.hbc'))).toBe(true);
    }, 120000);

    test.skipIf(!hasHermes && process.env.REQUIRE_HERMES !== '1')(
        'Hermes reproduces every upstream translator golden result',
        async () => {
            const input = createSmokeInput();
            const code = [
                readFileSync(join(here, 'hermes', 'react-native-prelude.js'), 'utf8'),
                `var __SMOKE_INPUT__ = ${JSON.stringify(input)};`,
                await bundle('default'),
            ].join('\n');
            const directory = mkdtempSync(join(tmpdir(), 'yomitan-hermes-'));
            const file = join(directory, 'bundle.js');
            writeFileSync(file, code);
            const output = execFileSync(hermesBin, [file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
            const errorIndex = output.indexOf('__SMOKE_ERROR__');
            if (errorIndex >= 0) {
                throw new Error(output.slice(errorIndex));
            }
            const mediaMarker = '__SMOKE_MEDIA__';
            const mediaLine = output.slice(output.indexOf(mediaMarker) + mediaMarker.length).split('\n')[0];
            expect(JSON.parse(mediaLine)).toEqual([
                [64, 64],
                [7, 7],
            ]);
            const clientMarker = '__SMOKE_CLIENT__';
            const clientLine = output.slice(output.indexOf(clientMarker) + clientMarker.length).split('\n')[0];
            expect(JSON.parse(clientLine)).toEqual({
                range: { start: 3, end: 7 },
                sentence: { text: '今日は打ち込む。', offset: 3 },
                parse: ['打ち込む', '\n', '打つ'],
                recommended: true,
            });
            const marker = '__SMOKE_RESULT__';
            const results = JSON.parse(output.slice(output.indexOf(marker) + marker.length).split('\n')[0]);
            const expected =
                readUpstreamJson<{ originalTextLength?: number; dictionaryEntries: unknown[] }[]>(
                    'translator-test-results.json',
                );
            expect(results).toHaveLength(expected.length);
            for (let i = 0; i < expected.length; ++i) {
                expect.soft(results[i].dictionaryEntries).toStrictEqual(expected[i].dictionaryEntries);
                if ('originalTextLength' in expected[i]) {
                    expect.soft(results[i].originalTextLength).toStrictEqual(expected[i].originalTextLength);
                }
            }
        },
        300000,
    );
});
