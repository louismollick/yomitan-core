import type { DictionaryEntryType } from '../types/dictionary';
import type { Summary } from '../types/dictionary-importer';

export type DictionaryMarkerSource = {
    name: string;
    enabled: boolean;
};

/**
 * Gets the standard marker names available for a given entry type.
 */
export function getStandardFieldMarkers(type: DictionaryEntryType, language = 'ja'): string[] {
    switch (type) {
        case 'term': {
            const markers = [
                'audio',
                'clipboard-image',
                'clipboard-text',
                'cloze-body',
                'cloze-prefix',
                'cloze-suffix',
                'conjugation',
                'dictionary',
                'dictionary-alias',
                'document-title',
                'expression',
                'frequencies',
                'frequency-harmonic-rank',
                'frequency-harmonic-occurrence',
                'frequency-average-rank',
                'frequency-average-occurrence',
                'furigana',
                'furigana-plain',
                'glossary',
                'glossary-brief',
                'glossary-no-dictionary',
                'glossary-plain',
                'glossary-plain-no-dictionary',
                'glossary-first',
                'glossary-first-brief',
                'glossary-first-no-dictionary',
                'part-of-speech',
                'phonetic-transcriptions',
                'reading',
                'screenshot',
                'search-query',
                'popup-selection-text',
                'sentence',
                'sentence-furigana',
                'sentence-furigana-plain',
                'tags',
                'url',
            ];
            if (language === 'ja') {
                markers.push(
                    'cloze-body-kana',
                    'pitch-accents',
                    'pitch-accent-graphs',
                    'pitch-accent-graphs-jj',
                    'pitch-accent-positions',
                    'pitch-accent-categories',
                );
            }
            return markers;
        }
        case 'kanji':
            return [
                'character',
                'clipboard-image',
                'clipboard-text',
                'cloze-body',
                'cloze-prefix',
                'cloze-suffix',
                'dictionary',
                'dictionary-alias',
                'document-title',
                'frequencies',
                'frequency-harmonic-rank',
                'frequency-harmonic-occurrence',
                'frequency-average-rank',
                'frequency-average-occurrence',
                'glossary',
                'kunyomi',
                'onyomi',
                'onyomi-hiragana',
                'screenshot',
                'search-query',
                'popup-selection-text',
                'sentence',
                'sentence-furigana',
                'sentence-furigana-plain',
                'stroke-count',
                'tags',
                'url',
            ];
        default:
            return [];
    }
}

/**
 * Returns dynamic marker names derived from enabled dictionaries.
 */
export function getDynamicFieldMarkers(
    dictionaries: DictionaryMarkerSource[],
    dictionaryInfo: Summary[],
): string[] {
    const markers: string[] = [];
    for (const dictionary of dictionaries) {
        const currentDictionaryInfo = dictionaryInfo.find(({ title }) => title === dictionary.name);
        if (!dictionary.enabled) {
            continue;
        }

        const totalTerms = currentDictionaryInfo?.counts?.terms?.total;
        if (totalTerms && totalTerms > 0) {
            markers.push(`single-glossary-${getKebabCase(dictionary.name)}`);
        }

        const totalMeta = currentDictionaryInfo?.counts?.termMeta;
        if (totalMeta && totalMeta.freq && totalMeta.freq > 0) {
            markers.push(`single-frequency-number-${getKebabCase(dictionary.name)}`);
        }
    }
    return markers;
}

/**
 * Returns dynamic inline template partials derived from enabled dictionaries.
 */
export function getDynamicTemplates(
    dictionaries: DictionaryMarkerSource[],
    dictionaryInfo: Summary[],
): string {
    let dynamicTemplates = '\n';
    for (const dictionary of dictionaries) {
        const currentDictionaryInfo = dictionaryInfo.find(({ title }) => title === dictionary.name);
        if (!dictionary.enabled) {
            continue;
        }

        const totalTerms = currentDictionaryInfo?.counts?.terms?.total;
        if (totalTerms && totalTerms > 0) {
            dynamicTemplates += `
{{#*inline "single-glossary-${getKebabCase(dictionary.name)}"}}
    {{~> glossary selectedDictionary='${escapeDictName(dictionary.name)}'}}
{{/inline}}

{{#*inline "single-glossary-${getKebabCase(dictionary.name)}-no-dictionary"}}
    {{~> glossary selectedDictionary='${escapeDictName(dictionary.name)}' noDictionaryTag=true}}
{{/inline}}

{{#*inline "single-glossary-${getKebabCase(dictionary.name)}-brief"}}
    {{~> glossary selectedDictionary='${escapeDictName(dictionary.name)}' brief=true}}
{{/inline}}

{{#*inline "single-glossary-${getKebabCase(dictionary.name)}-plain"}}
    {{~> glossary-plain selectedDictionary='${escapeDictName(dictionary.name)}'}}
{{/inline}}

{{#*inline "single-glossary-${getKebabCase(dictionary.name)}-plain-no-dictionary"}}
    {{~> glossary-plain-no-dictionary selectedDictionary='${escapeDictName(dictionary.name)}' noDictionaryTag=true}}
{{/inline}}
`;
        }

        const totalMeta = currentDictionaryInfo?.counts?.termMeta;
        if (totalMeta && totalMeta.freq && totalMeta.freq > 0) {
            dynamicTemplates += `
{{#*inline "single-frequency-number-${getKebabCase(dictionary.name)}"}}
    {{~> single-frequency-number selectedDictionary='${escapeDictName(dictionary.name)}'}}
{{/inline}}
{{#*inline "single-frequency-${getKebabCase(dictionary.name)}"}}
    {{~> frequencies selectedDictionary='${escapeDictName(dictionary.name)}'}}
{{/inline}}
`;
        }
    }
    return dynamicTemplates;
}

export function getKebabCase(str: string): string {
    return str
        .replace(/[\s_\u3000]/g, '-')
        .replace(/[^\p{L}\p{N}-]/gu, '')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}

function escapeDictName(name: string): string {
    return name
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}
