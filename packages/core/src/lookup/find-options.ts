/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Profile → translator options, ported from Yomitan's ext/js/background/backend.js
 * (_getTranslatorFindTermsOptions, _getTranslatorFindKanjiOptions, _getTranslatorEnabledDictionaryMap,
 * _getTranslatorTextReplacements). Parity is checked by the profile-mapping goldens.
 */

import type { ProfileOptions } from '../upstream/types/ext/settings';
import type {
    FindKanjiOptions,
    FindTermDictionary,
    FindTermsOptions,
    FindTermsTextReplacement,
} from '../upstream/types/ext/translation';

export type FindTermsMode = 'group' | 'merge' | 'split' | 'simple';

export type FindTermsDetails = {
    matchType?: 'exact' | 'prefix' | 'suffix';
    deinflect?: boolean;
    primaryReading?: string;
};

export function getEnabledDictionaryMap(options: ProfileOptions): Map<string, FindTermDictionary> {
    const enabledDictionaryMap = new Map<string, FindTermDictionary>();
    for (const dictionary of options.dictionaries) {
        if (!dictionary.enabled) {
            continue;
        }
        const { name, alias, allowSecondarySearches, partsOfSpeechFilter, useDeinflections } = dictionary;
        enabledDictionaryMap.set(name, {
            index: enabledDictionaryMap.size,
            alias,
            allowSecondarySearches,
            partsOfSpeechFilter,
            useDeinflections,
        });
    }
    return enabledDictionaryMap;
}

export function getTextReplacements(
    textReplacementsOptions: ProfileOptions['translation']['textReplacements'],
): (FindTermsTextReplacement[] | null)[] {
    const textReplacements: (FindTermsTextReplacement[] | null)[] = [];
    for (const group of textReplacementsOptions.groups) {
        const entries: FindTermsTextReplacement[] = [];
        for (const { pattern, ignoreCase, replacement } of group) {
            let patternRegExp: RegExp;
            try {
                patternRegExp = ignoreCase
                    ? new RegExp(pattern.replace(/['’]/g, "['’]"), 'gi')
                    : new RegExp(pattern, 'g');
            } catch {
                // Invalid pattern
                continue;
            }
            entries.push({ pattern: patternRegExp, replacement });
        }
        if (entries.length > 0) {
            textReplacements.push(entries);
        }
    }
    if (textReplacements.length === 0 || textReplacementsOptions.searchOriginal) {
        textReplacements.unshift(null);
    }
    return textReplacements;
}

export function getFindTermsOptions(
    mode: FindTermsMode,
    details: FindTermsDetails,
    options: ProfileOptions,
): FindTermsOptions {
    let { matchType, deinflect, primaryReading } = details;
    if (typeof matchType !== 'string') {
        matchType = 'exact';
    }
    if (typeof deinflect !== 'boolean') {
        deinflect = true;
    }
    if (typeof primaryReading !== 'string') {
        primaryReading = '';
    }
    const enabledDictionaryMap = getEnabledDictionaryMap(options);
    const {
        general: { mainDictionary, sortFrequencyDictionary, sortFrequencyDictionaryOrder, language },
        scanning: { alphanumeric },
        translation: { textReplacements: textReplacementsOptions, searchResolution },
    } = options;
    const textReplacements = getTextReplacements(textReplacementsOptions);
    let excludeDictionaryDefinitions: Set<string> | null = null;
    if (mode === 'merge' && !enabledDictionaryMap.has(mainDictionary)) {
        enabledDictionaryMap.set(mainDictionary, {
            index: enabledDictionaryMap.size,
            alias: mainDictionary,
            allowSecondarySearches: false,
            partsOfSpeechFilter: true,
            useDeinflections: true,
        });
        excludeDictionaryDefinitions = new Set([mainDictionary]);
    }
    return {
        matchType,
        deinflect,
        primaryReading,
        mainDictionary,
        sortFrequencyDictionary,
        sortFrequencyDictionaryOrder,
        removeNonJapaneseCharacters: !alphanumeric,
        searchResolution,
        textReplacements,
        enabledDictionaryMap,
        excludeDictionaryDefinitions,
        language,
        useAllFrequencyDictionaries: false,
    } as FindTermsOptions;
}

export function getFindKanjiOptions(options: ProfileOptions): FindKanjiOptions {
    return {
        enabledDictionaryMap: getEnabledDictionaryMap(options),
        removeNonJapaneseCharacters: !options.scanning.alphanumeric,
    } as FindKanjiOptions;
}
