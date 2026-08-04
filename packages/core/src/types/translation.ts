import type * as Dictionary from './dictionary';

export type SearchResolution = 'letter' | 'word';

export type FindKanjiOptions = {
    enabledDictionaryMap: KanjiEnabledDictionaryMap;
    removeNonJapaneseCharacters: boolean;
};

export type FindKanjiDictionary = {
    index: number;
    alias: string;
};

export type FindTermsOptions = {
    matchType: FindTermsMatchType;
    deinflect: boolean;
    primaryReading: string;
    mainDictionary: string;
    sortFrequencyDictionary: string | null;
    sortFrequencyDictionaryOrder: FindTermsSortOrder;
    removeNonJapaneseCharacters: boolean;
    textReplacements: FindTermsTextReplacements;
    enabledDictionaryMap: TermEnabledDictionaryMap;
    excludeDictionaryDefinitions: Set<string> | null;
    searchResolution: SearchResolution;
    language: string;
};

export type FindTermsMatchType = Dictionary.TermSourceMatchType;

export type FindTermsSortOrder = 'ascending' | 'descending';

export type FindTermsTextReplacement = {
    pattern: RegExp;
    replacement: string;
};

export type FindTermsTextReplacements = (FindTermsTextReplacement[] | null)[];

export type FindTermDictionary = {
    index: number;
    alias: string;
    allowSecondarySearches: boolean;
    partsOfSpeechFilter: boolean;
    useDeinflections: boolean;
};

export type TermEnabledDictionaryMap = Map<string, FindTermDictionary>;

export type KanjiEnabledDictionaryMap = Map<string, FindKanjiDictionary>;
