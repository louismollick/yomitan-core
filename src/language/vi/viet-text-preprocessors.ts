import type { TextProcessor } from '../../types/language';

const TONE = '([\u0300\u0309\u0303\u0301\u0323])'; // Huyen, hoi, nga, sac, nang
const COMBINING_BREVE = '\u0306'; // A breve
const COMBINING_CIRCUMFLEX_ACCENT = '\u0302'; // A circumflex
const COMBINING_HORN = '\u031B'; // O horn
const DIACRITICS = `${COMBINING_BREVE}${COMBINING_CIRCUMFLEX_ACCENT}${COMBINING_HORN}`;

// eslint-disable-next-line no-misleading-character-class
const re1 = new RegExp(`${TONE}([aeiouy${DIACRITICS}]+)`, 'i');
const re2 = new RegExp(`(?<=[${DIACRITICS}])(.)${TONE}`, 'i');
const re3 = new RegExp(`(?<=[ae])([iouy])${TONE}`, 'i');
const re4 = new RegExp(`(?<=[oy])([iuy])${TONE}`, 'i');
const re5 = new RegExp(`(?<!q)(u)([aeiou])${TONE}`, 'i');
const re6 = new RegExp(`(?<!g)(i)([aeiouy])${TONE}`, 'i');
const re7 = new RegExp(`(?<!q)([ou])([aeoy])${TONE}(?!\\w)`, 'i');

export const normalizeDiacritics: TextProcessor<'old' | 'new' | 'off'> = {
    name: 'Normalize Diacritics',
    description:
        'Normalize diacritics and their placements (in either the old style or new style). NFC normalization is used.',
    options: ['old', 'new', 'off'],
    process: (str, setting) => {
        if (setting === 'off') {
            return str;
        }

        let result = str.normalize('NFD');
        // Put the tone on the second vowel
        result = result.replace(re1, '$2$1');
        // Put the tone on the vowel with a diacritic
        result = result.replace(re2, '$2$1');
        // For vowels that are not oa, oe, uy put the tone on the penultimate vowel
        result = result.replace(re3, '$2$1');
        result = result.replace(re4, '$2$1');
        result = result.replace(re5, '$1$3$2');
        result = result.replace(re6, '$1$3$2');

        if (setting === 'old') {
            result = result.replace(re7, '$1$3$2');
        }
        return result.normalize('NFC');
    },
};
