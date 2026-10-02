/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Plain-text equivalents of Yomitan's DOM text scanning (ext/js/dom/dom-text-scanner.js,
 * text-source-range.js, text-source-generator.js#extractSentence), for text that has no DOM.
 * Semantics follow upstream's defaults (`layoutAwareScan: false`, which preserves whitespace):
 * lengths count code points, and zero-width spaces, zero-width non-joiners and soft hyphens are
 * stepped over without being counted or included.
 */

/** Upstream's `DOMTextScanner.WORD_DELIMITER_REGEX`. */
const WORD_DELIMITER_REGEX = /[^\w\p{L}\p{N}]/u;

function isWordDelimiter(character: string): boolean {
    return WORD_DELIMITER_REGEX.test(character);
}

function isSingleQuote(character: string): boolean {
    switch (character.charCodeAt(0)) {
        case 0x27:
        case 0x2019:
        case 0x2032:
        case 0x2035:
        case 0x02bc:
            return true;
        default:
            return false;
    }
}

function isIgnored(character: string): boolean {
    switch (character.charCodeAt(0)) {
        case 0x200b:
        case 0x200c:
        case 0x00ad:
            return true;
        default:
            return false;
    }
}

function codePointAfter(text: string, offset: number): string {
    return String.fromCodePoint(text.codePointAt(offset) as number);
}

function codePointBefore(text: string, offset: number): string {
    const low = text.charCodeAt(offset - 1);
    if (offset >= 2 && low >= 0xdc00 && low <= 0xdfff) {
        const high = text.charCodeAt(offset - 2);
        if (high >= 0xd800 && high <= 0xdbff) {
            return text.slice(offset - 2, offset);
        }
    }
    return text[offset - 1];
}

type SeekResult = { offset: number; content: string; remainder: number };

/** Moves forward from `offset` over up to `length` counted characters. */
export function seekForward(text: string, offset: number, length: number): SeekResult {
    let content = '';
    let remainder = length;
    while (remainder > 0 && offset < text.length) {
        const character = codePointAfter(text, offset);
        offset += character.length;
        if (isIgnored(character)) {
            continue;
        }
        content += character;
        --remainder;
    }
    return { offset, content, remainder };
}

/**
 * Moves backward from `offset` over up to `length` counted characters. With `stopAtWordBoundary`,
 * stops before a word delimiter (an apostrophe inside a word such as "don't" is not a delimiter).
 */
export function seekBackward(text: string, offset: number, length: number, stopAtWordBoundary = false): SeekResult {
    let content = '';
    let remainder = length;
    while (remainder > 0 && offset > 0) {
        const character = codePointBefore(text, offset);
        if (stopAtWordBoundary && isWordDelimiter(character)) {
            if (
                !isSingleQuote(character) ||
                offset <= 1 ||
                isWordDelimiter(codePointBefore(text, offset - character.length))
            ) {
                break;
            }
        }
        offset -= character.length;
        if (isIgnored(character)) {
            continue;
        }
        content = character + content;
        --remainder;
    }
    return { offset, content, remainder };
}

/** A range of plain text, mirroring the parts of upstream's `TextSourceRange` that scanning uses. */
export class PlainTextSource {
    readonly text: string;
    start: number;
    end: number;

    constructor(text: string, start: number, end = start) {
        this.text = text;
        this.start = start;
        this.end = end;
    }

    clone(): PlainTextSource {
        return new PlainTextSource(this.text, this.start, this.end);
    }

    /** Moves the start backward; returns how many characters it moved. */
    setStartOffset(length: number, stopAtWordBoundary = false): number {
        const result = seekBackward(this.text, this.start, length, stopAtWordBoundary);
        this.start = result.offset;
        return length - result.remainder;
    }

    /** Moves the end forward from the start (or, with `fromEnd`, from the end); returns how far it moved. */
    setEndOffset(length: number, fromEnd = false): number {
        const result = seekForward(this.text, fromEnd ? this.end : this.start, length);
        this.end = result.offset;
        return length - result.remainder;
    }

    content(): string {
        let content = '';
        for (let offset = this.start; offset < this.end; ) {
            const character = codePointAfter(this.text, offset);
            offset += character.length;
            if (!isIgnored(character)) {
                content += character;
            }
        }
        return content;
    }
}

export type SentenceParsingSettings = {
    extent: number;
    terminateAtNewlines: boolean;
    /** Character → [include at start, include at end]. */
    terminatorMap: Map<string, [boolean, boolean]>;
    /** Opening quote → [closing quote, include at start]. */
    forwardQuoteMap: Map<string, [string, boolean]>;
    /** Closing quote → [opening quote, include at end]. */
    backwardQuoteMap: Map<string, [string, boolean]>;
};

export type TerminationCharacter = {
    enabled: boolean;
    character1: string;
    character2: string | null;
    includeCharacterAtStart: boolean;
    includeCharacterAtEnd: boolean;
};

/** Upstream `TextScanner.setOptions` → sentence settings, from the profile's `sentenceParsing`. */
export function createSentenceParsingSettings(options: {
    scanExtent: number;
    terminationCharacterMode: string;
    terminationCharacters: TerminationCharacter[];
}): SentenceParsingSettings {
    const { scanExtent, terminationCharacterMode, terminationCharacters } = options;
    const terminatorMap = new Map<string, [boolean, boolean]>();
    const forwardQuoteMap = new Map<string, [string, boolean]>();
    const backwardQuoteMap = new Map<string, [string, boolean]>();
    if (terminationCharacterMode === 'custom' || terminationCharacterMode === 'custom-no-newlines') {
        for (const {
            enabled,
            character1,
            character2,
            includeCharacterAtStart,
            includeCharacterAtEnd,
        } of terminationCharacters) {
            if (!enabled) {
                continue;
            }
            if (character2 === null) {
                terminatorMap.set(character1, [includeCharacterAtStart, includeCharacterAtEnd]);
            } else {
                forwardQuoteMap.set(character1, [character2, includeCharacterAtStart]);
                backwardQuoteMap.set(character2, [character1, includeCharacterAtEnd]);
            }
        }
    }
    return {
        extent: scanExtent,
        terminateAtNewlines: terminationCharacterMode === 'custom' || terminationCharacterMode === 'newlines',
        terminatorMap,
        forwardQuoteMap,
        backwardQuoteMap,
    };
}

export type Sentence = {
    text: string;
    /** Characters (code points) from the sentence start to the scanned term, as in Yomitan. */
    offset: number;
};

function isWhitespace(value: string): boolean {
    return value.trim().length === 0;
}

/** Port of upstream `TextSourceGenerator.extractSentence`, over a {@link PlainTextSource}. */
export function extractSentence(source: PlainTextSource, settings: SentenceParsingSettings): Sentence {
    const { extent, terminateAtNewlines, terminatorMap, forwardQuoteMap, backwardQuoteMap } = settings;
    source = source.clone();
    const startLength = source.setStartOffset(extent);
    const endLength = source.setEndOffset(extent * 2 - startLength, true);
    const text = [...source.content()];
    const textLength = text.length;
    const textEndAnchor = textLength - endLength;

    let cursorStart = startLength;
    let cursorEnd = textEndAnchor;

    // Move backward
    let quoteStack: string[] = [];
    for (; cursorStart > 0; --cursorStart) {
        let c = text[cursorStart - 1];
        if (c === '\n' && terminateAtNewlines) {
            break;
        }

        if (quoteStack.length === 0) {
            let terminatorInfo = terminatorMap.get(c);
            if (typeof terminatorInfo !== 'undefined') {
                while (terminatorInfo[0] && cursorStart > 0) {
                    --cursorStart;
                    if (cursorStart === 0) {
                        break;
                    }
                    c = text[cursorStart - 1];
                    terminatorInfo = terminatorMap.get(c);
                    if (typeof terminatorInfo === 'undefined') {
                        break;
                    }
                }
                break;
            }
        }

        let quoteInfo = forwardQuoteMap.get(c);
        if (typeof quoteInfo !== 'undefined') {
            if (quoteStack.length === 0) {
                while (quoteInfo[1] && cursorStart > 0) {
                    --cursorStart;
                    if (cursorStart === 0) {
                        break;
                    }
                    c = text[cursorStart - 1];
                    quoteInfo = forwardQuoteMap.get(c);
                    if (typeof quoteInfo === 'undefined') {
                        break;
                    }
                }
                break;
            }
            if (quoteStack[0] === c) {
                quoteStack.pop();
                continue;
            }
        }

        const backwardInfo = backwardQuoteMap.get(c);
        if (typeof backwardInfo !== 'undefined') {
            quoteStack.unshift(backwardInfo[0]);
        }
    }

    // Move forward
    quoteStack = [];
    for (; cursorEnd < textLength; ++cursorEnd) {
        let c = text[cursorEnd];
        if (c === '\n' && terminateAtNewlines) {
            break;
        }

        if (quoteStack.length === 0) {
            let terminatorInfo = terminatorMap.get(c);
            if (typeof terminatorInfo !== 'undefined') {
                while (terminatorInfo[1] && cursorEnd < textLength) {
                    ++cursorEnd;
                    if (cursorEnd === textLength) {
                        break;
                    }
                    c = text[cursorEnd];
                    terminatorInfo = terminatorMap.get(c);
                    if (typeof terminatorInfo === 'undefined') {
                        break;
                    }
                }
                break;
            }
        }

        let quoteInfo: [string, boolean] | undefined = backwardQuoteMap.get(c);
        if (typeof quoteInfo !== 'undefined') {
            if (quoteStack.length === 0) {
                while (quoteInfo[1] && cursorEnd < textLength) {
                    ++cursorEnd;
                    if (cursorEnd === textLength) {
                        break;
                    }
                    c = text[cursorEnd];
                    // Upstream looks the next character up in the forward map here.
                    quoteInfo = forwardQuoteMap.get(c);
                    if (typeof quoteInfo === 'undefined') {
                        break;
                    }
                }
                break;
            }
            if (quoteStack[0] === c) {
                quoteStack.pop();
                continue;
            }
        }

        const forwardInfo = forwardQuoteMap.get(c);
        if (typeof forwardInfo !== 'undefined') {
            quoteStack.unshift(forwardInfo[0]);
        }
    }

    // Trim whitespace
    for (; cursorStart < startLength && isWhitespace(text[cursorStart]); ++cursorStart) {
        /* NOP */
    }
    for (; cursorEnd > textEndAnchor && isWhitespace(text[cursorEnd - 1]); --cursorEnd) {
        /* NOP */
    }

    return {
        text: text.slice(cursorStart, cursorEnd).join(''),
        offset: startLength - cursorStart,
    };
}
