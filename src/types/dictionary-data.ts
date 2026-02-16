import type * as StructuredContent from './structured-content';

export type IndexVersion = 1 | 2 | 3;

export type Index = {
    format?: IndexVersion;
    version?: IndexVersion;
    title: string;
    revision: string;
    minimumYomitanVersion?: string;
    sequenced?: boolean;
    isUpdatable?: true;
    indexUrl?: string;
    downloadUrl?: string;
    author?: string;
    url?: string;
    description?: string;
    attribution?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    frequencyMode?: 'occurrence-based' | 'rank-based';
    tagMeta?: IndexTagMeta;
};

export type IndexTagMeta = {
    [name: string]: IndexTag;
};

export type IndexTag = {
    category: string;
    order: number;
    notes: string;
    score: number;
};

export type TermV1Array = TermV1[];

export type TermV1 = [
    expression: string,
    reading: string,
    definitionTags: string | null,
    rules: string,
    score: number,
    ...glossary: string[],
];

export type TermV3Array = TermV3[];

export type TermV3 = [
    expression: string,
    reading: string,
    definitionTags: string | null,
    rules: string,
    score: number,
    glossary: TermGlossary[],
    sequence: number,
    termTags: string,
];

export type KanjiV1Array = KanjiV1[];

export type KanjiV1 = [character: string, onyomi: string, kunyomi: string, tags: string, ...meanings: string[]];

export type KanjiV3Array = KanjiV3[];

export type KanjiV3 = [
    character: string,
    onyomi: string,
    kunyomi: string,
    tags: string,
    meanings: string[],
    stats: { [name: string]: string },
];

export type TermGlossary = TermGlossaryContent | TermGlossaryDeinflection;

export type TermGlossaryContent =
    | TermGlossaryString
    | TermGlossaryText
    | TermGlossaryImage
    | TermGlossaryStructuredContent;

export type TermGlossaryString = string;

export type TermGlossaryText = { type: 'text'; text: string };

export type TermGlossaryImage = { type: 'image' } & TermImage;

export type TermGlossaryStructuredContent = { type: 'structured-content'; content: StructuredContent.Content };

export type TermGlossaryDeinflection = [uninflected: string, inflectionRuleChain: string[]];

export type TermImage = StructuredContent.ImageElementBase & {
    verticalAlign?: undefined;
    border?: undefined;
    borderRadius?: undefined;
    sizeUnits?: undefined;
};

export type TagArray = Tag[];

export type Tag = [name: string, category: string, order: number, notes: string, score: number];

export type GenericFrequencyData =
    | string
    | number
    | {
          value: number;
          displayValue?: string;
          reading?: undefined;
      };

export type TermMetaArray = TermMeta[];

export type TermMeta = TermMetaFrequency | TermMetaPitch | TermMetaPhonetic;

export type TermMetaFrequencyDataWithReading = {
    reading: string;
    frequency: GenericFrequencyData;
};

export type TermMetaFrequency = [
    expression: string,
    mode: 'freq',
    data: GenericFrequencyData | TermMetaFrequencyDataWithReading,
];

export type TermMetaPitchData = {
    reading: string;
    pitches: {
        position: number | string;
        nasal?: number | number[];
        devoice?: number | number[];
        tags?: string[];
    }[];
};

export type TermMetaPitch = [expression: string, mode: 'pitch', data: TermMetaPitchData];

export type TermMetaPhonetic = [expression: string, mode: 'ipa', data: TermMetaPhoneticData];

export type TermMetaPhoneticData = {
    reading: string;
    transcriptions: {
        ipa: string;
        tags?: string[];
    }[];
};

export type KanjiMetaArray = KanjiMeta[];

export type KanjiMeta = KanjiMetaFrequency;

export type KanjiMetaFrequency = [character: string, mode: 'freq', data: GenericFrequencyData];
