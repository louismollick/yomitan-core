import type { BidirectionalConversionPreprocessor } from '../../types/language';

export const processDiphtongs: BidirectionalConversionPreprocessor = {
    name: 'Convert diphthongs',
    description: '\u00e6 \u2192 ae, \u0153 \u2192 oe and vice versa',
    options: ['off', 'direct', 'inverse'],
    process: (str, setting) => {
        switch (setting) {
            case 'off':
                return str;
            case 'direct':
                return str
                    .replace(/\u00e6/g, 'ae')
                    .replace(/\u0153/g, 'oe')
                    .replace(/\u00c6/g, 'Ae')
                    .replace(/\u0152/g, 'Oe');
            case 'inverse':
                return str
                    .replace(/ae/g, '\u00e6')
                    .replace(/oe/g, '\u0153')
                    .replace(/Ae/g, '\u00c6')
                    .replace(/Oe/g, '\u0152');
        }
    },
};
