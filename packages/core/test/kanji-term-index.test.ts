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

describe('bounded building', () => {
    /** The index computed the obvious way, holding everything in memory. */
    function reference(meta: ReturnType<typeof freq>[], direction: 1 | -1) {
        const best = new Map<string, number>();
        for (const { expression, data } of meta) {
            const value = data as number;
            const current = best.get(expression);
            if (current === undefined || direction * (value - current) < 0) {
                best.set(expression, value);
            }
        }
        const byKanji = new Map<string, [string, number][]>();
        for (const [term, value] of best) {
            for (const kanji of new Set([...term])) {
                byKanji.set(kanji, [...(byKanji.get(kanji) ?? []), [term, value]]);
            }
        }
        return new Map(
            [...byKanji].map(([kanji, terms]) => [
                kanji,
                terms
                    .sort((a, b) => direction * (a[1] - b[1]) || (a[0] < b[0] ? -1 : 1))
                    .slice(0, KANJI_TERM_INDEX_SIZE)
                    .map(([term, value]) => [term, value]),
            ]),
        );
    }

    for (const mode of ['rank-based', 'occurrence-based'] as const) {
        test(`keeps the exact top terms per kanji while retaining only ${KANJI_TERM_INDEX_SIZE}, ${mode}`, () => {
            // Many terms share the kanji 字 or 学, repeated with better and worse values in any order.
            let seed = 7;
            const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
            const meta = Array.from({ length: 6000 }, () =>
                freq(
                    `${random() < 0.5 ? '字' : '学'}${String.fromCodePoint(0x4e00 + Math.floor(random() * 400))}`,
                    1 + Math.floor(random() * 500),
                ),
            );
            const rows = buildKanjiTermRows('D', meta, mode);
            const expected = reference(meta, mode === 'rank-based' ? 1 : -1);
            for (const { character, terms } of rows) {
                if (character === '') continue;
                expect(terms.length).toBeLessThanOrEqual(KANJI_TERM_INDEX_SIZE);
                expect(terms.map(({ term, frequency }) => [term, frequency])).toEqual(expected.get(character));
            }
            expect(rows.length).toBe(expected.size + 1);
        });
    }

    test('a better value that arrives after the term was evicted still gets it back in', () => {
        const filler = Array.from({ length: KANJI_TERM_INDEX_SIZE }, (_, i) =>
            freq(`字${String.fromCodePoint(0x4e00 + i)}`, 10 + i),
        );
        const [row] = buildKanjiTermRows('D', [freq('字late', 1000), ...filler, freq('字late', 1)], undefined);
        expect(row.terms[0]).toMatchObject({ term: '字late', frequency: 1 });
        expect(row.terms).toHaveLength(KANJI_TERM_INDEX_SIZE);
    });
});

describe('frequency strings', () => {
    test('are parsed as upstream does: exponents, leading decimals, finite values only', () => {
        const [row] = buildKanjiTermRows(
            'D',
            [
                freq('字一', '1.5e3'),
                freq('字二', '.5 per million'),
                freq('字三', '2.'),
                freq('字四', '1e999'),
                freq('字五', 'x'),
            ],
            undefined,
        );
        expect(row.terms.map(({ term, frequency }) => [term, frequency])).toEqual([
            ['字二', 0.5],
            ['字三', 2],
            ['字一', 1500],
        ]);
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
