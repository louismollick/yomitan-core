import type { TextProcessor } from '../types/language';
import { basicTextProcessorOptions } from './text-processors';

export type CodepointRange = [number, number];

const CJK_UNIFIED_IDEOGRAPHS_RANGE: CodepointRange = [0x4e00, 0x9fff];
const CJK_UNIFIED_IDEOGRAPHS_EXTENSION_A_RANGE: CodepointRange = [0x3400, 0x4dbf];
const CJK_UNIFIED_IDEOGRAPHS_EXTENSION_B_RANGE: CodepointRange = [0x20000, 0x2a6df];
const CJK_UNIFIED_IDEOGRAPHS_EXTENSION_C_RANGE: CodepointRange = [0x2a700, 0x2b73f];
const CJK_UNIFIED_IDEOGRAPHS_EXTENSION_D_RANGE: CodepointRange = [0x2b740, 0x2b81f];
const CJK_UNIFIED_IDEOGRAPHS_EXTENSION_E_RANGE: CodepointRange = [0x2b820, 0x2ceaf];
const CJK_UNIFIED_IDEOGRAPHS_EXTENSION_F_RANGE: CodepointRange = [0x2ceb0, 0x2ebef];
const CJK_UNIFIED_IDEOGRAPHS_EXTENSION_G_RANGE: CodepointRange = [0x30000, 0x3134f];
const CJK_UNIFIED_IDEOGRAPHS_EXTENSION_H_RANGE: CodepointRange = [0x31350, 0x323af];
const CJK_UNIFIED_IDEOGRAPHS_EXTENSION_I_RANGE: CodepointRange = [0x2ebf0, 0x2ee5f];
const CJK_COMPATIBILITY_IDEOGRAPHS_RANGE: CodepointRange = [0xf900, 0xfaff];
const CJK_COMPATIBILITY_IDEOGRAPHS_SUPPLEMENT_RANGE: CodepointRange = [0x2f800, 0x2fa1f];

export const CJK_IDEOGRAPH_RANGES: CodepointRange[] = [
    CJK_UNIFIED_IDEOGRAPHS_RANGE,
    CJK_UNIFIED_IDEOGRAPHS_EXTENSION_A_RANGE,
    CJK_UNIFIED_IDEOGRAPHS_EXTENSION_B_RANGE,
    CJK_UNIFIED_IDEOGRAPHS_EXTENSION_C_RANGE,
    CJK_UNIFIED_IDEOGRAPHS_EXTENSION_D_RANGE,
    CJK_UNIFIED_IDEOGRAPHS_EXTENSION_E_RANGE,
    CJK_UNIFIED_IDEOGRAPHS_EXTENSION_F_RANGE,
    CJK_UNIFIED_IDEOGRAPHS_EXTENSION_G_RANGE,
    CJK_UNIFIED_IDEOGRAPHS_EXTENSION_H_RANGE,
    CJK_UNIFIED_IDEOGRAPHS_EXTENSION_I_RANGE,
    CJK_COMPATIBILITY_IDEOGRAPHS_RANGE,
    CJK_COMPATIBILITY_IDEOGRAPHS_SUPPLEMENT_RANGE,
];

export const FULLWIDTH_CHARACTER_RANGES: CodepointRange[] = [
    [0xff10, 0xff19],
    [0xff21, 0xff3a],
    [0xff41, 0xff5a],
    [0xff01, 0xff0f],
    [0xff1a, 0xff1f],
    [0xff3b, 0xff3f],
    [0xff5b, 0xff60],
    [0xffe0, 0xffee],
];

export const CJK_PUNCTUATION_RANGE: CodepointRange = [0x3000, 0x303f];

export const CJK_COMPATIBILITY: CodepointRange = [0x3300, 0x33ff];

export function isCodePointInRange(codePoint: number, [min, max]: CodepointRange): boolean {
    return codePoint >= min && codePoint <= max;
}

export function isCodePointInRanges(codePoint: number, ranges: CodepointRange[]): boolean {
    for (const [min, max] of ranges) {
        if (codePoint >= min && codePoint <= max) {
            return true;
        }
    }
    return false;
}

export const KANGXI_RADICALS_RANGE: CodepointRange = [0x2f00, 0x2fdf];
export const CJK_RADICALS_SUPPLEMENT_RANGE: CodepointRange = [0x2e80, 0x2eff];
export const CJK_STROKES_RANGE: CodepointRange = [0x31c0, 0x31ef];

export const CJK_RADICALS_RANGES: CodepointRange[] = [
    KANGXI_RADICALS_RANGE,
    CJK_RADICALS_SUPPLEMENT_RANGE,
    CJK_STROKES_RANGE,
];

export function normalizeRadicals(text: string): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const codePoint = text[i].codePointAt(0);
        result +=
            codePoint && isCodePointInRanges(codePoint, CJK_RADICALS_RANGES) ? text[i].normalize('NFKD') : text[i];
    }
    return result;
}

export const normalizeRadicalCharacters: TextProcessor<boolean> = {
    name: 'Normalize radical characters',
    description: '⼀ → 一 (U+2F00 → U+4E00)',
    options: basicTextProcessorOptions,
    process: (str, setting) => (setting ? normalizeRadicals(str) : str),
};
