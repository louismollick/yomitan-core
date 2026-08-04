import type { TextProcessor } from '../../types/language';
import { basicTextProcessorOptions } from '../text-processors';

export function removeDoubleAcuteAccentsImpl(str: string): string {
    return str.replace(/\u030B/g, '');
}

export const removeDoubleAcuteAccents: TextProcessor<boolean> = {
    name: 'Remove double acute accents',
    description: 'Remove double acute accent marks from text',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        return setting ? removeDoubleAcuteAccentsImpl(str) : str;
    },
};
