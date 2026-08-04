import type { BidirectionalConversionPreprocessor } from '../../types/language';

export const apostropheVariants: BidirectionalConversionPreprocessor = {
    name: 'Convert between apostrophe variants',
    description: "\u2019 \u2192 ' and vice versa",
    options: ['off', 'direct', 'inverse'],
    process: (str, setting) => {
        switch (setting) {
            case 'off':
                return str;
            case 'direct':
                return str.replace(/\u2019/g, "'");
            case 'inverse':
                return str.replace(/'/g, '\u2019');
        }
    },
};
