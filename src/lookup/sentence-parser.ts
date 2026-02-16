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

import { distributeFurigana } from '../language/ja/furigana';
import type { FuriganaSegment } from '../language/ja/furigana';
import type { TermDictionaryEntry } from '../types/dictionary';
import type { FindTermDictionary } from '../types/translation';
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

export interface SentenceParserOptions {
    /** The enabled dictionary map for lookups. */
    enabledDictionaryMap: Map<string, { index: number; priority: number }>;
    /** Maximum character length for substring lookups. Defaults to 20. */
    maxLength?: number;
}

/**
 * Parses text into segments with dictionary lookups using a left-to-right
 * sliding window (longest match) algorithm.
 */
export class SentenceParser {
    private _translator: Translator;

    constructor(translator: Translator) {
        this._translator = translator;
    }

    /**
     * Parses the given text into lines of parsed segments.
     * For each position, attempts to find the longest dictionary match by
     * querying the translator with progressively shorter substrings.
     * Generates furigana for Japanese text segments.
     */
    async parseText(text: string, language: string, options: SentenceParserOptions): Promise<ParsedLine[]> {
        const maxLength = options.maxLength ?? 20;
        const enabledDictionaryMap = this._buildFindTermDictionaryMap(options.enabledDictionaryMap);

        const lines = text.split('\n');
        const results: ParsedLine[] = [];

        for (const line of lines) {
            const segments = await this._parseLine(line, language, enabledDictionaryMap, maxLength);
            results.push({ segments });
        }

        return results;
    }

    /**
     * Parses a single line of text into segments.
     */
    private async _parseLine(
        line: string,
        language: string,
        enabledDictionaryMap: Map<string, FindTermDictionary>,
        maxLength: number,
    ): Promise<ParsedSegment[]> {
        const segments: ParsedSegment[] = [];
        let position = 0;

        while (position < line.length) {
            const remaining = line.substring(position);
            const searchLength = Math.min(remaining.length, maxLength);

            let bestMatch: {
                length: number;
                entries: TermDictionaryEntry[];
                term: string;
                reading: string;
            } | null = null;

            // Try progressively shorter substrings from longest to shortest
            for (let len = searchLength; len > 0; --len) {
                const substring = remaining.substring(0, len);

                const findTermsOptions = this._createFindTermsOptions(language, enabledDictionaryMap);

                try {
                    const { dictionaryEntries, originalTextLength } = await this._translator.findTerms(
                        'simple',
                        substring,
                        findTermsOptions,
                    );

                    if (dictionaryEntries.length > 0 && originalTextLength > 0) {
                        const firstEntry = dictionaryEntries[0];
                        const headword = firstEntry.headwords[0];
                        bestMatch = {
                            length: originalTextLength,
                            entries: dictionaryEntries,
                            term: headword.term,
                            reading: headword.reading,
                        };
                        break;
                    }
                } catch {}
            }

            if (bestMatch !== null) {
                const surfaceText = remaining.substring(0, bestMatch.length);
                const furigana =
                    language === 'ja'
                        ? distributeFurigana(surfaceText, bestMatch.reading)
                        : [{ text: surfaceText, reading: '' }];

                segments.push({
                    text: surfaceText,
                    reading: bestMatch.reading,
                    term: bestMatch.term,
                    entries: bestMatch.entries,
                    furigana,
                });
                position += bestMatch.length;
            } else {
                // No match found; consume one character
                const char = remaining.substring(0, 1);
                segments.push({
                    text: char,
                    reading: '',
                    term: char,
                    entries: [],
                    furigana: [{ text: char, reading: '' }],
                });
                position += char.length;
            }
        }

        return segments;
    }

    /**
     * Builds a FindTermDictionary map from the simplified input format.
     */
    private _buildFindTermDictionaryMap(
        inputMap: Map<string, { index: number; priority: number }>,
    ): Map<string, FindTermDictionary> {
        const result = new Map<string, FindTermDictionary>();
        for (const [name, { index }] of inputMap.entries()) {
            result.set(name, {
                index,
                alias: name,
                allowSecondarySearches: false,
                partsOfSpeechFilter: true,
                useDeinflections: true,
            });
        }
        return result;
    }

    /**
     * Creates a FindTermsOptions for simple lookup.
     */
    private _createFindTermsOptions(language: string, enabledDictionaryMap: Map<string, FindTermDictionary>) {
        return {
            matchType: 'exact' as const,
            deinflect: true,
            primaryReading: '',
            mainDictionary: '',
            sortFrequencyDictionary: null,
            sortFrequencyDictionaryOrder: 'descending' as const,
            removeNonJapaneseCharacters:
                language === 'ja' || language === 'zh' || language === 'yue' || language === 'ko',
            textReplacements: [null],
            enabledDictionaryMap,
            excludeDictionaryDefinitions: null,
            searchResolution: 'letter' as const,
            language,
        };
    }
}
