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

import { distributeFuriganaInflected, isCodePointJapanese } from '../language/ja/japanese';
import type { FuriganaSegment } from '../language/ja/japanese';
import type { TermDictionaryEntry, TermHeadword } from '../types/dictionary';
import type { FindTermDictionary, FindTermsTextReplacements, SearchResolution } from '../types/translation';
import type { Translator } from './translator';

export interface ParsedSegment {
    /** The surface text of this segment. */
    text: string;
    /** The reading (furigana) for this segment, or empty string if no reading. */
    reading: string;
    /** The dictionary form (headword term) matched for this segment, or the surface text if no match. */
    term: string;
    /** The dictionary entries found for this segment. */
    entries: TermDictionaryEntry[];
    /** Furigana distribution for this segment. */
    furigana: FuriganaSegment[];
}

export interface ParsedLine {
    /** The parsed segments for this line. */
    segments: ParsedSegment[];
}

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
    segments: ParsedSegment[];
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
    async parseText(text: string, language: string, options: SentenceParserOptions): Promise<ParsedLine[]> {
        const scanLength = options.scanLength ?? options.maxLength ?? 20;
        const enabledDictionaryMap = this._buildFindTermDictionaryMap(options.enabledDictionaryMap);

        const lines = text.split('\n');
        const results: ParsedLine[] = [];

        for (const line of lines) {
            const segments = await this._parseLine(line, language, enabledDictionaryMap, scanLength, options);
            results.push({ segments });
        }

        return results;
    }

    /**
     * Parses a single line using extension-equivalent scanning parser semantics.
     */
    private async _parseLine(
        line: string,
        language: string,
        enabledDictionaryMap: Map<string, FindTermDictionary>,
        scanLength: number,
        options: SentenceParserOptions,
    ): Promise<ParsedSegment[]> {
        const findTermsOptions = this._createFindTermsOptions(language, enabledDictionaryMap, options);
        const cache = new Map<string, ParseScanCacheEntry>();

        const result: ParsedSegment[] = [];
        let previousUngroupedSegment: ParsedSegment | null = null;

        let i = 0;
        const ii = line.length;
        while (i < ii) {
            const codePoint = line.codePointAt(i) as number;
            const character = String.fromCodePoint(codePoint);
            const substring = line.substring(i, i + scanLength);

            let cached = cache.get(substring);
            if (!cached) {
                const { dictionaryEntries, originalTextLength } = await this._translator.findTerms(
                    'simple',
                    substring,
                    findTermsOptions,
                );

                let segments: ParsedSegment[] = [];

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
            }

            const { originalTextLength, segments } = cached;
            if (segments.length > 0) {
                previousUngroupedSegment = null;
                result.push(...segments);
                i += Math.max(1, originalTextLength);
            } else {
                if (previousUngroupedSegment === null) {
                    previousUngroupedSegment = {
                        text: character,
                        reading: '',
                        term: character,
                        entries: [],
                        furigana: [{ text: character, reading: '' }],
                    };
                    result.push(previousUngroupedSegment);
                } else {
                    previousUngroupedSegment.text += character;
                    previousUngroupedSegment.term = previousUngroupedSegment.text;
                    previousUngroupedSegment.furigana = [{ text: previousUngroupedSegment.text, reading: '' }];
                }
                i += character.length;
            }
        }

        return result;
    }

    private _createMatchedSegments(source: string, dictionaryEntries: TermDictionaryEntry[]): ParsedSegment[] {
        if (dictionaryEntries.length === 0) {
            return [];
        }

        const firstEntry = dictionaryEntries[0];
        const firstHeadword = firstEntry.headwords[0];
        if (!firstHeadword) {
            return [];
        }

        const reading = firstHeadword.reading ?? '';
        const term = firstHeadword.term ?? source;

        const furigana = distributeFuriganaInflected(term, reading, source);
        const filteredEntries = this._trimEntriesForSource(dictionaryEntries, source);

        return [
            {
                text: source,
                reading,
                term,
                entries: filteredEntries,
                furigana,
            },
        ];
    }

    private _trimEntriesForSource(dictionaryEntries: TermDictionaryEntry[], source: string): TermDictionaryEntry[] {
        const trimmed: TermDictionaryEntry[] = [];

        for (const entry of dictionaryEntries) {
            const headwords: TermHeadword[] = [];
            for (const headword of entry.headwords) {
                const validSources = headword.sources.filter(
                    (src) => src.originalText === source && src.isPrimary && src.matchType === 'exact',
                );

                if (validSources.length > 0) {
                    headwords.push({ ...headword, sources: validSources });
                }
            }

            if (headwords.length > 0) {
                trimmed.push({ ...entry, headwords });
            }
        }

        return trimmed.length > 0 ? trimmed : dictionaryEntries;
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
