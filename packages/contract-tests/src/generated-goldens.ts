/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Checks yomitan-core against goldens generated from upstream code (scripts/generate-goldens.ts).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'vitest';
import { createYomitan } from '../../core/src/client/yomitan';
import { getFindKanjiOptions, getFindTermsOptions } from '../../core/src/lookup/find-options';
import type { ParseToken } from '../../core/src/lookup/text-lookup';
import { ProfileFormat } from '../../core/src/profile/profile';
import type { CreateClientStorage } from './client-contract';
import { createDictionaryArchive, upstreamFixturesDir } from './fixtures';
import { createGoldenProfiles, serializeOptions } from './golden-inputs';

const generatedDir = join(upstreamFixturesDir, '..', 'generated');

function readGenerated<T>(name: string): T {
    return JSON.parse(readFileSync(join(generatedDir, name), 'utf8')) as T;
}

/** yomitan-core's parse tokens in the shape of upstream's `_textParseScanning` result. */
export function toUpstreamParseResult(tokens: ParseToken[]): unknown[] {
    return tokens.map((token) =>
        token.segments.map((segment, index) =>
            index === 0 && token.headwords !== undefined ? { ...segment, headwords: token.headwords } : segment,
        ),
    );
}

export function runGeneratedGoldens(label: string, createStorage: CreateClientStorage): void {
    describe(`${label}: goldens generated from upstream code`, () => {
        test('profile → translator options match upstream Backend for every golden profile', async ({ expect }) => {
            const golden =
                readGenerated<{ name: string; terms: Record<string, unknown>; kanji: unknown }[]>(
                    'profile-mapping.json',
                );
            const profiles = createGoldenProfiles((await new ProfileFormat().defaults()).options);
            expect(profiles.map(({ name }) => name)).toEqual(golden.map(({ name }) => name));
            for (const [i, { options }] of profiles.entries()) {
                for (const mode of ['group', 'merge', 'split', 'simple'] as const) {
                    expect
                        .soft(
                            serializeOptions(getFindTermsOptions(mode, { primaryReading: 'よみ' }, options)),
                            `${golden[i].name}/${mode}`,
                        )
                        .toStrictEqual(golden[i].terms[mode]);
                }
                expect
                    .soft(serializeOptions(getFindKanjiOptions(options)), `${golden[i].name}/kanji`)
                    .toStrictEqual(golden[i].kanji);
            }
        });

        test('lookup.parse matches upstream _textParseScanning', async ({ expect }) => {
            const golden = readGenerated<{ text: string; result: unknown[] }[]>('parse.json');
            const format = new ProfileFormat();
            const defaults = await format.defaults();
            const profile = createGoldenProfiles(defaults.options).find(
                ({ name }) => name === 'test-dictionary-enabled',
            );
            const client = await createYomitan({ storage: await createStorage() });
            await client.dictionaries.import({ source: await createDictionaryArchive('valid-dictionary1') });
            await client.profile.set({ version: defaults.version, options: profile?.options });
            for (const { text, result } of golden) {
                expect
                    .soft(toUpstreamParseResult(await client.lookup.parse(text)), JSON.stringify(text))
                    .toStrictEqual(result);
            }
            await client.dispose();
        });
    });
}
