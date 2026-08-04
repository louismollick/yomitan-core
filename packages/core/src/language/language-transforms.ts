import type { Rule, SuffixRule } from '../types/language-transformer';

export function suffixInflection<TCondition extends string>(
    inflectedSuffix: string,
    deinflectedSuffix: string,
    conditionsIn: TCondition[],
    conditionsOut: TCondition[],
): SuffixRule<TCondition> {
    const suffixRegExp = new RegExp(`${inflectedSuffix}$`);
    return {
        type: 'suffix',
        isInflected: suffixRegExp,
        deinflected: deinflectedSuffix,
        deinflect: (text) => text.slice(0, -inflectedSuffix.length) + deinflectedSuffix,
        conditionsIn,
        conditionsOut,
    };
}

export function prefixInflection<TCondition extends string>(
    inflectedPrefix: string,
    deinflectedPrefix: string,
    conditionsIn: TCondition[],
    conditionsOut: TCondition[],
): Rule<TCondition> {
    const prefixRegExp = new RegExp(`^${inflectedPrefix}`);
    return {
        type: 'prefix',
        isInflected: prefixRegExp,
        deinflect: (text) => deinflectedPrefix + text.slice(inflectedPrefix.length),
        conditionsIn,
        conditionsOut,
    };
}

export function wholeWordInflection<TCondition extends string>(
    inflectedWord: string,
    deinflectedWord: string,
    conditionsIn: TCondition[],
    conditionsOut: TCondition[],
): Rule<TCondition> {
    const regex = new RegExp(`^${inflectedWord}$`);
    return {
        type: 'wholeWord',
        isInflected: regex,
        deinflect: () => deinflectedWord,
        conditionsIn,
        conditionsOut,
    };
}
