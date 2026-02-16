import type { TextProcessor } from '../../types/language';
import { basicTextProcessorOptions } from '../text-processors';

const diacriticsRegex = /[\u0300\u0301\u0302\u0303\u0304\u0306\u0308\u030B]/g;

export const removeRussianDiacritics: TextProcessor<boolean> = {
    name: 'Remove diacritics',
    description: 'Remove Russian diacritics (accents)',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        return setting ? str.normalize('NFD').replace(diacriticsRegex, '').normalize('NFC') : str;
    },
};

export const yoToE: TextProcessor<boolean> = {
    name: 'Convert \u0451 to \u0435',
    description: '\u0451 \u2192 \u0435',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        return setting ? str.replace(/\u0451/g, '\u0435').replace(/\u0401/g, '\u0415') : str;
    },
};
