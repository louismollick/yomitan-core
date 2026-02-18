/*
 * Copyright (C) 2023-2025  Yomitan Authors
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

import { isCodePointJapanese } from '../language/ja/japanese';
import type { TermDictionaryEntry } from '../types/dictionary';
import type { ParseTextHeadword, ParseTextLine, ParseTextSegment } from '../types/parse';
import type { FindTermDictionary, FindTermsTextReplacements, SearchResolution } from '../types/translation';
import { codePointPreview, debugYomitanCore } from '../util/debug';
import type { Translator } from './translator';
export type { ParseTextHeadword, ParseTextLine, ParseTextResultItem, ParseTextSegment } from '../types/parse';

export interface SentenceParserDictionaryInput {
    index: number;
    priority?: number;
    alias?: string;
    allowSecondarySearches?: boolean;
    partsOfSpeechFilter?: boolean;
    useDeinflections?: boolean;
}

export interface SentenceParserOptions {
    /** The enabled dictionary map for lookups. */
    enabledDictionaryMap: Map<string, SentenceParserDictionaryInput>;
    /** Window size used by scanning parser. Defaults to 20. */
    scanLength?: number;
    /** Backward compatibility alias for scanLength. */
    maxLength?: number;
    /** Search resolution for translator. */
    searchResolution?: SearchResolution;
    /** Whether to remove non-Japanese characters in lookups. */
    removeNonJapaneseCharacters?: boolean;
    /** Whether to apply deinflection. */
    deinflect?: boolean;
    /** Text replacements forwarded to translator. */
    textReplacements?: FindTermsTextReplacements;
}

interface ParseScanCacheEntry {
    originalTextLength: number;
    segments: ParseTextSegment[];
}

/**
 * Parses text into segments with dictionary lookups using the same
 * scanning-parser model as Yomitan extension (non-MeCab path).
 */
export class SentenceParser {
    private _translator: Translator;

    constructor(translator: Translator) {
        this._translator = translator;
    }

    /**
     * Parses the given text into lines of parsed segments.
     */
    async parseText(text: string, language: string, options: SentenceParserOptions): Promise<ParseTextLine[]> {
        const scanLength = options.scanLength ?? options.maxLength ?? 20;
        const enabledDictionaryMap = this._buildFindTermDictionaryMap(options.enabledDictionaryMap);
        debugYomitanCore('sentence-parser', 'parseText:start', {
            textLength: text.length,
            textPreview: text.slice(0, 120),
            textCodePoints: codePointPreview(text),
            lineCount: text.split('\n').length,
            scanLength,
            language,
            enabledDictionaryCount: enabledDictionaryMap.size,
            enabledDictionaryNames: [...enabledDictionaryMap.keys()],
            searchResolution: options.searchResolution ?? 'letter',
            removeNonJapaneseCharacters: options.removeNonJapaneseCharacters,
            deinflect: options.deinflect,
        });

        const lines = text.split('\n');
        const results: ParseTextLine[] = [];

        for (const [lineIndex, line] of lines.entries()) {
            const segments = await this._parseLine(line, lineIndex, language, enabledDictionaryMap, scanLength, options);
            results.push(segments);
        }

        debugYomitanCore('sentence-parser', 'parseText:complete', {
            lineCount: results.length,
            lineSegmentCounts: results.map((line) => line.length),
            totalSegments: results.reduce((count, line) => count + line.length, 0),
            matchedSegments: results.reduce(
                (count, line) => count + line.filter((segment) => Array.isArray(segment.headwords)).length,
                0,
            ),
        });

        return results;
    }

    /**
     * Parses a single line using extension-equivalent scanning parser semantics.
     */
    private async _parseLine(
        line: string,
        lineIndex: number,
        language: string,
        enabledDictionaryMap: Map<string, FindTermDictionary>,
        scanLength: number,
        options: SentenceParserOptions,
    ): Promise<ParseTextLine> {
        const findTermsOptions = this._createFindTermsOptions(language, enabledDictionaryMap, options);
        const cache = new Map<string, ParseScanCacheEntry>();

        const result: ParseTextSegment[] = [];
        let previousUngroupedSegment: ParseTextSegment | null = null;
        let lookupCount = 0;
        let cacheHits = 0;
        let cacheMisses = 0;
        let matchedSegmentCount = 0;
        let unmatchedSegmentCount = 0;
        let emptyEntryLookups = 0;
        const lookupMissSamples: Array<{ substring: string; codePoints: string[]; originalTextLength: number }> = [];

        let i = 0;
        const ii = line.length;
        while (i < ii) {
            const codePoint = line.codePointAt(i) as number;
            const character = String.fromCodePoint(codePoint);
            const substring = line.substring(i, i + scanLength);

            let cached = cache.get(substring);
            if (!cached) {
                cacheMisses += 1;
                const { dictionaryEntries, originalTextLength } = await this._translator.findTerms(
                    'simple',
                    substring,
                    findTermsOptions,
                );
                lookupCount += 1;

                let segments: ParseTextSegment[] = [];
                if (dictionaryEntries.length === 0) {
                    emptyEntryLookups += 1;
                    if (lookupMissSamples.length < 5) {
                        lookupMissSamples.push({
                            substring: substring.slice(0, 40),
                            codePoints: codePointPreview(substring, 20),
                            originalTextLength,
                        });
                    }
                }

                if (
                    dictionaryEntries.length > 0 &&
                    originalTextLength > 0 &&
                    (originalTextLength !== character.length || isCodePointJapanese(codePoint))
                ) {
                    const source = substring.substring(0, originalTextLength);
                    segments = this._createMatchedSegments(source, dictionaryEntries);
                }

                cached = {
                    originalTextLength,
                    segments,
                };
                cache.set(substring, cached);
            } else {
                cacheHits += 1;
            }

            const { originalTextLength, segments } = cached;
            if (segments.length > 0) {
                previousUngroupedSegment = null;
                result.push(...segments);
                matchedSegmentCount += segments.length;
                i += Math.max(1, originalTextLength);
            } else {
                if (previousUngroupedSegment === null) {
                    previousUngroupedSegment = {
                        text: character,
                        reading: ''
                    };
                    result.push(previousUngroupedSegment);
                    unmatchedSegmentCount += 1;
                } else {
                    previousUngroupedSegment.text += character;
                }
                i += character.length;
            }
        }

        debugYomitanCore('sentence-parser', 'parseLine:complete', {
            lineIndex,
            lineLength: line.length,
            linePreview: line.slice(0, 120),
            lookupCount,
            cacheHits,
            cacheMisses,
            emptyEntryLookups,
            matchedSegmentCount,
            unmatchedSegmentCount,
            finalSegmentCount: result.length,
            missSamples: lookupMissSamples,
        });

        return result;
    }

    private _createMatchedSegments(source: string, dictionaryEntries: TermDictionaryEntry[]): ParseTextSegment[] {
        if (dictionaryEntries.length === 0) {
            return [];
        }

        const firstEntry = dictionaryEntries[0];
        const firstHeadword = firstEntry.headwords[0];
        if (!firstHeadword) {
            return [];
        }

        const trimmedHeadwords: ParseTextHeadword[][] = [];
        for (const dictionaryEntry of dictionaryEntries) {
            const validHeadwords: ParseTextHeadword[] = [];
            for (const headword of dictionaryEntry.headwords) {
                const validSources = headword.sources.filter(
                    (src) => src.originalText === source && src.isPrimary && src.matchType === 'exact',
                );

                if (validSources.length > 0) {
                    validHeadwords.push({
                        term: headword.term,
                        reading: headword.reading,
                        sources: validSources,
                    });
                }
            }
            if (validHeadwords.length > 0) {
                trimmedHeadwords.push(validHeadwords);
            }
        }

        return [
            {
                text: source,
                reading: firstHeadword.reading ?? '',
                ...(trimmedHeadwords.length > 0 ? { headwords: trimmedHeadwords } : {}),
            },
        ];
    }

    /**
     * Builds a FindTermDictionary map from the input format.
     */
    private _buildFindTermDictionaryMap(
        inputMap: Map<string, SentenceParserDictionaryInput>,
    ): Map<string, FindTermDictionary> {
        const result = new Map<string, FindTermDictionary>();

        for (const [name, config] of inputMap.entries()) {
            result.set(name, {
                index: config.index,
                alias: config.alias ?? name,
                allowSecondarySearches: config.allowSecondarySearches ?? false,
                partsOfSpeechFilter: config.partsOfSpeechFilter ?? true,
                useDeinflections: config.useDeinflections ?? true,
            });
        }

        return result;
    }

    /**
     * Creates a FindTermsOptions object for scanning parser lookups.
     */
    private _createFindTermsOptions(
        language: string,
        enabledDictionaryMap: Map<string, FindTermDictionary>,
        options: SentenceParserOptions,
    ) {
        return {
            matchType: 'exact' as const,
            deinflect: options.deinflect ?? true,
            primaryReading: '',
            mainDictionary: '',
            sortFrequencyDictionary: null,
            sortFrequencyDictionaryOrder: 'descending' as const,
            removeNonJapaneseCharacters:
                options.removeNonJapaneseCharacters ??
                (language === 'ja' || language === 'zh' || language === 'yue' || language === 'ko'),
            textReplacements: options.textReplacements ?? [null],
            enabledDictionaryMap,
            excludeDictionaryDefinitions: null,
            searchResolution: options.searchResolution ?? ('letter' as const),
            language,
        };
    }
}
