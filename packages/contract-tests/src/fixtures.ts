/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Archive helpers adapted from Yomitan's dev/dictionary-archive-util.js.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';

export const upstreamFixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'upstream');

export function readUpstreamJson<T = unknown>(relativePath: string): T {
    return JSON.parse(readFileSync(join(upstreamFixturesDir, relativePath), 'utf8')) as T;
}

export type ArchiveOptions = {
    /** Overrides the dictionary title in index.json. */
    title?: string;
    /** Deflate level; upstream tests use 0 (stored). Real dictionaries are deflated. */
    level?: number;
};

/** Zips one of upstream's test dictionary directories (e.g. `valid-dictionary1`). */
export async function createDictionaryArchive(dictionary: string, options: ArchiveOptions = {}): Promise<ArrayBuffer> {
    const directory = join(upstreamFixturesDir, 'dictionaries', dictionary);
    const zipWriter = new ZipWriter(new BlobWriter(), { level: options.level ?? 0 });
    for (const fileName of readdirSync(directory).sort()) {
        if (fileName.endsWith('.json')) {
            const json = JSON.parse(readFileSync(join(directory, fileName), 'utf8'));
            if (fileName === 'index.json' && typeof options.title === 'string') {
                json.title = options.title;
            }
            await zipWriter.add(fileName, new TextReader(JSON.stringify(json)));
        } else {
            await zipWriter.add(
                fileName,
                new Uint8ArrayReader(new Uint8Array(readFileSync(join(directory, fileName)))),
            );
        }
    }
    const blob = await zipWriter.close();
    return await blob.arrayBuffer();
}

/** Zips in-memory files (strings are file text). */
export async function zipFiles(files: Record<string, string | Uint8Array>, level = 6): Promise<ArrayBuffer> {
    const zipWriter = new ZipWriter(new BlobWriter(), { level });
    for (const [name, content] of Object.entries(files)) {
        await zipWriter.add(
            name,
            typeof content === 'string' ? new TextReader(content) : new Uint8ArrayReader(content),
        );
    }
    return await (await zipWriter.close()).arrayBuffer();
}
