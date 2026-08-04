import type { LanguageTransformDescriptor, Rule, SuffixRule } from '../../types/language-transformer';
import { prefixInflection, suffixInflection } from '../language-transforms';

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

function doubledConsonantInflection(
    consonants: string,
    suffix: string,
    conditionsIn: Condition[],
    conditionsOut: Condition[],
): SuffixRule<Condition>[] {
    const inflections: SuffixRule<Condition>[] = [];
    for (const consonant of consonants) {
        inflections.push(suffixInflection(`${consonant}${consonant}${suffix}`, consonant, conditionsIn, conditionsOut));
    }
    return inflections;
}

const pastSuffixInflections = [
    suffixInflection('ed', '', ['v'], ['v']), // 'walked'
    suffixInflection('ed', 'e', ['v'], ['v']), // 'hoped'
    suffixInflection('ied', 'y', ['v'], ['v']), // 'tried'
    suffixInflection('cked', 'c', ['v'], ['v']), // 'frolicked'
    ...doubledConsonantInflection('bdgklmnprstz', 'ed', ['v'], ['v']),

    suffixInflection('laid', 'lay', ['v'], ['v']),
    suffixInflection('paid', 'pay', ['v'], ['v']),
    suffixInflection('said', 'say', ['v'], ['v']),
];

const ingSuffixInflections = [
    suffixInflection('ing', '', ['v'], ['v']), // 'walking'
    suffixInflection('ing', 'e', ['v'], ['v']), // 'driving'
    suffixInflection('ying', 'ie', ['v'], ['v']), // 'lying'
    suffixInflection('cking', 'c', ['v'], ['v']), // 'panicking'
    ...doubledConsonantInflection('bdgklmnprstz', 'ing', ['v'], ['v']),
];

const thirdPersonSgPresentSuffixInflections = [
    suffixInflection('s', '', ['v'], ['v']), // 'walks'
    suffixInflection('es', '', ['v'], ['v']), // 'teaches'
    suffixInflection('ies', 'y', ['v'], ['v']), // 'tries'
];

const phrasalVerbParticles = [
    'aboard',
    'about',
    'above',
    'across',
    'ahead',
    'alongside',
    'apart',
    'around',
    'aside',
    'astray',
    'away',
    'back',
    'before',
    'behind',
    'below',
    'beneath',
    'besides',
    'between',
    'beyond',
    'by',
    'close',
    'down',
    'east',
    'west',
    'north',
    'south',
    'eastward',
    'westward',
    'northward',
    'southward',
    'forward',
    'backward',
    'backwards',
    'forwards',
    'home',
    'in',
    'inside',
    'instead',
    'near',
    'off',
    'on',
    'opposite',
    'out',
    'outside',
    'over',
    'overhead',
    'past',
    'round',
    'since',
    'through',
    'throughout',
    'together',
    'under',
    'underneath',
    'up',
    'within',
    'without',
];
const phrasalVerbPrepositions = [
    'aback',
    'about',
    'above',
    'across',
    'after',
    'against',
    'ahead',
    'along',
    'among',
    'apart',
    'around',
    'as',
    'aside',
    'at',
    'away',
    'back',
    'before',
    'behind',
    'below',
    'between',
    'beyond',
    'by',
    'down',
    'even',
    'for',
    'forth',
    'forward',
    'from',
    'in',
    'into',
    'of',
    'off',
    'on',
    'onto',
    'open',
    'out',
    'over',
    'past',
    'round',
    'through',
    'to',
    'together',
    'toward',
    'towards',
    'under',
    'up',
    'upon',
    'way',
    'with',
    'without',
];

const particlesDisjunction = phrasalVerbParticles.join('|');
const phrasalVerbWordSet = new Set([...phrasalVerbParticles, ...phrasalVerbPrepositions]);
const phrasalVerbWordDisjunction = [...phrasalVerbWordSet].join('|');

const phrasalVerbInterposedObjectRule: Rule<Condition> = {
    type: 'other',
    isInflected: new RegExp(`^\\w* (?:(?!\\b(${phrasalVerbWordDisjunction})\\b).)+ (?:${particlesDisjunction})`),
    deinflect: (term: string) => {
        return term.replace(
            new RegExp(`(?<=\\w) (?:(?!\\b(${phrasalVerbWordDisjunction})\\b).)+ (?=(?:${particlesDisjunction}))`),
            ' ',
        );
    },
    conditionsIn: [],
    conditionsOut: ['v_phr'],
};

function createPhrasalVerbInflection(inflected: string, deinflected: string): Rule<Condition> {
    return {
        type: 'other',
        isInflected: new RegExp(`^\\w*${inflected} (?:${phrasalVerbWordDisjunction})`),
        deinflect: (term: string) => {
            return term.replace(new RegExp(`(?<=)${inflected}(?= (?:${phrasalVerbWordDisjunction}))`), deinflected);
        },
        conditionsIn: ['v'],
        conditionsOut: ['v_phr'],
    };
}

function createPhrasalVerbInflectionsFromSuffixInflections(sourceRules: SuffixRule<Condition>[]): Rule<Condition>[] {
    return sourceRules.flatMap(({ isInflected, deinflected }) => {
        if (typeof deinflected === 'undefined') {
            return [];
        }
        const inflectedSuffix = isInflected.source.replace('$', '');
        const deinflectedSuffix = deinflected;
        return [createPhrasalVerbInflection(inflectedSuffix, deinflectedSuffix)];
    });
}

export const englishTransforms: LanguageTransformDescriptor<Condition> = {
    language: 'en',
    conditions,
    transforms: {
        plural: {
            name: 'plural',
            description: 'Plural form of a noun',
            rules: [
                suffixInflection('s', '', ['np'], ['ns']),
                suffixInflection('es', '', ['np'], ['ns']),
                suffixInflection('ies', 'y', ['np'], ['ns']),
                suffixInflection('ves', 'fe', ['np'], ['ns']),
                suffixInflection('ves', 'f', ['np'], ['ns']),
            ],
        },
        possessive: {
            name: 'possessive',
            description: 'Possessive form of a noun',
            rules: [suffixInflection("'s", '', ['n'], ['n']), suffixInflection("s'", 's', ['n'], ['n'])],
        },
        past: {
            name: 'past',
            description: 'Simple past tense of a verb',
            rules: [
                ...pastSuffixInflections,
                ...createPhrasalVerbInflectionsFromSuffixInflections(pastSuffixInflections),
            ],
        },
        ing: {
            name: 'ing',
            description: 'Present participle of a verb',
            rules: [
                ...ingSuffixInflections,
                ...createPhrasalVerbInflectionsFromSuffixInflections(ingSuffixInflections),
            ],
        },
        '3rd pers. sing. pres': {
            name: '3rd pers. sing. pres',
            description: 'Third person singular present tense of a verb',
            rules: [
                ...thirdPersonSgPresentSuffixInflections,
                ...createPhrasalVerbInflectionsFromSuffixInflections(thirdPersonSgPresentSuffixInflections),
            ],
        },
        'interposed object': {
            name: 'interposed object',
            description: 'Phrasal verb with interposed object',
            rules: [phrasalVerbInterposedObjectRule],
        },
        archaic: {
            name: 'archaic',
            description: 'Archaic form of a word',
            rules: [suffixInflection("'d", 'ed', ['v'], ['v'])],
        },
        adverb: {
            name: 'adverb',
            description: 'Adverb form of an adjective',
            rules: [
                suffixInflection('ly', '', ['adv'], ['adj']), // 'quickly'
                suffixInflection('ily', 'y', ['adv'], ['adj']), // 'happily'
                suffixInflection('ly', 'le', ['adv'], ['adj']), // 'humbly'
            ],
        },
        comparative: {
            name: 'comparative',
            description: 'Comparative form of an adjective',
            rules: [
                suffixInflection('er', '', ['adj'], ['adj']), // 'faster'
                suffixInflection('er', 'e', ['adj'], ['adj']), // 'nicer'
                suffixInflection('ier', 'y', ['adj'], ['adj']), // 'happier'
                ...doubledConsonantInflection('bdgmnt', 'er', ['adj'], ['adj']),
            ],
        },
        superlative: {
            name: 'superlative',
            description: 'Superlative form of an adjective',
            rules: [
                suffixInflection('est', '', ['adj'], ['adj']), // 'fastest'
                suffixInflection('est', 'e', ['adj'], ['adj']), // 'nicest'
                suffixInflection('iest', 'y', ['adj'], ['adj']), // 'happiest'
                ...doubledConsonantInflection('bdgmnt', 'est', ['adj'], ['adj']),
            ],
        },
        'dropped g': {
            name: 'dropped g',
            description: 'Dropped g in -ing form of a verb',
            rules: [suffixInflection("in'", 'ing', ['v'], ['v'])],
        },
        '-y': {
            name: '-y',
            description: 'Adjective formed from a verb or noun',
            rules: [
                suffixInflection('y', '', ['adj'], ['n', 'v']), // 'dirty', 'pushy'
                suffixInflection('y', 'e', ['adj'], ['n', 'v']), // 'hazy'
                ...doubledConsonantInflection('glmnprst', 'y', [], ['n', 'v']), // 'baggy', 'saggy'
            ],
        },
        'un-': {
            name: 'un-',
            description: 'Negative form of an adjective, adverb, or verb',
            rules: [prefixInflection('un', '', ['adj', 'adv', 'v'], ['adj', 'adv', 'v'])],
        },
        'going-to future': {
            name: 'going-to future',
            description: 'Going-to future tense of a verb',
            rules: [prefixInflection('going to ', '', ['v'], ['v'])],
        },
        'will future': {
            name: 'will future',
            description: 'Will-future tense of a verb',
            rules: [prefixInflection('will ', '', ['v'], ['v'])],
        },
        'imperative negative': {
            name: 'imperative negative',
            description: 'Negative imperative form of a verb',
            rules: [prefixInflection("don't ", '', ['v'], ['v']), prefixInflection('do not ', '', ['v'], ['v'])],
        },
        '-able': {
            name: '-able',
            description: 'Adjective formed from a verb',
            rules: [
                suffixInflection('able', '', ['v'], ['adj']),
                suffixInflection('able', 'e', ['v'], ['adj']),
                suffixInflection('iable', 'y', ['v'], ['adj']),
                ...doubledConsonantInflection('bdgklmnprstz', 'able', ['v'], ['adj']),
            ],
        },
    },
};
