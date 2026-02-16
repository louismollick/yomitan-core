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

type MatchResult = {
    length: number;
    entries: TermDictionaryEntry[];
    term: string;
    reading: string;
};

type SegmentCandidate = {
    to: number;
    score: number;
    match: MatchResult;
};

/**
 * Parses text into segments with dictionary lookups.
 *
 * The parser enumerates candidate dictionary matches at every position and then
 * chooses a global best path. This avoids greedy local choices such as
 * splitting 会わせて into 会わせ + て and more closely matches extension behavior.
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
     * Parses a single line into segments using global best-path optimization.
     */
    private async _parseLine(
        line: string,
        language: string,
        enabledDictionaryMap: Map<string, FindTermDictionary>,
        maxLength: number,
    ): Promise<ParsedSegment[]> {
        const n = line.length;
        if (n === 0) {
            return [];
        }

        const findTermsOptions = this._createFindTermsOptions(language, enabledDictionaryMap);
        const lookupCache = new Map<string, Promise<MatchResult | null>>();

        const lookupMatch = async (substring: string): Promise<MatchResult | null> => {
            const cached = lookupCache.get(substring);
            if (cached) {
                return await cached;
            }

            const promise = this._translator
                .findTerms('simple', substring, findTermsOptions)
                .then(({ dictionaryEntries, originalTextLength }) => {
                    if (dictionaryEntries.length === 0 || originalTextLength <= 0) {
                        return null;
                    }

                    const firstEntry = dictionaryEntries[0];
                    const headword = firstEntry.headwords[0];
                    const term = headword?.term ?? substring.substring(0, originalTextLength);
                    const reading = headword?.reading ?? '';

                    return {
                        length: originalTextLength,
                        entries: dictionaryEntries,
                        term,
                        reading,
                    } satisfies MatchResult;
                })
                .catch(() => null);

            lookupCache.set(substring, promise);
            return await promise;
        };

        const candidatesAt: SegmentCandidate[][] = Array.from({ length: n }, () => []);

        for (let start = 0; start < n; ++start) {
            const remaining = n - start;
            const searchLength = Math.min(remaining, maxLength);
            const byEnd = new Map<number, SegmentCandidate>();

            for (let len = searchLength; len > 0; --len) {
                const substring = line.substring(start, start + len);
                const match = await lookupMatch(substring);
                if (match === null) {
                    continue;
                }

                const end = start + match.length;
                if (end <= start || end > n) {
                    continue;
                }

                const surface = line.substring(start, end);
                const isSurfaceMismatch = match.term.length > 0 && match.term !== surface;
                // Penalize deinflected surface mismatches slightly to reduce over-greedy tails.
                const mismatchPenalty = isSurfaceMismatch ? Math.ceil(match.length * 0.75) : 0;
                const score = match.length * match.length - mismatchPenalty;

                const candidate: SegmentCandidate = { to: end, score, match };
                const existing = byEnd.get(end);
                if (!existing || candidate.score > existing.score) {
                    byEnd.set(end, candidate);
                }
            }

            if (byEnd.size === 0) {
                const char = line.substring(start, start + 1);
                byEnd.set(start + 1, {
                    to: start + 1,
                    // Strongly discourage fallback when dictionary matches exist.
                    score: -100,
                    match: {
                        length: 1,
                        entries: [],
                        term: char,
                        reading: '',
                    },
                });
            }

            candidatesAt[start] = [...byEnd.values()];
        }

        const bestScore = Array<number>(n + 1).fill(Number.NEGATIVE_INFINITY);
        const bestChoice = Array<SegmentCandidate | null>(n + 1).fill(null);
        bestScore[n] = 0;

        for (let i = n - 1; i >= 0; --i) {
            for (const candidate of candidatesAt[i]) {
                const continuation = bestScore[candidate.to];
                if (!Number.isFinite(continuation)) {
                    continue;
                }

                // Small per-token penalty to prefer fewer, longer segments.
                const score = candidate.score + continuation - 1;
                const previous = bestScore[i];
                const previousChoice = bestChoice[i];

                const isBetter =
                    score > previous ||
                    (score === previous &&
                        previousChoice !== null &&
                        candidate.match.length > previousChoice.match.length);

                if (isBetter || previousChoice === null) {
                    bestScore[i] = score;
                    bestChoice[i] = candidate;
                }
            }
        }

        const segments: ParsedSegment[] = [];
        let position = 0;

        while (position < n) {
            const choice = bestChoice[position];
            if (!choice || choice.to <= position) {
                // Safety fallback if DP path is unexpectedly incomplete.
                const char = line.substring(position, position + 1);
                segments.push({
                    text: char,
                    reading: '',
                    term: char,
                    entries: [],
                    furigana: [{ text: char, reading: '' }],
                });
                position += char.length;
                continue;
            }

            const surfaceText = line.substring(position, choice.to);
            const furigana =
                language === 'ja'
                    ? distributeFurigana(surfaceText, choice.match.reading)
                    : [{ text: surfaceText, reading: '' }];

            segments.push({
                text: surfaceText,
                reading: choice.match.reading,
                term: choice.match.term,
                entries: choice.match.entries,
                furigana,
            });

            position = choice.to;
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
