import type { BidirectionalConversionPreprocessor, TextProcessor } from '../../types/language';

const finalLetterMap = new Map<string, string>([
    ['\u05de', '\u05dd'], // mem to final mem
    ['\u05e0', '\u05df'], // nun to final nun
    ['\u05e6', '\u05e5'], // tsadi to final tsadi
    ['\u05e4', '\u05e3'], // pe to final pe
    ['\u05dB', '\u05da'], // kaf to final kaf
]);

const ligatures = [
    { lig: '\u05f0', split: '\u05d5' + '\u05d5' },
    { lig: '\u05f1', split: '\u05d5' + '\u05d9' },
    { lig: '\u05f2', split: '\u05d9' + '\u05d9' },
    { lig: '\ufb1d', split: '\u05d9' + '\u05b4' },
    { lig: '\ufb1f', split: '\u05d9' + '\u05d9' + '\u05b7' },
    { lig: '\ufb2e', split: '\u05d0' + '\u05b7' },
    { lig: '\ufb2f', split: '\u05d0' + '\u05b8' },
];

export const convertFinalLetters: TextProcessor<boolean> = {
    name: 'Convert to Final Letters',
    description: 'Convert final letters',
    options: [true],
    process: (str) => {
        const len = str.length - 1;
        if ([...finalLetterMap.keys()].includes(str.charAt(len))) {
            str = str.substring(0, len) + (finalLetterMap.get(str.substring(len)) as string);
        }
        return str;
    },
};

export const convertYiddishLigatures: BidirectionalConversionPreprocessor = {
    name: 'Split Ligatures',
    description: '\u05d5\u05d5 \u2192 \u05f0',
    options: ['off', 'direct', 'inverse'],
    process: (str, setting) => {
        switch (setting) {
            case 'off':
                return str;
            case 'direct':
                for (const ligature of ligatures) {
                    str = str.replace(ligature.lig, ligature.split);
                }
                return str;
            case 'inverse':
                for (const ligature of ligatures) {
                    str = str.replace(ligature.split, ligature.lig);
                }
                return str;
        }
    },
};
