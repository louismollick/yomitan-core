import type { TextProcessor } from '../../types/language';

// Hangul syllable decomposition/composition constants
const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const LEAD_BASE = 0x1100;
const VOWEL_BASE = 0x1161;
const TAIL_BASE = 0x11a7;
const LEAD_COUNT = 19;
const VOWEL_COUNT = 21;
const TAIL_COUNT = 28;
const SYLLABLE_COUNT = VOWEL_COUNT * TAIL_COUNT;

const COMPAT_LEADS =
    '\u3131\u3132\u3134\u3137\u3138\u3139\u3141\u3142\u3143\u3145\u3146\u3147\u3148\u3149\u314A\u314B\u314C\u314D\u314E';
const COMPAT_VOWELS =
    '\u314F\u3150\u3151\u3152\u3153\u3154\u3155\u3156\u3157\u3158\u3159\u315A\u315B\u315C\u315D\u315E\u315F\u3160\u3161\u3162\u3163';
const COMPAT_TAILS =
    '\u3131\u3132\u3133\u3134\u3135\u3136\u3137\u3139\u313A\u313B\u313C\u313D\u313E\u313F\u3140\u3141\u3142\u3144\u3145\u3146\u3147\u3148\u314A\u314B\u314C\u314D\u314E';

function isHangulSyllable(code: number): boolean {
    return code >= HANGUL_BASE && code <= HANGUL_END;
}

function decomposeSyllable(code: number): string[] {
    const syllableIndex = code - HANGUL_BASE;
    const leadIndex = Math.floor(syllableIndex / SYLLABLE_COUNT);
    const vowelIndex = Math.floor((syllableIndex % SYLLABLE_COUNT) / TAIL_COUNT);
    const tailIndex = syllableIndex % TAIL_COUNT;

    const result: string[] = [COMPAT_LEADS[leadIndex], COMPAT_VOWELS[vowelIndex]];
    if (tailIndex > 0) {
        result.push(COMPAT_TAILS[tailIndex - 1]);
    }
    return result;
}

function disassemble(str: string): string[] {
    const result: string[] = [];
    for (const char of str) {
        const code = char.codePointAt(0) as number;
        if (isHangulSyllable(code)) {
            result.push(...decomposeSyllable(code));
        } else {
            result.push(char);
        }
    }
    return result;
}

function assemble(str: string): string {
    const chars = [...str];
    let result = '';
    let i = 0;

    while (i < chars.length) {
        const leadIdx = COMPAT_LEADS.indexOf(chars[i]);
        if (leadIdx >= 0 && i + 1 < chars.length) {
            const vowelIdx = COMPAT_VOWELS.indexOf(chars[i + 1]);
            if (vowelIdx >= 0) {
                let tailIdx = 0;
                if (i + 2 < chars.length) {
                    const possibleTail = COMPAT_TAILS.indexOf(chars[i + 2]);
                    if (possibleTail >= 0) {
                        // Check if next char forms a new syllable (look ahead)
                        if (
                            i + 3 < chars.length &&
                            COMPAT_VOWELS.indexOf(chars[i + 3]) >= 0 &&
                            COMPAT_LEADS.indexOf(chars[i + 2]) >= 0
                        ) {
                            // The tail char is actually the lead of the next syllable
                            tailIdx = 0;
                        } else {
                            tailIdx = possibleTail + 1;
                            i++;
                        }
                    }
                }
                const code = HANGUL_BASE + leadIdx * SYLLABLE_COUNT + vowelIdx * TAIL_COUNT + tailIdx;
                result += String.fromCodePoint(code);
                i += 2;
                continue;
            }
        }
        result += chars[i];
        i++;
    }
    return result;
}

export const disassembleHangul: TextProcessor<boolean> = {
    name: 'Disassemble Hangul',
    description: 'Disassemble Hangul characters into jamo.',
    options: [true],
    process: (str) => {
        return disassemble(str).join('');
    },
};

export const reassembleHangul: TextProcessor<boolean> = {
    name: 'Reassemble Hangul',
    description: 'Reassemble Hangul characters from jamo.',
    options: [true],
    process: (str) => {
        return assemble(str);
    },
};
