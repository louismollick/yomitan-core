import {
    CJK_IDEOGRAPH_RANGES,
    CJK_PUNCTUATION_RANGE,
    FULLWIDTH_CHARACTER_RANGES,
    isCodePointInRanges,
} from '../cjk-util';
import type { CodepointRange } from '../cjk-util';

const BOPOMOFO_RANGE: CodepointRange = [0x3100, 0x312f];
const BOPOMOFO_EXTENDED_RANGE: CodepointRange = [0x31a0, 0x31bf];
const IDEOGRAPHIC_SYMBOLS_AND_PUNCTUATION_RANGE: CodepointRange = [0x16fe0, 0x16fff];
const SMALL_FORM_RANGE: CodepointRange = [0xfe50, 0xfe6f];
const VERTICAL_FORM_RANGE: CodepointRange = [0xfe10, 0xfe1f];

const CHINESE_RANGES: CodepointRange[] = [
    ...CJK_IDEOGRAPH_RANGES,
    CJK_PUNCTUATION_RANGE,
    ...FULLWIDTH_CHARACTER_RANGES,
    BOPOMOFO_RANGE,
    BOPOMOFO_EXTENDED_RANGE,
    IDEOGRAPHIC_SYMBOLS_AND_PUNCTUATION_RANGE,
    SMALL_FORM_RANGE,
    VERTICAL_FORM_RANGE,
];

export function isStringPartiallyChinese(str: string): boolean {
    if (str.length === 0) {
        return false;
    }
    for (const c of str) {
        if (isCodePointInRanges(c.codePointAt(0) as number, CHINESE_RANGES)) {
            return true;
        }
    }
    return false;
}

export function isCodePointChinese(codePoint: number): boolean {
    return isCodePointInRanges(codePoint, CHINESE_RANGES);
}

export function normalizePinyin(str: string): string {
    return str
        .normalize('NFC')
        .toLowerCase()
        .replace(/[\s\u30FB:''\u2019-]|\/\//g, '');
}
