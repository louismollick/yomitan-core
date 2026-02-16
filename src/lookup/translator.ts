/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { DictionaryDB } from '../database/dictionary-database';
import {
    CJK_IDEOGRAPH_RANGES,
    CJK_PUNCTUATION_RANGE,
    FULLWIDTH_CHARACTER_RANGES,
    isCodePointInRanges,
} from '../language/cjk-util';
import type { CodepointRange } from '../language/cjk-util';
import { LanguageTransformer } from '../language/language-transformer';
import type { TransformedText } from '../language/language-transformer';
import { getAllLanguageReadingNormalizers, getAllLanguageTextProcessors } from '../language/languages';
import { MultiLanguageTransformer } from '../language/multi-language-transformer';
import type * as Dictionary from '../types/dictionary';
import type * as DictionaryData from '../types/dictionary-data';
import type * as DictionaryDatabase from '../types/dictionary-database';
import type * as Language from '../types/language';
import type * as Translation from '../types/translation';
import { applyTextReplacement } from '../util/regex-util';

// --- Internal types ---

type DictionaryTagCache = Map<string, Map<string, DictionaryDatabase.Tag | null>>;

type TextProcessorMap = Map<
    string,
    {
        textPreprocessors: Language.TextProcessorWithId<unknown>[];
        textPostprocessors: Language.TextProcessorWithId<unknown>[];
    }
>;

type ReadingNormalizerMap = Map<string, Language.ReadingNormalizer>;

type TextProcessorRuleChainCandidate = string[];

type InflectionRuleChainCandidate = {
    source: Dictionary.InflectionSource;
    inflectionRules: string[];
};

type TermDictionaryEntry = Dictionary.TermDictionaryEntry;

type DatabaseDeinflection = {
    originalText: string;
    transformedText: string;
    deinflectedText: string;
    conditions: number;
    textProcessorRuleChainCandidates: TextProcessorRuleChainCandidate[];
    inflectionRuleChainCandidates: InflectionRuleChainCandidate[];
    databaseEntries: DictionaryDatabase.TermEntry[];
};

type DictionaryEntryGroup = {
    ids: Set<number>;
    dictionaryEntries: TermDictionaryEntry[];
};

type SequenceQuery = {
    query: number;
    dictionary: string;
};

type TagGroup = {
    dictionary: string;
    tagNames: string[];
};

type TagExpansionTarget = {
    tags: Dictionary.Tag[];
    tagGroups: TagGroup[];
};

type TagTargetItem = {
    query: string;
    dictionary: string;
    tagName: string;
    cache: Map<string, DictionaryDatabase.Tag | null> | null;
    databaseTag: DictionaryDatabase.Tag | null;
    targets: Dictionary.Tag[][];
};

type TextCache = Map<string, Map<string, Map<unknown, string>>>;

type VariantAndTextProcessorRuleChainCandidatesMap = Map<string, TextProcessorRuleChainCandidate[]>;

export type FindTermsMode = 'group' | 'term' | 'merge' | 'simple';

// --- CJK Range definitions for JCK filtering ---

const HIRAGANA_RANGE: CodepointRange = [0x3040, 0x309f];
const KATAKANA_RANGE: CodepointRange = [0x30a0, 0x30ff];

const JAPANESE_RANGES: CodepointRange[] = [
    HIRAGANA_RANGE,
    KATAKANA_RANGE,
    ...CJK_IDEOGRAPH_RANGES,
    [0xff66, 0xff9f], // Halfwidth katakana
    [0x30fb, 0x30fc], // Katakana punctuation
    [0xff61, 0xff65], // Kana punctuation
    CJK_PUNCTUATION_RANGE,
    ...FULLWIDTH_CHARACTER_RANGES,
];

const BOPOMOFO_RANGE: CodepointRange = [0x3100, 0x312f];
const BOPOMOFO_EXTENDED_RANGE: CodepointRange = [0x31a0, 0x31bf];
const IDEOGRAPHIC_SYMBOLS_AND_PUNCTUATION_RANGE: CodepointRange = [0x16fe0, 0x16fff];
const SMALL_FORM_RANGE: CodepointRange = [0xfe50, 0xfe6f];
const VERTICAL_FORM_RANGE: CodepointRange = [0xfe10, 0xfe1f];

const CHINESE_RANGES: CodepointRange[] = [
    ...CJK_IDEOGRAPH_RANGES,
    CJK_PUNCTUATION_RANGE,
    ...FULLWIDTH_CHARACTER_RANGES,
    BOPOMOFO_RANGE,
    BOPOMOFO_EXTENDED_RANGE,
    IDEOGRAPHIC_SYMBOLS_AND_PUNCTUATION_RANGE,
    SMALL_FORM_RANGE,
    VERTICAL_FORM_RANGE,
];

const HANGUL_JAMO_RANGE: CodepointRange = [0x1100, 0x11ff];
const HANGUL_COMPATIBILITY_JAMO_RANGE: CodepointRange = [0x3130, 0x318f];
const HANGUL_SYLLABLES_RANGE: CodepointRange = [0xac00, 0xd7af];
const HANGUL_JAMO_EXTENDED_A_RANGE: CodepointRange = [0xa960, 0xa97f];
const HANGUL_JAMO_EXTENDED_B_RANGE: CodepointRange = [0xd7b0, 0xd7ff];
const HANGUL_JAMO_HALF_WIDTH_RANGE: CodepointRange = [0xffa0, 0xffdc];

const KOREAN_RANGES: CodepointRange[] = [
    ...CJK_IDEOGRAPH_RANGES,
    CJK_PUNCTUATION_RANGE,
    ...FULLWIDTH_CHARACTER_RANGES,
    HANGUL_JAMO_RANGE,
    HANGUL_COMPATIBILITY_JAMO_RANGE,
    HANGUL_SYLLABLES_RANGE,
    HANGUL_JAMO_EXTENDED_A_RANGE,
    HANGUL_JAMO_EXTENDED_B_RANGE,
    HANGUL_JAMO_HALF_WIDTH_RANGE,
];

function isCodePointJapanese(codePoint: number): boolean {
    return isCodePointInRanges(codePoint, JAPANESE_RANGES);
}

function isCodePointChinese(codePoint: number): boolean {
    return isCodePointInRanges(codePoint, CHINESE_RANGES);
}

function isCodePointKorean(codePoint: number): boolean {
    return isCodePointInRanges(codePoint, KOREAN_RANGES);
}

// --- TranslatorTagAggregator ---

class TranslatorTagAggregator {
    private _tagExpansionTargetMap: Map<Dictionary.Tag[], TagGroup[]>;

    constructor() {
        this._tagExpansionTargetMap = new Map();
    }

    addTags(tags: Dictionary.Tag[], dictionary: string, tagNames: string[]): void {
        if (tagNames.length === 0) {
            return;
        }
        const tagGroups = this._getOrCreateTagGroups(tags);
        const tagGroup = this._getOrCreateTagGroup(tagGroups, dictionary);
        this._addUniqueTags(tagGroup, tagNames);
    }

    getTagExpansionTargets(): TagExpansionTarget[] {
        const results: TagExpansionTarget[] = [];
        for (const [tags, tagGroups] of this._tagExpansionTargetMap) {
            results.push({ tags, tagGroups });
        }
        return results;
    }

    mergeTags(tags: Dictionary.Tag[], newTags: Dictionary.Tag[]): void {
        const newTagGroups = this._tagExpansionTargetMap.get(newTags);
        if (typeof newTagGroups === 'undefined') {
            return;
        }
        const tagGroups = this._getOrCreateTagGroups(tags);
        for (const { dictionary, tagNames } of newTagGroups) {
            const tagGroup = this._getOrCreateTagGroup(tagGroups, dictionary);
            this._addUniqueTags(tagGroup, tagNames);
        }
    }

    private _getOrCreateTagGroups(tags: Dictionary.Tag[]): TagGroup[] {
        let tagGroups = this._tagExpansionTargetMap.get(tags);
        if (typeof tagGroups === 'undefined') {
            tagGroups = [];
            this._tagExpansionTargetMap.set(tags, tagGroups);
        }
        return tagGroups;
    }

    private _getOrCreateTagGroup(tagGroups: TagGroup[], dictionary: string): TagGroup {
        for (const tagGroup of tagGroups) {
            if (tagGroup.dictionary === dictionary) {
                return tagGroup;
            }
        }
        const newTagGroup: TagGroup = { dictionary, tagNames: [] };
        tagGroups.push(newTagGroup);
        return newTagGroup;
    }

    private _addUniqueTags(tagGroup: TagGroup, newTagNames: string[]): void {
        const { tagNames } = tagGroup;
        for (const tagName of newTagNames) {
            if (tagNames.includes(tagName)) {
                continue;
            }
            tagNames.push(tagName);
        }
    }
}

// --- Translator ---

/**
 * Class which finds term and kanji dictionary entries for text.
 */
export class Translator {
    private _database: DictionaryDB;
    private _multiLanguageTransformer: MultiLanguageTransformer;
    private _tagCache: DictionaryTagCache;
    private _stringComparer: Intl.Collator;
    private _numberRegex: RegExp;
    private _textProcessors: TextProcessorMap;
    private _readingNormalizers: ReadingNormalizerMap;

    constructor(database: DictionaryDB) {
        this._database = database;
        this._multiLanguageTransformer = new MultiLanguageTransformer();
        this._tagCache = new Map();
        this._stringComparer = new Intl.Collator('en-US'); // Invariant locale
        this._numberRegex = /[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/;
        this._textProcessors = new Map();
        this._readingNormalizers = new Map();
    }

    /**
     * Initializes the instance for use. The public API should not be used until this function has been called.
     */
    prepare(): void {
        this._multiLanguageTransformer.prepare();
        for (const { iso, textPreprocessors = [], textPostprocessors = [] } of getAllLanguageTextProcessors()) {
            this._textProcessors.set(iso, { textPreprocessors, textPostprocessors });
        }
        for (const { iso, readingNormalizer } of getAllLanguageReadingNormalizers()) {
            this._readingNormalizers.set(iso, readingNormalizer);
        }
    }

    /**
     * Clears the database tag cache. This should be executed if the database is changed.
     */
    clearDatabaseCaches(): void {
        this._tagCache.clear();
    }

    /**
     * Finds term definitions for the given text.
     */
    async findTerms(
        mode: FindTermsMode,
        text: string,
        options: Translation.FindTermsOptions,
    ): Promise<{ dictionaryEntries: TermDictionaryEntry[]; originalTextLength: number }> {
        const {
            enabledDictionaryMap,
            excludeDictionaryDefinitions,
            sortFrequencyDictionary,
            sortFrequencyDictionaryOrder,
            language,
            primaryReading,
        } = options;
        const tagAggregator = new TranslatorTagAggregator();
        let { dictionaryEntries, originalTextLength } = await this._findTermsInternal(
            text,
            options,
            tagAggregator,
            primaryReading,
        );

        switch (mode) {
            case 'group':
                dictionaryEntries = this._groupDictionaryEntriesByHeadword(
                    language,
                    dictionaryEntries,
                    tagAggregator,
                    primaryReading,
                );
                break;
            case 'term':
                dictionaryEntries = this._groupDictionaryEntriesByTerm(
                    language,
                    dictionaryEntries,
                    tagAggregator,
                    primaryReading,
                );
                break;
            case 'merge':
                dictionaryEntries = await this._getRelatedDictionaryEntries(dictionaryEntries, options, tagAggregator);
                break;
        }

        if (excludeDictionaryDefinitions !== null) {
            this._removeExcludedDefinitions(dictionaryEntries, excludeDictionaryDefinitions);
        }

        if (mode !== 'simple') {
            await this._addTermMeta(dictionaryEntries, enabledDictionaryMap, tagAggregator);
            await this._expandTagGroupsAndGroup(tagAggregator.getTagExpansionTargets());
        } else {
            if (sortFrequencyDictionary !== null) {
                const sortDictionaryMap: Translation.TermEnabledDictionaryMap = new Map();
                const value = enabledDictionaryMap.get(sortFrequencyDictionary);
                if (typeof value !== 'undefined') {
                    sortDictionaryMap.set(sortFrequencyDictionary, value);
                }
                await this._addTermMeta(dictionaryEntries, sortDictionaryMap, tagAggregator);
            }
        }

        if (sortFrequencyDictionary !== null) {
            this._updateSortFrequencies(
                dictionaryEntries,
                sortFrequencyDictionary,
                sortFrequencyDictionaryOrder === 'ascending',
            );
        }
        if (dictionaryEntries.length > 1) {
            this._sortTermDictionaryEntries(dictionaryEntries);
        }
        for (const { definitions, frequencies, pronunciations } of dictionaryEntries) {
            this._flagRedundantDefinitionTags(definitions);
            if (definitions.length > 1) {
                this._sortTermDictionaryEntryDefinitions(definitions);
            }
            if (frequencies.length > 1) {
                this._sortTermDictionaryEntrySimpleData(frequencies);
            }
            if (pronunciations.length > 1) {
                this._sortTermDictionaryEntrySimpleData(pronunciations);
            }
        }
        const withUserFacingInflections = this._addUserFacingInflections(language, dictionaryEntries);

        return { dictionaryEntries: withUserFacingInflections, originalTextLength };
    }

    /**
     * Finds kanji definitions for the given text.
     */
    async findKanji(text: string, options: Translation.FindKanjiOptions): Promise<Dictionary.KanjiDictionaryEntry[]> {
        if (options.removeNonJapaneseCharacters) {
            text = this._getJapaneseChineseKoreanOnlyText(text);
        }
        const { enabledDictionaryMap } = options;
        const kanjiUnique = new Set<string>();
        for (const c of text) {
            kanjiUnique.add(c);
        }

        const databaseEntries = await this._database.findKanjiBulk([...kanjiUnique], enabledDictionaryMap);
        if (databaseEntries.length === 0) {
            return [];
        }

        this._sortDatabaseEntriesByIndex(databaseEntries);

        const dictionaryEntries: Dictionary.KanjiDictionaryEntry[] = [];
        const tagAggregator = new TranslatorTagAggregator();
        for (const { character, onyomi, kunyomi, tags, definitions, stats, dictionary } of databaseEntries) {
            const expandedStats = await this._expandKanjiStats(stats, dictionary);
            const dictionaryAlias = this._getDictionaryAlias(dictionary, enabledDictionaryMap);
            const dictionaryEntry = this._createKanjiDictionaryEntry(
                character,
                dictionary,
                dictionaryAlias,
                onyomi,
                kunyomi,
                expandedStats,
                definitions,
                enabledDictionaryMap,
            );
            dictionaryEntries.push(dictionaryEntry);
            tagAggregator.addTags(dictionaryEntry.tags, dictionary, tags);
        }

        if (dictionaryEntries.length > 1) {
            this._sortKanjiDictionaryEntries(dictionaryEntries);
        }

        await this._addKanjiMeta(dictionaryEntries, enabledDictionaryMap);
        await this._expandTagGroupsAndGroup(tagAggregator.getTagExpansionTargets());

        this._sortKanjiDictionaryEntryData(dictionaryEntries);

        return dictionaryEntries;
    }

    /**
     * Gets a list of frequency information for a given list of term-reading pairs
     * and a list of dictionaries.
     */
    async getTermFrequencies(
        termReadingList: { term: string; reading: string | null }[],
        dictionaries: string[],
    ): Promise<
        {
            term: string;
            reading: string | null;
            dictionary: string;
            hasReading: boolean;
            frequency: number;
            displayValue: string | null;
            displayValueParsed: boolean;
        }[]
    > {
        const dictionarySet = new Set<string>();
        for (const dictionary of dictionaries) {
            dictionarySet.add(dictionary);
        }

        const termList = termReadingList.map(({ term }) => term);
        const metas = await this._database.findTermMetaBulk(termList, dictionarySet);

        const results: {
            term: string;
            reading: string | null;
            dictionary: string;
            hasReading: boolean;
            frequency: number;
            displayValue: string | null;
            displayValueParsed: boolean;
        }[] = [];
        for (const { mode, data, dictionary, index } of metas) {
            if (mode !== 'freq') {
                continue;
            }
            let { term, reading } = termReadingList[index];
            const hasReading =
                data !== null &&
                typeof data === 'object' &&
                typeof (data as DictionaryData.TermMetaFrequencyDataWithReading).reading === 'string';
            if (hasReading && (data as DictionaryData.TermMetaFrequencyDataWithReading).reading !== reading) {
                if (reading !== null) {
                    continue;
                }
                reading = (data as DictionaryData.TermMetaFrequencyDataWithReading).reading;
            }
            const frequency = hasReading
                ? (data as DictionaryData.TermMetaFrequencyDataWithReading).frequency
                : (data as DictionaryData.GenericFrequencyData);
            const { frequency: frequencyValue, displayValue, displayValueParsed } = this._getFrequencyInfo(frequency);
            results.push({
                term,
                reading,
                dictionary,
                hasReading,
                frequency: frequencyValue,
                displayValue,
                displayValueParsed,
            });
        }
        return results;
    }

    // Find terms internal implementation

    private async _findTermsInternal(
        text: string,
        options: Translation.FindTermsOptions,
        tagAggregator: TranslatorTagAggregator,
        primaryReading: string,
    ): Promise<{ dictionaryEntries: TermDictionaryEntry[]; originalTextLength: number }> {
        const { removeNonJapaneseCharacters, enabledDictionaryMap } = options;
        if (removeNonJapaneseCharacters && ['ja', 'zh', 'yue', 'ko'].includes(options.language)) {
            text = this._getJapaneseChineseKoreanOnlyText(text);
        }
        if (text.length === 0) {
            return { dictionaryEntries: [], originalTextLength: 0 };
        }

        const deinflections = await this._getDeinflections(text, options);

        return this._getDictionaryEntries(deinflections, enabledDictionaryMap, tagAggregator, primaryReading);
    }

    private _getDictionaryEntries(
        deinflections: DatabaseDeinflection[],
        enabledDictionaryMap: Translation.TermEnabledDictionaryMap,
        tagAggregator: TranslatorTagAggregator,
        primaryReading: string,
    ): { dictionaryEntries: TermDictionaryEntry[]; originalTextLength: number } {
        let originalTextLength = 0;
        const dictionaryEntries: TermDictionaryEntry[] = [];
        const ids = new Set<number>();
        for (const {
            databaseEntries,
            originalText,
            transformedText,
            deinflectedText,
            textProcessorRuleChainCandidates,
            inflectionRuleChainCandidates,
        } of deinflections) {
            if (databaseEntries.length === 0) {
                continue;
            }
            originalTextLength = Math.max(originalTextLength, originalText.length);
            for (const databaseEntry of databaseEntries) {
                const { id } = databaseEntry;
                if (ids.has(id)) {
                    const existingEntryInfo = this._findExistingEntry(dictionaryEntries, id);
                    if (!existingEntryInfo) {
                        continue;
                    }
                    const { existingEntry, existingIndex } = existingEntryInfo;

                    const existingTransformedLength = existingEntry.headwords[0].sources[0].transformedText.length;
                    if (transformedText.length < existingTransformedLength) {
                        continue;
                    }
                    if (transformedText.length > existingTransformedLength) {
                        dictionaryEntries.splice(
                            existingIndex,
                            1,
                            this._createTermDictionaryEntryFromDatabaseEntry(
                                databaseEntry,
                                originalText,
                                transformedText,
                                deinflectedText,
                                textProcessorRuleChainCandidates,
                                inflectionRuleChainCandidates,
                                true,
                                enabledDictionaryMap,
                                tagAggregator,
                                primaryReading,
                            ),
                        );
                    } else {
                        this._mergeInflectionRuleChains(existingEntry, inflectionRuleChainCandidates);
                        this._mergeTextProcessorRuleChains(existingEntry, textProcessorRuleChainCandidates);
                    }
                } else {
                    const dictionaryEntry = this._createTermDictionaryEntryFromDatabaseEntry(
                        databaseEntry,
                        originalText,
                        transformedText,
                        deinflectedText,
                        textProcessorRuleChainCandidates,
                        inflectionRuleChainCandidates,
                        true,
                        enabledDictionaryMap,
                        tagAggregator,
                        primaryReading,
                    );
                    dictionaryEntries.push(dictionaryEntry);
                    ids.add(id);
                }
            }
        }
        return { dictionaryEntries, originalTextLength };
    }

    private _findExistingEntry(
        dictionaryEntries: TermDictionaryEntry[],
        id: number,
    ): { existingEntry: TermDictionaryEntry; existingIndex: number } | null {
        for (const [index, entry] of dictionaryEntries.entries()) {
            if (entry.definitions.some((definition) => definition.id === id)) {
                return { existingEntry: entry, existingIndex: index };
            }
        }
        return null;
    }

    private _mergeTextProcessorRuleChains(
        existingEntry: TermDictionaryEntry,
        textProcessorRuleChainCandidates: TextProcessorRuleChainCandidate[],
    ): void {
        const existingChains = existingEntry.textProcessorRuleChainCandidates;

        for (const textProcessorRules of textProcessorRuleChainCandidates) {
            const duplicate = existingChains.find((existingChain) => {
                return this._areArraysEqualIgnoreOrder(existingChain, textProcessorRules);
            });
            if (!duplicate) {
                existingEntry.textProcessorRuleChainCandidates.push(textProcessorRules);
            }
        }
    }

    private _mergeInflectionRuleChains(
        existingEntry: TermDictionaryEntry,
        inflectionRuleChainCandidates: InflectionRuleChainCandidate[],
    ): void {
        const existingChains = existingEntry.inflectionRuleChainCandidates;

        for (const { source, inflectionRules } of inflectionRuleChainCandidates) {
            const duplicate = existingChains.find((existingChain) => {
                return this._areArraysEqualIgnoreOrder(
                    existingChain.inflectionRules.map((r) => r.name),
                    inflectionRules,
                );
            });
            if (!duplicate) {
                existingEntry.inflectionRuleChainCandidates.push({
                    source,
                    inflectionRules: inflectionRules.map((rule) => ({ name: rule })),
                });
            } else if (duplicate.source !== source) {
                duplicate.source = 'both';
            }
        }
    }

    private _areArraysEqualIgnoreOrder(array1: string[], array2: string[]): boolean {
        if (array1.length !== array2.length) {
            return false;
        }

        const frequencyCounter = new Map<string, number>();

        for (const element of array1) {
            frequencyCounter.set(element, (frequencyCounter.get(element) || 0) + 1);
        }

        for (const element of array2) {
            const frequency = frequencyCounter.get(element);
            if (!frequency) {
                return false;
            }
            frequencyCounter.set(element, frequency - 1);
        }

        return true;
    }

    // Deinflections

    private async _getDeinflections(
        text: string,
        options: Translation.FindTermsOptions,
    ): Promise<DatabaseDeinflection[]> {
        let deinflections = options.deinflect
            ? this._getAlgorithmDeinflections(text, options)
            : [this._createDeinflection(text, text, text, 0, [], [])];
        if (deinflections.length === 0) {
            return [];
        }

        const { matchType, language, enabledDictionaryMap } = options;

        await this._addEntriesToDeinflections(language, deinflections, enabledDictionaryMap, matchType);

        const dictionaryDeinflections = await this._getDictionaryDeinflections(
            language,
            deinflections,
            enabledDictionaryMap,
            matchType,
        );
        deinflections.push(...dictionaryDeinflections);

        for (const deinflection of deinflections) {
            for (const entry of deinflection.databaseEntries) {
                entry.definitions = entry.definitions.filter((definition) => !Array.isArray(definition));
            }
            deinflection.databaseEntries = deinflection.databaseEntries.filter((entry) => entry.definitions.length);
        }
        deinflections = deinflections.filter((deinflection) => deinflection.databaseEntries.length);

        return deinflections;
    }

    private async _getDictionaryDeinflections(
        language: string,
        deinflections: DatabaseDeinflection[],
        enabledDictionaryMap: Map<string, Translation.FindTermDictionary>,
        matchType: Dictionary.TermSourceMatchType,
    ): Promise<DatabaseDeinflection[]> {
        const dictionaryDeinflections: DatabaseDeinflection[] = [];
        for (const deinflection of deinflections) {
            const {
                originalText,
                transformedText,
                textProcessorRuleChainCandidates,
                inflectionRuleChainCandidates: algorithmChains,
                databaseEntries,
            } = deinflection;
            for (const entry of databaseEntries) {
                const { dictionary, definitions } = entry;
                const entryDictionary = enabledDictionaryMap.get(dictionary);
                const useDeinflections = entryDictionary?.useDeinflections ?? true;
                if (!useDeinflections) {
                    continue;
                }
                for (const definition of definitions) {
                    if (Array.isArray(definition)) {
                        const [formOf, inflectionRules] = definition as [string, string[]];
                        if (!formOf) {
                            continue;
                        }

                        const inflectionRuleChainCandidates = algorithmChains.map(
                            ({ inflectionRules: algInflections }) => {
                                return {
                                    source: (algInflections.length === 0
                                        ? 'dictionary'
                                        : 'both') as Dictionary.InflectionSource,
                                    inflectionRules: [...algInflections, ...inflectionRules],
                                };
                            },
                        );

                        const dictionaryDeinflection = this._createDeinflection(
                            originalText,
                            transformedText,
                            formOf,
                            0,
                            textProcessorRuleChainCandidates,
                            inflectionRuleChainCandidates,
                        );
                        dictionaryDeinflections.push(dictionaryDeinflection);
                    }
                }
            }
        }

        await this._addEntriesToDeinflections(language, dictionaryDeinflections, enabledDictionaryMap, matchType);

        return dictionaryDeinflections;
    }

    private async _addEntriesToDeinflections(
        language: string,
        deinflections: DatabaseDeinflection[],
        enabledDictionaryMap: Map<string, Translation.FindTermDictionary>,
        matchType: Dictionary.TermSourceMatchType,
    ): Promise<void> {
        const uniqueDeinflectionsMap = this._groupDeinflectionsByTerm(deinflections);
        const uniqueDeinflectionArrays = [...uniqueDeinflectionsMap.values()];
        const uniqueDeinflectionTerms = [...uniqueDeinflectionsMap.keys()];

        const databaseEntries = await this._database.findTermsBulk(
            uniqueDeinflectionTerms,
            enabledDictionaryMap,
            matchType,
        );
        this._matchEntriesToDeinflections(language, databaseEntries, uniqueDeinflectionArrays, enabledDictionaryMap);
    }

    private _groupDeinflectionsByTerm(deinflections: DatabaseDeinflection[]): Map<string, DatabaseDeinflection[]> {
        const result = new Map<string, DatabaseDeinflection[]>();
        for (const deinflection of deinflections) {
            const { deinflectedText } = deinflection;
            let deinflectionArray = result.get(deinflectedText);
            if (typeof deinflectionArray === 'undefined') {
                deinflectionArray = [];
                result.set(deinflectedText, deinflectionArray);
            }
            deinflectionArray.push(deinflection);
        }
        return result;
    }

    private _matchEntriesToDeinflections(
        language: string,
        databaseEntries: DictionaryDatabase.TermEntry[],
        uniqueDeinflectionArrays: DatabaseDeinflection[][],
        enabledDictionaryMap: Map<string, Translation.FindTermDictionary>,
    ): void {
        for (const databaseEntry of databaseEntries) {
            const entryDictionary = enabledDictionaryMap.get(databaseEntry.dictionary);
            if (typeof entryDictionary === 'undefined') {
                continue;
            }
            const { partsOfSpeechFilter } = entryDictionary;

            const definitionConditions = this._multiLanguageTransformer.getConditionFlagsFromPartsOfSpeech(
                language,
                databaseEntry.rules,
            );
            for (const deinflection of uniqueDeinflectionArrays[databaseEntry.index]) {
                if (
                    !partsOfSpeechFilter ||
                    LanguageTransformer.conditionsMatch(deinflection.conditions, definitionConditions)
                ) {
                    deinflection.databaseEntries.push(databaseEntry);
                }
            }
        }
    }

    // Deinflections and text processing

    private _getAlgorithmDeinflections(text: string, options: Translation.FindTermsOptions): DatabaseDeinflection[] {
        const { language } = options;
        const processorsForLanguage = this._textProcessors.get(language);
        if (typeof processorsForLanguage === 'undefined') {
            throw new Error(`Unsupported language: ${language}`);
        }
        const { textPreprocessors, textPostprocessors } = processorsForLanguage;

        const deinflections: DatabaseDeinflection[] = [];
        const sourceCache: TextCache = new Map();

        for (
            let rawSource = text;
            rawSource.length > 0;
            rawSource = this._getNextSubstring(options.searchResolution, rawSource)
        ) {
            const preprocessedTextVariants = this._getTextVariants(
                rawSource,
                textPreprocessors,
                this._getTextReplacementsVariants(options),
                sourceCache,
            );

            for (const [source, preprocessorRuleChainCandidates] of preprocessedTextVariants) {
                for (const deinflection of this._multiLanguageTransformer.transform(language, source)) {
                    const { trace, conditions } = deinflection;
                    const postprocessedTextVariants = this._getTextVariants(
                        deinflection.text,
                        textPostprocessors,
                        [null],
                        sourceCache,
                    );
                    for (const [transformedText, postprocessorRuleChainCandidates] of postprocessedTextVariants) {
                        const inflectionRuleChainCandidate: InflectionRuleChainCandidate = {
                            source: 'algorithm',
                            inflectionRules: trace.map((frame) => frame.transform),
                        };

                        // Every combination of preprocessor rule candidates and postprocessor rule candidates
                        const textProcessorRuleChainCandidates = preprocessorRuleChainCandidates.flatMap(
                            (preprocessorRuleChainCandidate) =>
                                postprocessorRuleChainCandidates.map((postprocessorRuleChainCandidate) => [
                                    ...preprocessorRuleChainCandidate,
                                    ...postprocessorRuleChainCandidate,
                                ]),
                        );
                        deinflections.push(
                            this._createDeinflection(
                                rawSource,
                                source,
                                transformedText,
                                conditions,
                                textProcessorRuleChainCandidates,
                                [inflectionRuleChainCandidate],
                            ),
                        );
                    }
                }
            }
        }
        return deinflections;
    }

    private _getTextVariants(
        text: string,
        textProcessors: Language.TextProcessorWithId<unknown>[],
        textReplacements: (Translation.FindTermsTextReplacement[] | null)[],
        textCache: TextCache,
    ): VariantAndTextProcessorRuleChainCandidatesMap {
        let variantsMap: VariantAndTextProcessorRuleChainCandidatesMap = new Map([[text, [[]]]]);

        for (const [id, textReplacement] of textReplacements.entries()) {
            if (textReplacement === null) {
                continue;
            }
            variantsMap.set(this._applyTextReplacements(text, textReplacement), [[`Text Replacement ${id}`]]);
        }
        for (const {
            id,
            textProcessor: { process, options },
        } of textProcessors) {
            const newVariantsMap: VariantAndTextProcessorRuleChainCandidatesMap = new Map();
            for (const [variant, currentPreprocessorRuleChainCandidates] of variantsMap) {
                for (const option of options) {
                    const processed = this._getProcessedText(textCache, variant, id, option, process);
                    const existingCandidates = newVariantsMap.get(processed);

                    // Ignore if applying the textProcessor doesn't change the source
                    if (processed === variant) {
                        if (typeof existingCandidates === 'undefined') {
                            newVariantsMap.set(processed, currentPreprocessorRuleChainCandidates);
                        } else {
                            newVariantsMap.set(processed, existingCandidates);
                        }
                    } else if (typeof existingCandidates === 'undefined') {
                        newVariantsMap.set(
                            processed,
                            currentPreprocessorRuleChainCandidates.map((candidate) => [...candidate, id]),
                        );
                    } else {
                        newVariantsMap.set(processed, [
                            ...existingCandidates,
                            ...currentPreprocessorRuleChainCandidates.map((candidate) => [...candidate, id]),
                        ]);
                    }
                }
            }
            variantsMap = newVariantsMap;
        }
        return variantsMap;
    }

    private _getProcessedText(
        textCache: TextCache,
        text: string,
        id: string,
        setting: unknown,
        process: Language.TextProcessorFunction,
    ): string {
        let level1 = textCache.get(text);
        if (!level1) {
            level1 = new Map();
            textCache.set(text, level1);
        }

        let level2 = level1.get(id);
        if (!level2) {
            level2 = new Map();
            level1.set(id, level2);
        }

        if (!level2.has(setting)) {
            text = process(text, setting);
            level2.set(setting, text);
        } else {
            text = level2.get(setting) || '';
        }
        return text;
    }

    private _getNextSubstring(searchResolution: string, currentString: string): string {
        const nextSubstringLength =
            searchResolution === 'word'
                ? currentString.search(/[^\p{Letter}][\p{Letter}\p{Number}]*$/u)
                : currentString.length - 1;
        return currentString.substring(0, nextSubstringLength);
    }

    private _applyTextReplacements(text: string, replacements: Translation.FindTermsTextReplacement[]): string {
        for (const { pattern, replacement } of replacements) {
            text = applyTextReplacement(text, pattern, replacement);
        }
        return text;
    }

    private _getJapaneseChineseKoreanOnlyText(text: string): string {
        let length = 0;
        for (const c of text) {
            const codePoint = c.codePointAt(0) as number;
            if (!isCodePointJapanese(codePoint) && !isCodePointChinese(codePoint) && !isCodePointKorean(codePoint)) {
                return text.substring(0, length);
            }
            length += c.length;
        }
        return text;
    }

    private _getTextReplacementsVariants(
        options: Translation.FindTermsOptions,
    ): (Translation.FindTermsTextReplacement[] | null)[] {
        return options.textReplacements;
    }

    private _createDeinflection(
        originalText: string,
        transformedText: string,
        deinflectedText: string,
        conditions: number,
        textProcessorRuleChainCandidates: TextProcessorRuleChainCandidate[],
        inflectionRuleChainCandidates: InflectionRuleChainCandidate[],
    ): DatabaseDeinflection {
        return {
            originalText,
            transformedText,
            deinflectedText,
            conditions,
            textProcessorRuleChainCandidates,
            inflectionRuleChainCandidates,
            databaseEntries: [],
        };
    }

    // Term dictionary entry grouping

    private async _getRelatedDictionaryEntries(
        dictionaryEntries: TermDictionaryEntry[],
        options: Translation.FindTermsOptions,
        tagAggregator: TranslatorTagAggregator,
    ): Promise<TermDictionaryEntry[]> {
        const { mainDictionary, enabledDictionaryMap, language, primaryReading } = options;
        const sequenceList: SequenceQuery[] = [];
        const groupedDictionaryEntries: DictionaryEntryGroup[] = [];
        const groupedDictionaryEntriesMap = new Map<number, DictionaryEntryGroup>();
        const ungroupedDictionaryEntriesMap = new Map<number, TermDictionaryEntry>();
        for (const dictionaryEntry of dictionaryEntries) {
            const {
                definitions: [
                    {
                        id,
                        dictionary,
                        sequences: [sequence],
                    },
                ],
            } = dictionaryEntry;
            if (mainDictionary === dictionary && sequence >= 0) {
                let group = groupedDictionaryEntriesMap.get(sequence);
                if (typeof group === 'undefined') {
                    group = {
                        ids: new Set(),
                        dictionaryEntries: [],
                    };
                    sequenceList.push({ query: sequence, dictionary });
                    groupedDictionaryEntries.push(group);
                    groupedDictionaryEntriesMap.set(sequence, group);
                }
                group.dictionaryEntries.push(dictionaryEntry);
                group.ids.add(id);
            } else {
                ungroupedDictionaryEntriesMap.set(id, dictionaryEntry);
            }
        }

        if (sequenceList.length > 0) {
            const secondarySearchDictionaryMap = this._getSecondarySearchDictionaryMap(enabledDictionaryMap);
            await this._addRelatedDictionaryEntries(
                groupedDictionaryEntries,
                ungroupedDictionaryEntriesMap,
                sequenceList,
                enabledDictionaryMap,
                tagAggregator,
                primaryReading,
            );
            for (const group of groupedDictionaryEntries) {
                this._sortTermDictionaryEntriesById(group.dictionaryEntries);
            }
            if (ungroupedDictionaryEntriesMap.size > 0 || secondarySearchDictionaryMap.size > 0) {
                await this._addSecondaryRelatedDictionaryEntries(
                    language,
                    groupedDictionaryEntries,
                    ungroupedDictionaryEntriesMap,
                    enabledDictionaryMap,
                    secondarySearchDictionaryMap,
                    tagAggregator,
                    primaryReading,
                );
            }
        }

        const newDictionaryEntries: TermDictionaryEntry[] = [];
        for (const group of groupedDictionaryEntries) {
            newDictionaryEntries.push(
                this._createGroupedDictionaryEntry(
                    language,
                    group.dictionaryEntries,
                    true,
                    tagAggregator,
                    primaryReading,
                ),
            );
        }
        newDictionaryEntries.push(
            ...this._groupDictionaryEntriesByHeadword(
                language,
                ungroupedDictionaryEntriesMap.values(),
                tagAggregator,
                primaryReading,
            ),
        );
        return newDictionaryEntries;
    }

    private async _addRelatedDictionaryEntries(
        groupedDictionaryEntries: DictionaryEntryGroup[],
        ungroupedDictionaryEntriesMap: Map<number, TermDictionaryEntry>,
        sequenceList: SequenceQuery[],
        enabledDictionaryMap: Translation.TermEnabledDictionaryMap,
        tagAggregator: TranslatorTagAggregator,
        primaryReading: string,
    ): Promise<void> {
        const databaseEntries = await this._database.findTermsBySequenceBulk(sequenceList);
        for (const databaseEntry of databaseEntries) {
            const { dictionaryEntries: groupEntries, ids } = groupedDictionaryEntries[databaseEntry.index];
            const { id } = databaseEntry;
            if (ids.has(id)) {
                continue;
            }

            const { term } = databaseEntry;
            const dictionaryEntry = this._createTermDictionaryEntryFromDatabaseEntry(
                databaseEntry,
                term,
                term,
                term,
                [],
                [],
                false,
                enabledDictionaryMap,
                tagAggregator,
                primaryReading,
            );
            groupEntries.push(dictionaryEntry);
            ids.add(id);
            ungroupedDictionaryEntriesMap.delete(id);
        }
    }

    private async _addSecondaryRelatedDictionaryEntries(
        language: string,
        groupedDictionaryEntries: DictionaryEntryGroup[],
        ungroupedDictionaryEntriesMap: Map<number, TermDictionaryEntry>,
        enabledDictionaryMap: Translation.TermEnabledDictionaryMap,
        secondarySearchDictionaryMap: Translation.TermEnabledDictionaryMap,
        tagAggregator: TranslatorTagAggregator,
        primaryReading: string,
    ): Promise<void> {
        // Prepare grouping info
        const termList: DictionaryDatabase.TermExactRequest[] = [];
        const targetList: { groups: DictionaryEntryGroup[] }[] = [];
        const targetMap = new Map<string, { groups: DictionaryEntryGroup[] }>();

        const readingNormalizer = this._readingNormalizers.get(language);

        for (const group of groupedDictionaryEntries) {
            const { dictionaryEntries: groupEntries } = group;
            for (const dictionaryEntry of groupEntries) {
                const { term, reading } = dictionaryEntry.headwords[0];
                const normalizedReading =
                    typeof readingNormalizer === 'undefined' ? reading : readingNormalizer(reading);
                const key = this._createMapKey([term, normalizedReading]);
                let target = targetMap.get(key);
                if (typeof target === 'undefined') {
                    target = {
                        groups: [],
                    };
                    targetMap.set(key, target);
                    termList.push({ term, reading });
                    targetList.push(target);
                }
                target.groups.push(group);
            }
        }

        // Group unsequenced dictionary entries with sequenced entries that have a matching [term, reading].
        for (const [id, dictionaryEntry] of ungroupedDictionaryEntriesMap.entries()) {
            const { term, reading } = dictionaryEntry.headwords[0];
            const normalizedReading = typeof readingNormalizer === 'undefined' ? reading : readingNormalizer(reading);
            const key = this._createMapKey([term, normalizedReading]);
            const target = targetMap.get(key);
            if (typeof target === 'undefined') {
                continue;
            }

            for (const { ids, dictionaryEntries: groupEntries } of target.groups) {
                if (ids.has(id)) {
                    continue;
                }
                groupEntries.push(dictionaryEntry);
                ids.add(id);
            }
            ungroupedDictionaryEntriesMap.delete(id);
        }

        // Search database for additional secondary terms
        if (termList.length === 0 || secondarySearchDictionaryMap.size === 0) {
            return;
        }

        const databaseEntries = await this._database.findTermsExactBulk(termList, secondarySearchDictionaryMap);
        this._sortDatabaseEntriesByIndex(databaseEntries);

        for (const databaseEntry of databaseEntries) {
            const { index, id } = databaseEntry;
            const sourceText = termList[index].term;
            const target = targetList[index];
            for (const { ids, dictionaryEntries: groupEntries } of target.groups) {
                if (ids.has(id)) {
                    continue;
                }

                const dictionaryEntry = this._createTermDictionaryEntryFromDatabaseEntry(
                    databaseEntry,
                    sourceText,
                    sourceText,
                    sourceText,
                    [],
                    [],
                    false,
                    enabledDictionaryMap,
                    tagAggregator,
                    primaryReading,
                );
                groupEntries.push(dictionaryEntry);
                ids.add(id);
                ungroupedDictionaryEntriesMap.delete(id);
            }
        }
    }

    private _groupDictionaryEntriesByHeadword(
        language: string,
        dictionaryEntries: Iterable<TermDictionaryEntry>,
        tagAggregator: TranslatorTagAggregator,
        primaryReading: string,
    ): TermDictionaryEntry[] {
        const readingNormalizer = this._readingNormalizers.get(language);
        const createGroupingKey = (dictionaryEntry: TermDictionaryEntry): string => {
            const {
                inflectionRuleChainCandidates,
                headwords: [{ term, reading }],
            } = dictionaryEntry;
            const normalizedReading = typeof readingNormalizer === 'undefined' ? reading : readingNormalizer(reading);
            return this._createMapKey([term, normalizedReading, ...inflectionRuleChainCandidates]);
        };
        return this._groupDictionaryEntries(
            language,
            dictionaryEntries,
            tagAggregator,
            primaryReading,
            createGroupingKey,
        );
    }

    private _groupDictionaryEntriesByTerm(
        language: string,
        dictionaryEntries: Iterable<TermDictionaryEntry>,
        tagAggregator: TranslatorTagAggregator,
        primaryReading: string,
    ): TermDictionaryEntry[] {
        const createGroupingKey = (dictionaryEntry: TermDictionaryEntry): string => {
            const {
                inflectionRuleChainCandidates,
                headwords: [{ term }],
            } = dictionaryEntry;
            return this._createMapKey([term, ...inflectionRuleChainCandidates]);
        };
        return this._groupDictionaryEntries(
            language,
            dictionaryEntries,
            tagAggregator,
            primaryReading,
            createGroupingKey,
        );
    }

    private _groupDictionaryEntries(
        language: string,
        dictionaryEntries: Iterable<TermDictionaryEntry>,
        tagAggregator: TranslatorTagAggregator,
        primaryReading: string,
        createGroupingKey: (entry: TermDictionaryEntry) => string,
    ): TermDictionaryEntry[] {
        const groups = new Map<string, TermDictionaryEntry[]>();
        for (const dictionaryEntry of dictionaryEntries) {
            const key = createGroupingKey(dictionaryEntry);
            let groupDictionaryEntries = groups.get(key);
            if (typeof groupDictionaryEntries === 'undefined') {
                groupDictionaryEntries = [];
                groups.set(key, groupDictionaryEntries);
            }
            groupDictionaryEntries.push(dictionaryEntry);
        }

        const newDictionaryEntries: TermDictionaryEntry[] = [];
        for (const groupDictionaryEntries of groups.values()) {
            newDictionaryEntries.push(
                this._createGroupedDictionaryEntry(
                    language,
                    groupDictionaryEntries,
                    false,
                    tagAggregator,
                    primaryReading,
                ),
            );
        }
        return newDictionaryEntries;
    }

    // Removing data

    private _removeExcludedDefinitions(
        dictionaryEntries: TermDictionaryEntry[],
        excludeDictionaryDefinitions: Set<string>,
    ): void {
        for (let i = dictionaryEntries.length - 1; i >= 0; --i) {
            const dictionaryEntry = dictionaryEntries[i];
            const { definitions, pronunciations, frequencies, headwords } = dictionaryEntry;
            const definitionsChanged = this._removeArrayItemsWithDictionary(definitions, excludeDictionaryDefinitions);
            this._removeArrayItemsWithDictionary(pronunciations, excludeDictionaryDefinitions);
            this._removeArrayItemsWithDictionary(frequencies, excludeDictionaryDefinitions);
            this._removeTagGroupsWithDictionary(definitions, excludeDictionaryDefinitions);
            this._removeTagGroupsWithDictionary(headwords, excludeDictionaryDefinitions);

            if (!definitionsChanged) {
                continue;
            }

            if (definitions.length === 0) {
                dictionaryEntries.splice(i, 1);
            } else {
                this._removeUnusedHeadwords(dictionaryEntry);
            }
        }
    }

    private _removeUnusedHeadwords(dictionaryEntry: TermDictionaryEntry): void {
        const { definitions, pronunciations, frequencies, headwords } = dictionaryEntry;
        const removeHeadwordIndices = new Set<number>();
        for (let i = 0, ii = headwords.length; i < ii; ++i) {
            removeHeadwordIndices.add(i);
        }
        for (const { headwordIndices } of definitions) {
            for (const headwordIndex of headwordIndices) {
                removeHeadwordIndices.delete(headwordIndex);
            }
        }

        if (removeHeadwordIndices.size === 0) {
            return;
        }

        const indexRemap = new Map<number, number>();
        let oldIndex = 0;
        for (let i = 0, ii = headwords.length; i < ii; ++i) {
            if (removeHeadwordIndices.has(oldIndex)) {
                headwords.splice(i, 1);
                --i;
                --ii;
            } else {
                indexRemap.set(oldIndex, indexRemap.size);
            }
            ++oldIndex;
        }

        this._updateDefinitionHeadwordIndices(definitions, indexRemap);
        this._updateArrayItemsHeadwordIndex(pronunciations, indexRemap);
        this._updateArrayItemsHeadwordIndex(frequencies, indexRemap);
    }

    private _updateDefinitionHeadwordIndices(
        definitions: Dictionary.TermDefinition[],
        indexRemap: Map<number, number>,
    ): void {
        for (const { headwordIndices } of definitions) {
            for (let i = headwordIndices.length - 1; i >= 0; --i) {
                const newHeadwordIndex = indexRemap.get(headwordIndices[i]);
                if (typeof newHeadwordIndex === 'undefined') {
                    headwordIndices.splice(i, 1);
                } else {
                    headwordIndices[i] = newHeadwordIndex;
                }
            }
        }
    }

    private _updateArrayItemsHeadwordIndex(
        array: (Dictionary.TermPronunciation | Dictionary.TermFrequency)[],
        indexRemap: Map<number, number>,
    ): void {
        for (let i = array.length - 1; i >= 0; --i) {
            const item = array[i];
            const { headwordIndex } = item;
            const newHeadwordIndex = indexRemap.get(headwordIndex);
            if (typeof newHeadwordIndex === 'undefined') {
                array.splice(i, 1);
            } else {
                item.headwordIndex = newHeadwordIndex;
            }
        }
    }

    private _removeArrayItemsWithDictionary(
        array: { dictionary: string }[],
        excludeDictionaryDefinitions: Set<string>,
    ): boolean {
        let changed = false;
        for (let j = array.length - 1; j >= 0; --j) {
            const { dictionary } = array[j];
            if (!excludeDictionaryDefinitions.has(dictionary)) {
                continue;
            }
            array.splice(j, 1);
            changed = true;
        }
        return changed;
    }

    private _removeArrayItemsWithDictionary2(
        array: Dictionary.Tag[],
        excludeDictionaryDefinitions: Set<string>,
    ): boolean {
        let changed = false;
        for (let j = array.length - 1; j >= 0; --j) {
            const { dictionaries } = array[j];
            if (this._hasAny(excludeDictionaryDefinitions, dictionaries)) {
                continue;
            }
            array.splice(j, 1);
            changed = true;
        }
        return changed;
    }

    private _removeTagGroupsWithDictionary(
        array: { tags: Dictionary.Tag[] }[],
        excludeDictionaryDefinitions: Set<string>,
    ): void {
        for (const { tags } of array) {
            this._removeArrayItemsWithDictionary2(tags, excludeDictionaryDefinitions);
        }
    }

    // Tags

    private async _expandTagGroupsAndGroup(tagExpansionTargets: TagExpansionTarget[]): Promise<void> {
        await this._expandTagGroups(tagExpansionTargets);
        this._groupTags(tagExpansionTargets);
    }

    private async _expandTagGroups(tagTargets: TagExpansionTarget[]): Promise<void> {
        const allItems: TagTargetItem[] = [];
        const targetMap = new Map<string, Map<string, TagTargetItem>>();
        for (const { tagGroups, tags } of tagTargets) {
            for (const { dictionary, tagNames } of tagGroups) {
                let dictionaryItems = targetMap.get(dictionary);
                if (typeof dictionaryItems === 'undefined') {
                    dictionaryItems = new Map();
                    targetMap.set(dictionary, dictionaryItems);
                }
                for (const tagName of tagNames) {
                    let item = dictionaryItems.get(tagName);
                    if (typeof item === 'undefined') {
                        const query = this._getNameBase(tagName);
                        item = { query, dictionary, tagName, cache: null, databaseTag: null, targets: [] };
                        dictionaryItems.set(tagName, item);
                        allItems.push(item);
                    }
                    item.targets.push(tags);
                }
            }
        }

        const nonCachedItems: TagTargetItem[] = [];
        const tagCache = this._tagCache;
        for (const [dictionary, dictionaryItems] of targetMap.entries()) {
            let cache = tagCache.get(dictionary);
            if (typeof cache === 'undefined') {
                cache = new Map();
                tagCache.set(dictionary, cache);
            }
            for (const item of dictionaryItems.values()) {
                const databaseTag = cache.get(item.query);
                if (typeof databaseTag !== 'undefined') {
                    item.databaseTag = databaseTag;
                } else {
                    item.cache = cache;
                    nonCachedItems.push(item);
                }
            }
        }

        const nonCachedItemCount = nonCachedItems.length;
        if (nonCachedItemCount > 0) {
            const databaseTags = await this._database.findTagMetaBulk(nonCachedItems);
            for (let i = 0; i < nonCachedItemCount; ++i) {
                const item = nonCachedItems[i];
                const databaseTag = databaseTags[i];
                const databaseTag2 = typeof databaseTag !== 'undefined' ? databaseTag : null;
                item.databaseTag = databaseTag2;
                if (item.cache !== null) {
                    item.cache.set(item.query, databaseTag2);
                }
            }
        }

        for (const { dictionary, tagName, databaseTag, targets } of allItems) {
            for (const tags of targets) {
                tags.push(this._createTag(databaseTag, tagName, dictionary));
            }
        }
    }

    private _groupTags(tagTargets: TagExpansionTarget[]): void {
        const stringComparer = this._stringComparer;
        const compare = (v1: Dictionary.Tag, v2: Dictionary.Tag): number => {
            const i = v1.order - v2.order;
            return i !== 0 ? i : stringComparer.compare(v1.name, v2.name);
        };

        for (const { tags } of tagTargets) {
            if (tags.length <= 1) {
                continue;
            }
            this._mergeSimilarTags(tags);
            tags.sort(compare);
        }
    }

    private _mergeSimilarTags(tags: Dictionary.Tag[]): void {
        let tagCount = tags.length;
        for (let i = 0; i < tagCount; ++i) {
            const tag1 = tags[i];
            const { category, name } = tag1;
            for (let j = i + 1; j < tagCount; ++j) {
                const tag2 = tags[j];
                if (tag2.name !== name || tag2.category !== category) {
                    continue;
                }
                // Merge tag
                tag1.order = Math.min(tag1.order, tag2.order);
                tag1.score = Math.max(tag1.score, tag2.score);
                tag1.dictionaries.push(...tag2.dictionaries);
                this._addUniqueSimple(tag1.content, tag2.content);
                tags.splice(j, 1);
                --tagCount;
                --j;
            }
        }
    }

    private _getTagNamesWithCategory(tags: Dictionary.Tag[], category: string): string[] {
        const results: string[] = [];
        for (const tag of tags) {
            if (tag.category !== category) {
                continue;
            }
            results.push(tag.name);
        }
        results.sort();
        return results;
    }

    private _flagRedundantDefinitionTags(definitions: Dictionary.TermDefinition[]): void {
        if (definitions.length === 0) {
            return;
        }

        let lastDictionary: string | null = null;
        let lastPartOfSpeech = '';
        const removeCategoriesSet = new Set<string>();

        for (const { dictionary, tags } of definitions) {
            const partOfSpeech = this._createMapKey(this._getTagNamesWithCategory(tags, 'partOfSpeech'));

            if (lastDictionary !== dictionary) {
                lastDictionary = dictionary;
                lastPartOfSpeech = '';
            }

            if (lastPartOfSpeech === partOfSpeech) {
                removeCategoriesSet.add('partOfSpeech');
            } else {
                lastPartOfSpeech = partOfSpeech;
            }

            if (removeCategoriesSet.size > 0) {
                for (const tag of tags) {
                    if (removeCategoriesSet.has(tag.category)) {
                        tag.redundant = true;
                    }
                }
                removeCategoriesSet.clear();
            }
        }
    }

    // Metadata

    private async _addTermMeta(
        dictionaryEntries: TermDictionaryEntry[],
        enabledDictionaryMap: Translation.TermEnabledDictionaryMap,
        tagAggregator: TranslatorTagAggregator,
    ): Promise<void> {
        const headwordMap = new Map<
            string,
            Map<
                string,
                {
                    headwordIndex: number;
                    pronunciations: Dictionary.TermPronunciation[];
                    frequencies: Dictionary.TermFrequency[];
                }[]
            >
        >();
        const headwordMapKeys: string[] = [];
        const headwordReadingMaps: Map<
            string,
            {
                headwordIndex: number;
                pronunciations: Dictionary.TermPronunciation[];
                frequencies: Dictionary.TermFrequency[];
            }[]
        >[] = [];

        for (const { headwords, pronunciations, frequencies } of dictionaryEntries) {
            for (let i = 0, ii = headwords.length; i < ii; ++i) {
                const { term, reading } = headwords[i];
                let readingMap = headwordMap.get(term);
                if (typeof readingMap === 'undefined') {
                    readingMap = new Map();
                    headwordMap.set(term, readingMap);
                    headwordMapKeys.push(term);
                    headwordReadingMaps.push(readingMap);
                }
                let targets = readingMap.get(reading);
                if (typeof targets === 'undefined') {
                    targets = [];
                    readingMap.set(reading, targets);
                }
                targets.push({ headwordIndex: i, pronunciations, frequencies });
            }
        }

        const metas = await this._database.findTermMetaBulk(headwordMapKeys, enabledDictionaryMap);
        for (const { mode, data, dictionary, index } of metas) {
            const { index: dictionaryIndex } = this._getDictionaryOrder(dictionary, enabledDictionaryMap);
            const dictionaryAlias = this._getDictionaryAlias(dictionary, enabledDictionaryMap);
            const map2 = headwordReadingMaps[index];
            for (const [reading, targets] of map2.entries()) {
                switch (mode) {
                    case 'freq':
                        {
                            const hasReading =
                                data !== null &&
                                typeof data === 'object' &&
                                typeof (data as DictionaryData.TermMetaFrequencyDataWithReading).reading === 'string';
                            if (
                                hasReading &&
                                (data as DictionaryData.TermMetaFrequencyDataWithReading).reading !== reading
                            ) {
                                continue;
                            }
                            const frequency = hasReading
                                ? (data as DictionaryData.TermMetaFrequencyDataWithReading).frequency
                                : (data as DictionaryData.GenericFrequencyData);
                            for (const { frequencies, headwordIndex } of targets) {
                                const {
                                    frequency: frequencyValue,
                                    displayValue,
                                    displayValueParsed,
                                } = this._getFrequencyInfo(frequency);
                                frequencies.push(
                                    this._createTermFrequency(
                                        frequencies.length,
                                        headwordIndex,
                                        dictionary,
                                        dictionaryIndex,
                                        dictionaryAlias,
                                        hasReading,
                                        frequencyValue,
                                        displayValue,
                                        displayValueParsed,
                                    ),
                                );
                            }
                        }
                        break;
                    case 'pitch':
                        {
                            if ((data as DictionaryData.TermMetaPitchData).reading !== reading) {
                                continue;
                            }
                            const pitches: Dictionary.PitchAccent[] = [];
                            for (const { position, tags, nasal, devoice } of (data as DictionaryData.TermMetaPitchData)
                                .pitches) {
                                const tags2: Dictionary.Tag[] = [];
                                if (Array.isArray(tags)) {
                                    tagAggregator.addTags(tags2, dictionary, tags);
                                }
                                const nasalPositions = this._toNumberArray(nasal);
                                const devoicePositions = this._toNumberArray(devoice);
                                pitches.push({
                                    type: 'pitch-accent',
                                    positions: position,
                                    nasalPositions,
                                    devoicePositions,
                                    tags: tags2,
                                });
                            }
                            for (const { pronunciations, headwordIndex } of targets) {
                                pronunciations.push(
                                    this._createTermPronunciation(
                                        pronunciations.length,
                                        headwordIndex,
                                        dictionary,
                                        dictionaryIndex,
                                        dictionaryAlias,
                                        pitches,
                                    ),
                                );
                            }
                        }
                        break;
                    case 'ipa': {
                        if ((data as DictionaryData.TermMetaPhoneticData).reading !== reading) {
                            continue;
                        }
                        const phoneticTranscriptions: Dictionary.PhoneticTranscription[] = [];
                        for (const { ipa, tags } of (data as DictionaryData.TermMetaPhoneticData).transcriptions) {
                            const tags2: Dictionary.Tag[] = [];
                            if (Array.isArray(tags)) {
                                tagAggregator.addTags(tags2, dictionary, tags);
                            }
                            phoneticTranscriptions.push({
                                type: 'phonetic-transcription',
                                ipa,
                                tags: tags2,
                            });
                        }
                        for (const { pronunciations, headwordIndex } of targets) {
                            pronunciations.push(
                                this._createTermPronunciation(
                                    pronunciations.length,
                                    headwordIndex,
                                    dictionary,
                                    dictionaryIndex,
                                    dictionaryAlias,
                                    phoneticTranscriptions,
                                ),
                            );
                        }
                    }
                }
            }
        }
    }

    private async _addKanjiMeta(
        dictionaryEntries: Dictionary.KanjiDictionaryEntry[],
        enabledDictionaryMap: Translation.KanjiEnabledDictionaryMap,
    ): Promise<void> {
        const kanjiList: string[] = [];
        for (const { character } of dictionaryEntries) {
            kanjiList.push(character);
        }

        const metas = await this._database.findKanjiMetaBulk(kanjiList, enabledDictionaryMap);
        for (const { character, mode, data, dictionary, index } of metas) {
            const { index: dictionaryIndex } = this._getDictionaryOrder(dictionary, enabledDictionaryMap);
            const dictionaryAlias = this._getDictionaryAlias(dictionary, enabledDictionaryMap);
            switch (mode) {
                case 'freq':
                    {
                        const { frequencies } = dictionaryEntries[index];
                        const { frequency, displayValue, displayValueParsed } = this._getFrequencyInfo(data);
                        frequencies.push(
                            this._createKanjiFrequency(
                                frequencies.length,
                                dictionary,
                                dictionaryIndex,
                                dictionaryAlias,
                                character,
                                frequency,
                                displayValue,
                                displayValueParsed,
                            ),
                        );
                    }
                    break;
            }
        }
    }

    private async _expandKanjiStats(
        stats: { [key: string]: string | number },
        dictionary: string,
    ): Promise<Dictionary.KanjiStatGroups> {
        const statsEntries = Object.entries(stats);
        const items: { query: string; dictionary: string }[] = [];
        for (const [name] of statsEntries) {
            const query = this._getNameBase(name);
            items.push({ query, dictionary });
        }

        const databaseInfos = await this._database.findTagMetaBulk(items);

        const statsGroups = new Map<string, Dictionary.KanjiStat[]>();
        for (let i = 0, ii = statsEntries.length; i < ii; ++i) {
            const databaseInfo = databaseInfos[i];
            if (typeof databaseInfo === 'undefined') {
                continue;
            }

            const [name, value] = statsEntries[i];
            const { category } = databaseInfo;
            let group = statsGroups.get(category);
            if (typeof group === 'undefined') {
                group = [];
                statsGroups.set(category, group);
            }

            group.push(this._createKanjiStat(name, value, databaseInfo, dictionary));
        }

        const groupedStats: Dictionary.KanjiStatGroups = {};
        for (const [category, group] of statsGroups.entries()) {
            this._sortKanjiStats(group);
            groupedStats[category] = group;
        }
        return groupedStats;
    }

    private _sortKanjiStats(stats: Dictionary.KanjiStat[]): void {
        if (stats.length <= 1) {
            return;
        }
        const stringComparer = this._stringComparer;
        stats.sort((v1, v2) => {
            const i = v1.order - v2.order;
            return i !== 0 ? i : stringComparer.compare(v1.content, v2.content);
        });
    }

    private _convertStringToNumber(value: string): number {
        const match = this._numberRegex.exec(value);
        if (match === null) {
            return 0;
        }
        const result = Number.parseFloat(match[0]);
        return Number.isFinite(result) ? result : 0;
    }

    private _getFrequencyInfo(frequency: DictionaryData.GenericFrequencyData): {
        frequency: number;
        displayValue: string | null;
        displayValueParsed: boolean;
    } {
        let frequencyValue = 0;
        let displayValue: string | null = null;
        let displayValueParsed = false;
        if (typeof frequency === 'object' && frequency !== null) {
            const { value: frequencyValue2, displayValue: displayValue2 } = frequency;
            if (typeof frequencyValue2 === 'number') {
                frequencyValue = frequencyValue2;
            }
            if (typeof displayValue2 === 'string') {
                displayValue = displayValue2;
            }
        } else {
            switch (typeof frequency) {
                case 'number':
                    frequencyValue = frequency;
                    break;
                case 'string':
                    displayValue = frequency;
                    displayValueParsed = true;
                    frequencyValue = this._convertStringToNumber(frequency);
                    break;
            }
        }
        return { frequency: frequencyValue, displayValue, displayValueParsed };
    }

    // Helpers

    private _getNameBase(name: string): string {
        const pos = name.indexOf(':');
        return pos >= 0 ? name.substring(0, pos) : name;
    }

    private _getSecondarySearchDictionaryMap(
        enabledDictionaryMap: Translation.TermEnabledDictionaryMap,
    ): Translation.TermEnabledDictionaryMap {
        const secondarySearchDictionaryMap: Translation.TermEnabledDictionaryMap = new Map();
        for (const [dictionary, details] of enabledDictionaryMap.entries()) {
            if (!details.allowSecondarySearches) {
                continue;
            }
            secondarySearchDictionaryMap.set(dictionary, details);
        }
        return secondarySearchDictionaryMap;
    }

    private _getDictionaryOrder(
        dictionary: string,
        enabledDictionaryMap: Translation.TermEnabledDictionaryMap | Translation.KanjiEnabledDictionaryMap,
    ): { index: number } {
        const info = enabledDictionaryMap.get(dictionary);
        const { index } = typeof info !== 'undefined' ? info : { index: enabledDictionaryMap.size };
        return { index };
    }

    private _getDictionaryAlias(
        dictionary: string,
        enabledDictionaryMap: Translation.TermEnabledDictionaryMap | Translation.KanjiEnabledDictionaryMap,
    ): string {
        const info = enabledDictionaryMap.get(dictionary);
        return (info as { alias?: string })?.alias || dictionary;
    }

    private _createMapKey(array: unknown[]): string {
        return JSON.stringify(array);
    }

    private _toNumberArray(value: number | number[] | undefined): number[] {
        return Array.isArray(value) ? value : typeof value === 'number' ? [value] : [];
    }

    // Kanji data

    private _createKanjiStat(
        name: string,
        value: string | number,
        databaseInfo: DictionaryDatabase.Tag,
        dictionary: string,
    ): Dictionary.KanjiStat {
        const { category, notes, order, score } = databaseInfo;
        return {
            name,
            category: typeof category === 'string' && category.length > 0 ? category : 'default',
            content: typeof notes === 'string' ? notes : '',
            order: typeof order === 'number' ? order : 0,
            score: typeof score === 'number' ? score : 0,
            dictionary,
            value,
        };
    }

    private _createKanjiFrequency(
        index: number,
        dictionary: string,
        dictionaryIndex: number,
        dictionaryAlias: string,
        character: string,
        frequency: number,
        displayValue: string | null,
        displayValueParsed: boolean,
    ): Dictionary.KanjiFrequency {
        return {
            index,
            dictionary,
            dictionaryIndex,
            dictionaryAlias,
            character,
            frequency,
            displayValue,
            displayValueParsed,
        };
    }

    private _createKanjiDictionaryEntry(
        character: string,
        dictionary: string,
        dictionaryAlias: string,
        onyomi: string[],
        kunyomi: string[],
        stats: Dictionary.KanjiStatGroups,
        definitions: string[],
        enabledDictionaryMap: Translation.KanjiEnabledDictionaryMap,
    ): Dictionary.KanjiDictionaryEntry {
        const { index: dictionaryIndex } = this._getDictionaryOrder(dictionary, enabledDictionaryMap);
        return {
            type: 'kanji',
            character,
            dictionary,
            dictionaryIndex,
            dictionaryAlias,
            onyomi,
            kunyomi,
            tags: [],
            stats,
            definitions,
            frequencies: [],
        };
    }

    // Term data

    private _createTag(databaseTag: DictionaryDatabase.Tag | null, name: string, dictionary: string): Dictionary.Tag {
        let category: string | undefined;
        let notes: string | undefined;
        let order: number | undefined;
        let score: number | undefined;
        if (typeof databaseTag === 'object' && databaseTag !== null) {
            ({ category, notes, order, score } = databaseTag);
        }
        return {
            name,
            category: typeof category === 'string' && category.length > 0 ? category : 'default',
            order: typeof order === 'number' ? order : 0,
            score: typeof score === 'number' ? score : 0,
            content: typeof notes === 'string' && notes.length > 0 ? [notes] : [],
            dictionaries: [dictionary],
            redundant: false,
        };
    }

    private _createSource(
        originalText: string,
        transformedText: string,
        deinflectedText: string,
        matchType: Dictionary.TermSourceMatchType,
        matchSource: Dictionary.TermSourceMatchSource,
        isPrimary: boolean,
    ): Dictionary.TermSource {
        return { originalText, transformedText, deinflectedText, matchType, matchSource, isPrimary };
    }

    private _createTermHeadword(
        index: number,
        term: string,
        reading: string,
        sources: Dictionary.TermSource[],
        tags: Dictionary.Tag[],
        wordClasses: string[],
    ): Dictionary.TermHeadword {
        return { index, term, reading, sources, tags, wordClasses };
    }

    private _createTermDefinition(
        index: number,
        headwordIndices: number[],
        dictionary: string,
        dictionaryIndex: number,
        dictionaryAlias: string,
        id: number,
        score: number,
        sequences: number[],
        isPrimary: boolean,
        tags: Dictionary.Tag[],
        entries: DictionaryData.TermGlossaryContent[],
    ): Dictionary.TermDefinition {
        return {
            index,
            headwordIndices,
            dictionary,
            dictionaryIndex,
            dictionaryAlias,
            id,
            score,
            frequencyOrder: 0,
            sequences,
            isPrimary,
            tags,
            entries,
        };
    }

    private _createTermPronunciation(
        index: number,
        headwordIndex: number,
        dictionary: string,
        dictionaryIndex: number,
        dictionaryAlias: string,
        pronunciations: Dictionary.Pronunciation[],
    ): Dictionary.TermPronunciation {
        return { index, headwordIndex, dictionary, dictionaryIndex, dictionaryAlias, pronunciations };
    }

    private _createTermFrequency(
        index: number,
        headwordIndex: number,
        dictionary: string,
        dictionaryIndex: number,
        dictionaryAlias: string,
        hasReading: boolean,
        frequency: number,
        displayValue: string | null,
        displayValueParsed: boolean,
    ): Dictionary.TermFrequency {
        return {
            index,
            headwordIndex,
            dictionary,
            dictionaryIndex,
            dictionaryAlias,
            hasReading,
            frequency,
            displayValue,
            displayValueParsed,
        };
    }

    private _createTermDictionaryEntry(
        isPrimary: boolean,
        textProcessorRuleChainCandidates: TextProcessorRuleChainCandidate[],
        inflectionRuleChainCandidates: Dictionary.InflectionRuleChainCandidate[],
        score: number,
        dictionaryIndex: number,
        dictionaryAlias: string,
        sourceTermExactMatchCount: number,
        matchPrimaryReading: boolean,
        maxOriginalTextLength: number,
        headwords: Dictionary.TermHeadword[],
        definitions: Dictionary.TermDefinition[],
    ): TermDictionaryEntry {
        return {
            type: 'term',
            isPrimary,
            textProcessorRuleChainCandidates,
            inflectionRuleChainCandidates,
            score,
            frequencyOrder: 0,
            dictionaryIndex,
            dictionaryAlias,
            sourceTermExactMatchCount,
            matchPrimaryReading,
            maxOriginalTextLength,
            headwords,
            definitions,
            pronunciations: [],
            frequencies: [],
        };
    }

    private _createTermDictionaryEntryFromDatabaseEntry(
        databaseEntry: DictionaryDatabase.TermEntry,
        originalText: string,
        transformedText: string,
        deinflectedText: string,
        textProcessorRuleChainCandidates: TextProcessorRuleChainCandidate[],
        inflectionRuleChainCandidates: InflectionRuleChainCandidate[],
        isPrimary: boolean,
        enabledDictionaryMap: Map<string, Translation.FindTermDictionary>,
        tagAggregator: TranslatorTagAggregator,
        primaryReading: string,
    ): TermDictionaryEntry {
        const {
            matchType,
            matchSource,
            term,
            reading: rawReading,
            definitionTags,
            termTags,
            definitions,
            score,
            dictionary,
            id,
            sequence: rawSequence,
            rules,
        } = databaseEntry;
        // Cast is safe because getDeinflections filters out deinflection definitions
        const contentDefinitions = definitions as DictionaryData.TermGlossaryContent[];
        const reading = rawReading.length > 0 ? rawReading : term;
        const matchPrimaryReading = primaryReading.length > 0 && reading === primaryReading;
        const { index: dictionaryIndex } = this._getDictionaryOrder(dictionary, enabledDictionaryMap);
        const dictionaryAlias = this._getDictionaryAlias(dictionary, enabledDictionaryMap);
        const sourceTermExactMatchCount = isPrimary && deinflectedText === term ? 1 : 0;
        const source = this._createSource(
            originalText,
            transformedText,
            deinflectedText,
            matchType,
            matchSource,
            isPrimary,
        );
        const maxOriginalTextLength = originalText.length;
        const hasSequence = rawSequence >= 0;
        const sequence = hasSequence ? rawSequence : -1;

        const headwordTagGroups: Dictionary.Tag[] = [];
        const definitionTagGroups: Dictionary.Tag[] = [];
        tagAggregator.addTags(headwordTagGroups, dictionary, termTags);
        tagAggregator.addTags(definitionTagGroups, dictionary, definitionTags);

        const expandedInflectionRuleChainCandidates: Dictionary.InflectionRuleChainCandidate[] =
            inflectionRuleChainCandidates.map(({ source: src, inflectionRules }) => ({
                source: src,
                inflectionRules: inflectionRules.map((rule) => ({ name: rule })),
            }));

        return this._createTermDictionaryEntry(
            isPrimary,
            textProcessorRuleChainCandidates,
            expandedInflectionRuleChainCandidates,
            score,
            dictionaryIndex,
            dictionaryAlias,
            sourceTermExactMatchCount,
            matchPrimaryReading,
            maxOriginalTextLength,
            [this._createTermHeadword(0, term, reading, [source], headwordTagGroups, rules)],
            [
                this._createTermDefinition(
                    0,
                    [0],
                    dictionary,
                    dictionaryIndex,
                    dictionaryAlias,
                    id,
                    score,
                    [sequence],
                    isPrimary,
                    definitionTagGroups,
                    contentDefinitions,
                ),
            ],
        );
    }

    private _createGroupedDictionaryEntry(
        language: string,
        dictionaryEntries: TermDictionaryEntry[],
        checkDuplicateDefinitions: boolean,
        tagAggregator: TranslatorTagAggregator,
        primaryReading: string,
    ): TermDictionaryEntry {
        // Headwords are generated before sorting, so that the order of dictionaryEntries can be maintained
        const definitionEntries: { index: number; dictionaryEntry: TermDictionaryEntry; headwordIndexMap: number[] }[] =
            [];
        const headwords = new Map<string, Dictionary.TermHeadword>();
        const headwordDictionaryIndices = new Map<number, number>();
        for (const dictionaryEntry of dictionaryEntries) {
            const headwordIndexMap = this._addTermHeadwords(
                language,
                headwords,
                dictionaryEntry.headwords,
                tagAggregator,
            );
            // Track minimum dictionary index for each headword
            for (const headwordIndex of headwordIndexMap) {
                const existing = headwordDictionaryIndices.get(headwordIndex);
                if (typeof existing === 'undefined' || dictionaryEntry.dictionaryIndex < existing) {
                    headwordDictionaryIndices.set(headwordIndex, dictionaryEntry.dictionaryIndex);
                }
            }
            definitionEntries.push({ index: definitionEntries.length, dictionaryEntry, headwordIndexMap });
        }

        // Sort
        if (definitionEntries.length <= 1) {
            checkDuplicateDefinitions = false;
        }

        // Merge dictionary entry data
        let score = Number.MIN_SAFE_INTEGER;
        let dictionaryIndex = Number.MAX_SAFE_INTEGER;
        const dictionaryAlias = '';
        let maxOriginalTextLength = 0;
        let isPrimary = false;
        const definitions: Dictionary.TermDefinition[] = [];
        const definitionsMap: Map<string, Dictionary.TermDefinition> | null = checkDuplicateDefinitions
            ? new Map()
            : null;

        let inflections: Dictionary.InflectionRuleChainCandidate[] | null = null;
        let textProcesses: TextProcessorRuleChainCandidate[] | null = null;

        for (const { dictionaryEntry, headwordIndexMap } of definitionEntries) {
            score = Math.max(score, dictionaryEntry.score);
            dictionaryIndex = Math.min(dictionaryIndex, dictionaryEntry.dictionaryIndex);

            if (dictionaryEntry.isPrimary) {
                isPrimary = true;
                maxOriginalTextLength = Math.max(maxOriginalTextLength, dictionaryEntry.maxOriginalTextLength);

                const dictionaryEntryInflections = dictionaryEntry.inflectionRuleChainCandidates;
                const dictionaryEntryTextProcesses = dictionaryEntry.textProcessorRuleChainCandidates;

                if (inflections === null || dictionaryEntryInflections.length < inflections.length) {
                    inflections = dictionaryEntryInflections;
                }
                if (textProcesses === null || dictionaryEntryTextProcesses.length < textProcesses.length) {
                    textProcesses = dictionaryEntryTextProcesses;
                }
            }

            if (definitionsMap !== null) {
                this._addTermDefinitions(
                    definitions,
                    definitionsMap,
                    dictionaryEntry.definitions,
                    headwordIndexMap,
                    tagAggregator,
                );
            } else {
                this._addTermDefinitionsFast(definitions, dictionaryEntry.definitions, headwordIndexMap);
            }
        }

        const headwordsArray = [...headwords.values()];

        this._sortHeadwords(headwordsArray, headwordDictionaryIndices, definitions);

        const { sourceTermExactMatchCount, matchPrimaryReading } = this._getHeadwordMatchCounts(
            headwordsArray,
            primaryReading,
        );

        return this._createTermDictionaryEntry(
            isPrimary,
            textProcesses !== null ? textProcesses : [],
            inflections !== null ? inflections : [],
            score,
            dictionaryIndex,
            dictionaryAlias,
            sourceTermExactMatchCount,
            matchPrimaryReading,
            maxOriginalTextLength,
            headwordsArray,
            definitions,
        );
    }

    private _sortHeadwords(
        headwordsArray: Dictionary.TermHeadword[],
        headwordDictionaryIndices: Map<number, number>,
        definitions: Dictionary.TermDefinition[],
    ): void {
        // Sort headwords: primary sources first, then by dictionary index
        headwordsArray.sort((a, b) => {
            const aHasPrimary = a.sources.some((s) => s.isPrimary);
            const bHasPrimary = b.sources.some((s) => s.isPrimary);
            if (aHasPrimary !== bHasPrimary) {
                return aHasPrimary ? -1 : 1;
            }
            const aDictIndex = headwordDictionaryIndices.get(a.index) ?? Number.MAX_SAFE_INTEGER;
            const bDictIndex = headwordDictionaryIndices.get(b.index) ?? Number.MAX_SAFE_INTEGER;
            return aDictIndex - bDictIndex;
        });

        // Update headword indices after sorting
        const headwordIndexMap = new Map<number, number>();
        for (let i = 0; i < headwordsArray.length; i++) {
            headwordIndexMap.set(headwordsArray[i].index, i);
            headwordsArray[i].index = i;
        }

        // Remap definition headword indices
        for (const definition of definitions) {
            for (let i = 0; i < definition.headwordIndices.length; i++) {
                const oldIndex = definition.headwordIndices[i];
                const newIndex = headwordIndexMap.get(oldIndex);
                if (typeof newIndex === 'number') {
                    definition.headwordIndices[i] = newIndex;
                }
            }
        }
    }

    private _getHeadwordMatchCounts(
        headwordsArray: Dictionary.TermHeadword[],
        primaryReading: string,
    ): { sourceTermExactMatchCount: number; matchPrimaryReading: boolean } {
        let sourceTermExactMatchCount = 0;
        let matchPrimaryReading = false;
        for (const { sources, reading } of headwordsArray) {
            if (primaryReading.length > 0 && reading === primaryReading) {
                matchPrimaryReading = true;
            }
            for (const source of sources) {
                if (source.isPrimary && source.matchSource === 'term') {
                    ++sourceTermExactMatchCount;
                    break;
                }
            }
        }
        return { sourceTermExactMatchCount, matchPrimaryReading };
    }

    // Data collection addition functions

    private _addUniqueSimple<T>(list: T[], newItems: T[]): void {
        for (const item of newItems) {
            if (!list.includes(item)) {
                list.push(item);
            }
        }
    }

    private _addUniqueSources(sources: Dictionary.TermSource[], newSources: Dictionary.TermSource[]): void {
        if (newSources.length === 0) {
            return;
        }
        if (sources.length === 0) {
            sources.push(...newSources);
            return;
        }
        for (const newSource of newSources) {
            const { originalText, transformedText, deinflectedText, matchType, matchSource, isPrimary } = newSource;
            let has = false;
            for (const source of sources) {
                if (
                    source.deinflectedText === deinflectedText &&
                    source.transformedText === transformedText &&
                    source.originalText === originalText &&
                    source.matchType === matchType &&
                    source.matchSource === matchSource
                ) {
                    if (isPrimary) {
                        source.isPrimary = true;
                    }
                    has = true;
                    break;
                }
            }
            if (!has) {
                sources.push(newSource);
            }
        }
    }

    private _addTermHeadwords(
        language: string,
        headwordsMap: Map<string, Dictionary.TermHeadword>,
        headwords: Dictionary.TermHeadword[],
        tagAggregator: TranslatorTagAggregator,
    ): number[] {
        const headwordIndexMap: number[] = [];
        for (const { term, reading, sources, tags, wordClasses } of headwords) {
            const readingNormalizer = this._readingNormalizers.get(language);
            const normalizedReading = typeof readingNormalizer === 'undefined' ? reading : readingNormalizer(reading);
            const key = this._createMapKey([term, normalizedReading]);
            let headword = headwordsMap.get(key);
            if (typeof headword === 'undefined') {
                headword = this._createTermHeadword(headwordsMap.size, term, reading, [], [], []);
                headwordsMap.set(key, headword);
            }
            this._addUniqueSources(headword.sources, sources);
            this._addUniqueSimple(headword.wordClasses, wordClasses);
            tagAggregator.mergeTags(headword.tags, tags);
            headwordIndexMap.push(headword.index);
        }
        return headwordIndexMap;
    }

    private _addUniqueTermHeadwordIndex(headwordIndices: number[], headwordIndex: number): void {
        let end = headwordIndices.length;
        if (end === 0) {
            headwordIndices.push(headwordIndex);
            return;
        }

        let start = 0;
        while (start < end) {
            const mid = Math.floor((start + end) / 2);
            const value = headwordIndices[mid];
            if (headwordIndex === value) {
                return;
            }
            if (headwordIndex > value) {
                start = mid + 1;
            } else {
                end = mid;
            }
        }

        if (headwordIndex === headwordIndices[start]) {
            return;
        }
        headwordIndices.splice(start, 0, headwordIndex);
    }

    private _addTermDefinitionsFast(
        definitions: Dictionary.TermDefinition[],
        newDefinitions: Dictionary.TermDefinition[],
        headwordIndexMap: number[],
    ): void {
        for (const {
            headwordIndices,
            dictionary,
            dictionaryIndex,
            dictionaryAlias,
            sequences,
            id,
            score,
            isPrimary,
            tags,
            entries,
        } of newDefinitions) {
            const headwordIndicesNew: number[] = [];
            for (const headwordIndex of headwordIndices) {
                headwordIndicesNew.push(headwordIndexMap[headwordIndex]);
            }
            definitions.push(
                this._createTermDefinition(
                    definitions.length,
                    headwordIndicesNew,
                    dictionary,
                    dictionaryIndex,
                    dictionaryAlias,
                    id,
                    score,
                    sequences,
                    isPrimary,
                    tags,
                    entries,
                ),
            );
        }
    }

    private _addTermDefinitions(
        definitions: Dictionary.TermDefinition[],
        definitionsMap: Map<string, Dictionary.TermDefinition>,
        newDefinitions: Dictionary.TermDefinition[],
        headwordIndexMap: number[],
        tagAggregator: TranslatorTagAggregator,
    ): void {
        for (const {
            headwordIndices,
            dictionary,
            dictionaryIndex,
            dictionaryAlias,
            sequences,
            id,
            score,
            isPrimary,
            tags,
            entries,
        } of newDefinitions) {
            const key = this._createMapKey([dictionary, ...entries]);
            let definition = definitionsMap.get(key);
            if (typeof definition === 'undefined') {
                definition = this._createTermDefinition(
                    definitions.length,
                    [],
                    dictionary,
                    dictionaryIndex,
                    dictionaryAlias,
                    id,
                    score,
                    [...sequences],
                    isPrimary,
                    [],
                    [...entries],
                );
                definitions.push(definition);
                definitionsMap.set(key, definition);
            } else {
                if (isPrimary) {
                    definition.isPrimary = true;
                }
                this._addUniqueSimple(definition.sequences, sequences);
            }

            const newHeadwordIndices = definition.headwordIndices;
            for (const headwordIndex of headwordIndices) {
                this._addUniqueTermHeadwordIndex(newHeadwordIndices, headwordIndexMap[headwordIndex]);
            }
            tagAggregator.mergeTags(definition.tags, tags);
        }
    }

    // Sorting functions

    private _sortDatabaseEntriesByIndex(
        databaseEntries: (DictionaryDatabase.TermEntry | DictionaryDatabase.KanjiEntry)[],
    ): void {
        if (databaseEntries.length <= 1) {
            return;
        }
        const compareFunction = (v1: { index: number }, v2: { index: number }): number => v1.index - v2.index;
        databaseEntries.sort(compareFunction);
    }

    private _sortKanjiDictionaryEntries(dictionaryEntries: Dictionary.KanjiDictionaryEntry[]): void {
        const compareFunction = (v1: Dictionary.KanjiDictionaryEntry, v2: Dictionary.KanjiDictionaryEntry): number => {
            // Sort by dictionary order
            return v1.dictionaryIndex - v2.dictionaryIndex;
        };
        dictionaryEntries.sort(compareFunction);
    }

    private _sortTermDictionaryEntries(dictionaryEntries: TermDictionaryEntry[]): void {
        const stringComparer = this._stringComparer;
        const compareFunction = (v1: TermDictionaryEntry, v2: TermDictionaryEntry): number => {
            // Sort by reading match
            let i = (v2.matchPrimaryReading ? 1 : 0) - (v1.matchPrimaryReading ? 1 : 0);
            if (i !== 0) {
                return i;
            }

            // Sort by length of source term
            i = v2.maxOriginalTextLength - v1.maxOriginalTextLength;
            if (i !== 0) {
                return i;
            }

            // Sort by length of the shortest text processing chain
            i =
                this._getShortestTextProcessingChainLength(v1.textProcessorRuleChainCandidates) -
                this._getShortestTextProcessingChainLength(v2.textProcessorRuleChainCandidates);
            if (i !== 0) {
                return i;
            }

            // Sort by length of the shortest inflection chain
            i =
                this._getShortestInflectionChainLength(v1.inflectionRuleChainCandidates) -
                this._getShortestInflectionChainLength(v2.inflectionRuleChainCandidates);
            if (i !== 0) {
                return i;
            }

            // Sort by how many terms exactly match the source
            i = v2.sourceTermExactMatchCount - v1.sourceTermExactMatchCount;
            if (i !== 0) {
                return i;
            }

            // Sort by frequency order
            i = v1.frequencyOrder - v2.frequencyOrder;
            if (i !== 0) {
                return i;
            }

            // Sort by dictionary order
            i = v1.dictionaryIndex - v2.dictionaryIndex;
            if (i !== 0) {
                return i;
            }

            // Sort by term score
            i = v2.score - v1.score;
            if (i !== 0) {
                return i;
            }

            // Sort by headword term text
            const headwords1 = v1.headwords;
            const headwords2 = v2.headwords;
            for (let j = 0, jj = Math.min(headwords1.length, headwords2.length); j < jj; ++j) {
                const term1 = headwords1[j].term;
                const term2 = headwords2[j].term;

                i = term2.length - term1.length;
                if (i !== 0) {
                    return i;
                }

                i = stringComparer.compare(term1, term2);
                if (i !== 0) {
                    return i;
                }
            }

            // Sort by definition count
            i = v2.definitions.length - v1.definitions.length;
            return i;
        };
        dictionaryEntries.sort(compareFunction);
    }

    private _sortTermDictionaryEntryDefinitions(definitions: Dictionary.TermDefinition[]): void {
        const compareFunction = (v1: Dictionary.TermDefinition, v2: Dictionary.TermDefinition): number => {
            // Sort by frequency order
            let i = v1.frequencyOrder - v2.frequencyOrder;
            if (i !== 0) {
                return i;
            }

            // Sort by dictionary order
            i = v1.dictionaryIndex - v2.dictionaryIndex;
            if (i !== 0) {
                return i;
            }

            // Sort by term score
            i = v2.score - v1.score;
            if (i !== 0) {
                return i;
            }

            // Sort by definition headword index
            const headwordIndices1 = v1.headwordIndices;
            const headwordIndices2 = v2.headwordIndices;
            const jj = headwordIndices1.length;
            i = headwordIndices2.length - jj;
            if (i !== 0) {
                return i;
            }
            for (let j = 0; j < jj; ++j) {
                i = headwordIndices1[j] - headwordIndices2[j];
                if (i !== 0) {
                    return i;
                }
            }

            // Sort by original order
            i = v1.index - v2.index;
            return i;
        };
        definitions.sort(compareFunction);
    }

    private _sortTermDictionaryEntriesById(dictionaryEntries: TermDictionaryEntry[]): void {
        if (dictionaryEntries.length <= 1) {
            return;
        }
        dictionaryEntries.sort((a, b) => a.definitions[0].id - b.definitions[0].id);
    }

    private _sortTermDictionaryEntrySimpleData(
        dataList: (Dictionary.TermFrequency | Dictionary.TermPronunciation)[],
    ): void {
        const compare = (
            v1: Dictionary.TermFrequency | Dictionary.TermPronunciation,
            v2: Dictionary.TermFrequency | Dictionary.TermPronunciation,
        ): number => {
            // Sort by headword order
            let i = v1.headwordIndex - v2.headwordIndex;
            if (i !== 0) {
                return i;
            }

            // Sort by dictionary order
            i = v1.dictionaryIndex - v2.dictionaryIndex;
            if (i !== 0) {
                return i;
            }

            // Default order
            i = v1.index - v2.index;
            return i;
        };
        dataList.sort(compare);
    }

    private _sortKanjiDictionaryEntryData(dictionaryEntries: Dictionary.KanjiDictionaryEntry[]): void {
        const compare = (v1: Dictionary.KanjiFrequency, v2: Dictionary.KanjiFrequency): number => {
            // Sort by dictionary order
            let i = v1.dictionaryIndex - v2.dictionaryIndex;
            if (i !== 0) {
                return i;
            }

            // Default order
            i = v1.index - v2.index;
            return i;
        };

        for (const { frequencies } of dictionaryEntries) {
            frequencies.sort(compare);
        }
    }

    private _updateSortFrequencies(
        dictionaryEntries: TermDictionaryEntry[],
        dictionary: string,
        ascending: boolean,
    ): void {
        const frequencyMap = new Map<number, number>();
        for (const dictionaryEntry of dictionaryEntries) {
            const { definitions, frequencies } = dictionaryEntry;
            let frequencyMin = Number.MAX_SAFE_INTEGER;
            let frequencyMax = Number.MIN_SAFE_INTEGER;
            for (const item of frequencies) {
                if (item.dictionary !== dictionary) {
                    continue;
                }
                const { headwordIndex, frequency } = item;
                if (typeof frequency !== 'number') {
                    continue;
                }
                frequencyMap.set(headwordIndex, frequency);
                frequencyMin = Math.min(frequencyMin, frequency);
                frequencyMax = Math.max(frequencyMax, frequency);
            }
            dictionaryEntry.frequencyOrder =
                frequencyMin <= frequencyMax
                    ? ascending
                        ? frequencyMin
                        : -frequencyMax
                    : ascending
                      ? Number.MAX_SAFE_INTEGER
                      : 0;
            for (const definition of definitions) {
                frequencyMin = Number.MAX_SAFE_INTEGER;
                frequencyMax = Number.MIN_SAFE_INTEGER;
                const { headwordIndices } = definition;
                for (const headwordIndex of headwordIndices) {
                    const frequency = frequencyMap.get(headwordIndex);
                    if (typeof frequency !== 'number') {
                        continue;
                    }
                    frequencyMin = Math.min(frequencyMin, frequency);
                    frequencyMax = Math.max(frequencyMax, frequency);
                }
                definition.frequencyOrder =
                    frequencyMin <= frequencyMax
                        ? ascending
                            ? frequencyMin
                            : -frequencyMax
                        : ascending
                          ? Number.MAX_SAFE_INTEGER
                          : 0;
            }
            frequencyMap.clear();
        }
    }

    private _getShortestTextProcessingChainLength(
        textProcessorRuleChainCandidates: TextProcessorRuleChainCandidate[],
    ): number {
        if (textProcessorRuleChainCandidates.length === 0) {
            return 0;
        }
        let length = Number.MAX_SAFE_INTEGER;
        for (const candidate of textProcessorRuleChainCandidates) {
            length = Math.min(length, candidate.length);
        }
        return length;
    }

    private _getShortestInflectionChainLength(
        inflectionRuleChainCandidates: Dictionary.InflectionRuleChainCandidate[],
    ): number {
        if (inflectionRuleChainCandidates.length === 0) {
            return 0;
        }
        let length = Number.MAX_SAFE_INTEGER;
        for (const { inflectionRules } of inflectionRuleChainCandidates) {
            length = Math.min(length, inflectionRules.length);
        }
        return length;
    }

    private _addUserFacingInflections(
        language: string,
        dictionaryEntries: TermDictionaryEntry[],
    ): TermDictionaryEntry[] {
        const result: TermDictionaryEntry[] = [];
        for (const dictionaryEntry of dictionaryEntries) {
            const { inflectionRuleChainCandidates } = dictionaryEntry;
            const expandedChains = inflectionRuleChainCandidates.map(({ source, inflectionRules }) => ({
                source,
                inflectionRules: this._multiLanguageTransformer.getUserFacingInflectionRules(
                    language,
                    inflectionRules.map((r) => r.name),
                ),
            }));
            result.push({ ...dictionaryEntry, inflectionRuleChainCandidates: expandedChains });
        }
        return result;
    }

    // Miscellaneous

    private _hasAny<T>(set: Set<T>, values: T[]): boolean {
        for (const value of values) {
            if (set.has(value)) {
                return true;
            }
        }
        return false;
    }
}
