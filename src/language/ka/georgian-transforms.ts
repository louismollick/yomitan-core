import type { LanguageTransformDescriptor } from '../../types/language-transformer';
import { suffixInflection } from '../language-transforms';

const conditions = {
    v: {
        name: 'Verb',
        isDictionaryForm: true,
    },
    n: {
        name: 'Noun',
        isDictionaryForm: true,
        subConditions: ['np', 'ns'],
    },
    np: {
        name: 'Noun plural',
        isDictionaryForm: true,
    },
    ns: {
        name: 'Noun singular',
        isDictionaryForm: true,
    },
    adj: {
        name: 'Adjective',
        isDictionaryForm: true,
    },
    adv: {
        name: 'Adverb',
        isDictionaryForm: true,
    },
};

type Condition = keyof typeof conditions;

const suffixes = [
    'ები',
    'ებს',
    'ებების', // plural suffixes
    'მა', // ergative
    'ს', // dative
    'ის', // genitive
    'ით', // instrumental
    'ად', // adverbial
    'ო', // vocative
    'ში',
    'ზე',
    'შია',
    'ზეა',
];

const nounAdjConditions: Condition[] = ['n', 'adj'];

// Stem completion (for consonant endings)
const stemCompletionRules = [
    suffixInflection('გნ', 'გნი', nounAdjConditions, nounAdjConditions),
    suffixInflection('ნ', 'ნი', nounAdjConditions, nounAdjConditions),
];

// Vowel restoration example (optional, extend as needed)
const vowelRestorationRules = [suffixInflection('გ', 'გა', nounAdjConditions, nounAdjConditions)];

export const georgianTransforms: LanguageTransformDescriptor<Condition> = {
    language: 'kat',
    conditions,
    transforms: {
        nounAdjSuffixStripping: {
            name: 'noun-adj-suffix-stripping',
            description: 'Strip Georgian noun and adjective declension suffixes',
            rules: suffixes.map((suffix) => suffixInflection(suffix, '', nounAdjConditions, nounAdjConditions)),
        },
        nounAdjStemCompletion: {
            name: 'noun-adj-stem-completion',
            description: 'Restore nominative suffix -ი for consonant-ending noun/adjective stems',
            rules: stemCompletionRules,
        },
        vowelRestoration: {
            name: 'vowel-restoration',
            description: 'Restore truncated vowels if applicable',
            rules: vowelRestorationRules,
        },
    },
};
