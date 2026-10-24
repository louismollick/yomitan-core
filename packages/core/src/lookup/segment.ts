/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Lattice segmentation: splits a text into words by the cheapest path through every dictionary match,
 * instead of the greedy longest match of `parseText`. Tuned for Japanese.
 */

import { isCodePointJapanese } from '../upstream/ext/js/language/ja/japanese.js';
import type { TermDictionaryEntry } from '../upstream/types/ext/dictionary';
import { type ParseToken, type TextRange, describeMatch } from './text-lookup';

/** A token of `lookup.segment`: a `ParseToken` plus the term entries for its span (`[]` if unmatched). */
export type SegmentToken = ParseToken & { entries: TermDictionaryEntry[] };

/** A dictionary match starting at some offset, `length` UTF-16 units long. Lower cost is better. */
export type Edge = { length: number; cost: number };

/** A span of the chosen path; unmatched characters are merged into one step. */
export type PathStep = { start: number; end: number; matched: boolean };

/** What an unmatched character costs on a path, by script. */
export type UnmatchedCost = { japanese: number; other: number };

/** A headword the dictionary matches at the start of a text, over `length` UTF-16 units of it. */
export type DictionaryMatch = { term: string; reading: string; length: number; deinflected: boolean };

/** One frequency of a term. `reading` is only meaningful when `hasReading`. */
export type TermFrequencyRecord = { term: string; reading: string | null; hasReading: boolean; frequency: number };

/**
 * What segmenting needs from the engine. `matches` must be every headword matched at the start of the
 * text at every length (the Translator drops all but the longest match per database entry, so a
 * grouped lookup is not enough). `frequencies` is null without a usable frequency dictionary.
 * `entries` is a group-mode lookup of just the span, untruncated.
 */
export type SegmentLookup = {
    matches(text: string): Promise<DictionaryMatch[]>;
    frequencies: ((terms: string[]) => Promise<TermFrequencyRecord[]>) | null;
    entries(span: string): Promise<TermDictionaryEntry[]>;
};

export type SegmentOptions = {
    /** How many characters to look ahead (`scanning.length`). */
    scanLength: number;
    /** Entries kept per token (`general.maxResults`). */
    maxResults: number;
    /** Look up at letters and digits too, for words like Tシャツ (`scanning.alphanumeric`). */
    alphanumeric: boolean;
};

/** Cost of one Japanese character no dictionary word covers. Beats any word, even an unranked one. */
export const UNKNOWN_COST = 20;
/** Added to every word's `ln(rank)`: splitting a span in two must pay for the extra word. */
const WORD_COST = 6;
/** Extra cost of a match that needed deinflection or a text variant (as opposed to the literal text). */
const DEINFLECTED_COST = 1.5;
/** Rank assumed for a matched headword the frequency dictionary does not list. */
const UNRANKED = 200_000;
/** Costs closer than this are ties. */
const EPSILON = 1e-9;

/**
 * The cheapest way to cover `text` with `candidates[i]` (the matches starting at UTF-16 offset `i`;
 * missing means none). Characters no match covers cost `unmatched` by script. Ties go to the longer
 * first word. Returns consecutive steps covering the whole text.
 */
export function cheapestPath(
    text: string,
    candidates: readonly (readonly Edge[] | undefined)[],
    unmatched: UnmatchedCost = { japanese: UNKNOWN_COST, other: 0 },
): PathStep[] {
    const n = text.length;
    const best = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const step = new Array<{ length: number; matched: boolean }>(n);
    best[n] = 0;
    for (let i = n - 1; i >= 0; i--) {
        const codePoint = text.codePointAt(i) as number;
        const width = codePoint > 0xffff ? 2 : 1;
        best[i] = (isCodePointJapanese(codePoint) ? unmatched.japanese : unmatched.other) + best[i + width];
        step[i] = { length: width, matched: false };
        for (const { length, cost } of candidates[i] ?? []) {
            if (i + length > n) {
                continue;
            }
            const total = cost + best[i + length];
            if (total < best[i] - EPSILON || (total <= best[i] + EPSILON && length >= step[i].length)) {
                best[i] = total;
                step[i] = { length, matched: true };
            }
        }
    }
    const path: PathStep[] = [];
    for (let i = 0; i < n; ) {
        const { length, matched } = step[i];
        const previous = path[path.length - 1];
        if (!matched && previous !== undefined && !previous.matched) {
            previous.end += length;
        } else {
            path.push({ start: i, end: i + length, matched });
        }
        i += length;
    }
    return path;
}

/**
 * A rank lookup for headwords from a frequency dictionary's records: the headword's own frequency
 * (its reading's, or one that names no reading), else the term's best across readings.
 */
export function createRankLookup(
    records: readonly TermFrequencyRecord[],
): (term: string, reading: string) => number | undefined {
    const byTerm = new Map<string, TermFrequencyRecord[]>();
    for (const record of records) {
        if (record.frequency > 0) {
            byTerm.set(record.term, [...(byTerm.get(record.term) ?? []), record]);
        }
    }
    const best = (list: readonly TermFrequencyRecord[]) =>
        list.length === 0 ? undefined : Math.min(...list.map(({ frequency }) => frequency));
    return (term, reading) => {
        const all = byTerm.get(term) ?? [];
        return best(all.filter((record) => !record.hasReading || record.reading === reading)) ?? best(all);
    };
}

/**
 * The cost of the cheapest word per matched length: `ln(rank) + 6` (plus a deinflection penalty) for
 * the best-ranked headword, with `UNRANKED` for headwords the dictionary does not list. With no `rank`
 * lookup every word costs 1, so the cheapest path is the one with the fewest words.
 */
export function wordCosts(
    matches: readonly DictionaryMatch[],
    rank: ((term: string, reading: string) => number | undefined) | null,
): Map<number, number> {
    const costs = new Map<number, number>();
    for (const { term, reading, length, deinflected } of matches) {
        const cost =
            rank === null
                ? 1
                : Math.log(rank(term, reading) ?? UNRANKED) + WORD_COST + (deinflected ? DEINFLECTED_COST : 0);
        costs.set(length, Math.min(cost, costs.get(length) ?? Number.POSITIVE_INFINITY));
    }
    return costs;
}

/** The entries with a headword matched exactly over `length` units (what a lookup of just that span shows). */
function entriesForLength(entries: readonly TermDictionaryEntry[], length: number): TermDictionaryEntry[] {
    return entries.filter((entry) =>
        entry.headwords.some((headword) =>
            headword.sources.some(
                (source) => source.matchType === 'exact' && source.isPrimary && source.originalText.length === length,
            ),
        ),
    );
}

const ALPHANUMERIC = /[\p{L}\p{N}]/u;

/**
 * Splits `text` into words by the cheapest path through all dictionary matches. Unmatched characters
 * are merged into entry-less tokens, as `parseText` does. They cost something so that a mixed-script
 * word (Tシャツ) beats its parts: 20 per Japanese character, and a word's base cost for the rest.
 */
export async function segmentText(
    text: string,
    options: SegmentOptions,
    lookup: SegmentLookup,
): Promise<SegmentToken[]> {
    const { scanLength, maxResults, alphanumeric } = options;
    const matches: (DictionaryMatch[] | undefined)[] = [];
    for (let i = 0; i < text.length; i += (text.codePointAt(i) as number) > 0xffff ? 2 : 1) {
        const codePoint = text.codePointAt(i) as number;
        if (isCodePointJapanese(codePoint) || (alphanumeric && ALPHANUMERIC.test(String.fromCodePoint(codePoint)))) {
            matches[i] = await lookup.matches(text.substring(i, i + scanLength));
        }
    }
    let rank: ReturnType<typeof createRankLookup> | null = null;
    if (lookup.frequencies !== null) {
        const terms = new Set<string>();
        for (const found of matches) {
            for (const { term } of found ?? []) {
                terms.add(term);
            }
        }
        rank = createRankLookup(await lookup.frequencies([...terms]));
    }
    const candidates = matches.map((found) =>
        found === undefined ? undefined : [...wordCosts(found, rank)].map(([length, cost]): Edge => ({ length, cost })),
    );
    const path = cheapestPath(text, candidates, { japanese: UNKNOWN_COST, other: rank === null ? 1 : WORD_COST });
    const tokens: SegmentToken[] = [];
    for (const { start, end, matched } of path) {
        const span = text.substring(start, end);
        const entries = matched ? entriesForLength(await lookup.entries(span), end - start).slice(0, maxResults) : [];
        const match = entries.length > 0 ? describeMatch(entries, span) : undefined;
        tokens.push(
            match === undefined || match.segments.length === 0
                ? { text: span, range: { start, end }, segments: [{ text: span, reading: '' }], entries: [] }
                : { text: span, range: { start, end }, segments: match.segments, headwords: match.headwords, entries },
        );
    }
    return tokens;
}

/** The token whose range contains `offset` (UTF-16), or undefined. Works on `parse` tokens too. */
export function tokenAt<T extends { range: TextRange }>(tokens: readonly T[], offset: number): T | undefined {
    return tokens.find(({ range }) => offset >= range.start && offset < range.end);
}
