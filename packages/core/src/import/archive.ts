/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type BlobLike, isBlobLike } from '../platform/types';
/** One file in a dictionary archive. */
export interface ArchiveEntry {
    /** Path inside the archive, with `/` separators. */
    readonly name: string;
    text(): Promise<string>;
    bytes(): Promise<Uint8Array>;
}

/**
 * A dictionary archive: a zip in memory, a Blob, an unpacked directory, or in-memory files. Readers
 * load file contents on demand, so an unpacked directory is never held in memory as a whole.
 */
export interface ArchiveReader {
    entries(): Promise<ArchiveEntry[]>;
    close?(): Promise<void>;
}

type ZipEntry = { filename: string; directory: boolean; getData?: (writer: unknown) => Promise<unknown> };

/**
 * Reads a `.zip` held in memory or in a Blob. Needs `TextDecoder` and streams (browsers, workers,
 * Node); zip.js is loaded on first use. React Native reads unpacked directories instead.
 */
export function createZipArchiveReader(source: ArrayBuffer | Uint8Array | BlobLike): ArchiveReader {
    let reader: { getEntries(): Promise<ZipEntry[]>; close(): Promise<unknown> } | null = null;
    return {
        async entries() {
            const { BlobReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } = await import(
                '../upstream/ext/lib/zip-full.js'
            );
            let input: unknown;
            if (typeof Blob !== 'undefined' && source instanceof Blob) {
                input = new BlobReader(source);
            } else if (isBlobLike(source)) {
                input = new Uint8ArrayReader(new Uint8Array(await source.arrayBuffer()));
            } else {
                input = new Uint8ArrayReader(source instanceof Uint8Array ? source : new Uint8Array(source));
            }
            reader = new ZipReader(input) as unknown as NonNullable<typeof reader>;
            const entries = await (reader as NonNullable<typeof reader>).getEntries();
            return entries
                .filter((entry) => !entry.directory)
                .map((entry) => ({
                    name: entry.filename,
                    async text() {
                        return (await entry.getData?.(new TextWriter())) as string;
                    },
                    async bytes() {
                        return (await entry.getData?.(new Uint8ArrayWriter())) as Uint8Array;
                    },
                }));
        },
        async close() {
            await reader?.close();
            reader = null;
        },
    };
}

/**
 * Reads files already in memory, keyed by archive path. Strings are file text; byte arrays are file
 * content. Useful for tests and for platforms that unpack archives natively.
 */
export function createFilesArchiveReader(files: Record<string, string | Uint8Array>): ArchiveReader {
    return {
        async entries() {
            return Object.entries(files).map(([name, content]) => ({
                name,
                async text() {
                    if (typeof content === 'string') {
                        return content;
                    }
                    return decodeUtf8(content);
                },
                async bytes() {
                    return typeof content === 'string' ? encodeUtf8(content) : content;
                },
            }));
        },
    };
}

function encodeUtf8(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

/** UTF-8 decoding that does not depend on `TextDecoder`, which React Native lacks. */
export function decodeUtf8(bytes: Uint8Array): string {
    if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder('utf-8').decode(bytes);
    }
    let result = '';
    const chunk: number[] = [];
    for (let i = 0; i < bytes.length; ) {
        const b0 = bytes[i++];
        let codePoint: number;
        if (b0 < 0x80) {
            codePoint = b0;
        } else if (b0 >= 0xc0 && b0 < 0xe0) {
            codePoint = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
        } else if (b0 >= 0xe0 && b0 < 0xf0) {
            codePoint = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else if (b0 >= 0xf0 && b0 < 0xf8) {
            codePoint =
                ((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else {
            codePoint = 0xfffd;
        }
        if (codePoint > 0xffff) {
            codePoint -= 0x10000;
            chunk.push(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
        } else {
            chunk.push(codePoint);
        }
        if (chunk.length >= 8192) {
            result += String.fromCharCode(...chunk);
            chunk.length = 0;
        }
    }
    return result + String.fromCharCode(...chunk);
}
