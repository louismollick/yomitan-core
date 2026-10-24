import { describe, expect, test } from 'vitest';
import { UNKNOWN_COST, cheapestPath, tokenAt, wordCosts } from '../src/lookup/segment';
import type { TermDictionaryEntry } from '../src/upstream/types/ext/dictionary';

const texts = (text: string, path: ReturnType<typeof cheapestPath>) =>
    path.map(({ start, end, matched }) => [text.slice(start, end), matched]);

describe('cheapestPath', () => {
    test('prefers two cheap words over one expensive long word', () => {
        const whole = cheapestPath('あいう', [[{ length: 3, cost: 10 }], [{ length: 2, cost: 30 }]]);
        expect(texts('あいう', whole)).toEqual([['あいう', true]]);
        const split = cheapestPath('あいう', [
            [
                { length: 3, cost: 10 },
                { length: 1, cost: 2 },
            ],
            [{ length: 2, cost: 3 }],
        ]);
        expect(texts('あいう', split)).toEqual([
            ['あ', true],
            ['いう', true],
        ]);
    });

    test('merges unmatched characters and charges only Japanese ones', () => {
        const text = 'あxyい';
        const path = cheapestPath(text, [[{ length: 1, cost: 1 }], undefined, undefined, [{ length: 1, cost: 1 }]]);
        expect(texts(text, path)).toEqual([
            ['あ', true],
            ['xy', false],
            ['い', true],
        ]);
        // A word beats leaving a Japanese character unmatched, however costly the word is.
        const unmatched = cheapestPath('あ', [[{ length: 1, cost: UNKNOWN_COST - 1 }]]);
        expect(texts('あ', unmatched)).toEqual([['あ', true]]);
        expect(texts('あ', cheapestPath('あ', []))).toEqual([['あ', false]]);
    });

    test('breaks ties toward the longer first word', () => {
        // Two words either way: ab|c versus a|bc.
        const candidates = [
            [
                { length: 2, cost: 1 },
                { length: 1, cost: 1 },
            ],
            [{ length: 2, cost: 1 }],
            [{ length: 1, cost: 1 }],
        ];
        expect(texts('あいう', cheapestPath('あいう', candidates))).toEqual([
            ['あい', true],
            ['う', true],
        ]);
    });

    test('ignores matches that run past the end and handles astral characters', () => {
        const text = '𠮷あ';
        const path = cheapestPath(text, [[{ length: 2, cost: 1 }], undefined, [{ length: 5, cost: 0 }]]);
        expect(texts(text, path)).toEqual([
            ['𠮷', true],
            ['あ', false],
        ]);
        expect(cheapestPath('', [])).toEqual([]);
    });
});

/** A term entry with only the fields `wordCosts` reads. */
function entry(
    headwords: { term: string; length: number; deinflected?: boolean; matchType?: 'exact' | 'prefix' }[],
    frequencies: { headwordIndex: number; dictionary: string; frequency: number; occurrence?: boolean }[] = [],
): TermDictionaryEntry {
    return {
        headwords: headwords.map(({ term, length, deinflected = false, matchType = 'exact' }, headwordIndex) => ({
            headwordIndex,
            term,
            sources: [
                {
                    originalText: 'あ'.repeat(length),
                    deinflectedText: deinflected ? 'い'.repeat(length) : 'あ'.repeat(length),
                    matchType,
                    isPrimary: true,
                },
            ],
        })),
        frequencies: frequencies.map(({ occurrence, ...rest }) => ({
            ...rest,
            frequencyMode: occurrence ? 'occurrence-based' : 'rank-based',
        })),
    } as unknown as TermDictionaryEntry;
}

describe('wordCosts', () => {
    const cost = (rank: number, extra = 0) => Math.log(rank) + 6 + extra;

    test('scores each length by its best-ranked headword', () => {
        const costs = wordCosts(
            [
                entry([{ term: 'a', length: 2 }], [{ headwordIndex: 0, dictionary: 'F', frequency: 100 }]),
                entry([{ term: 'b', length: 2 }], [{ headwordIndex: 0, dictionary: 'F', frequency: 10 }]),
                entry([{ term: 'c', length: 1 }], [{ headwordIndex: 0, dictionary: 'F', frequency: 5 }]),
            ],
            'F',
        );
        expect(costs.get(2)).toBeCloseTo(cost(10));
        expect(costs.get(1)).toBeCloseTo(cost(5));
        expect(costs.size).toBe(2);
    });

    test('charges deinflected matches and unranked headwords', () => {
        const costs = wordCosts(
            [
                entry(
                    [{ term: 'a', length: 1, deinflected: true }],
                    [{ headwordIndex: 0, dictionary: 'F', frequency: 7 }],
                ),
                entry([{ term: 'b', length: 2 }]),
            ],
            'F',
        );
        expect(costs.get(1)).toBeCloseTo(cost(7, 1.5));
        expect(costs.get(2)).toBeCloseTo(cost(200_000));
    });

    test('uses the entry best rank for a headword without its own', () => {
        const costs = wordCosts(
            [
                entry(
                    [
                        { term: 'a', length: 1 },
                        { term: 'b', length: 3 },
                    ],
                    [{ headwordIndex: 0, dictionary: 'F', frequency: 20 }],
                ),
            ],
            'F',
        );
        expect(costs.get(3)).toBeCloseTo(cost(20));
    });

    test('ignores other dictionaries, occurrence-based ones and non-exact sources', () => {
        const costs = wordCosts(
            [
                entry(
                    [{ term: 'a', length: 1 }],
                    [
                        { headwordIndex: 0, dictionary: 'Other', frequency: 1 },
                        { headwordIndex: 0, dictionary: 'F', frequency: 3, occurrence: true },
                    ],
                ),
                entry([{ term: 'b', length: 4, matchType: 'prefix' }]),
            ],
            'F',
        );
        expect(costs.get(1)).toBeCloseTo(cost(200_000));
        expect(costs.has(4)).toBe(false);
    });

    test('costs every word 1 without a frequency dictionary', () => {
        const costs = wordCosts(
            [
                entry(
                    [{ term: 'a', length: 1, deinflected: true }],
                    [{ headwordIndex: 0, dictionary: 'F', frequency: 3 }],
                ),
                entry([{ term: 'b', length: 2 }]),
            ],
            null,
        );
        expect([...costs]).toEqual([
            [1, 1],
            [2, 1],
        ]);
    });
});

describe('tokenAt', () => {
    const tokens = [
        { text: 'ab', range: { start: 0, end: 2 } },
        { text: 'c', range: { start: 2, end: 3 } },
    ];

    test('finds the token whose half-open range contains the offset', () => {
        expect(tokenAt(tokens, 0)).toBe(tokens[0]);
        expect(tokenAt(tokens, 1)).toBe(tokens[0]);
        expect(tokenAt(tokens, 2)).toBe(tokens[1]);
    });

    test('is undefined outside the text', () => {
        expect(tokenAt(tokens, 3)).toBeUndefined();
        expect(tokenAt(tokens, -1)).toBeUndefined();
        expect(tokenAt([], 0)).toBeUndefined();
    });
});
