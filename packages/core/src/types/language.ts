import type { LanguageTransformDescriptor } from './language-transformer';

export type TextProcessorOptions<T = unknown> = T[];

export type TextProcessorFunction<T = unknown> = (str: string, setting: T) => string;

export type TextProcessor<T = unknown> = {
    name: string;
    description: string;
    options: TextProcessorOptions<T>;
    process: TextProcessorFunction<T>;
};

export type ReadingNormalizer = (str: string) => string;

export type BidirectionalPreprocessorOptions = 'off' | 'direct' | 'inverse';

export type BidirectionalConversionPreprocessor = TextProcessor<BidirectionalPreprocessorOptions>;

export type LanguageAndProcessors = {
    iso: string;
    textPreprocessors?: TextProcessorWithId<unknown>[];
    textPostprocessors?: TextProcessorWithId<unknown>[];
};

export type LanguageAndReadingNormalizer = {
    iso: string;
    readingNormalizer: ReadingNormalizer;
};

export type LanguageAndTransforms = {
    iso: string;
    languageTransforms: LanguageTransformDescriptor;
};

export type TextProcessorWithId<T = unknown> = {
    id: string;
    textProcessor: TextProcessor<T>;
};

export type LanguageSummary = {
    name: string;
    iso: string;
    iso639_3: string;
    exampleText: string;
};

export type IsTextLookupWorthyFunction = (text: string) => boolean;

export type LanguageDescriptorAny = {
    iso: string;
    iso639_3: string;
    name: string;
    exampleText: string;
    isTextLookupWorthy?: IsTextLookupWorthyFunction;
    readingNormalizer?: ReadingNormalizer;
    textPreprocessors?: Record<string, TextProcessor<any>>;
    textPostprocessors?: Record<string, TextProcessor<any>>;
    languageTransforms?: LanguageTransformDescriptor;
};
