import { describe, expect, test } from 'vitest';
import {
    type SegmentLookup,
    UNKNOWN_COST,
    cheapestPath,
    createRankLookup,
    segmentText,
    tokenAt,
    wordCosts,
} from '../src/lookup/segment';
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

describe('createRankLookup', () => {
    const record = (term: string, frequency: number, reading?: string) => ({
        term,
        frequency,
        reading: reading ?? null,
        hasReading: reading !== undefined,
    });

    test('prefers the headword reading, then a reading-less record, then the term best', () => {
        const rank = createRankLookup([
            record('打', 8, 'だ'),
            record('打', 9, 'ダース'),
            record('打つ', 5),
            record('x', 0),
        ]);
        expect(rank('打', 'だ')).toBe(8);
        expect(rank('打', 'うつ')).toBe(8);
        expect(rank('打つ', 'うつ')).toBe(5);
        expect(rank('x', 'x')).toBeUndefined();
        expect(rank('none', 'none')).toBeUndefined();
    });
});

describe('wordCosts', () => {
    const cost = (rank: number, extra = 0) => Math.log(rank) + 6 + extra;
    const match = (term: string, length: number, deinflected = false) => ({
        term,
        reading: term,
        length,
        deinflected,
    });

    test('scores each length by its best-ranked headword', () => {
        const ranks: Record<string, number> = { a: 100, b: 10, c: 5 };
        const costs = wordCosts([match('a', 2), match('b', 2), match('c', 1)], (term) => ranks[term]);
        expect(costs.get(2)).toBeCloseTo(cost(10));
        expect(costs.get(1)).toBeCloseTo(cost(5));
        expect(costs.size).toBe(2);
    });

    test('charges deinflected matches and unranked headwords', () => {
        const costs = wordCosts([match('a', 1, true), match('b', 2)], (term) => (term === 'a' ? 7 : undefined));
        expect(costs.get(1)).toBeCloseTo(cost(7, 1.5));
        expect(costs.get(2)).toBeCloseTo(cost(200_000));
    });

    test('costs every word 1 without a rank lookup', () => {
        expect([...wordCosts([match('a', 1, true), match('b', 2)], null)]).toEqual([
            [1, 1],
            [2, 1],
        ]);
    });
});

/** A term entry with only the fields `segmentText` reads. */
function entry(term: string, reading: string, length: number): TermDictionaryEntry {
    return {
        headwords: [
            {
                term,
                reading,
                headwordIndex: 0,
                sources: [{ originalText: 'x'.repeat(length), matchType: 'exact', isPrimary: true }],
            },
        ],
        frequencies: [],
        pronunciations: [],
    } as unknown as TermDictionaryEntry;
}

describe('segmentText', () => {
    const options = { scanLength: 16, maxResults: 32, alphanumeric: true };

    /** A fake dictionary: headwords by surface text (every prefix of the window that is a key matches). */
    function fakeLookup(words: Record<string, { rank?: number; deinflected?: boolean }>, ranked = true) {
        const lookups: string[] = [];
        const lookup: SegmentLookup = {
            async matches(text) {
                lookups.push(text);
                return Object.entries(words)
                    .filter(([surface]) => text.startsWith(surface))
                    .map(([surface, { deinflected = false }]) => ({
                        term: surface,
                        reading: surface,
                        length: surface.length,
                        deinflected,
                    }));
            },
            frequencies: ranked
                ? async (terms) =>
                      terms.flatMap((term) =>
                          words[term]?.rank === undefined
                              ? []
                              : [{ term, reading: null, hasReading: false, frequency: words[term].rank as number }],
                      )
                : null,
            async entries(span) {
                return span in words ? [entry(span, span, span.length)] : [];
            },
        };
        return { lookup, lookups };
    }

    test('keeps shorter matches the greedy parse would hide', async () => {
        // 見た, 見たく and くせに: only the lattice sees 見た | くせに beating 見たく | せに.
        const { lookup } = fakeLookup({
            見た: { rank: 36, deinflected: true },
            見たく: { rank: 36, deinflected: true },
            くせに: { rank: 500 },
        });
        const tokens = await segmentText('見たくせに', options, lookup);
        expect(tokens.map(({ text, entries }) => [text, entries.length])).toEqual([
            ['見た', 1],
            ['くせに', 1],
        ]);
        expect(tokens[1].range).toEqual({ start: 2, end: 5 });
    });

    test('merges unmatched runs into one entry-less token, even with a mixed-script word nearby', async () => {
        const { lookup } = fakeLookup({ シャツ: { rank: 3000 }, Tシャツ: { rank: 2000 } });
        const tokens = await segmentText('xyzTシャツ', options, lookup);
        expect(tokens.map(({ text, entries }) => [text, entries.length])).toEqual([
            ['xyz', 0],
            ['Tシャツ', 1],
        ]);
    });

    test('looks up at letters and digits only when alphanumeric scanning is on', async () => {
        const words = { Tシャツ: { rank: 2000 }, シャツ: { rank: 3000 } };
        const on = fakeLookup(words);
        expect((await segmentText('Tシャツ', options, on.lookup)).map(({ text }) => text)).toEqual(['Tシャツ']);
        const off = fakeLookup(words);
        const tokens = await segmentText('Tシャツ', { ...options, alphanumeric: false }, off.lookup);
        expect(off.lookups).toEqual(['シャツ', 'ャツ', 'ツ']);
        expect(on.lookups[0]).toBe('Tシャツ');
        expect(tokens.map(({ text }) => text)).toEqual(['T', 'シャツ']);
    });

    test('without frequencies the fewest words win', async () => {
        const { lookup } = fakeLookup({ あ: {}, あい: {}, あいう: {}, いうえ: {} }, false);
        const tokens = await segmentText('あいうえ', options, lookup);
        expect(tokens.map(({ text }) => text)).toEqual(['あ', 'いうえ']);
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
