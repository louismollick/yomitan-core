import type * as DictionaryData from './dictionary-data';
import type * as DictionaryDatabase from './dictionary-database';
import type * as StructuredContent from './structured-content';

export type OnProgressCallback = (data: ProgressData) => void;

export type ImportStep = { label: string; callback?: () => void };

export type ImportSteps = ImportStep[];

export type ProgressData = {
    index: number;
    count: number;
    nextStep?: boolean;
};

export type ImportResult = {
    result: Summary | null;
    errors: Error[];
};

export type ImportDetails = {
    prefixWildcardsSupported: boolean;
    yomitanVersion: string;
};

export type Summary = {
    title: string;
    revision: string;
    sequenced: boolean;
    minimumYomitanVersion?: string;
    version: number;
    importDate: number;
    prefixWildcardsSupported: boolean;
    counts?: SummaryCounts;
    styles: string;
    isUpdatable?: boolean;
    indexUrl?: string;
    downloadUrl?: string;
    author?: string;
    url?: string;
    description?: string;
    attribution?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    frequencyMode?: 'occurrence-based' | 'rank-based';
    importSuccess?: boolean;
};

export type SummaryDetails = {
    prefixWildcardsSupported: boolean;
    counts: SummaryCounts;
    styles: string;
    yomitanVersion: string;
    importSuccess: boolean;
};

export type SummaryCounts = {
    terms: SummaryItemCount;
    termMeta: SummaryMetaCount;
    kanji: SummaryItemCount;
    kanjiMeta: SummaryMetaCount;
    tagMeta: SummaryItemCount;
    media: SummaryItemCount;
};

export type SummaryItemCount = {
    total: number;
};

export type SummaryMetaCount = {
    [key: string]: number;
};

export type ImportRequirement = ImageImportRequirement | StructuredContentImageImportRequirement;

export type ImageImportRequirement = {
    type: 'image';
    target: DictionaryData.TermGlossaryImage;
    source: DictionaryData.TermGlossaryImage;
    entry: DictionaryDatabase.DatabaseTermEntry;
};

export type StructuredContentImageImportRequirement = {
    type: 'structured-content-image';
    target: StructuredContent.ImageElement;
    source: StructuredContent.ImageElement;
    entry: DictionaryDatabase.DatabaseTermEntry;
};

export type ImportRequirementContext = {
    fileMap: ArchiveFileMap;
    media: Map<string, DictionaryDatabase.MediaDataArrayBufferContent>;
};

export type ArchiveFileMap = Map<string, unknown>;

export type QueryDetails = [fileType: string, fileNameFormat: RegExp][];

export type QueryResult = Map<string, unknown[]>;

export type CompiledSchemaValidators = {
    dictionaryIndex: import('ajv').ValidateFunction;
    dictionaryTermBankV1: import('ajv').ValidateFunction;
    dictionaryTermBankV3: import('ajv').ValidateFunction;
    dictionaryTermMetaBankV3: import('ajv').ValidateFunction;
    dictionaryKanjiBankV1: import('ajv').ValidateFunction;
    dictionaryKanjiBankV3: import('ajv').ValidateFunction;
    dictionaryKanjiMetaBankV3: import('ajv').ValidateFunction;
    dictionaryTagBankV3: import('ajv').ValidateFunction;
};

export type CompiledSchemaName = keyof CompiledSchemaValidators;

export type CompiledSchemaNameArray = [
    termBank: CompiledSchemaName,
    termMetaBank: CompiledSchemaName,
    kanjiBank: CompiledSchemaName,
    kanjiMetaBank: CompiledSchemaName,
    tagBank: CompiledSchemaName,
];
