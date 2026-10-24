/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The kanji-term index: for each frequency dictionary and kanji, the most frequent terms that contain
 * that kanji. It is derived from the dictionary's term `freq` meta (not part of Yomitan's schema),
 * built when the dictionary is imported, and deleted with it.
 */

import { isCodePointKanji } from '../upstream/ext/js/language/ja/japanese.js';
import type { DDB } from './types';

/** How many terms are kept per (dictionary, kanji). */
export const KANJI_TERM_INDEX_SIZE = 50;

/** A term that contains a kanji, with its frequency in one dictionary. */
export type KanjiTerm = {
    term: string;
    /** `''` when the frequency dictionary doesn't say which reading the frequency is for. */
    reading: string;
    /** The dictionary's frequency value: a rank (lower is more frequent) or an occurrence count. */
    frequency: number;
    displayValue?: string;
};

/** One row of the `kanjiTerms` store. The row with `character: ''` only marks the dictionary as indexed. */
export type KanjiTermRow = { dictionary: string; character: string; terms: KanjiTerm[] };

/** JPDB and Jiten mark the frequency of a word written in kana with this character in `displayValue`. */
const KANA_SPELLING_MARKER = '㋕';

/** The distinct kanji of `text`. 々 and other non-ideographs don't count. */
function kanjiOf(text: string): Set<string> {
    const result = new Set<string>();
    for (const character of text) {
        if (isCodePointKanji(character.codePointAt(0) as number)) {
            result.add(character);
        }
    }
    return result;
}

/** Whether `text` is exactly one kanji (CJK ideograph). */
export function isSingleKanji(text: string): boolean {
    const [first, ...rest] = text;
    return first !== undefined && rest.length === 0 && kanjiOf(first).size === 1;
}

/** Upstream's `Translator._numberRegex`: the first number in a frequency string (exponents, leading decimal). */
const NUMBER_PATTERN = /[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/;

/**
 * Upstream's `Translator._getFrequencyInfo`. Unlike upstream, which turns a value with no number in
 * it into 0, such rows are skipped: they have no rank to order by.
 */
function readFrequency(
    data: DDB.DatabaseTermMetaFrequency['data'],
): { reading: string; frequency: number; displayValue?: string } | null {
    const withReading = typeof data === 'object' && 'frequency' in data ? data : null;
    const reading = withReading?.reading ?? '';
    const value =
        withReading === null ? (data as DDB.TermMetaFrequencyDataWithReading['frequency']) : withReading.frequency;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? { reading, frequency: value } : null;
    }
    if (typeof value === 'string') {
        const match = NUMBER_PATTERN.exec(value);
        const frequency = match === null ? Number.NaN : Number.parseFloat(match[0]);
        return Number.isFinite(frequency) ? { reading, frequency, displayValue: value } : null;
    }
    return typeof value.value === 'number' && Number.isFinite(value.value)
        ? { reading, frequency: value.value, displayValue: value.displayValue }
        : null;
}

/**
 * Builds the index rows of one dictionary from its term `freq` meta, fed in any order and in batches.
 * Per kanji it keeps only the {@link KANJI_TERM_INDEX_SIZE} best terms seen so far, so memory does not
 * grow with the dictionary. That is exact: once a kanji's list is full its worst entry only improves,
 * so a term that was dropped (or is rejected later) could never have made the final list, and a
 * better frequency for a term that is kept replaces its entry.
 *
 * Terms are ranked by their best frequency, once each. Frequencies of kana spellings (`displayValue`
 * marked ㋕, as JPDB and Jiten do) are skipped, so a word is not ranked by how often it is written in
 * kana. `rank-based` dictionaries (the default) rank lower values first; `occurrence-based` ones
 * rank higher values first.
 */
export class KanjiTermIndexBuilder {
    private readonly byKanji = new Map<string, KanjiTerm[]>();
    private readonly direction: 1 | -1;

    constructor(frequencyMode: 'rank-based' | 'occurrence-based' | undefined) {
        this.direction = frequencyMode === 'occurrence-based' ? -1 : 1;
    }

    /** Best first; ties by term so results are stable. */
    private compare(a: KanjiTerm, b: KanjiTerm): number {
        return this.direction * (a.frequency - b.frequency) || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0);
    }

    add(row: Record<string, unknown>): void {
        const { expression, mode, data } = row as unknown as DDB.DatabaseTermMeta;
        if (mode !== 'freq') {
            return;
        }
        const kanji = kanjiOf(expression);
        const info = kanji.size === 0 ? null : readFrequency(data);
        if (info === null || info.displayValue?.includes(KANA_SPELLING_MARKER)) {
            return;
        }
        const candidate: KanjiTerm = { term: expression, ...info };
        for (const character of kanji) {
            let list = this.byKanji.get(character);
            if (list === undefined) {
                list = [];
                this.byKanji.set(character, list);
            }
            this.insert(list, candidate);
        }
    }

    addAll(rows: Iterable<Record<string, unknown>>): void {
        for (const row of rows) {
            this.add(row);
        }
    }

    private insert(list: KanjiTerm[], candidate: KanjiTerm): void {
        // Not better than the worst of a full list: it can't be in the top list, nor improve a member.
        if (list.length >= KANJI_TERM_INDEX_SIZE && this.compare(candidate, list[list.length - 1]) >= 0) {
            return;
        }
        const existing = list.findIndex(({ term }) => term === candidate.term);
        if (existing >= 0) {
            if (this.compare(candidate, list[existing]) >= 0) {
                return;
            }
            list.splice(existing, 1);
        }
        const position = list.findIndex((other) => this.compare(candidate, other) < 0);
        list.splice(position < 0 ? list.length : position, 0, candidate);
        if (list.length > KANJI_TERM_INDEX_SIZE) {
            list.pop();
        }
    }

    /** The rows of `dictionary`, ending with the marker row. */
    rows(dictionary: string): KanjiTermRow[] {
        const rows: KanjiTermRow[] = [];
        for (const [character, terms] of this.byKanji) {
            rows.push({ dictionary, character, terms });
        }
        rows.push({ dictionary, character: '', terms: [] });
        return rows;
    }
}

/** The index rows of one dictionary from all of its term meta at once (see {@link KanjiTermIndexBuilder}). */
export function buildKanjiTermRows(
    dictionary: string,
    termMeta: Iterable<Record<string, unknown>>,
    frequencyMode: 'rank-based' | 'occurrence-based' | undefined,
): KanjiTermRow[] {
    const builder = new KanjiTermIndexBuilder(frequencyMode);
    builder.addAll(termMeta);
    return builder.rows(dictionary);
}
