export type AnkiDuplicateScope = 'collection' | 'deck' | 'deck-root';

export type ProfileOptions = {
    general: GeneralOptions;
    audio: AudioOptions;
    anki: AnkiOptions;
    translation: TranslationOptions;
};

export type GeneralOptions = {
    language: string;
    resultOutputMode: 'group' | 'merge' | 'split';
    mainDictionary: string;
    sortFrequencyDictionary: string | null;
    sortFrequencyDictionaryOrder: 'ascending' | 'descending';
};

export type AudioOptions = {
    enabled: boolean;
    sources: AudioSourceOptions[];
    volume: number;
};

export type AudioSourceOptions = {
    type: string;
    url: string;
    voice: string;
};

export type AnkiOptions = {
    enable: boolean;
    server: string;
    apiKey: string;
    duplicateScope: AnkiDuplicateScope;
};

export type TranslationOptions = {
    searchResolution: 'letter' | 'word';
    textReplacements: {
        searchOriginal: string;
        searchReplacement: string;
    }[];
};
