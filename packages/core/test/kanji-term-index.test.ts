import { describe, expect, test } from 'vitest';
import { KANJI_TERM_INDEX_SIZE, buildKanjiTermRows, isSingleKanji } from '../src/storage/kanji-term-index';

const freq = (expression: string, data: unknown) => ({ expression, mode: 'freq', data, dictionary: 'D' });

describe('buildKanjiTermRows', () => {
    test('keeps each term once at its best rank, skipping kana-spelling rows and other modes', () => {
        const rows = buildKanjiTermRows(
            'D',
            [
                freq('学校', { reading: 'がっこう', frequency: { value: 5, displayValue: '5㋕' } }),
                freq('学校', { reading: 'がっこう', frequency: { value: 300, displayValue: '300' } }),
                freq('学校', 120),
                freq('の', 1),
                freq('々', 2),
                { expression: '学校', mode: 'pitch', data: {}, dictionary: 'D' },
            ],
            undefined,
        );
        expect(rows).toEqual([
            { dictionary: 'D', character: '学', terms: [{ term: '学校', reading: '', frequency: 120 }] },
            { dictionary: 'D', character: '校', terms: [{ term: '学校', reading: '', frequency: 120 }] },
            { dictionary: 'D', character: '', terms: [] },
        ]);
    });

    test('reads every frequency data shape upstream accepts', () => {
        const [row] = buildKanjiTermRows(
            'D',
            [
                freq('字一', 3),
                freq('字二', { value: 4, displayValue: 'four' }),
                freq('字三', 'rank 5'),
                freq('字四', { reading: 'よん', frequency: '6' }),
                freq('字五', 'none'),
            ],
            undefined,
        );
        expect(
            row.terms.map(({ term, reading, frequency, displayValue }) => [term, reading, frequency, displayValue]),
        ).toEqual([
            ['字一', '', 3, undefined],
            ['字二', '', 4, 'four'],
            ['字三', '', 5, 'rank 5'],
            ['字四', 'よん', 6, '6'],
        ]);
    });

    test('ranks occurrence-based dictionaries highest first, and ties by term', () => {
        const meta = [freq('字b', 10), freq('字a', 10), freq('字c', 99)];
        const terms = (mode: 'rank-based' | 'occurrence-based') =>
            buildKanjiTermRows('D', meta, mode)[0].terms.map(({ term }) => term);
        expect(terms('occurrence-based')).toEqual(['字c', '字a', '字b']);
        expect(terms('rank-based')).toEqual(['字a', '字b', '字c']);
    });

    test('keeps the best terms per kanji, and always ends with the marker row', () => {
        const meta = Array.from({ length: KANJI_TERM_INDEX_SIZE + 10 }, (_, i) => freq(`字${'あ'.repeat(i)}`, i + 1));
        const rows = buildKanjiTermRows('D', meta, undefined);
        expect(rows).toHaveLength(2);
        expect(rows[0].terms).toHaveLength(KANJI_TERM_INDEX_SIZE);
        expect(rows[0].terms[0].frequency).toBe(1);
        expect(rows[1]).toEqual({ dictionary: 'D', character: '', terms: [] });
        expect(buildKanjiTermRows('D', [], undefined)).toEqual([{ dictionary: 'D', character: '', terms: [] }]);
    });
});

describe('isSingleKanji', () => {
    test('accepts one ideograph, including those outside the BMP', () => {
        expect(isSingleKanji('学')).toBe(true);
        expect(isSingleKanji('\u{20BB7}')).toBe(true);
        for (const text of ['々', 'あ', 'a', '', '学校', '学a']) {
            expect(isSingleKanji(text)).toBe(false);
        }
    });
});
