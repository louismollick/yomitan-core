/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Scanning at a position (TextScanner._findTermDictionaryEntries) and whole-text parsing
 * (Backend._textParseScanning), for plain text.
 */

import { distributeFuriganaInflected, isCodePointJapanese } from '../upstream/ext/js/language/ja/japanese.js';
import type { TermDictionaryEntry } from '../upstream/types/ext/dictionary';
import type { ProfileOptions } from '../upstream/types/ext/settings';
import { PlainTextSource, type Sentence, createSentenceParsingSettings, extractSentence } from './text-source';

/** A half-open UTF-16 range `[start, end)` in the text that was scanned or parsed. */
export type TextRange = { start: number; end: number };

export type FindTerms = (
    text: string,
    details?: { matchType?: 'exact'; deinflect?: boolean },
) => Promise<{ dictionaryEntries: TermDictionaryEntry[]; originalTextLength: number }>;

/** Upstream's `TextScanner` does not expand to word starts for these languages. */
const SCAN_RESOLUTION_EXCLUDED_LANGUAGES = new Set(['ja', 'zh', 'yue', 'ko']);

export type ScanResult = {
    entries: TermDictionaryEntry[];
    /** The text that matched, in the scanned text's UTF-16 offsets. */
    range: TextRange;
    sentence: Sentence;
};

/**
 * What Yomitan does when the pointer lands on `offset`: look up the next `scanning.length`
 * characters (after moving to the word start for space-separated languages), then extract the
 * sentence around the match.
 */
export async function scanText(
    text: string,
    offset: number,
    options: ProfileOptions,
    findTerms: FindTerms,
): Promise<ScanResult | null> {
    const scanLength = options.scanning.length;
    const source = new PlainTextSource(text, clampOffset(text, offset));
    if (
        options.scanning.scanResolution === 'word' &&
        !SCAN_RESOLUTION_EXCLUDED_LANGUAGES.has(options.general.language)
    ) {
        source.setStartOffset(scanLength, true);
    }
    const searchSource = source.clone();
    searchSource.setEndOffset(scanLength);
    const searchText = searchSource.content();
    if (searchText.length === 0) {
        return null;
    }
    const { dictionaryEntries, originalTextLength } = await findTerms(searchText);
    if (dictionaryEntries.length === 0) {
        return null;
    }
    // Upstream passes originalTextLength (UTF-16 units) as a character count here; kept for parity.
    source.setEndOffset(originalTextLength);
    const sentence = extractSentence(source, createSentenceParsingSettings(options.sentenceParsing));
    return { entries: dictionaryEntries, range: { start: source.start, end: source.end }, sentence };
}

/** The sentence around `[offset, offset + length)` under the profile's sentence parsing rules. */
export function sentenceAt(text: string, offset: number, length: number, options: ProfileOptions): Sentence {
    const source = new PlainTextSource(text, clampOffset(text, offset));
    source.setEndOffset(length);
    return extractSentence(source, createSentenceParsingSettings(options.sentenceParsing));
}

export type ParseSegment = { text: string; reading: string };

export type ParseHeadword = {
    term: string;
    reading: string;
    sources: TermDictionaryEntry['headwords'][number]['sources'];
    frequencies: TermDictionaryEntry['frequencies'];
    pronunciations: TermDictionaryEntry['pronunciations'];
};

export type ParseToken = {
    /** The token's text in the parsed text; its segments join to this. */
    text: string;
    range: TextRange;
    /** Furigana segments, as Yomitan's "parse text" feature shows them. Readings are empty for kana. */
    segments: ParseSegment[];
    /** Present when the token matched dictionary entries. */
    headwords?: ParseHeadword[][];
};

/**
 * Port of upstream's scanning parser (`Backend._textParseScanning`): repeatedly looks up the longest
 * term at the current position; unmatched characters are merged into plain segments.
 */
export async function parseText(text: string, options: ProfileOptions, findTerms: FindTerms): Promise<ParseToken[]> {
    const scanLength = options.scanning.length;
    const tokens: ParseToken[] = [];
    let previousUngrouped: ParseToken | null = null;
    let i = 0;
    while (i < text.length) {
        const codePoint = text.codePointAt(i) as number;
        const character = String.fromCodePoint(codePoint);
        const substring = text.substring(i, i + scanLength);
        const { dictionaryEntries, originalTextLength } = await findTerms(substring, {
            matchType: 'exact',
            deinflect: true,
        });
        const segments: ParseSegment[] = [];
        let headwords: ParseHeadword[][] | undefined;
        if (
            dictionaryEntries.length > 0 &&
            originalTextLength > 0 &&
            (originalTextLength !== character.length || isCodePointJapanese(codePoint))
        ) {
            const {
                headwords: [{ term, reading }],
            } = dictionaryEntries[0];
            const source = substring.substring(0, originalTextLength);
            for (const segment of distributeFuriganaInflected(term, reading, source) as ParseSegment[]) {
                segments.push({ text: segment.text, reading: segment.reading });
            }
            if (segments.length > 0) {
                const token = segments.map((segment) => segment.text).join('');
                headwords = [];
                for (const dictionaryEntry of dictionaryEntries) {
                    const valid: ParseHeadword[] = [];
                    for (const headword of dictionaryEntry.headwords) {
                        const sources = headword.sources.filter(
                            (src) => src.originalText === token && src.isPrimary && src.matchType === 'exact',
                        );
                        if (sources.length > 0) {
                            valid.push({
                                term: headword.term,
                                reading: headword.reading,
                                sources,
                                frequencies: dictionaryEntry.frequencies.filter(
                                    (f) => f.headwordIndex === headword.headwordIndex,
                                ),
                                pronunciations: dictionaryEntry.pronunciations.filter(
                                    (p) => p.headwordIndex === headword.headwordIndex,
                                ),
                            });
                        }
                    }
                    if (valid.length > 0) {
                        headwords.push(valid);
                    }
                }
            }
        }
        if (segments.length > 0) {
            previousUngrouped = null;
            const tokenText = segments.map((segment) => segment.text).join('');
            tokens.push({
                text: tokenText,
                range: { start: i, end: i + originalTextLength },
                segments,
                ...(headwords === undefined ? {} : { headwords }),
            });
            i += originalTextLength;
        } else {
            if (previousUngrouped === null) {
                previousUngrouped = {
                    text: character,
                    range: { start: i, end: i + character.length },
                    segments: [{ text: character, reading: '' }],
                };
                tokens.push(previousUngrouped);
            } else {
                previousUngrouped.text += character;
                previousUngrouped.range.end += character.length;
                previousUngrouped.segments[0].text += character;
            }
            i += character.length;
        }
    }
    return tokens;
}

function clampOffset(text: string, offset: number): number {
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
        throw new RangeError(`Offset ${offset} is outside the text (length ${text.length})`);
    }
    return offset;
}
