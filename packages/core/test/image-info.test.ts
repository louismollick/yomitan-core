import { describe, expect, test } from 'vitest';
import { headerImageInfoReader, readImageSize } from '../src/import/image-info';

function bytes(...parts: (number[] | string)[]): Uint8Array {
    const out: number[] = [];
    for (const part of parts) {
        if (typeof part === 'string') {
            for (const char of part) {
                out.push(char.charCodeAt(0));
            }
        } else {
            out.push(...part);
        }
    }
    return new Uint8Array(out);
}
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

describe('readImageSize', () => {
    test('PNG', () => {
        const png = bytes([0x89], 'PNG\r\n\x1a\n', u32be(13), 'IHDR', u32be(640), u32be(480));
        expect(readImageSize(png, 'image/png')).toEqual({ width: 640, height: 480 });
    });
    test('GIF', () => {
        expect(readImageSize(bytes('GIF89a', u16le(12), u16le(34)), 'image/gif')).toEqual({ width: 12, height: 34 });
    });
    test('JPEG skips segments before the frame header', () => {
        const app0 = [0xff, 0xe0, ...u16be(16), ...new Array(14).fill(0)];
        const sof2 = [0xff, 0xc2, ...u16be(17), 8, ...u16be(300), ...u16be(200), 3, ...new Array(9).fill(0)];
        expect(readImageSize(bytes([0xff, 0xd8], app0, sof2), 'image/jpeg')).toEqual({ width: 200, height: 300 });
    });
    test('WebP lossy, lossless and extended', () => {
        const lossy = bytes('RIFF', u32le(0), 'WEBPVP8 ', u32le(0), [0, 0, 0, 0x9d, 0x01, 0x2a], u16le(100), u16le(50));
        expect(readImageSize(lossy, 'image/webp')).toEqual({ width: 100, height: 50 });
        const packed = (99 & 0x3fff) | ((49 & 0x3fff) << 14);
        const lossless = bytes('RIFF', u32le(0), 'WEBPVP8L', u32le(0), [0x2f], u32le(packed), [0, 0, 0, 0, 0]);
        expect(readImageSize(lossless, 'image/webp')).toEqual({ width: 100, height: 50 });
        const extended = bytes('RIFF', u32le(0), 'WEBPVP8X', u32le(10), [0, 0, 0, 0], [99, 0, 0], [49, 0, 0], [0, 0]);
        expect(readImageSize(extended, 'image/webp')).toEqual({ width: 100, height: 50 });
    });
    test('BMP with a top-down (negative) height', () => {
        const bmp = bytes('BM', new Array(16).fill(0), u32le(20), u32le(-10 >>> 0));
        expect(readImageSize(bmp, 'image/bmp')).toEqual({ width: 20, height: 10 });
    });
    test('ICO, where 0 means 256', () => {
        expect(readImageSize(bytes(u16le(0), u16le(1), u16le(1), [0, 16]), 'image/x-icon')).toEqual({
            width: 256,
            height: 16,
        });
    });
    test('TIFF in both byte orders', () => {
        const little = bytes(
            'II',
            u16le(42),
            u32le(8),
            u16le(2),
            u16le(256),
            u16le(3),
            u32le(1),
            u16le(33),
            [0, 0],
            u16le(257),
            u16le(4),
            u32le(1),
            u32le(44),
        );
        expect(readImageSize(little, 'image/tiff')).toEqual({ width: 33, height: 44 });
        const big = bytes('MM', u16be(42), u32be(8), u16be(1), u16be(256), u16be(4), u32be(1), u32be(55));
        expect(readImageSize(big, 'image/tiff')).toBeNull();
    });
    test('AVIF ispe box', () => {
        const avif = bytes(
            u32be(20),
            'ftypavif',
            new Array(8).fill(0),
            u32be(20),
            'ispe',
            u32be(0),
            u32be(320),
            u32be(240),
        );
        expect(readImageSize(avif, 'image/avif')).toEqual({ width: 320, height: 240 });
    });
    test('SVG sizes from attributes or viewBox', () => {
        const svg = (attributes: string) =>
            new TextEncoder().encode(`<?xml version="1.0"?><svg xmlns="x" ${attributes}></svg>`);
        expect(readImageSize(svg('width="30" height="40"'), 'image/svg+xml')).toEqual({ width: 30, height: 40 });
        expect(readImageSize(svg('viewBox="0 0 10 5"'), 'image/svg+xml')).toEqual({ width: 10, height: 5 });
        expect(readImageSize(svg('width="20px" viewBox="0 0 10 5"'), 'image/svg+xml')).toEqual({
            width: 20,
            height: 10,
        });
        expect(readImageSize(svg('width="50%"'), 'image/svg+xml')).toEqual({ width: 0, height: 0 });
        expect(readImageSize(svg('width="1in" height="0.5in"'), 'image/svg+xml')).toEqual({ width: 96, height: 48 });
        expect(readImageSize(svg('width="12pt" height="1pc"'), 'image/svg+xml')).toEqual({ width: 16, height: 16 });
    });
    test('unreadable raster images fail like an image that would not load', async () => {
        expect(readImageSize(bytes('not a png'), 'image/png')).toBeNull();
        await expect(headerImageInfoReader.getImageDetails(new ArrayBuffer(4), 'image/png')).rejects.toThrow(
            'Image failed to load',
        );
    });
});
