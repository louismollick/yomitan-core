import { describe, expect, it, vi } from 'vitest';

import YomitanCore from '../src/index';
import { getAllLanguageTextProcessors } from '../src/language/languages';

describe('Japanese parity contracts', () => {
    it('returns extension-style parseText envelope fields for scanning parser', async () => {
        const core = new YomitanCore({ databaseName: 'yomitan-core-test-jp-parity' });
        await core.initialize();

        const parseTextMock = vi.fn().mockResolvedValue([
            [
                {
                    text: '猫',
                    reading: 'ねこ',
                    headwords: [
                        [
                            {
                                term: '猫',
                                reading: 'ねこ',
                                sources: [
                                    {
                                        originalText: '猫',
                                        transformedText: '猫',
                                        deinflectedText: '猫',
                                        matchType: 'exact',
                                        matchSource: 'term',
                                        isPrimary: true,
                                    },
                                ],
                            },
                        ],
                    ],
                },
            ],
        ]);
        (core as any)._sentenceParser = { parseText: parseTextMock };

        const result = await core.parseText('猫', {
            language: 'ja',
            enabledDictionaryMap: new Map([['JMdict', { index: 0 }]]),
        });

        expect(result).toEqual([
            {
                id: 'scan',
                source: 'scanning-parser',
                dictionary: null,
                index: 0,
                content: [
                    [
                        {
                            text: '猫',
                            reading: 'ねこ',
                            headwords: [
                                [
                                    {
                                        term: '猫',
                                        reading: 'ねこ',
                                        sources: [
                                            {
                                                originalText: '猫',
                                                transformedText: '猫',
                                                deinflectedText: '猫',
                                                matchType: 'exact',
                                                matchSource: 'term',
                                                isPrimary: true,
                                            },
                                        ],
                                    },
                                ],
                            ],
                        },
                    ],
                ],
            },
        ]);

        await core.dispose();
    });

    it('includes Japanese preprocessors needed for extension parity', () => {
        const japaneseProcessors = getAllLanguageTextProcessors().find((item) => item.iso === 'ja');
        expect(japaneseProcessors).toBeTruthy();

        const processorIds = (japaneseProcessors?.textPreprocessors ?? []).map((item) => item.id);
        expect(processorIds).toContain('normalizeRadicalCharacters');
        expect(processorIds).toContain('standardizeKanji');
    });
});
