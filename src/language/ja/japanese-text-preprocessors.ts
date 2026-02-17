import type { BidirectionalConversionPreprocessor, TextProcessor } from '../../types/language';
import { basicTextProcessorOptions } from '../text-processors';
import itaijiList from 'kanji-processor/dist/itaiji_list.json';
import mappings from 'kanji-processor/dist/full_list.json';
import {
    collapseEmphaticSequences as collapseEmphaticSequencesFunction,
    convertAlphanumericToFullWidth,
    convertFullWidthAlphanumericToNormal,
    convertHalfWidthKanaToFullWidth,
    convertHiraganaToKatakana as convertHiraganaToKatakanaFunction,
    convertKatakanaToHiragana as convertKatakanaToHiraganaFunction,
    normalizeCJKCompatibilityCharacters as normalizeCJKCompatibilityCharactersFunction,
    normalizeCombiningCharacters as normalizeCombiningCharactersFunction,
} from './japanese';
import { convertAlphabeticToKana } from './japanese-wanakana';

let kanjiVariantRegex: RegExp | null = null;
let kanjiVariantMap: Map<string, string> | null = null;

function convertVariants(text: string): string {
    if (kanjiVariantRegex === null || kanjiVariantMap === null) {
        kanjiVariantRegex = new RegExp(`[${itaijiList.join('')}]`, 'g');
        kanjiVariantMap = new Map<string, string>();
        for (const mapping of mappings) {
            for (const itaiji of mapping.itaiji) {
                kanjiVariantMap.set(itaiji, mapping.oyaji);
            }
        }
    }

    return text.replace(kanjiVariantRegex, (match) => kanjiVariantMap?.get(match) ?? match);
}

export const convertHalfWidthCharacters: TextProcessor<boolean> = {
    name: 'Convert half width characters to full width',
    description: '\uff96\uff90\uff81\uff6c\uff9d \u2192 \u30e8\u30df\u30c1\u30e3\u30f3',
    options: basicTextProcessorOptions,
    process: (str, setting) => (setting ? convertHalfWidthKanaToFullWidth(str) : str),
};

export const alphabeticToHiragana: TextProcessor<boolean> = {
    name: 'Convert alphabetic characters to hiragana',
    description: 'yomichan \u2192 \u3088\u307f\u3061\u3083\u3093',
    options: basicTextProcessorOptions,
    process: (str, setting) => (setting ? convertAlphabeticToKana(str) : str),
};

export const alphanumericWidthVariants: BidirectionalConversionPreprocessor = {
    name: 'Convert between alphabetic width variants',
    description: '\uff59\uff4f\uff4d\uff49\uff54\uff41\uff4e \u2192 yomitan and vice versa',
    options: ['off', 'direct', 'inverse'],
    process: (str, setting) => {
        switch (setting) {
            case 'off':
                return str;
            case 'direct':
                return convertFullWidthAlphanumericToNormal(str);
            case 'inverse':
                return convertAlphanumericToFullWidth(str);
        }
    },
};

export const convertHiraganaToKatakana: BidirectionalConversionPreprocessor = {
    name: 'Convert hiragana to katakana',
    description: '\u3088\u307f\u3061\u3083\u3093 \u2192 \u30e8\u30df\u30c1\u30e3\u30f3 and vice versa',
    options: ['off', 'direct', 'inverse'],
    process: (str, setting) => {
        switch (setting) {
            case 'off':
                return str;
            case 'direct':
                return convertHiraganaToKatakanaFunction(str);
            case 'inverse':
                return convertKatakanaToHiraganaFunction(str);
        }
    },
};

export const collapseEmphaticSequences: TextProcessor<[collapseEmphatic: boolean, collapseEmphaticFull: boolean]> = {
    name: 'Collapse emphatic character sequences',
    description:
        '\u3059\u3063\u3063\u3054\u30fc\u30fc\u3044 \u2192 \u3059\u3063\u3054\u30fc\u3044 / \u3059\u3054\u3044',
    options: [
        [false, false],
        [true, false],
        [true, true],
    ],
    process: (str, setting) => {
        const [collapseEmphatic, collapseEmphaticFull] = setting;
        if (collapseEmphatic) {
            str = collapseEmphaticSequencesFunction(str, collapseEmphaticFull);
        }
        return str;
    },
};

export const normalizeCombiningCharacters: TextProcessor<boolean> = {
    name: 'Normalize combining characters',
    description: '\u30c8\u3099 \u2192 \u30c9 (U+30C8 U+3099 \u2192 U+30C9)',
    options: basicTextProcessorOptions,
    process: (str, setting) => (setting ? normalizeCombiningCharactersFunction(str) : str),
};

export const normalizeCJKCompatibilityCharacters: TextProcessor<boolean> = {
    name: 'Normalize CJK Compatibility Characters',
    description: '\u3300 \u2192 \u30a2\u30d1\u30fc\u30c8',
    options: basicTextProcessorOptions,
    process: (str, setting) => (setting ? normalizeCJKCompatibilityCharactersFunction(str) : str),
};

export const standardizeKanji: TextProcessor<boolean> = {
    name: 'Convert kanji variants to their modern standard form',
    description: '\u842c \u2192 \u4e07',
    options: basicTextProcessorOptions,
    process: (str, setting) => (setting ? convertVariants(str) : str),
};
