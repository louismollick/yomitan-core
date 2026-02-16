import {
    CJK_COMPATIBILITY,
    CJK_IDEOGRAPH_RANGES,
    CJK_PUNCTUATION_RANGE,
    FULLWIDTH_CHARACTER_RANGES,
    isCodePointInRange,
    isCodePointInRanges,
} from '../cjk-util';
import type { CodepointRange } from '../cjk-util';

export type FuriganaSegment = {
    text: string;
    reading: string;
};

export type FuriganaGroup = {
    isKana: boolean;
    text: string;
    textNormalized: string | null;
};

export type DiacriticType = 'dakuten' | 'handakuten';

export type PitchCategory = 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka' | 'kifuku';

const HIRAGANA_SMALL_TSU_CODE_POINT = 0x3063;
const KATAKANA_SMALL_TSU_CODE_POINT = 0x30c3;
const KATAKANA_SMALL_KA_CODE_POINT = 0x30f5;
const KATAKANA_SMALL_KE_CODE_POINT = 0x30f6;
const KANA_PROLONGED_SOUND_MARK_CODE_POINT = 0x30fc;

const HIRAGANA_RANGE: CodepointRange = [0x3040, 0x309f];
const KATAKANA_RANGE: CodepointRange = [0x30a0, 0x30ff];

const HIRAGANA_CONVERSION_RANGE: CodepointRange = [0x3041, 0x3096];
const KATAKANA_CONVERSION_RANGE: CodepointRange = [0x30a1, 0x30f6];

const KANA_RANGES: CodepointRange[] = [HIRAGANA_RANGE, KATAKANA_RANGE];

const JAPANESE_RANGES: CodepointRange[] = [
    HIRAGANA_RANGE,
    KATAKANA_RANGE,
    ...CJK_IDEOGRAPH_RANGES,
    [0xff66, 0xff9f], // Halfwidth katakana
    [0x30fb, 0x30fc], // Katakana punctuation
    [0xff61, 0xff65], // Kana punctuation
    CJK_PUNCTUATION_RANGE,
    ...FULLWIDTH_CHARACTER_RANGES,
];

const SMALL_KANA_SET = new Set('ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ');

const HALFWIDTH_KATAKANA_MAPPING = new Map<string, string>([
    ['･', '・--'],
    ['ｦ', 'ヲヺ-'],
    ['ｧ', 'ァ--'],
    ['ｨ', 'ィ--'],
    ['ｩ', 'ゥ--'],
    ['ｪ', 'ェ--'],
    ['ｫ', 'ォ--'],
    ['ｬ', 'ャ--'],
    ['ｭ', 'ュ--'],
    ['ｮ', 'ョ--'],
    ['ｯ', 'ッ--'],
    ['ｰ', 'ー--'],
    ['ｱ', 'ア--'],
    ['ｲ', 'イ--'],
    ['ｳ', 'ウヴ-'],
    ['ｴ', 'エ--'],
    ['ｵ', 'オ--'],
    ['ｶ', 'カガ-'],
    ['ｷ', 'キギ-'],
    ['ｸ', 'クグ-'],
    ['ｹ', 'ケゲ-'],
    ['ｺ', 'コゴ-'],
    ['ｻ', 'サザ-'],
    ['ｼ', 'シジ-'],
    ['ｽ', 'スズ-'],
    ['ｾ', 'セゼ-'],
    ['ｿ', 'ソゾ-'],
    ['ﾀ', 'タダ-'],
    ['ﾁ', 'チヂ-'],
    ['ﾂ', 'ツヅ-'],
    ['ﾃ', 'テデ-'],
    ['ﾄ', 'トド-'],
    ['ﾅ', 'ナ--'],
    ['ﾆ', 'ニ--'],
    ['ﾇ', 'ヌ--'],
    ['ﾈ', 'ネ--'],
    ['ﾉ', 'ノ--'],
    ['ﾊ', 'ハバパ'],
    ['ﾋ', 'ヒビピ'],
    ['ﾌ', 'フブプ'],
    ['ﾍ', 'ヘベペ'],
    ['ﾎ', 'ホボポ'],
    ['ﾏ', 'マ--'],
    ['ﾐ', 'ミ--'],
    ['ﾑ', 'ム--'],
    ['ﾒ', 'メ--'],
    ['ﾓ', 'モ--'],
    ['ﾔ', 'ヤ--'],
    ['ﾕ', 'ユ--'],
    ['ﾖ', 'ヨ--'],
    ['ﾗ', 'ラ--'],
    ['ﾘ', 'リ--'],
    ['ﾙ', 'ル--'],
    ['ﾚ', 'レ--'],
    ['ﾛ', 'ロ--'],
    ['ﾜ', 'ワ--'],
    ['ﾝ', 'ン--'],
]);

const VOWEL_TO_KANA_MAPPING = new Map<string, string>([
    ['a', 'ぁあかがさざただなはばぱまゃやらゎわヵァアカガサザタダナハバパマャヤラヮワヵヷ'],
    ['i', 'ぃいきぎしじちぢにひびぴみりゐィイキギシジチヂニヒビピミリヰヸ'],
    ['u', 'ぅうくぐすずっつづぬふぶぷむゅゆるゥウクグスズッツヅヌフブプムュユルヴ'],
    ['e', 'ぇえけげせぜてでねへべぺめれゑヶェエケゲセゼテデネヘベペメレヱヶヹ'],
    ['o', 'ぉおこごそぞとどのほぼぽもょよろをォオコゴソゾトドノホボポモョヨロヲヺ'],
    ['', 'のノ'],
]);

const KANA_TO_VOWEL_MAPPING = new Map<string, string>();
for (const [vowel, characters] of VOWEL_TO_KANA_MAPPING) {
    for (const character of characters) {
        KANA_TO_VOWEL_MAPPING.set(character, vowel);
    }
}

const kana =
    'うゔ-かが-きぎ-くぐ-けげ-こご-さざ-しじ-すず-せぜ-そぞ-ただ-ちぢ-つづ-てで-とど-はばぱひびぴふぶぷへべぺほぼぽワヷ-ヰヸ-ウヴ-ヱヹ-ヲヺ-カガ-キギ-クグ-ケゲ-コゴ-サザ-シジ-スズ-セゼ-ソゾ-タダ-チヂ-ツヅ-テデ-トド-ハバパヒビピフブプヘベペホボポ';
const DIACRITIC_MAPPING = new Map<string, { character: string; type: DiacriticType }>();
for (let i = 0, ii = kana.length; i < ii; i += 3) {
    const character = kana[i];
    const dakuten = kana[i + 1];
    const handakuten = kana[i + 2];
    DIACRITIC_MAPPING.set(dakuten, { character, type: 'dakuten' });
    if (handakuten !== '-') {
        DIACRITIC_MAPPING.set(handakuten, { character, type: 'handakuten' });
    }
}

function getProlongedHiragana(previousCharacter: string): string | null {
    switch (KANA_TO_VOWEL_MAPPING.get(previousCharacter)) {
        case 'a':
            return 'あ';
        case 'i':
            return 'い';
        case 'u':
            return 'う';
        case 'e':
            return 'え';
        case 'o':
            return 'う';
        default:
            return null;
    }
}

function createFuriganaSegment(text: string, reading: string): FuriganaSegment {
    return { text, reading };
}

function segmentizeFurigana(
    reading: string,
    readingNormalized: string,
    groups: FuriganaGroup[],
    groupsStart: number,
): FuriganaSegment[] | null {
    const groupCount = groups.length - groupsStart;
    if (groupCount <= 0) {
        return reading.length === 0 ? [] : null;
    }

    const group = groups[groupsStart];
    const { isKana, text } = group;
    const textLength = text.length;
    if (isKana) {
        const { textNormalized } = group;
        if (textNormalized !== null && readingNormalized.startsWith(textNormalized)) {
            const segments = segmentizeFurigana(
                reading.substring(textLength),
                readingNormalized.substring(textLength),
                groups,
                groupsStart + 1,
            );
            if (segments !== null) {
                if (reading.startsWith(text)) {
                    segments.unshift(createFuriganaSegment(text, ''));
                } else {
                    segments.unshift(...getFuriganaKanaSegments(text, reading));
                }
                return segments;
            }
        }
        return null;
    }
    let result: FuriganaSegment[] | null = null;
    for (let i = reading.length; i >= textLength; --i) {
        const segments = segmentizeFurigana(
            reading.substring(i),
            readingNormalized.substring(i),
            groups,
            groupsStart + 1,
        );
        if (segments !== null) {
            if (result !== null) {
                // More than one way to segmentize the tail; mark as ambiguous
                return null;
            }
            const segmentReading = reading.substring(0, i);
            segments.unshift(createFuriganaSegment(text, segmentReading));
            result = segments;
        }
        // There is only one way to segmentize the last non-kana group
        if (groupCount === 1) {
            break;
        }
    }
    return result;
}

function getFuriganaKanaSegments(text: string, reading: string): FuriganaSegment[] {
    const textLength = text.length;
    const newSegments: FuriganaSegment[] = [];
    let start = 0;
    let state = reading[0] === text[0];
    for (let i = 1; i < textLength; ++i) {
        const newState = reading[i] === text[i];
        if (state === newState) {
            continue;
        }
        newSegments.push(createFuriganaSegment(text.substring(start, i), state ? '' : reading.substring(start, i)));
        state = newState;
        start = i;
    }
    newSegments.push(
        createFuriganaSegment(text.substring(start, textLength), state ? '' : reading.substring(start, textLength)),
    );
    return newSegments;
}

function getStemLength(text1: string, text2: string): number {
    const minLength = Math.min(text1.length, text2.length);
    if (minLength === 0) {
        return 0;
    }

    let i = 0;
    while (true) {
        const char1 = text1.codePointAt(i) as number;
        const char2 = text2.codePointAt(i) as number;
        if (char1 !== char2) {
            break;
        }
        const charLength = String.fromCodePoint(char1).length;
        i += charLength;
        if (i >= minLength) {
            if (i > minLength) {
                i -= charLength; // Don't consume partial UTF16 surrogate characters
            }
            break;
        }
    }
    return i;
}

// Character code testing functions

export function isCodePointKanji(codePoint: number): boolean {
    return isCodePointInRanges(codePoint, CJK_IDEOGRAPH_RANGES);
}

export function isCodePointKana(codePoint: number): boolean {
    return isCodePointInRanges(codePoint, KANA_RANGES);
}

export function isCodePointJapanese(codePoint: number): boolean {
    return isCodePointInRanges(codePoint, JAPANESE_RANGES);
}

// String testing functions

export function isStringEntirelyKana(str: string): boolean {
    if (str.length === 0) {
        return false;
    }
    for (const c of str) {
        if (!isCodePointInRanges(c.codePointAt(0) as number, KANA_RANGES)) {
            return false;
        }
    }
    return true;
}

export function isStringPartiallyJapanese(str: string): boolean {
    if (str.length === 0) {
        return false;
    }
    for (const c of str) {
        if (isCodePointInRanges(c.codePointAt(0) as number, JAPANESE_RANGES)) {
            return true;
        }
    }
    return false;
}

// Mora functions

export function isMoraPitchHigh(moraIndex: number, pitchAccentValue: number | string): boolean {
    if (typeof pitchAccentValue === 'string') {
        return pitchAccentValue[moraIndex] === 'H';
    }
    switch (pitchAccentValue) {
        case 0:
            return moraIndex > 0;
        case 1:
            return moraIndex < 1;
        default:
            return moraIndex > 0 && moraIndex < pitchAccentValue;
    }
}

export function getPitchCategory(
    text: string,
    pitchAccentValue: number | string,
    isVerbOrAdjective: boolean,
): PitchCategory | null {
    const pitchAccentDownstepPosition =
        typeof pitchAccentValue === 'string' ? getDownstepPositions(pitchAccentValue)[0] : pitchAccentValue;
    if (pitchAccentDownstepPosition === 0) {
        return 'heiban';
    }
    if (isVerbOrAdjective) {
        return pitchAccentDownstepPosition > 0 ? 'kifuku' : null;
    }
    if (pitchAccentDownstepPosition === 1) {
        return 'atamadaka';
    }
    if (pitchAccentDownstepPosition > 1) {
        return pitchAccentDownstepPosition >= getKanaMoraCount(text) ? 'odaka' : 'nakadaka';
    }
    return null;
}

export function getDownstepPositions(pitchString: string): number[] {
    const downsteps: number[] = [];
    const moraCount = pitchString.length;
    for (let i = 0; i < moraCount; i++) {
        if (i > 0 && pitchString[i - 1] === 'H' && pitchString[i] === 'L') {
            downsteps.push(i);
        }
    }
    if (downsteps.length === 0) {
        downsteps.push(pitchString.startsWith('L') ? 0 : -1);
    }
    return downsteps;
}

export function getKanaMorae(text: string): string[] {
    const morae: string[] = [];
    let i: number;
    for (const c of text) {
        if (SMALL_KANA_SET.has(c) && (i = morae.length) > 0) {
            morae[i - 1] += c;
        } else {
            morae.push(c);
        }
    }
    return morae;
}

export function getKanaMoraCount(text: string): number {
    let moraCount = 0;
    for (const c of text) {
        if (!(SMALL_KANA_SET.has(c) && moraCount > 0)) {
            ++moraCount;
        }
    }
    return moraCount;
}

// Conversion functions

export function convertKatakanaToHiragana(text: string, keepProlongedSoundMarks = false): string {
    let result = '';
    const offset = HIRAGANA_CONVERSION_RANGE[0] - KATAKANA_CONVERSION_RANGE[0];
    for (let char of text) {
        const codePoint = char.codePointAt(0) as number;
        switch (codePoint) {
            case KATAKANA_SMALL_KA_CODE_POINT:
            case KATAKANA_SMALL_KE_CODE_POINT:
                // No change
                break;
            case KANA_PROLONGED_SOUND_MARK_CODE_POINT:
                if (!keepProlongedSoundMarks && result.length > 0) {
                    const char2 = getProlongedHiragana(result[result.length - 1]);
                    if (char2 !== null) {
                        char = char2;
                    }
                }
                break;
            default:
                if (isCodePointInRange(codePoint, KATAKANA_CONVERSION_RANGE)) {
                    char = String.fromCodePoint(codePoint + offset);
                }
                break;
        }
        result += char;
    }
    return result;
}

export function convertHiraganaToKatakana(text: string): string {
    let result = '';
    const offset = KATAKANA_CONVERSION_RANGE[0] - HIRAGANA_CONVERSION_RANGE[0];
    for (let char of text) {
        const codePoint = char.codePointAt(0) as number;
        if (isCodePointInRange(codePoint, HIRAGANA_CONVERSION_RANGE)) {
            char = String.fromCodePoint(codePoint + offset);
        }
        result += char;
    }
    return result;
}

export function convertAlphanumericToFullWidth(text: string): string {
    let result = '';
    for (const char of text) {
        let c = char.codePointAt(0) as number;
        if (c >= 0x30 && c <= 0x39) {
            // ['0', '9']
            c += 0xff10 - 0x30;
        } else if (c >= 0x41 && c <= 0x5a) {
            // ['A', 'Z']
            c += 0xff21 - 0x41;
        } else if (c >= 0x61 && c <= 0x7a) {
            // ['a', 'z']
            c += 0xff41 - 0x61;
        }
        result += String.fromCodePoint(c);
    }
    return result;
}

export function convertFullWidthAlphanumericToNormal(text: string): string {
    let result = '';
    const length = text.length;
    for (let i = 0; i < length; i++) {
        let c = text[i].codePointAt(0) as number;
        if (c >= 0xff10 && c <= 0xff19) {
            // ['0', '9']
            c -= 0xff10 - 0x30;
        } else if (c >= 0xff21 && c <= 0xff3a) {
            // ['A', 'Z']
            c -= 0xff21 - 0x41;
        } else if (c >= 0xff41 && c <= 0xff5a) {
            // ['a', 'z']
            c -= 0xff41 - 0x61;
        }
        result += String.fromCodePoint(c);
    }
    return result;
}

export function convertHalfWidthKanaToFullWidth(text: string): string {
    let result = '';

    for (let i = 0, ii = text.length; i < ii; ++i) {
        const c = text[i];
        const mapping = HALFWIDTH_KATAKANA_MAPPING.get(c);
        if (typeof mapping !== 'string') {
            result += c;
            continue;
        }

        let index = 0;
        switch (text.charCodeAt(i + 1)) {
            case 0xff9e: // Dakuten
                index = 1;
                break;
            case 0xff9f: // Handakuten
                index = 2;
                break;
        }

        let c2 = mapping[index];
        if (index > 0) {
            if (c2 === '-') {
                // Invalid
                index = 0;
                c2 = mapping[0];
            } else {
                ++i;
            }
        }

        result += c2;
    }

    return result;
}

export function getKanaDiacriticInfo(character: string): { character: string; type: DiacriticType } | null {
    const info = DIACRITIC_MAPPING.get(character);
    return typeof info !== 'undefined' ? { character: info.character, type: info.type } : null;
}

function dakutenAllowed(codePoint: number): boolean {
    return (
        (codePoint >= 0x304b && codePoint <= 0x3068) ||
        (codePoint >= 0x306f && codePoint <= 0x307b) ||
        (codePoint >= 0x30ab && codePoint <= 0x30c8) ||
        (codePoint >= 0x30cf && codePoint <= 0x30db)
    );
}

function handakutenAllowed(codePoint: number): boolean {
    return (codePoint >= 0x306f && codePoint <= 0x307b) || (codePoint >= 0x30cf && codePoint <= 0x30db);
}

export function normalizeCombiningCharacters(text: string): string {
    let result = '';
    let i = text.length - 1;
    while (i > 0) {
        if (text[i] === '\u3099') {
            const dakutenCombinee = text[i - 1].codePointAt(0);
            if (dakutenCombinee && dakutenAllowed(dakutenCombinee)) {
                result = String.fromCodePoint(dakutenCombinee + 1) + result;
                i -= 2;
                continue;
            }
        } else if (text[i] === '\u309A') {
            const handakutenCombinee = text[i - 1].codePointAt(0);
            if (handakutenCombinee && handakutenAllowed(handakutenCombinee)) {
                result = String.fromCodePoint(handakutenCombinee + 2) + result;
                i -= 2;
                continue;
            }
        }
        result = text[i] + result;
        i--;
    }
    if (i === 0) {
        result = text[0] + result;
    }
    return result;
}

export function normalizeCJKCompatibilityCharacters(text: string): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const codePoint = text[i].codePointAt(0);
        result += codePoint && isCodePointInRange(codePoint, CJK_COMPATIBILITY) ? text[i].normalize('NFKD') : text[i];
    }
    return result;
}

// Furigana distribution

export function distributeFurigana(term: string, reading: string): FuriganaSegment[] {
    if (reading === term) {
        return [createFuriganaSegment(term, '')];
    }

    const groups: FuriganaGroup[] = [];
    let groupPre: FuriganaGroup | null = null;
    let isKanaPre: boolean | null = null;
    for (const c of term) {
        const codePoint = c.codePointAt(0) as number;
        const isKana = isCodePointKana(codePoint);
        if (isKana === isKanaPre) {
            (groupPre as FuriganaGroup).text += c;
        } else {
            groupPre = { isKana, text: c, textNormalized: null };
            groups.push(groupPre);
            isKanaPre = isKana;
        }
    }
    for (const group of groups) {
        if (group.isKana) {
            group.textNormalized = convertKatakanaToHiragana(group.text);
        }
    }

    const readingNormalized = convertKatakanaToHiragana(reading);
    const segments = segmentizeFurigana(reading, readingNormalized, groups, 0);
    if (segments !== null) {
        return segments;
    }

    // Fallback
    return [createFuriganaSegment(term, reading)];
}

export function distributeFuriganaInflected(term: string, reading: string, source: string): FuriganaSegment[] {
    const termNormalized = convertKatakanaToHiragana(term);
    const readingNormalized = convertKatakanaToHiragana(reading);
    const sourceNormalized = convertKatakanaToHiragana(source);

    let mainText = term;
    let stemLength = getStemLength(termNormalized, sourceNormalized);

    const readingStemLength = getStemLength(readingNormalized, sourceNormalized);
    if (readingStemLength > 0 && readingStemLength >= stemLength) {
        mainText = reading;
        stemLength = readingStemLength;
        reading = `${source.substring(0, stemLength)}${reading.substring(stemLength)}`;
    }

    const segments: FuriganaSegment[] = [];
    if (stemLength > 0) {
        mainText = `${source.substring(0, stemLength)}${mainText.substring(stemLength)}`;
        const segments2 = distributeFurigana(mainText, reading);
        let consumed = 0;
        for (const segment of segments2) {
            const { text } = segment;
            const start = consumed;
            consumed += text.length;
            if (consumed < stemLength) {
                segments.push(segment);
            } else if (consumed === stemLength) {
                segments.push(segment);
                break;
            } else {
                if (start < stemLength) {
                    segments.push(createFuriganaSegment(mainText.substring(start, stemLength), ''));
                }
                break;
            }
        }
    }

    if (stemLength < source.length) {
        const remainder = source.substring(stemLength);
        const segmentCount = segments.length;
        if (segmentCount > 0 && segments[segmentCount - 1].reading.length === 0) {
            segments[segmentCount - 1].text += remainder;
        } else {
            segments.push(createFuriganaSegment(remainder, ''));
        }
    }

    return segments;
}

// Miscellaneous

export function isEmphaticCodePoint(codePoint: number): boolean {
    return (
        codePoint === HIRAGANA_SMALL_TSU_CODE_POINT ||
        codePoint === KATAKANA_SMALL_TSU_CODE_POINT ||
        codePoint === KANA_PROLONGED_SOUND_MARK_CODE_POINT
    );
}

export function collapseEmphaticSequences(text: string, fullCollapse: boolean): string {
    let left = 0;
    while (left < text.length && isEmphaticCodePoint(text.codePointAt(left) as number)) {
        ++left;
    }
    let right = text.length - 1;
    while (right >= 0 && isEmphaticCodePoint(text.codePointAt(right) as number)) {
        --right;
    }
    if (left > right) {
        return text;
    }

    const leadingEmphatics = text.substring(0, left);
    const trailingEmphatics = text.substring(right + 1);
    let middle = '';
    let currentCollapsedCodePoint = -1;

    for (let i = left; i <= right; ++i) {
        const char = text[i];
        const codePoint = char.codePointAt(0) as number;
        if (isEmphaticCodePoint(codePoint)) {
            if (currentCollapsedCodePoint !== codePoint) {
                currentCollapsedCodePoint = codePoint;
                if (!fullCollapse) {
                    middle += char;
                }
            }
        } else {
            currentCollapsedCodePoint = -1;
            middle += char;
        }
    }

    return leadingEmphatics + middle + trailingEmphatics;
}
