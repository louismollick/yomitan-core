import type { LanguageTransformDescriptor, Rule } from '../../types/language-transformer';
import { prefixInflection, suffixInflection } from '../language-transforms';

// https://www.dartmouth.edu/~deutsch/Grammatik/Wortbildung/Separables.html
const separablePrefixes = [
    'ab',
    'an',
    'auf',
    'aus',
    'auseinander',
    'bei',
    'da',
    'dabei',
    'dar',
    'daran',
    'dazwischen',
    'durch',
    'ein',
    'empor',
    'entgegen',
    'entlang',
    'entzwei',
    'fehl',
    'fern',
    'fest',
    'fort',
    'frei',
    'gegenüber',
    'gleich',
    'heim',
    'her',
    'herab',
    'heran',
    'herauf',
    'heraus',
    'herbei',
    'herein',
    'herüber',
    'herum',
    'herunter',
    'hervor',
    'hin',
    'hinab',
    'hinauf',
    'hinaus',
    'hinein',
    'hinterher',
    'hinunter',
    'hinweg',
    'hinzu',
    'hoch',
    'los',
    'mit',
    'nach',
    'nebenher',
    'nieder',
    'statt',
    'um',
    'vor',
    'voran',
    'voraus',
    'vorbei',
    'vorüber',
    'vorweg',
    'weg',
    'weiter',
    'wieder',
    'zu',
    'zurecht',
    'zurück',
    'zusammen',
];
const germanLetters = 'a-zA-ZäöüßÄÖÜẞ';

const conditions = {
    v: {
        name: 'Verb',
        isDictionaryForm: true,
        subConditions: ['vw', 'vs'],
    },
    vw: {
        name: 'Weak verb',
        isDictionaryForm: true,
    },
    vs: {
        name: 'Strong verb',
        isDictionaryForm: true,
    },
    n: {
        name: 'Noun',
        isDictionaryForm: true,
    },
    adj: {
        name: 'Adjective',
        isDictionaryForm: true,
    },
};

type Condition = keyof typeof conditions;

function separatedPrefix(prefix: string, conditionsIn: Condition[], conditionsOut: Condition[]): Rule<Condition> {
    const regex = new RegExp(`^([${germanLetters}]+) .+ ${prefix}$`);
    return {
        type: 'other',
        isInflected: regex,
        deinflect: (term) => {
            return term.replace(regex, `$1 ${prefix}`);
        },
        conditionsIn,
        conditionsOut,
    };
}

const separatedPrefixInflections = separablePrefixes.map((prefix) => {
    return separatedPrefix(prefix, [], []);
});

const zuInfinitiveInflections = separablePrefixes.map((prefix) => {
    return prefixInflection(`${prefix}zu`, prefix, [], ['v']);
});

function getBasicPastParticiples(): Rule<Condition>[] {
    const regularPastParticiple = new RegExp(`^ge([${germanLetters}]+)t$`);
    const suffixes = ['n', 'en'];
    return suffixes.map((suffix) => ({
        type: 'other',
        isInflected: regularPastParticiple,
        deinflect: (term) => {
            return term.replace(regularPastParticiple, `$1${suffix}`);
        },
        conditionsIn: [],
        conditionsOut: ['vw'],
    }));
}

function getSeparablePastParticiples(): Rule<Condition>[] {
    const prefixDisjunction = separablePrefixes.join('|');
    const separablePastParticiple = new RegExp(`^(${prefixDisjunction})ge([${germanLetters}]+)t$`);
    const suffixes = ['n', 'en'];
    return suffixes.map((suffix) => ({
        type: 'other',
        isInflected: separablePastParticiple,
        deinflect: (term) => {
            return term.replace(separablePastParticiple, `$1$2${suffix}`);
        },
        conditionsIn: [],
        conditionsOut: ['vw'],
    }));
}

export const germanTransforms: LanguageTransformDescriptor<Condition> = {
    language: 'de',
    conditions,
    transforms: {
        nominalization: {
            name: 'nominalization',
            description: 'Noun formed from a verb',
            rules: [
                suffixInflection('ung', 'en', [], ['v']),
                suffixInflection('lung', 'eln', [], ['v']),
                suffixInflection('rung', 'rn', [], ['v']),
            ],
        },
        '-bar': {
            name: '-bar',
            description: '-able adjective from a verb',
            rules: [suffixInflection('bar', 'en', ['adj'], ['v']), suffixInflection('bar', 'n', ['adj'], ['v'])],
        },
        negative: {
            name: 'negative',
            description: 'Negation',
            rules: [prefixInflection('un', '', [], ['adj'])],
        },
        'past participle': {
            name: 'past participle',
            rules: [...getBasicPastParticiples(), ...getSeparablePastParticiples()],
        },
        'separated prefix': {
            name: 'separated prefix',
            rules: [...separatedPrefixInflections],
        },
        'zu-infinitive': {
            name: 'zu-infinitive',
            rules: [...zuInfinitiveInflections],
        },
        '-heit': {
            name: '-heit',
            description:
                '1. Converts an adjective into a noun and usually denotes an abstract quality of the adjectival root. ' +
                'It is often equivalent to the English suffixes -ness, -th, -ty, -dom:\n' +
                '\t schön (“beautiful”) + -heit → Schönheit (“beauty”)\n' +
                '\t neu (“new”) + -heit → Neuheit (“novelty”)\n' +
                '2. Converts concrete nouns into abstract nouns:\n' +
                '\t Kind (“child”) + -heit → Kindheit (“childhood”)\n' +
                '\t Christ (“Christian”) + -heit → Christenheit (“Christendom”)\n',
            rules: [
                suffixInflection('heit', '', ['n'], ['adj', 'n']),
                suffixInflection('keit', '', ['n'], ['adj', 'n']),
            ],
        },
    },
};
