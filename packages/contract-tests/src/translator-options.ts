/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Converts Yomitan's translator fixture option presets exactly as upstream's
 * test/utilities/translator.js does. No Node APIs, so it can be bundled for Hermes.
 */

const PLACEHOLDER = '${title}';

export type Preset = Record<string, unknown> & { type: 'terms' | 'kanji' };
export type OptionsList = string | Preset | (string | Preset)[];
export type TranslatorTestCase =
    | { name: string; func: 'findTerms'; mode: string; text: string; options: OptionsList }
    | { name: string; func: 'findKanji'; text: string; options: OptionsList };

function getCompositePreset(type: Preset['type'], presets: Record<string, Preset>, optionsList: OptionsList): Preset {
    const preset: Preset = { type };
    for (const entry of Array.isArray(optionsList) ? optionsList : [optionsList]) {
        const source = typeof entry === 'string' ? presets[entry] : entry;
        if (source === undefined || source.type !== type) {
            throw new Error('Invalid options preset');
        }
        Object.assign(preset, JSON.parse(JSON.stringify(source)));
    }
    return preset;
}

function toEnabledDictionaryMap(value: unknown, dictionaryName: string): Map<string, unknown> {
    const map = new Map<string, unknown>();
    if (Array.isArray(value)) {
        for (const [key, options] of value) {
            map.set(key === PLACEHOLDER ? dictionaryName : key, options);
        }
    }
    return map;
}

export function createFindKanjiOptions(
    dictionaryName: string,
    presets: Record<string, Preset>,
    optionsList: OptionsList,
) {
    const preset = getCompositePreset('kanji', presets, optionsList);
    return {
        enabledDictionaryMap: toEnabledDictionaryMap(preset.enabledDictionaryMap, dictionaryName),
        removeNonJapaneseCharacters: !!preset.removeNonJapaneseCharacters,
    };
}

export function createFindTermsOptions(
    dictionaryName: string,
    presets: Record<string, Preset>,
    optionsList: OptionsList,
) {
    const preset = getCompositePreset('terms', presets, optionsList);
    const textReplacements: ({ pattern: RegExp; replacement: string }[] | null)[] = [];
    if (Array.isArray(preset.textReplacements)) {
        for (const value of preset.textReplacements) {
            textReplacements.push(
                Array.isArray(value)
                    ? value.map(({ pattern, flags, replacement }) => ({
                          pattern: new RegExp(pattern, flags),
                          replacement,
                      }))
                    : null,
            );
        }
    }
    const get = <T>(key: string, fallback: T): T => (preset[key] === undefined ? fallback : (preset[key] as T));
    const mainDictionary = get<string>('mainDictionary', dictionaryName);
    const excludeDictionaryDefinitions = preset.excludeDictionaryDefinitions;
    return {
        matchType: get('matchType', 'exact'),
        deinflect: get('deinflect', true),
        mainDictionary: mainDictionary === PLACEHOLDER ? dictionaryName : mainDictionary,
        sortFrequencyDictionary: get<string | null>('sortFrequencyDictionary', null),
        sortFrequencyDictionaryOrder: get('sortFrequencyDictionaryOrder', 'ascending'),
        removeNonJapaneseCharacters: get('removeNonJapaneseCharacters', false),
        primaryReading: get('primaryReading', ''),
        textReplacements,
        enabledDictionaryMap: toEnabledDictionaryMap(preset.enabledDictionaryMap, dictionaryName),
        excludeDictionaryDefinitions: Array.isArray(excludeDictionaryDefinitions)
            ? new Set(excludeDictionaryDefinitions)
            : null,
        searchResolution: get('searchResolution', 'letter'),
        language: get('language', 'ja'),
        useAllFrequencyDictionaries: false,
    };
}
