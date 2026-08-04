import type { TextProcessor } from '../../types/language';
import { basicTextProcessorOptions } from '../text-processors';

const arabicDiacritics = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

export const removeArabicScriptDiacritics: TextProcessor<boolean> = {
    name: 'Remove diacritics',
    description: 'Remove Arabic script diacritics',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        return setting ? str.replace(arabicDiacritics, '') : str;
    },
};

export const removeTatweel: TextProcessor<boolean> = {
    name: 'Remove tatweel',
    description: 'Remove tatweel (\u0640)',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        return setting ? str.replace(/\u0640/g, '') : str;
    },
};

const normalizeMap = new Map<string, string>([
    ['\u0671', '\u0627'], // Alif wasla -> Alif
    ['\u0622', '\u0627'], // Alif with madda above -> Alif
    ['\u0623', '\u0627'], // Alif with hamza above -> Alif
    ['\u0625', '\u0627'], // Alif with hamza below -> Alif
    ['\u0624', '\u0648'], // Waw with hamza above -> Waw
    ['\u0626', '\u064A'], // Yeh with hamza above -> Yeh
    ['\u0649', '\u064A'], // Alif maksura -> Yeh
    ['\u0629', '\u0647'], // Teh marbuta -> Heh
]);

export const normalizeUnicode: TextProcessor<boolean> = {
    name: 'Normalize Unicode',
    description: 'Normalize Arabic Unicode characters',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        if (!setting) {
            return str;
        }
        let result = '';
        for (const char of str) {
            result += normalizeMap.get(char) ?? char;
        }
        return result;
    },
};

export const addHamzaTop: TextProcessor<boolean> = {
    name: 'Add hamza above Alif',
    description: '\u0627 \u2192 \u0623',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        return setting ? str.replace(/\u0627/g, '\u0623') : str;
    },
};

export const addHamzaBottom: TextProcessor<boolean> = {
    name: 'Add hamza below Alif',
    description: '\u0627 \u2192 \u0625',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        return setting ? str.replace(/\u0627/g, '\u0625') : str;
    },
};

export const convertAlifMaqsuraToYaa: TextProcessor<boolean> = {
    name: 'Convert Alif Maqsura to Yaa',
    description: '\u0649 \u2192 \u064A',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        return setting ? str.replace(/\u0649/g, '\u064A') : str;
    },
};

export const convertHaToTaMarbuta: TextProcessor<boolean> = {
    name: 'Convert Ha to Ta Marbuta',
    description: '\u0647 \u2192 \u0629',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        return setting ? str.replace(/\u0647/g, '\u0629') : str;
    },
};
