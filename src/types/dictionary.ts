import type * as DictionaryData from './dictionary-data';

export type DictionaryEntry = KanjiDictionaryEntry | TermDictionaryEntry;

export type DictionaryEntryType = DictionaryEntry['type'];

export type Tag = {
    name: string;
    category: string;
    order: number;
    score: number;
    content: string[];
    dictionaries: string[];
    redundant: boolean;
};

export type KanjiDictionaryEntry = {
    type: 'kanji';
    character: string;
    dictionary: string;
    dictionaryIndex: number;
    dictionaryAlias: string;
    onyomi: string[];
    kunyomi: string[];
    tags: Tag[];
    stats: KanjiStatGroups;
    definitions: string[];
    frequencies: KanjiFrequency[];
};

export type KanjiStatGroups = {
    [propName: string]: KanjiStat[];
};

export type KanjiStat = {
    name: string;
    category: string;
    content: string;
    order: number;
    score: number;
    dictionary: string;
    value: number | string;
};

export type KanjiFrequency = {
    index: number;
    dictionary: string;
    dictionaryIndex: number;
    dictionaryAlias: string;
    character: string;
    frequency: number;
    displayValue: string | null;
    displayValueParsed: boolean;
};

export type TermDictionaryEntry = {
    type: 'term';
    isPrimary: boolean;
    textProcessorRuleChainCandidates: TextProcessorRuleChainCandidate[];
    inflectionRuleChainCandidates: InflectionRuleChainCandidate[];
    score: number;
    frequencyOrder: number;
    dictionaryIndex: number;
    dictionaryAlias: string;
    sourceTermExactMatchCount: number;
    matchPrimaryReading: boolean;
    maxOriginalTextLength: number;
    headwords: TermHeadword[];
    definitions: TermDefinition[];
    pronunciations: TermPronunciation[];
    frequencies: TermFrequency[];
};

export type InflectionRuleChainCandidate = {
    source: InflectionSource;
    inflectionRules: InflectionRuleChain;
};

export type TextProcessorRuleChainCandidate = string[];

export type InflectionRuleChain = InflectionRule[];

export type InflectionRule = {
    name: string;
    description?: string;
};

export type InflectionSource = 'algorithm' | 'dictionary' | 'both';

export type TermHeadword = {
    index: number;
    term: string;
    reading: string;
    sources: TermSource[];
    tags: Tag[];
    wordClasses: string[];
};

export type TermDefinition = {
    index: number;
    headwordIndices: number[];
    dictionary: string;
    dictionaryIndex: number;
    dictionaryAlias: string;
    id: number;
    score: number;
    frequencyOrder: number;
    sequences: number[];
    isPrimary: boolean;
    tags: Tag[];
    entries: DictionaryData.TermGlossaryContent[];
};

export type TermPronunciation = {
    index: number;
    headwordIndex: number;
    dictionary: string;
    dictionaryIndex: number;
    dictionaryAlias: string;
    pronunciations: Pronunciation[];
};

export type Pronunciation = PitchAccent | PhoneticTranscription;

export type PitchAccent = {
    type: 'pitch-accent';
    positions: number | string;
    nasalPositions: number[];
    devoicePositions: number[];
    tags: Tag[];
};

export type PhoneticTranscription = {
    type: 'phonetic-transcription';
    ipa: string;
    tags: Tag[];
};

export type PronunciationType = Pronunciation['type'];

export type PronunciationGeneric<T extends PronunciationType> = Extract<Pronunciation, { type: T }>;

export type TermFrequency = {
    index: number;
    headwordIndex: number;
    dictionary: string;
    dictionaryIndex: number;
    dictionaryAlias: string;
    hasReading: boolean;
    frequency: number;
    displayValue: string | null;
    displayValueParsed: boolean;
};

export type TermSourceMatchType = 'exact' | 'prefix' | 'suffix';

export type TermSourceMatchSource = 'term' | 'reading' | 'sequence';

export type TermSource = {
    originalText: string;
    transformedText: string;
    deinflectedText: string;
    matchType: TermSourceMatchType;
    matchSource: TermSourceMatchSource;
    isPrimary: boolean;
};
