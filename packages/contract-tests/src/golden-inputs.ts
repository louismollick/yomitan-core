/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Inputs shared by the golden generator (upstream code) and the golden tests (yomitan-core).
 */

import type { ProfileOptions } from '../../core/src/profile/profile';

export const GOLDEN_DICTIONARY = 'Test Dictionary';

export const GOLDEN_PARSE_TEXTS = [
    '打ち込む',
    '打ち込む\n打つ',
    '今日は打ち込んだ。',
    'ダースで打つ',
    'test 打った! 　打ち込み',
    '𠀋打つ',
    '',
];

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function withDictionary(
    defaults: ProfileOptions,
    overrides: Partial<ProfileOptions['dictionaries'][number]> = {},
): ProfileOptions {
    const options = clone(defaults);
    options.dictionaries = [
        {
            name: GOLDEN_DICTIONARY,
            alias: GOLDEN_DICTIONARY,
            enabled: true,
            allowSecondarySearches: false,
            definitionsCollapsible: 'not-collapsible',
            partsOfSpeechFilter: true,
            useDeinflections: true,
            styles: '',
            ...overrides,
        } as ProfileOptions['dictionaries'][number],
    ];
    options.general.mainDictionary = GOLDEN_DICTIONARY;
    return options;
}

/** Profiles that exercise every branch of upstream's profile → translator options mapping. */
export function createGoldenProfiles(defaults: ProfileOptions): { name: string; options: ProfileOptions }[] {
    const profiles: { name: string; options: ProfileOptions }[] = [];
    profiles.push({ name: 'defaults', options: clone(defaults) });
    profiles.push({ name: 'test-dictionary-enabled', options: withDictionary(defaults) });

    const disabled = withDictionary(defaults, { enabled: false });
    profiles.push({ name: 'dictionary-disabled', options: disabled });

    const merge = withDictionary(defaults, { enabled: false });
    merge.general.resultOutputMode = 'merge';
    profiles.push({ name: 'merge-main-dictionary-disabled', options: merge });

    const aliased = withDictionary(defaults, {
        alias: 'Alias',
        allowSecondarySearches: true,
        partsOfSpeechFilter: false,
        useDeinflections: false,
    });
    profiles.push({ name: 'aliased-secondary', options: aliased });

    const alphanumeric = withDictionary(defaults);
    alphanumeric.scanning.alphanumeric = !defaults.scanning.alphanumeric;
    profiles.push({ name: 'alphanumeric-flipped', options: alphanumeric });

    const replacements = withDictionary(defaults);
    replacements.translation.textReplacements = {
        searchOriginal: false,
        groups: [
            [
                { pattern: '\\(([^)]*)\\)', ignoreCase: false, replacement: '' },
                { pattern: "don't", ignoreCase: true, replacement: 'do not' },
                { pattern: '([', ignoreCase: false, replacement: 'invalid' },
            ],
            [],
            [{ pattern: '[（(].*?[）)]', ignoreCase: true, replacement: '' }],
        ],
    } as ProfileOptions['translation']['textReplacements'];
    profiles.push({ name: 'text-replacements', options: replacements });

    const replacementsWithOriginal = clone(replacements);
    replacementsWithOriginal.translation.textReplacements.searchOriginal = true;
    profiles.push({ name: 'text-replacements-search-original', options: replacementsWithOriginal });

    const english = withDictionary(defaults);
    english.general.language = 'en';
    english.translation.searchResolution = 'word';
    english.general.sortFrequencyDictionary = GOLDEN_DICTIONARY;
    english.general.sortFrequencyDictionaryOrder = 'ascending';
    profiles.push({ name: 'english-word-resolution', options: english });
    return profiles;
}

/** JSON-safe form of translator options: Maps and Sets become arrays, RegExps become source/flags. */
export function serializeOptions(value: unknown): unknown {
    if (value instanceof Map) {
        return { $map: [...value.entries()].map(([key, item]) => [key, serializeOptions(item)]) };
    }
    if (value instanceof Set) {
        return { $set: [...value].map(serializeOptions) };
    }
    if (value instanceof RegExp) {
        return { $regexp: value.source, flags: value.flags };
    }
    if (Array.isArray(value)) {
        return value.map(serializeOptions);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeOptions(item)]));
    }
    return value;
}
