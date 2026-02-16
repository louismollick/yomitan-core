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

import type { TermDictionaryEntry } from '../types/dictionary';
import type { FindTermDictionary } from '../types/translation';
import type { FindTermsMode, Translator } from './translator';

export interface BatchLookupConfig {
    /** The language code for the lookup. Defaults to 'ja'. */
    language?: string;
    /** The enabled dictionary map for lookups. */
    enabledDictionaryMap: Map<string, { index: number; priority: number }>;
    /** Maximum number of concurrent lookups. Defaults to 5. */
    concurrency?: number;
    /** The find terms mode. Defaults to 'group'. */
    mode?: FindTermsMode;
}

export interface BatchResult {
    /** The original input text. */
    text: string;
    /** The dictionary entries found for this text. */
    entries: TermDictionaryEntry[];
    /** The length of the original text that was matched. */
    originalTextLength: number;
}

/**
 * Processes multiple text lookups in batch with optional concurrency limiting.
 * Shares the translator's tag cache across lookups for improved performance.
 */
export class BatchProcessor {
    private _translator: Translator;

    constructor(translator: Translator) {
        this._translator = translator;
    }

    /**
     * Looks up multiple texts and returns a map of text to results.
     * Texts are deduplicated before lookup. Concurrency is limited by the
     * `concurrency` config option.
     */
    async batchLookup(texts: string[], config: BatchLookupConfig): Promise<Map<string, BatchResult>> {
        const language = config.language ?? 'ja';
        const concurrency = config.concurrency ?? 5;
        const mode = config.mode ?? 'group';
        const enabledDictionaryMap = this._buildFindTermDictionaryMap(config.enabledDictionaryMap);

        // Deduplicate texts
        const uniqueTexts = [...new Set(texts)];
        const results = new Map<string, BatchResult>();

        // Process in batches with concurrency limiting
        for (let i = 0; i < uniqueTexts.length; i += concurrency) {
            const batch = uniqueTexts.slice(i, i + concurrency);
            const promises = batch.map(async (text) => {
                const result = await this._lookupSingle(text, language, mode, enabledDictionaryMap);
                results.set(text, result);
            });
            await Promise.all(promises);
        }

        return results;
    }

    /**
     * Performs a single text lookup.
     */
    private async _lookupSingle(
        text: string,
        language: string,
        mode: FindTermsMode,
        enabledDictionaryMap: Map<string, FindTermDictionary>,
    ): Promise<BatchResult> {
        const options = {
            matchType: 'exact' as const,
            deinflect: true,
            primaryReading: '',
            mainDictionary: '',
            sortFrequencyDictionary: null,
            sortFrequencyDictionaryOrder: 'descending' as const,
            removeNonJapaneseCharacters:
                language === 'ja' || language === 'zh' || language === 'yue' || language === 'ko',
            textReplacements: [null] as null[],
            enabledDictionaryMap,
            excludeDictionaryDefinitions: null,
            searchResolution: 'letter' as const,
            language,
        };

        try {
            const { dictionaryEntries, originalTextLength } = await this._translator.findTerms(mode, text, options);
            return {
                text,
                entries: dictionaryEntries,
                originalTextLength,
            };
        } catch {
            return {
                text,
                entries: [],
                originalTextLength: 0,
            };
        }
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
}
