/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Reads image dimensions from file headers without decoding, so dictionary import records real
 * image sizes on every target. Upstream decodes each image with `Image()` and fails the import if
 * that fails; here an unreadable raster image fails the import too (overhaul plan §3.3, "Import").
 */

export type ImageSize = { width: number; height: number };

/** Upstream's `DictionaryImporter` media-loader interface. */
export interface ImageInfoReader {
    getImageDetails(
        content: ArrayBuffer,
        mediaType: string,
    ): Promise<{ content: ArrayBuffer; width: number; height: number }>;
}

/** Bytes scanned for markers in formats whose size can sit after variable-length data. */
const MAX_SCAN_BYTES = 1024 * 1024;

function u16be(b: Uint8Array, o: number): number {
    return (b[o] << 8) | b[o + 1];
}
function u16le(b: Uint8Array, o: number): number {
    return b[o] | (b[o + 1] << 8);
}
function u24le(b: Uint8Array, o: number): number {
    return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}
function u32be(b: Uint8Array, o: number): number {
    return ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
}
function i32le(b: Uint8Array, o: number): number {
    return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
}
function ascii(b: Uint8Array, o: number, length: number): string {
    let result = '';
    for (let i = 0; i < length && o + i < b.length; ++i) {
        result += String.fromCharCode(b[o + i]);
    }
    return result;
}

function readPng(b: Uint8Array): ImageSize | null {
    if (b.length < 24 || u32be(b, 0) !== 0x89504e47 || ascii(b, 12, 4) !== 'IHDR') {
        return null;
    }
    return { width: u32be(b, 16), height: u32be(b, 20) };
}

function readGif(b: Uint8Array): ImageSize | null {
    if (b.length < 10 || ascii(b, 0, 3) !== 'GIF') {
        return null;
    }
    return { width: u16le(b, 6), height: u16le(b, 8) };
}

function readJpeg(b: Uint8Array): ImageSize | null {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) {
        return null;
    }
    let offset = 2;
    const end = Math.min(b.length, MAX_SCAN_BYTES);
    while (offset + 9 < end) {
        if (b[offset] !== 0xff) {
            ++offset;
            continue;
        }
        const marker = b[offset + 1];
        if (marker === 0xff) {
            ++offset;
            continue;
        }
        // Start-of-frame markers, excluding DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { width: u16be(b, offset + 7), height: u16be(b, offset + 5) };
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }
        offset += 2 + u16be(b, offset + 2);
    }
    return null;
}

function readWebp(b: Uint8Array): ImageSize | null {
    if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') {
        return null;
    }
    switch (ascii(b, 12, 4)) {
        case 'VP8 ':
            return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
        case 'VP8L': {
            const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
            return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        }
        case 'VP8X':
            return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
        default:
            return null;
    }
}

function readBmp(b: Uint8Array): ImageSize | null {
    if (b.length < 26 || ascii(b, 0, 2) !== 'BM') {
        return null;
    }
    return { width: Math.abs(i32le(b, 18)), height: Math.abs(i32le(b, 22)) };
}

function readIco(b: Uint8Array): ImageSize | null {
    if (b.length < 8 || u16le(b, 0) !== 0 || (u16le(b, 2) !== 1 && u16le(b, 2) !== 2) || u16le(b, 4) < 1) {
        return null;
    }
    return { width: b[6] === 0 ? 256 : b[6], height: b[7] === 0 ? 256 : b[7] };
}

function readTiff(b: Uint8Array): ImageSize | null {
    if (b.length < 8) {
        return null;
    }
    const order = ascii(b, 0, 2);
    const little = order === 'II';
    if (!little && order !== 'MM') {
        return null;
    }
    const r16 = (o: number) => (little ? u16le(b, o) : u16be(b, o));
    const r32 = (o: number) => (little ? i32le(b, o) >>> 0 : u32be(b, o));
    if (r16(2) !== 42) {
        return null;
    }
    const ifd = r32(4);
    if (ifd + 2 > b.length) {
        return null;
    }
    let width = 0;
    let height = 0;
    const count = r16(ifd);
    for (let i = 0; i < count; ++i) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > b.length) {
            break;
        }
        const tag = r16(entry);
        const type = r16(entry + 2);
        const value = type === 3 ? r16(entry + 8) : r32(entry + 8);
        if (tag === 256) {
            width = value;
        } else if (tag === 257) {
            height = value;
        }
    }
    return width > 0 && height > 0 ? { width, height } : null;
}

/** AVIF and other ISO-BMFF images store the size in an `ispe` box. */
function readIsobmff(b: Uint8Array): ImageSize | null {
    if (b.length < 12 || ascii(b, 4, 4) !== 'ftyp') {
        return null;
    }
    const end = Math.min(b.length, MAX_SCAN_BYTES);
    for (let offset = 8; offset + 16 <= end; ++offset) {
        if (b[offset] === 0x69 && ascii(b, offset, 4) === 'ispe') {
            return { width: u32be(b, offset + 8), height: u32be(b, offset + 12) };
        }
    }
    return null;
}

const SVG_ABSOLUTE_LENGTH = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i;

function readSvgLength(value: string | undefined): number | null {
    if (value === undefined) {
        return null;
    }
    const match = SVG_ABSOLUTE_LENGTH.exec(value);
    return match === null ? null : Number.parseFloat(match[1]);
}

function readSvgAttribute(tag: string, name: string): string | undefined {
    const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return match === null ? undefined : (match[1] ?? match[2]);
}

/**
 * Uses the root element's absolute `width`/`height`, else its `viewBox`. An SVG with neither has no
 * intrinsic size; it records 0×0 (a listed deviation: Chromium reports 300×150 for some such files).
 */
function readSvg(b: Uint8Array): ImageSize {
    const text = ascii(b, 0, Math.min(b.length, 64 * 1024));
    const tagMatch = /<svg\b[^>]*>/i.exec(text);
    if (tagMatch === null) {
        return { width: 0, height: 0 };
    }
    const tag = tagMatch[0];
    let width = readSvgLength(readSvgAttribute(tag, 'width'));
    let height = readSvgLength(readSvgAttribute(tag, 'height'));
    const viewBox = readSvgAttribute(tag, 'viewBox')
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
    if (
        viewBox !== undefined &&
        viewBox.length === 4 &&
        viewBox.every(Number.isFinite) &&
        viewBox[2] > 0 &&
        viewBox[3] > 0
    ) {
        const [, , boxWidth, boxHeight] = viewBox;
        if (width === null && height === null) {
            width = boxWidth;
            height = boxHeight;
        } else if (width === null && height !== null) {
            width = (height * boxWidth) / boxHeight;
        } else if (height === null && width !== null) {
            height = (width * boxHeight) / boxWidth;
        }
    }
    return { width: width ?? 0, height: height ?? 0 };
}

/** Returns the image size, or `null` if the bytes are not a readable image of that type. */
export function readImageSize(content: ArrayBuffer | Uint8Array, mediaType: string): ImageSize | null {
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
    switch (mediaType) {
        case 'image/png':
        case 'image/apng':
            return readPng(bytes);
        case 'image/gif':
            return readGif(bytes);
        case 'image/jpeg':
            return readJpeg(bytes);
        case 'image/webp':
            return readWebp(bytes);
        case 'image/bmp':
            return readBmp(bytes);
        case 'image/x-icon':
            return readIco(bytes);
        case 'image/tiff':
            return readTiff(bytes);
        case 'image/avif':
            return readIsobmff(bytes);
        case 'image/svg+xml':
            return readSvg(bytes);
        default:
            return null;
    }
}

/** The default {@link ImageInfoReader}: header parsing, available on every target. */
export const headerImageInfoReader: ImageInfoReader = {
    async getImageDetails(content, mediaType) {
        const size = readImageSize(content, mediaType);
        if (size === null) {
            throw new Error('Image failed to load');
        }
        return { content, width: size.width, height: size.height };
    },
};
