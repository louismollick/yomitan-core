import type { TextProcessor } from '../../types/language';

const ligatures = [
    { lig: '\u05f0', split: '\u05d5' + '\u05d5' }, // double vav
    { lig: '\u05f1', split: '\u05d5' + '\u05d9' }, // vav yod
    { lig: '\u05f2', split: '\u05d9' + '\u05d9' }, // double yod
    { lig: '\ufb1d', split: '\u05d9' + '\u05b4' }, // yod hiriq
    { lig: '\ufb1f', split: '\u05d9' + '\u05d9' + '\u05b7' }, // double yod patah
    { lig: '\ufb2e', split: '\u05d0' + '\u05b7' }, // Pasekh alef
    { lig: '\ufb2f', split: '\u05d0' + '\u05b8' }, // Komets alef
];

export const combineYiddishLigatures: TextProcessor<boolean> = {
    name: 'Combine Ligatures',
    description: '\u05d5\u05d5 \u2192 \u05f0',
    options: [true],
    process: (str) => {
        for (const ligature of ligatures) {
            str = str.replace(ligature.split, ligature.lig);
        }
        return str;
    },
};

export const removeYiddishDiacritics: TextProcessor<boolean> = {
    name: 'Remove Diacritics',
    description: 'Remove Yiddish diacritics',
    options: [true],
    process: (str) => {
        return str.replace(/[\u05B0-\u05C7]/g, '');
    },
};
