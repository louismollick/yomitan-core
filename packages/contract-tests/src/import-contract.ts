/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Import through yomitan-core's archive readers must produce exactly what upstream's importer does
 * from an in-memory zip, with real image sizes, on every storage adapter.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'vitest';
import { type ArchiveReader, createFilesArchiveReader, createZipArchiveReader } from '../../core/src/import/archive';
import { importDictionaryArchive } from '../../core/src/import/importer';
import type { DictionaryStorage } from '../../core/src/storage/types';
import { createDictionaryArchive, readUpstreamJson, upstreamFixturesDir } from './fixtures';

type CreateStorage = () => Promise<DictionaryStorage> | DictionaryStorage;

/** Actual pixel sizes of the images in upstream's valid-dictionary1. */
export const VALID_DICTIONARY_IMAGE_SIZES: Record<string, [number, number]> = {
    'character.gif': [24, 24],
    'character2.gif': [9, 24],
    'character3.gif': [24, 9],
    'image.gif': [7, 7],
    'aosaba_auto.png': [64, 64],
    'aosaba_mono.png': [64, 64],
};

export function readFixtureDictionaryFiles(dictionary: string): Record<string, string | Uint8Array> {
    const directory = join(upstreamFixturesDir, 'dictionaries', dictionary);
    const files: Record<string, string | Uint8Array> = {};
    for (const name of readdirSync(directory)) {
        files[name] =
            name.endsWith('.json') || name.endsWith('.css')
                ? readFileSync(join(directory, name), 'utf8')
                : new Uint8Array(readFileSync(join(directory, name)));
    }
    return files;
}

export type ExtraArchiveReaders = Record<string, () => ArchiveReader | Promise<ArchiveReader>>;

export function runImportContract(
    label: string,
    createStorage: CreateStorage,
    extraReaders: ExtraArchiveReaders = {},
): void {
    const { expectedSummary, expectedCounts } = readUpstreamJson<{
        expectedSummary: Record<string, unknown> & { importDate: number };
        expectedCounts: unknown;
    }>('database-test-cases.json');

    const readers: ExtraArchiveReaders = {
        'deflated zip': async () =>
            createZipArchiveReader(await createDictionaryArchive('valid-dictionary1', { level: 6 })),
        'zip Blob': async () =>
            createZipArchiveReader(new Blob([await createDictionaryArchive('valid-dictionary1', { level: 6 })])),
        'in-memory files': () => createFilesArchiveReader(readFixtureDictionaryFiles('valid-dictionary1')),
        ...extraReaders,
    };

    describe(`${label}: import contract`, () => {
        for (const [readerLabel, createReader] of Object.entries(readers)) {
            test(`imports valid-dictionary1 from ${readerLabel} exactly like upstream`, async ({ expect }) => {
                const storage = await createStorage();
                await storage.prepare();
                let progressed = false;
                const { result, errors } = await importDictionaryArchive(storage, await createReader(), {
                    onProgress: () => {
                        progressed = true;
                    },
                });
                expect(errors).toStrictEqual([]);
                expect(progressed).toBe(true);
                expect({ ...result, importDate: expectedSummary.importDate }).toStrictEqual(expectedSummary);
                const title = String(expectedSummary.title);
                expect(await storage.getDictionaryCounts([title], true)).toStrictEqual(expectedCounts);

                const media = await storage.getMedia(
                    Object.keys(VALID_DICTIONARY_IMAGE_SIZES).map((path) => ({ path, dictionary: title })),
                );
                expect(media).toHaveLength(Object.keys(VALID_DICTIONARY_IMAGE_SIZES).length);
                for (const item of media) {
                    const [width, height] = VALID_DICTIONARY_IMAGE_SIZES[item.path];
                    expect.soft({ path: item.path, width: item.width, height: item.height }).toStrictEqual({
                        path: item.path,
                        width,
                        height,
                    });
                    expect.soft(item.content.byteLength).toBeGreaterThan(0);
                }
                await storage.close();
            });
        }

        test('rejects a dictionary that requires a newer Yomitan than the parity pin', async ({ expect }) => {
            const storage = await createStorage();
            await storage.prepare();
            const files = readFixtureDictionaryFiles('valid-dictionary1');
            const index = JSON.parse(files['index.json'] as string);
            files['index.json'] = JSON.stringify({ ...index, minimumYomitanVersion: '99.0.0.0' });
            await expect(importDictionaryArchive(storage, createFilesArchiveReader(files))).rejects.toThrow(
                'Dictionary is incompatible with this version of Yomitan',
            );
            files['index.json'] = JSON.stringify({ ...index, minimumYomitanVersion: '24.1.1.0' });
            const { errors } = await importDictionaryArchive(storage, createFilesArchiveReader(files));
            expect(errors).toStrictEqual([]);
            await storage.close();
        });
    });
}
