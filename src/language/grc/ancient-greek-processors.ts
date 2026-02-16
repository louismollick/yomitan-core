import type { TextProcessor } from '../../types/language';
import { basicTextProcessorOptions, removeAlphabeticDiacritics } from '../text-processors';

export const convertLatinToGreek: TextProcessor<boolean> = {
    name: 'Convert latin characters to greek',
    description: 'a \u2192 \u03b1, A \u2192 \u0391, b \u2192 \u03b2, B \u2192 \u0392, etc.',
    options: basicTextProcessorOptions,
    process: (str, setting) => {
        return setting ? latinToGreek(str) : str;
    },
};

export function latinToGreek(latin: string): string {
    latin = removeAlphabeticDiacritics.process(latin, true);

    const singleMap: Record<string, string> = {
        a: '\u03b1',
        b: '\u03b2',
        g: '\u03b3',
        d: '\u03b4',
        e: '\u03b5',
        z: '\u03b6',
        '\u0113': '\u03b7',
        i: '\u03b9',
        k: '\u03ba',
        l: '\u03bb',
        m: '\u03bc',
        n: '\u03bd',
        x: '\u03be',
        o: '\u03bf',
        p: '\u03c0',
        r: '\u03c1',
        s: '\u03c3',
        t: '\u03c4',
        u: '\u03c5',
        '\u014d': '\u03c9',
        A: '\u0391',
        B: '\u0392',
        G: '\u0393',
        D: '\u0394',
        E: '\u0395',
        Z: '\u0396',
        '\u0112': '\u0397',
        I: '\u0399',
        K: '\u039a',
        L: '\u039b',
        M: '\u039c',
        N: '\u039d',
        X: '\u039e',
        O: '\u039f',
        P: '\u03a0',
        R: '\u03a1',
        S: '\u03a3',
        T: '\u03a4',
        U: '\u03a5',
        '\u014c': '\u03a9',
    };

    const doubleMap: Record<string, string> = {
        th: '\u03b8',
        ph: '\u03c6',
        ch: '\u03c7',
        ps: '\u03c8',
        Th: '\u0398',
        Ph: '\u03a6',
        Ch: '\u03a7',
        Ps: '\u03a8',
    };

    let result = latin;

    for (const [double, greek] of Object.entries(doubleMap)) {
        result = result.replace(new RegExp(double, 'g'), greek);
    }

    for (const [single, greek] of Object.entries(singleMap)) {
        result = result.replace(new RegExp(single, 'g'), greek);
    }

    // Handle final sigma
    result = result.replace(/\u03c3$/, '\u03c2');

    return result;
}
