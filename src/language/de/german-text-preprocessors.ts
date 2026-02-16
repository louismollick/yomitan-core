import type { BidirectionalConversionPreprocessor } from '../../types/language';

export const eszettPreprocessor: BidirectionalConversionPreprocessor = {
    name: 'Convert between \u00df and ss',
    description: '\u00df \u2192 ss and vice versa',
    options: ['off', 'direct', 'inverse'],
    process: (str, setting) => {
        switch (setting) {
            case 'off':
                return str;
            case 'direct':
                return str.replace(/\u00df/g, 'ss');
            case 'inverse':
                return str.replace(/ss/g, '\u00df');
        }
    },
};
