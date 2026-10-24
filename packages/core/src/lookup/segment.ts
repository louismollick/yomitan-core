/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Lattice segmentation: splits a text into words by the cheapest path through every dictionary match,
 * instead of the greedy longest match of `parseText`. Tuned for Japanese.
 */

import { isCodePointJapanese } from '../upstream/ext/js/language/ja/japanese.js';
import type { TermDictionaryEntry } from '../upstream/types/ext/dictionary';
import type { ProfileOptions } from '../upstream/types/ext/settings';
import { type FindTerms, type ParseToken, type TextRange, describeMatch } from './text-lookup';

/** A token of `lookup.segment`: a `ParseToken` plus the term entries for its span (`[]` if unmatched). */
export type SegmentToken = ParseToken & { entries: TermDictionaryEntry[] };

/** A dictionary match starting at some offset, `length` UTF-16 units long. Lower cost is better. */
export type Edge = { length: number; cost: number };

/** A span of the chosen path; unmatched characters are merged into one step. */
export type PathStep = { start: number; end: number; matched: boolean };

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
 * missing means none). A character with no match costs `UNKNOWN_COST` if Japanese, else nothing.
 * Ties go to the longer first word. Returns consecutive steps covering the whole text.
 */
export function cheapestPath(text: string, candidates: readonly (readonly Edge[] | undefined)[]): PathStep[] {
    const n = text.length;
    const best = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const step = new Array<{ length: number; matched: boolean }>(n);
    best[n] = 0;
    for (let i = n - 1; i >= 0; i--) {
        const codePoint = text.codePointAt(i) as number;
        const width = codePoint > 0xffff ? 2 : 1;
        best[i] = (isCodePointJapanese(codePoint) ? UNKNOWN_COST : 0) + best[i + width];
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
 * How frequent `entries`' headwords make a word, as a cost per matched length: `ln(rank) + 6` (plus a
 * deinflection penalty) for the best-ranked headword matched exactly over that length. Only
 * `frequencyDictionary`'s rank-based frequencies count; an occurrence-based dictionary has no rank to
 * use. A headword without a frequency uses the entry's best, then `UNRANKED`. With no frequency
 * dictionary every word costs 1, so the cheapest path is the one with the fewest words.
 */
export function wordCosts(
    entries: readonly TermDictionaryEntry[],
    frequencyDictionary: string | null,
): Map<number, number> {
    const costs = new Map<number, number>();
    for (const entry of entries) {
        const ranks = frequencyDictionary === null ? new Map<number, number>() : entryRanks(entry, frequencyDictionary);
        const bestRank = Math.min(...ranks.values());
        for (const headword of entry.headwords) {
            const rank = ranks.get(headword.headwordIndex) ?? bestRank;
            for (const source of headword.sources) {
                if (source.matchType !== 'exact' || !source.isPrimary) {
                    continue;
                }
                const length = source.originalText.length;
                const cost =
                    frequencyDictionary === null
                        ? 1
                        : Math.log(Number.isFinite(rank) ? rank : UNRANKED) +
                          WORD_COST +
                          (source.deinflectedText === source.originalText ? 0 : DEINFLECTED_COST);
                costs.set(length, Math.min(cost, costs.get(length) ?? Number.POSITIVE_INFINITY));
            }
        }
    }
    return costs;
}

/** The best (lowest) usable rank per headword index for `dictionary`. */
function entryRanks(entry: TermDictionaryEntry, dictionary: string): Map<number, number> {
    const ranks = new Map<number, number>();
    for (const { dictionary: name, frequencyMode, frequency, headwordIndex } of entry.frequencies) {
        if (name === dictionary && frequencyMode !== 'occurrence-based' && frequency > 0) {
            ranks.set(headwordIndex, Math.min(frequency, ranks.get(headwordIndex) ?? Number.POSITIVE_INFINITY));
        }
    }
    return ranks;
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

/**
 * Splits `text` into words by the cheapest path through all dictionary matches. `findTerms` must look
 * up in `group` mode without truncation, so one lookup per Japanese character returns the matches of
 * every length. Unmatched characters are merged into entry-less tokens, as `parseText` does.
 */
export async function segmentText(
    text: string,
    options: ProfileOptions,
    findTerms: FindTerms,
    frequencyDictionary: string | null,
): Promise<SegmentToken[]> {
    const scanLength = options.scanning.length;
    const found: (TermDictionaryEntry[] | undefined)[] = [];
    const candidates: (Edge[] | undefined)[] = [];
    for (let i = 0; i < text.length; i += (text.codePointAt(i) as number) > 0xffff ? 2 : 1) {
        if (!isCodePointJapanese(text.codePointAt(i) as number)) {
            continue;
        }
        const { dictionaryEntries } = await findTerms(text.substring(i, i + scanLength), {
            matchType: 'exact',
            deinflect: true,
        });
        found[i] = dictionaryEntries;
        candidates[i] = [...wordCosts(dictionaryEntries, frequencyDictionary)].map(([length, cost]) => ({
            length,
            cost,
        }));
    }
    const maxResults = options.general.maxResults;
    return cheapestPath(text, candidates).map(({ start, end, matched }): SegmentToken => {
        const span = text.substring(start, end);
        const entries = matched ? entriesForLength(found[start] ?? [], end - start).slice(0, maxResults) : [];
        const match = entries.length > 0 ? describeMatch(entries, span) : undefined;
        if (match === undefined || match.segments.length === 0) {
            return { text: span, range: { start, end }, segments: [{ text: span, reading: '' }], entries: [] };
        }
        return { text: span, range: { start, end }, segments: match.segments, headwords: match.headwords, entries };
    });
}

/** The token whose range contains `offset` (UTF-16), or undefined. Works on `parse` tokens too. */
export function tokenAt<T extends { range: TextRange }>(tokens: readonly T[], offset: number): T | undefined {
    return tokens.find(({ range }) => offset >= range.start && offset < range.end);
}
