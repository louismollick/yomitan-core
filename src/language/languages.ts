import type * as Language from '../types/language';
import { languageDescriptorMap } from './language-descriptors';

export function getLanguageSummaries(): Language.LanguageSummary[] {
    const results: Language.LanguageSummary[] = [];
    for (const { name, iso, iso639_3, exampleText } of languageDescriptorMap.values()) {
        results.push({ name, iso, iso639_3, exampleText });
    }
    return results;
}

export function getAllLanguageReadingNormalizers(): Language.LanguageAndReadingNormalizer[] {
    const results: Language.LanguageAndReadingNormalizer[] = [];
    for (const { iso, readingNormalizer } of languageDescriptorMap.values()) {
        if (typeof readingNormalizer === 'undefined') {
            continue;
        }
        results.push({ iso, readingNormalizer });
    }
    return results;
}

export function getAllLanguageTextProcessors(): Language.LanguageAndProcessors[] {
    const results: Language.LanguageAndProcessors[] = [];
    for (const { iso, textPreprocessors = {}, textPostprocessors = {} } of languageDescriptorMap.values()) {
        const textPreprocessorsArray: Language.TextProcessorWithId<unknown>[] = [];
        for (const [id, textPreprocessor] of Object.entries(textPreprocessors)) {
            textPreprocessorsArray.push({ id, textProcessor: textPreprocessor as Language.TextProcessor<unknown> });
        }
        const textPostprocessorsArray: Language.TextProcessorWithId<unknown>[] = [];
        for (const [id, textPostprocessor] of Object.entries(textPostprocessors)) {
            textPostprocessorsArray.push({ id, textProcessor: textPostprocessor as Language.TextProcessor<unknown> });
        }
        results.push({ iso, textPreprocessors: textPreprocessorsArray, textPostprocessors: textPostprocessorsArray });
    }
    return results;
}

export function isTextLookupWorthy(text: string, language: string): boolean {
    const descriptor = languageDescriptorMap.get(language);
    if (typeof descriptor === 'undefined') {
        return false;
    }
    return typeof descriptor.isTextLookupWorthy === 'undefined' || descriptor.isTextLookupWorthy(text);
}

export function getAllLanguageTransformDescriptors(): Language.LanguageAndTransforms[] {
    const results: Language.LanguageAndTransforms[] = [];
    for (const { iso, languageTransforms } of languageDescriptorMap.values()) {
        if (languageTransforms) {
            results.push({ iso, languageTransforms });
        }
    }
    return results;
}
