import type * as Dictionary from './dictionary';
import type * as DictionaryData from './dictionary-data';
import type { Summary } from './dictionary-importer';

export type DatabaseId = {
    id: number;
};

export type MediaDataBase<TContentType = unknown> = {
    dictionary: string;
    path: string;
    mediaType: string;
    width: number;
    height: number;
    content: TContentType;
};

export type MediaDataArrayBufferContent = MediaDataBase<ArrayBuffer>;

export type MediaDataStringContent = MediaDataBase<string>;

export type Media<T extends ArrayBuffer | string | null = ArrayBuffer> = { index: number } & MediaDataBase<T>;

export type DatabaseTermEntry = {
    expression: string;
    reading: string;
    expressionReverse?: string;
    readingReverse?: string;
    definitionTags: string | null;
    tags?: string;
    rules: string;
    score: number;
    glossary: DictionaryData.TermGlossary[];
    sequence?: number;
    termTags?: string;
    dictionary: string;
};

export type DatabaseTermEntryWithId = DatabaseTermEntry & DatabaseId;

export type TermEntry = {
    index: number;
    matchType: MatchType;
    matchSource: MatchSource;
    term: string;
    reading: string;
    definitionTags: string[];
    termTags: string[];
    rules: string[];
    definitions: DictionaryData.TermGlossary[];
    score: number;
    dictionary: string;
    id: number;
    sequence: number;
};

export type DatabaseKanjiEntry = {
    character: string;
    onyomi: string;
    kunyomi: string;
    tags: string;
    meanings: string[];
    dictionary: string;
    stats?: { [name: string]: string };
};

export type KanjiEntry = {
    index: number;
    character: string;
    onyomi: string[];
    kunyomi: string[];
    tags: string[];
    definitions: string[];
    stats: { [name: string]: string };
    dictionary: string;
};

export type Tag = {
    name: string;
    category: string;
    order: number;
    notes: string;
    score: number;
    dictionary: string;
};

export type DatabaseTermMeta = DatabaseTermMetaFrequency | DatabaseTermMetaPitch | DatabaseTermMetaPhoneticData;

export type DatabaseTermMetaFrequency = {
    expression: string;
    mode: 'freq';
    data: DictionaryData.GenericFrequencyData | DictionaryData.TermMetaFrequencyDataWithReading;
    dictionary: string;
};

export type DatabaseTermMetaPitch = {
    expression: string;
    mode: 'pitch';
    data: DictionaryData.TermMetaPitchData;
    dictionary: string;
};

export type DatabaseTermMetaPhoneticData = {
    expression: string;
    mode: 'ipa';
    data: DictionaryData.TermMetaPhoneticData;
    dictionary: string;
};

export type TermMeta = TermMetaFrequency | TermMetaPitch | TermMetaPhoneticData;

export type TermMetaType = TermMeta['mode'];

export type TermMetaFrequency = {
    index: number;
    term: string;
    mode: 'freq';
    data: DictionaryData.GenericFrequencyData | DictionaryData.TermMetaFrequencyDataWithReading;
    dictionary: string;
};

export type TermMetaPitch = {
    mode: 'pitch';
    index: number;
    term: string;
    data: DictionaryData.TermMetaPitchData;
    dictionary: string;
};

export type TermMetaPhoneticData = {
    mode: 'ipa';
    index: number;
    term: string;
    data: DictionaryData.TermMetaPhoneticData;
    dictionary: string;
};

export type DatabaseKanjiMeta = DatabaseKanjiMetaFrequency;

export type DatabaseKanjiMetaFrequency = {
    character: string;
    mode: 'freq';
    data: DictionaryData.GenericFrequencyData;
    dictionary: string;
};

export type KanjiMeta = KanjiMetaFrequency;

export type KanjiMetaType = KanjiMeta['mode'];

export type KanjiMetaFrequency = {
    index: number;
    character: string;
    mode: 'freq';
    data: DictionaryData.GenericFrequencyData;
    dictionary: string;
};

export type DictionaryCounts = {
    total: DictionaryCountGroup | null;
    counts: DictionaryCountGroup[];
};

export type DictionaryCountGroup = {
    [key: string]: number;
};

export type ObjectStoreName = 'dictionaries' | 'terms' | 'termMeta' | 'kanji' | 'kanjiMeta' | 'tagMeta' | 'media';

export type DeleteDictionaryProgressData = {
    count: number;
    processed: number;
    storeCount: number;
    storesProcesed: number;
};

export type DeleteDictionaryProgressCallback = (data: DeleteDictionaryProgressData) => void;

export type MatchType = Dictionary.TermSourceMatchType;

export type MatchSource = Dictionary.TermSourceMatchSource;

export type DictionaryAndQueryRequest = {
    query: string | number;
    dictionary: string;
};

export type TermExactRequest = {
    term: string;
    reading: string;
};

export type MediaRequest = {
    path: string;
    dictionary: string;
};

export type FindMultiBulkData<TItem = unknown> = {
    item: TItem;
    itemIndex: number;
    indexIndex: number;
};

export type CreateQuery<TItem = unknown> = (item: TItem) => IDBValidKey | IDBKeyRange | null;

export type FindPredicate<TItem = unknown, TRow = unknown> = (row: TRow, item: TItem) => boolean;

export type CreateResult<TItem = unknown, TRow = unknown, TResult = unknown> = (
    row: TRow,
    data: FindMultiBulkData<TItem>,
) => TResult;

export type DictionarySet = {
    has(value: string): boolean;
};
