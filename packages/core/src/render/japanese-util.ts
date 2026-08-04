/*
 * Copyright (C) 2024-2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Japanese language utility functions used by the display rendering layer.
 * These are ported from the Yomitan extension's japanese.js module.
 */

import { CJK_IDEOGRAPH_RANGES, isCodePointInRanges } from '../language/cjk-util.js';

export type PitchCategory = 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka' | 'kifuku';

export type DiacriticType = 'dakuten' | 'handakuten';

const SMALL_KANA_SET = new Set('ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ');

const kana =
    'うゔ-かが-きぎ-くぐ-けげ-こご-さざ-しじ-すず-せぜ-そぞ-ただ-ちぢ-つづ-てで-とど-はばぱひびぴふぶぷへべぺほぼぽワヷ-ヰヸ-ウヴ-ヱヹ-ヲヺ-カガ-キギ-クグ-ケゲ-コゴ-サザ-シジ-スズ-セゼ-ソゾ-タダ-チヂ-ツヅ-テデ-トド-ハバパヒビピフブプヘベペホボポ';
const DIACRITIC_MAPPING = new Map<string, { character: string; type: DiacriticType }>();
for (let i = 0, ii = kana.length; i < ii; i += 3) {
    const character = kana[i];
    const dakuten = kana[i + 1];
    const handakuten = kana[i + 2];
    DIACRITIC_MAPPING.set(dakuten, { character, type: 'dakuten' });
    if (handakuten !== '-') {
        DIACRITIC_MAPPING.set(handakuten, { character, type: 'handakuten' });
    }
}

/**
 * Checks if a code point represents a CJK kanji character.
 */
export function isCodePointKanji(codePoint: number): boolean {
    return isCodePointInRanges(codePoint, CJK_IDEOGRAPH_RANGES);
}

/**
 * Determines whether a mora at a given index has high pitch.
 * @param moraIndex - The 0-based mora index to check.
 * @param pitchAccentValue - The pitch accent pattern (number = downstep position, string = HL pattern).
 * @returns True if the mora at the given index has high pitch.
 */
export function isMoraPitchHigh(moraIndex: number, pitchAccentValue: number | string): boolean {
    if (typeof pitchAccentValue === 'string') {
        return pitchAccentValue[moraIndex] === 'H';
    }
    switch (pitchAccentValue) {
        case 0:
            return moraIndex > 0;
        case 1:
            return moraIndex < 1;
        default:
            return moraIndex > 0 && moraIndex < pitchAccentValue;
    }
}

/**
 * Determines the pitch accent category for a word.
 * @param text - The reading text.
 * @param pitchAccentValue - The pitch accent pattern.
 * @param isVerbOrAdjective - Whether the word is a verb or adjective (not a noun).
 * @returns The pitch category, or null if it cannot be determined.
 */
export function getPitchCategory(
    text: string,
    pitchAccentValue: number | string,
    isVerbOrAdjective: boolean,
): PitchCategory | null {
    const pitchAccentDownstepPosition =
        typeof pitchAccentValue === 'string' ? getDownstepPositions(pitchAccentValue)[0] : pitchAccentValue;
    if (pitchAccentDownstepPosition === 0) {
        return 'heiban';
    }
    if (isVerbOrAdjective) {
        return pitchAccentDownstepPosition > 0 ? 'kifuku' : null;
    }
    if (pitchAccentDownstepPosition === 1) {
        return 'atamadaka';
    }
    if (pitchAccentDownstepPosition > 1) {
        return pitchAccentDownstepPosition >= getKanaMoraCount(text) ? 'odaka' : 'nakadaka';
    }
    return null;
}

/**
 * Extracts downstep positions from an HL pitch string pattern.
 * @param pitchString - A string of 'H' and 'L' characters representing pitch.
 * @returns Array of downstep positions (1-indexed mora positions where pitch drops).
 */
export function getDownstepPositions(pitchString: string): number[] {
    const downsteps: number[] = [];
    const moraCount = pitchString.length;
    for (let i = 0; i < moraCount; i++) {
        if (i > 0 && pitchString[i - 1] === 'H' && pitchString[i] === 'L') {
            downsteps.push(i);
        }
    }
    if (downsteps.length === 0) {
        downsteps.push(pitchString.startsWith('L') ? 0 : -1);
    }
    return downsteps;
}

/**
 * Splits a kana text into an array of morae, combining small kana with their preceding character.
 * @param text - The kana text to split.
 * @returns Array of mora strings.
 */
export function getKanaMorae(text: string): string[] {
    const morae: string[] = [];
    let i: number;
    for (const c of text) {
        if (SMALL_KANA_SET.has(c) && (i = morae.length) > 0) {
            morae[i - 1] += c;
        } else {
            morae.push(c);
        }
    }
    return morae;
}

/**
 * Counts the number of morae in a kana text.
 * @param text - The kana text to count morae in.
 * @returns The number of morae.
 */
export function getKanaMoraCount(text: string): number {
    let moraCount = 0;
    for (const c of text) {
        if (!(SMALL_KANA_SET.has(c) && moraCount > 0)) {
            ++moraCount;
        }
    }
    return moraCount;
}

/**
 * Gets diacritic information for a kana character.
 * If the character is a dakuten or handakuten variant, returns the base character and type.
 * @param character - The kana character to check.
 * @returns An object with the base character and diacritic type, or null if not a diacritic variant.
 */
export function getKanaDiacriticInfo(character: string): { character: string; type: DiacriticType } | null {
    const info = DIACRITIC_MAPPING.get(character);
    return typeof info !== 'undefined' ? { character: info.character, type: info.type } : null;
}
