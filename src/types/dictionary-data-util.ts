import type * as Dictionary from './dictionary';

export type TagGroup = {
    tag: Dictionary.Tag;
    headwordIndices: number[];
};

export type TermFrequencyType = 'popular' | 'rare' | 'normal';

export type FrequencyValue = {
    frequency: number;
    displayValue: string | null;
};

export type TermFrequency = {
    term: string;
    reading: string | null;
    values: FrequencyValue[];
};

export type KanjiFrequency = {
    character: string;
    values: FrequencyValue[];
};

export type DictionaryFrequency<T> = {
    dictionary: string;
    dictionaryAlias: string;
    frequencies: T[];
    freqCount: number;
};

export type GroupedPronunciation = {
    pronunciation: Dictionary.Pronunciation;
    terms: string[];
    reading: string;
    exclusiveTerms: string[];
    exclusiveReadings: string[];
};

export type GroupedPronunciationInternal = {
    pronunciation: Dictionary.Pronunciation;
    terms: Set<string>;
    reading: string;
};

export type DictionaryGroupedPronunciations = {
    dictionary: string;
    dictionaryAlias: string;
    pronunciations: GroupedPronunciation[];
};

export type TermFrequenciesMap1 = Map<
    string,
    Map<string, { term: string; reading: string | null; values: Map<string, FrequencyValue> }>
>;

export type KanjiFrequenciesMap1 = Map<string, Map<string, { character: string; values: Map<string, FrequencyValue> }>>;
