import type { LanguageTransformDescriptor } from '../../types/language-transformer';
import { prefixInflection } from '../language-transforms';

const eclipsisPrefixInflections = [
    prefixInflection('mb', 'b', ['n'], ['n']), // 'mbean'
    prefixInflection('gc', 'c', ['n'], ['n']), // 'gclann'
    prefixInflection('nd', 'd', ['n'], ['n']), // 'ndul'
    prefixInflection('bhf', 'f', ['n'], ['n']), // bhfear
    prefixInflection('ng', 'g', ['n'], ['n']), // nGaeilge
    prefixInflection('bp', 'p', ['n'], ['n']), // bpáiste
    prefixInflection('dt', 't', ['n'], ['n']), // dtriail
];

const conditions = {
    v: {
        name: 'Verb',
        isDictionaryForm: true,
        subConditions: ['v_phr'],
    },
    v_phr: {
        name: 'Phrasal verb',
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

export const irishTransforms: LanguageTransformDescriptor<Condition> = {
    language: 'ga',
    conditions,
    transforms: {
        eclipsis: {
            name: 'eclipsis',
            description: 'eclipsis form of a noun',
            rules: [...eclipsisPrefixInflections],
        },
    },
};
