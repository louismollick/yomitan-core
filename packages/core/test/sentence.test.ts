/*
 * Upstream's test/document-util.test.js "scan" cases whose text is a single text node, run through
 * the plain-text port of TextSourceGenerator.extractSentence with the same maps upstream's test uses.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { upstreamFixturesDir } from '../../contract-tests/src/fixtures';
import { PlainTextSource, extractSentence } from '../src/lookup/text-source';

type ScanCase = {
    startNodeSelector: string;
    startOffset: number;
    endOffset: number;
    sentenceScanExtent: number;
    sentence: string;
    terminateAtNewlines?: boolean;
};

const html = readFileSync(join(upstreamFixturesDir, 'html', 'document-util.html'), 'utf8');
const cases = [
    ...html.matchAll(
        /<test-case\s+data-test-type="scan"\s+data-test-data='([^']*)'\s*>\s*<span>([^<]*)<\/span>\s*<\/test-case>/g,
    ),
].map(([, data, text]) => ({ data: JSON.parse(data) as ScanCase, text }));

const terminatorMap = new Map<string, [boolean, boolean]>([...'…。．.？?！!'].map((char) => [char, [false, true]]));
const forwardQuoteMap = new Map<string, [string, boolean]>();
const backwardQuoteMap = new Map<string, [string, boolean]>();
for (const [open, close] of [
    ['「', '」'],
    ['『', '』'],
    ["'", "'"],
    ['"', '"'],
]) {
    forwardQuoteMap.set(open, [close, false]);
    backwardQuoteMap.set(close, [open, false]);
}

describe('extractSentence (upstream document-util single-node cases)', () => {
    test('finds every single-node case', () => {
        expect(cases).toHaveLength(7);
    });
    test.each(cases)('offset $data.startOffset in $text', ({ data, text }) => {
        const source = new PlainTextSource(text, data.startOffset, data.endOffset);
        const sentence = extractSentence(source, {
            extent: data.sentenceScanExtent,
            terminateAtNewlines: data.terminateAtNewlines ?? true,
            terminatorMap,
            forwardQuoteMap,
            backwardQuoteMap,
        });
        expect(sentence.text).toBe(data.sentence);
    });
});
