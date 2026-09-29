/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { DictionaryStorage, Summary } from '../storage/types';
import { DictionaryImporter } from '../upstream/ext/js/dictionary/dictionary-importer.js';
import { BlobWriter, TextWriter } from '../upstream/ext/lib/zip.js';
import { upstreamPin } from '../upstream/pin.js';
import type { ArchiveEntry, ArchiveReader } from './archive';
import { type ImageInfoReader, headerImageInfoReader } from './image-info';

export type ImportProgress = { nextStep: boolean; index: number; count: number };

export type ImportResult = { result: Summary | null; errors: Error[] };

/** A zip.js-entry look-alike: the only shape upstream's importer reads files through. */
type UpstreamArchiveEntry = { filename: string; getData(writer: unknown): Promise<unknown> };

function toUpstreamEntry(entry: ArchiveEntry): UpstreamArchiveEntry {
    return {
        filename: entry.name,
        async getData(writer: unknown) {
            if (writer instanceof TextWriter) {
                return await entry.text();
            }
            if (writer instanceof BlobWriter) {
                const bytes = await entry.bytes();
                const content = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                return { arrayBuffer: async () => content };
            }
            throw new Error(`Unsupported archive writer for ${entry.name}`);
        },
    };
}

type UpstreamImporter = {
    importDictionary(
        storage: DictionaryStorage,
        archive: ArchiveReader,
        details: { prefixWildcardsSupported: boolean; yomitanVersion: string },
    ): Promise<unknown>;
};

const UpstreamDictionaryImporter = DictionaryImporter as unknown as new (
    mediaLoader: ImageInfoReader,
    onProgress?: (progress: ImportProgress) => void,
) => UpstreamImporter;

/**
 * Yomitan's `DictionaryImporter`, reading from an {@link ArchiveReader} instead of an in-memory zip.
 * Only the archive access is replaced; validation, conversion and writes are upstream's.
 */
class ArchiveDictionaryImporter extends UpstreamDictionaryImporter {
    async _getFilesFromArchive(reader: ArchiveReader): Promise<Map<string, UpstreamArchiveEntry>> {
        const fileMap = new Map<string, UpstreamArchiveEntry>();
        for (const entry of await reader.entries()) {
            fileMap.set(entry.name, toUpstreamEntry(entry));
        }
        return fileMap;
    }
}

export type ImportDictionaryOptions = {
    imageInfoReader?: ImageInfoReader;
    onProgress?: (progress: ImportProgress) => void;
};

/**
 * Imports one dictionary archive with upstream's importer. Suffix lookups are always enabled, and
 * `minimumYomitanVersion` is checked against the Yomitan release of the parity pin.
 */
export async function importDictionaryArchive(
    storage: DictionaryStorage,
    reader: ArchiveReader,
    options: ImportDictionaryOptions = {},
): Promise<ImportResult> {
    const importer = new ArchiveDictionaryImporter(
        options.imageInfoReader ?? headerImageInfoReader,
        options.onProgress,
    );
    try {
        return (await importer.importDictionary(storage, reader, {
            prefixWildcardsSupported: true,
            yomitanVersion: upstreamPin.yomitanVersion,
        })) as ImportResult;
    } finally {
        await reader.close?.();
    }
}

/**
 * Runs upstream's whole import against storage that discards every write: the index, every data
 * bank's schema, conversion, media loading and styles are all checked, nothing is stored. Used
 * before replacing an installed dictionary.
 */
export async function validateDictionaryArchive(
    reader: ArchiveReader,
    imageInfoReader?: ImageInfoReader,
): Promise<Error[]> {
    const discard = {
        isPrepared: () => true,
        dictionaryExists: async () => false,
        bulkAdd: async () => {},
        bulkUpdate: async () => {},
        addWithResult: async () => ({
            result: 1,
            set onsuccess(callback: (() => void) | null) {
                if (typeof callback === 'function') {
                    void Promise.resolve().then(callback);
                }
            },
            set onerror(_callback: unknown) {},
        }),
    };
    try {
        const { result, errors } = await importDictionaryArchive(
            discard as unknown as DictionaryStorage,
            { entries: () => reader.entries() },
            { imageInfoReader },
        );
        return errors.length > 0 ? errors : result === null ? [new Error('The archive could not be imported')] : [];
    } catch (error) {
        return [error instanceof Error ? error : new Error(String(error))];
    }
}
