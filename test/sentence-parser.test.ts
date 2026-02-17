import { describe, expect, it } from 'vitest';

import { isCodePointJapanese } from '../src/language/ja/japanese';
import { SentenceParser } from '../src/lookup/sentence-parser';
import type { TermDictionaryEntry } from '../src/types/dictionary';

function createEntry(term: string, reading: string, originalText: string): TermDictionaryEntry {
    return {
        type: 'term',
        isPrimary: true,
        textProcessorRuleChainCandidates: [],
        inflectionRuleChainCandidates: [],
        score: 0,
        frequencyOrder: 0,
        dictionaryIndex: 0,
        dictionaryAlias: 'TestDict',
        sourceTermExactMatchCount: 1,
        matchPrimaryReading: false,
        maxOriginalTextLength: originalText.length,
        headwords: [
            {
                index: 0,
                term,
                reading,
                sources: [
                    {
                        originalText,
                        transformedText: originalText,
                        deinflectedText: term,
                        matchType: 'exact',
                        matchSource: 'term',
                        isPrimary: true,
                    },
                ],
                tags: [],
                wordClasses: [],
            },
        ],
        definitions: [],
        pronunciations: [],
        frequencies: [],
    };
}

const translatorMock = {
    async findTerms(_mode: 'simple', text: string, _options: unknown) {
        if (text.startsWith('ボス')) {
            return {
                dictionaryEntries: [createEntry('ボス', 'ぼす', 'ボス')],
                originalTextLength: 2,
            };
        }

        if (text.startsWith('に')) {
            return {
                dictionaryEntries: [createEntry('に', 'に', 'に')],
                originalTextLength: 1,
            };
        }

        if (text.startsWith('会わせて')) {
            return {
                dictionaryEntries: [createEntry('会わせる', 'あわせる', '会わせて')],
                originalTextLength: 4,
            };
        }

        if (text.startsWith('くれ')) {
            return {
                dictionaryEntries: [createEntry('くれる', 'くれる', 'くれ')],
                originalTextLength: 2,
            };
        }

        return {
            dictionaryEntries: [],
            originalTextLength: 0,
        };
    },
};

async function extensionStyleScan(text: string, scanLength: number) {
    const result: string[] = [];
    let previousUngrouped: string | null = null;

    let i = 0;
    while (i < text.length) {
        const codePoint = text.codePointAt(i) as number;
        const character = String.fromCodePoint(codePoint);
        const substring = text.substring(i, i + scanLength);

        const { dictionaryEntries, originalTextLength } = await translatorMock.findTerms('simple', substring, {});

        if (
            dictionaryEntries.length > 0 &&
            originalTextLength > 0 &&
            (originalTextLength !== character.length || isCodePointJapanese(codePoint))
        ) {
            previousUngrouped = null;
            const source = substring.substring(0, originalTextLength);
            result.push(source);
            i += originalTextLength;
        } else {
            if (previousUngrouped === null) {
                previousUngrouped = character;
                result.push(previousUngrouped);
            } else {
                previousUngrouped += character;
                result[result.length - 1] = previousUngrouped;
            }
            i += character.length;
        }
    }

    return result;
}

describe('SentenceParser (scanning parser parity)', () => {
    it('segments ボスに会わせてくれ as expected', async () => {
        const parser = new SentenceParser(translatorMock as any);
        const result = await parser.parseText('ボスに会わせてくれ', 'ja', {
            enabledDictionaryMap: new Map([
                ['TestDict', { index: 0, alias: 'TestDict', useDeinflections: true, partsOfSpeechFilter: true }],
            ]),
            scanLength: 20,
        });

        expect(result).toHaveLength(1);
        expect(result[0].map((s) => s.text)).toEqual(['ボス', 'に', '会わせて', 'くれ']);
        expect(result[0][0].headwords?.[0][0].term).toBe('ボス');
        expect(result[0][1].headwords?.[0][0].term).toBe('に');
        expect(result[0][2].headwords?.[0][0].term).toBe('会わせる');
        expect(result[0][3].headwords?.[0][0].term).toBe('くれる');
    });

    it('matches extension-style scanning parser behavior for same translator outputs', async () => {
        const parser = new SentenceParser(translatorMock as any);
        const input = 'ボスに会わせてくれ';

        const expected = await extensionStyleScan(input, 20);
        const parsed = await parser.parseText(input, 'ja', {
            enabledDictionaryMap: new Map([
                ['TestDict', { index: 0, alias: 'TestDict', useDeinflections: true, partsOfSpeechFilter: true }],
            ]),
            scanLength: 20,
        });

        expect(parsed[0].map((s) => s.text)).toEqual(expected);
    });

    it('keeps unmatched punctuation grouped and non-actionable', async () => {
        const parser = new SentenceParser(translatorMock as any);
        const parsed = await parser.parseText('、。！？', 'ja', {
            enabledDictionaryMap: new Map([
                ['TestDict', { index: 0, alias: 'TestDict', useDeinflections: true, partsOfSpeechFilter: true }],
            ]),
            scanLength: 20,
        });

        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toEqual([{ text: '、。！？', reading: '' }]);
        expect(parsed[0][0].headwords).toBeUndefined();
    });
});
