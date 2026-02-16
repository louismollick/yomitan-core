const HANGUL_BLOCK: [number, number] = [0xac00, 0xd7af];
const HANGUL_JAMO: [number, number] = [0x1100, 0x11ff];
const HANGUL_COMPATIBILITY_JAMO: [number, number] = [0x3130, 0x318f];
const HANGUL_JAMO_EXTENDED_A: [number, number] = [0xa960, 0xa97f];
const HANGUL_JAMO_EXTENDED_B: [number, number] = [0xd7b0, 0xd7ff];

const KOREAN_RANGES: [number, number][] = [
    HANGUL_BLOCK,
    HANGUL_JAMO,
    HANGUL_COMPATIBILITY_JAMO,
    HANGUL_JAMO_EXTENDED_A,
    HANGUL_JAMO_EXTENDED_B,
];

export function isCodePointKorean(codePoint: number): boolean {
    for (const [min, max] of KOREAN_RANGES) {
        if (codePoint >= min && codePoint <= max) {
            return true;
        }
    }
    return false;
}
