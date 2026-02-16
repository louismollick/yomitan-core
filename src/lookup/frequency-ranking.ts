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

import type { DictionaryDB } from '../database/dictionary-database';
import type * as DictionaryData from '../types/dictionary-data';
import type * as DictionaryDatabase from '../types/dictionary-database';

export interface FrequencyRanking {
    /** Per-dictionary frequency data. */
    frequencies: { dictionary: string; frequency: number; displayValue: string | null }[];
    /** The harmonic mean across all dictionaries with positive frequency. */
    harmonicMean: number;
}

/**
 * Queries term frequency metadata from the database and computes
 * aggregate frequency rankings across multiple dictionaries.
 */
export class FrequencyRanker {
    private _db: DictionaryDB;
    private _numberRegex: RegExp;

    constructor(db: DictionaryDB) {
        this._db = db;
        this._numberRegex = /[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/;
    }

    /**
     * Gets the frequency ranking for a term across all dictionaries that
     * have frequency metadata for it.
     *
     * @param term The term to look up.
     * @param dictionaries The set of dictionary names to query.
     * @param reading Optional reading to filter frequency data. If not provided,
     *   all frequency entries for the term are included.
     * @returns A FrequencyRanking object with per-dictionary frequencies and a harmonic mean.
     */
    async getFrequencyRanking(term: string, dictionaries: string[], reading?: string): Promise<FrequencyRanking> {
        const dictionarySet = new Set(dictionaries);
        const metas = await this._db.findTermMetaBulk([term], dictionarySet);

        const frequencyMap = new Map<string, { frequency: number; displayValue: string | null }>();

        for (const meta of metas) {
            if (meta.mode !== 'freq') {
                continue;
            }

            const freqMeta = meta as DictionaryDatabase.TermMetaFrequency;
            const { data, dictionary } = freqMeta;

            const hasReading =
                data !== null &&
                typeof data === 'object' &&
                typeof (data as DictionaryData.TermMetaFrequencyDataWithReading).reading === 'string';

            if (hasReading) {
                const dataWithReading = data as DictionaryData.TermMetaFrequencyDataWithReading;
                if (typeof reading === 'string' && dataWithReading.reading !== reading) {
                    continue;
                }
                const { frequency, displayValue } = this._getFrequencyInfo(dataWithReading.frequency);
                const existing = frequencyMap.get(dictionary);
                if (typeof existing === 'undefined' || frequency < existing.frequency) {
                    frequencyMap.set(dictionary, { frequency, displayValue });
                }
            } else {
                const { frequency, displayValue } = this._getFrequencyInfo(data as DictionaryData.GenericFrequencyData);
                const existing = frequencyMap.get(dictionary);
                if (typeof existing === 'undefined' || frequency < existing.frequency) {
                    frequencyMap.set(dictionary, { frequency, displayValue });
                }
            }
        }

        const frequencies: { dictionary: string; frequency: number; displayValue: string | null }[] = [];
        for (const [dictionary, { frequency, displayValue }] of frequencyMap.entries()) {
            frequencies.push({ dictionary, frequency, displayValue });
        }

        const harmonicMean = this._computeHarmonicMean(frequencies.map((f) => f.frequency));

        return { frequencies, harmonicMean };
    }

    /**
     * Gets frequency rankings for multiple terms at once.
     */
    async getFrequencyRankingBulk(terms: string[], dictionaries: string[]): Promise<Map<string, FrequencyRanking>> {
        const results = new Map<string, FrequencyRanking>();
        const dictionarySet = new Set(dictionaries);
        const metas = await this._db.findTermMetaBulk(terms, dictionarySet);

        // Group by term
        const termMetaMap = new Map<string, DictionaryDatabase.TermMeta[]>();
        for (const meta of metas) {
            const term = terms[meta.index];
            let termMetas = termMetaMap.get(term);
            if (typeof termMetas === 'undefined') {
                termMetas = [];
                termMetaMap.set(term, termMetas);
            }
            termMetas.push(meta);
        }

        for (const [term, termMetas] of termMetaMap.entries()) {
            const frequencyMap = new Map<string, { frequency: number; displayValue: string | null }>();

            for (const meta of termMetas) {
                if (meta.mode !== 'freq') {
                    continue;
                }

                const freqMeta = meta as DictionaryDatabase.TermMetaFrequency;
                const { data, dictionary } = freqMeta;

                const hasReading =
                    data !== null &&
                    typeof data === 'object' &&
                    typeof (data as DictionaryData.TermMetaFrequencyDataWithReading).reading === 'string';
                const frequency = hasReading
                    ? (data as DictionaryData.TermMetaFrequencyDataWithReading).frequency
                    : (data as DictionaryData.GenericFrequencyData);

                const { frequency: freqValue, displayValue } = this._getFrequencyInfo(frequency);
                const existing = frequencyMap.get(dictionary);
                if (typeof existing === 'undefined' || freqValue < existing.frequency) {
                    frequencyMap.set(dictionary, { frequency: freqValue, displayValue });
                }
            }

            const frequencies: { dictionary: string; frequency: number; displayValue: string | null }[] = [];
            for (const [dictionary, { frequency, displayValue }] of frequencyMap.entries()) {
                frequencies.push({ dictionary, frequency, displayValue });
            }

            const harmonicMean = this._computeHarmonicMean(frequencies.map((f) => f.frequency));
            results.set(term, { frequencies, harmonicMean });
        }

        return results;
    }

    /**
     * Computes the harmonic mean of positive frequency values.
     */
    private _computeHarmonicMean(values: number[]): number {
        if (values.length === 0) {
            return 0;
        }
        let sum = 0;
        let count = 0;
        for (const freq of values) {
            if (freq <= 0) {
                continue;
            }
            sum += 1 / freq;
            count++;
        }
        return sum > 0 ? Math.round(count / sum) : 0;
    }

    /**
     * Extracts numeric frequency value and display string from generic frequency data.
     */
    private _getFrequencyInfo(frequency: DictionaryData.GenericFrequencyData): {
        frequency: number;
        displayValue: string | null;
    } {
        let frequencyValue = 0;
        let displayValue: string | null = null;
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
                    frequencyValue = this._convertStringToNumber(frequency);
                    break;
            }
        }
        return { frequency: frequencyValue, displayValue };
    }

    /**
     * Converts a string to a number by extracting the first numeric value.
     */
    private _convertStringToNumber(value: string): number {
        const match = this._numberRegex.exec(value);
        if (match === null) {
            return 0;
        }
        const result = Number.parseFloat(match[0]);
        return Number.isFinite(result) ? result : 0;
    }
}
