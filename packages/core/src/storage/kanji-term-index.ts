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

/** Upstream's `Translator._getFrequencyInfo`, restricted to values that have a number in them. */
function readFrequency(
    data: DDB.DatabaseTermMetaFrequency['data'],
): { reading: string; frequency: number; displayValue?: string } | null {
    const withReading = typeof data === 'object' && 'frequency' in data ? data : null;
    const reading = withReading?.reading ?? '';
    const value =
        withReading === null ? (data as DDB.TermMetaFrequencyDataWithReading['frequency']) : withReading.frequency;
    if (typeof value === 'number') {
        return { reading, frequency: value };
    }
    if (typeof value === 'string') {
        const match = /[+-]?\d+(?:\.\d+)?/.exec(value);
        return match === null ? null : { reading, frequency: Number.parseFloat(match[0]), displayValue: value };
    }
    return typeof value.value === 'number'
        ? { reading, frequency: value.value, displayValue: value.displayValue }
        : null;
}

/**
 * The index rows of one dictionary: per kanji, the {@link KANJI_TERM_INDEX_SIZE} most frequent terms
 * containing it, best first, one entry per distinct term (its best frequency). Frequencies of kana
 * spellings (`displayValue` marked with ㋕) are skipped, so a word is not ranked by how often it is
 * written in kana. `rank-based` dictionaries (the default) rank lower values first; `occurrence-based`
 * ones rank higher values first. The result ends with the marker row.
 */
export function buildKanjiTermRows(
    dictionary: string,
    termMeta: Iterable<Record<string, unknown>>,
    frequencyMode: 'rank-based' | 'occurrence-based' | undefined,
): KanjiTermRow[] {
    const direction = frequencyMode === 'occurrence-based' ? -1 : 1;
    // Best first; ties by term so results are stable.
    const compare = (a: KanjiTerm, b: KanjiTerm) =>
        direction * (a.frequency - b.frequency) || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0);

    const best = new Map<string, KanjiTerm>();
    for (const row of termMeta) {
        const { expression, mode, data } = row as unknown as DDB.DatabaseTermMeta;
        if (mode !== 'freq' || kanjiOf(expression).size === 0) {
            continue;
        }
        const info = readFrequency(data);
        if (info === null || info.displayValue?.includes(KANA_SPELLING_MARKER)) {
            continue;
        }
        const candidate: KanjiTerm = { term: expression, ...info };
        const current = best.get(expression);
        if (current === undefined || compare(candidate, current) < 0) {
            best.set(expression, candidate);
        }
    }

    const byKanji = new Map<string, KanjiTerm[]>();
    for (const entry of best.values()) {
        for (const kanji of kanjiOf(entry.term)) {
            const list = byKanji.get(kanji);
            if (list === undefined) {
                byKanji.set(kanji, [entry]);
            } else {
                list.push(entry);
            }
        }
    }
    const rows: KanjiTermRow[] = [];
    for (const [character, terms] of byKanji) {
        rows.push({ dictionary, character, terms: terms.sort(compare).slice(0, KANJI_TERM_INDEX_SIZE) });
    }
    rows.push({ dictionary, character: '', terms: [] });
    return rows;
}
