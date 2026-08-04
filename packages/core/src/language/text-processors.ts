import type { TextProcessor, TextProcessorOptions } from '../types/language';

export const basicTextProcessorOptions: TextProcessorOptions<boolean> = [false, true];

export const decapitalize: TextProcessor<boolean> = {
    name: 'Decapitalize text',
    description: 'CAPITALIZED TEXT → capitalized text',
    options: basicTextProcessorOptions,
    process: (str, setting) => (setting ? str.toLowerCase() : str),
};

export const capitalizeFirstLetter: TextProcessor<boolean> = {
    name: 'Capitalize first letter',
    description: 'lowercase text → Lowercase text',
    options: basicTextProcessorOptions,
    process: (str, setting) => (setting ? str.charAt(0).toUpperCase() + str.slice(1) : str),
};

export const removeAlphabeticDiacritics: TextProcessor<boolean> = {
    name: 'Remove Alphabetic Diacritics',
    description: 'ἄήé -> αηe',
    options: basicTextProcessorOptions,
    process: (str, setting) => (setting ? str.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : str),
};
