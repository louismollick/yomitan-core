import type { TextProcessor } from '../../types/language';
import { basicTextProcessorOptions } from '../text-processors';

const accentRegex = /[\u0300\u0301\u0302\u030F\u0311]/g;

export const removeSerboCroatianAccentMarks: TextProcessor<boolean> = {
    name: 'Remove accent marks',
    description: 'Remove Serbo-Croatian accent marks',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        return setting ? str.normalize('NFD').replace(accentRegex, '').normalize('NFC') : str;
    },
};
