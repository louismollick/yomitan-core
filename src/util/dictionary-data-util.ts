import type * as Dictionary from '../types/dictionary';
import type {
    KanjiFrequency as DDUKanjiFrequency,
    TermFrequency as DDUTermFrequency,
    DictionaryFrequency,
    DictionaryGroupedPronunciations,
    FrequencyValue,
    GroupedPronunciation,
    GroupedPronunciationInternal,
    TagGroup,
    TermFrequencyType,
} from '../types/dictionary-data-util';
import type * as DictionaryImporter from '../types/dictionary-importer';

/**
 * Computes the harmonic mean of frequency values for a given headword in a dictionary entry.
 */
export function getFrequencyHarmonic(dictionaryEntry: Dictionary.TermDictionaryEntry, headwordIndex: number): number {
    const dominated = dictionaryEntry.frequencies
        .filter((f) => f.headwordIndex === headwordIndex)
        .map((f) => f.frequency);
    if (dominated.length === 0) {
        return 0;
    }
    let sum = 0;
    for (const freq of dominated) {
        if (freq <= 0) {
            continue;
        }
        sum += 1 / freq;
    }
    return sum > 0 ? Math.round(dominated.length / sum) : 0;
}

export function groupTermTags(dictionaryEntry: Dictionary.TermDictionaryEntry): TagGroup[] {
    const { headwords } = dictionaryEntry;
    const headwordCount = headwords.length;
    const uniqueCheck = headwordCount > 1;
    const resultsIndexMap = new Map<string, number>();
    const results: TagGroup[] = [];
    for (let i = 0; i < headwordCount; ++i) {
        const { tags } = headwords[i];
        for (const tag of tags) {
            if (uniqueCheck) {
                const { name, category, content, dictionaries } = tag;
                const key = createMapKey([name, category, content, dictionaries]);
                const index = resultsIndexMap.get(key);
                if (typeof index !== 'undefined') {
                    results[index].headwordIndices.push(i);
                    continue;
                }
                resultsIndexMap.set(key, results.length);
            }
            results.push({ tag, headwordIndices: [i] });
        }
    }
    return results;
}

export function groupTermFrequencies(
    dictionaryEntry: Dictionary.TermDictionaryEntry,
    dictionaryInfo: DictionaryImporter.Summary[],
): DictionaryFrequency<DDUTermFrequency>[] {
    const { headwords, frequencies: sourceFrequencies } = dictionaryEntry;

    const map1 = new Map<
        string,
        Map<string, { term: string; reading: string | null; values: Map<string, FrequencyValue> }>
    >();
    const aliasMap = new Map<string, string>();
    for (const {
        headwordIndex,
        dictionary,
        dictionaryAlias,
        hasReading,
        frequency,
        displayValue,
    } of sourceFrequencies) {
        const { term, reading } = headwords[headwordIndex];

        let map2 = map1.get(dictionary);
        if (typeof map2 === 'undefined') {
            map2 = new Map();
            map1.set(dictionary, map2);
            aliasMap.set(dictionary, dictionaryAlias);
        }

        const readingKey = hasReading ? reading : null;
        const key = createMapKey([term, readingKey]);
        let frequencyData = map2.get(key);
        if (typeof frequencyData === 'undefined') {
            frequencyData = { term, reading: readingKey, values: new Map() };
            map2.set(key, frequencyData);
        }

        frequencyData.values.set(createMapKey([frequency, displayValue]), { frequency, displayValue });
    }

    const results: DictionaryFrequency<DDUTermFrequency>[] = [];

    for (const [dictionary, map2] of map1.entries()) {
        const frequencies: DDUTermFrequency[] = [];
        const dictionaryAlias = aliasMap.get(dictionary) ?? dictionary;
        for (const { term, reading, values } of map2.values()) {
            frequencies.push({ term, reading, values: [...values.values()] });
        }
        const currentDictionaryInfo = dictionaryInfo.find(({ title }) => title === dictionary);
        const freqCount = currentDictionaryInfo?.counts?.termMeta.freq ?? 0;
        results.push({ dictionary, frequencies, dictionaryAlias, freqCount });
    }

    const averageFrequencies: DDUTermFrequency[] = [];
    for (let i = 0; i < dictionaryEntry.headwords.length; i++) {
        const averageFrequency = getFrequencyHarmonic(dictionaryEntry, i);
        averageFrequencies.push({
            term: dictionaryEntry.headwords[i].term,
            reading: dictionaryEntry.headwords[i].reading,
            values: [{ frequency: averageFrequency, displayValue: averageFrequency.toString() }],
        });
    }

    results.push({
        dictionary: 'Average',
        frequencies: averageFrequencies,
        dictionaryAlias: 'Average',
        freqCount: averageFrequencies.length,
    });

    return results;
}

export function groupKanjiFrequencies(
    sourceFrequencies: Dictionary.KanjiFrequency[],
    dictionaryInfo: DictionaryImporter.Summary[],
): DictionaryFrequency<DDUKanjiFrequency>[] {
    const map1 = new Map<string, Map<string, { character: string; values: Map<string, FrequencyValue> }>>();
    const aliasMap = new Map<string, string>();
    for (const { dictionary, dictionaryAlias, character, frequency, displayValue } of sourceFrequencies) {
        let map2 = map1.get(dictionary);
        if (typeof map2 === 'undefined') {
            map2 = new Map();
            map1.set(dictionary, map2);
            aliasMap.set(dictionary, dictionaryAlias);
        }
        let frequencyData = map2.get(character);
        if (typeof frequencyData === 'undefined') {
            frequencyData = { character, values: new Map() };
            map2.set(character, frequencyData);
        }
        frequencyData.values.set(createMapKey([frequency, displayValue]), { frequency, displayValue });
    }

    const results: DictionaryFrequency<DDUKanjiFrequency>[] = [];
    for (const [dictionary, map2] of map1.entries()) {
        const frequencies: DDUKanjiFrequency[] = [];
        const dictionaryAlias = aliasMap.get(dictionary) ?? dictionary;
        for (const { character, values } of map2.values()) {
            frequencies.push({ character, values: [...values.values()] });
        }
        const currentDictionaryInfo = dictionaryInfo.find(({ title }) => title === dictionary);
        const freqCount = currentDictionaryInfo?.counts?.kanjiMeta.freq ?? 0;
        results.push({ dictionary, frequencies, dictionaryAlias, freqCount });
    }
    return results;
}

export function getGroupedPronunciations(
    dictionaryEntry: Dictionary.TermDictionaryEntry,
): DictionaryGroupedPronunciations[] {
    const { headwords, pronunciations: termPronunciations } = dictionaryEntry;

    const allTerms = new Set<string>();
    const allReadings = new Set<string>();
    const aliasMap = new Map<string, string>();
    for (const { term, reading } of headwords) {
        allTerms.add(term);
        allReadings.add(reading);
    }

    const groupedPronunciationsMap = new Map<string, GroupedPronunciationInternal[]>();
    for (const { headwordIndex, dictionary, dictionaryAlias, pronunciations } of termPronunciations) {
        const { term, reading } = headwords[headwordIndex];
        let dictionaryGroupedPronunciationList = groupedPronunciationsMap.get(dictionary);
        if (typeof dictionaryGroupedPronunciationList === 'undefined') {
            dictionaryGroupedPronunciationList = [];
            groupedPronunciationsMap.set(dictionary, dictionaryGroupedPronunciationList);
            aliasMap.set(dictionary, dictionaryAlias);
        }
        for (const pronunciation of pronunciations) {
            let groupedPronunciation = findExistingGroupedPronunciation(
                reading,
                pronunciation,
                dictionaryGroupedPronunciationList,
            );
            if (groupedPronunciation === null) {
                groupedPronunciation = { pronunciation, terms: new Set(), reading };
                dictionaryGroupedPronunciationList.push(groupedPronunciation);
            }
            groupedPronunciation.terms.add(term);
        }
    }

    const results: DictionaryGroupedPronunciations[] = [];
    const multipleReadings = allReadings.size > 1;
    for (const [dictionary, dictionaryGroupedPronunciationList] of groupedPronunciationsMap.entries()) {
        const pronunciations2: GroupedPronunciation[] = [];
        const dictionaryAlias = aliasMap.get(dictionary) ?? dictionary;
        for (const groupedPronunciation of dictionaryGroupedPronunciationList) {
            const { pronunciation, terms, reading } = groupedPronunciation;
            const exclusiveTerms = !areSetsEqual(terms, allTerms) ? getSetIntersection(terms, allTerms) : [];
            const exclusiveReadings: string[] = [];
            if (multipleReadings) {
                exclusiveReadings.push(reading);
            }
            pronunciations2.push({ pronunciation, terms: [...terms], reading, exclusiveTerms, exclusiveReadings });
        }
        results.push({ dictionary, dictionaryAlias, pronunciations: pronunciations2 });
    }
    return results;
}

export function getPronunciationsOfType<T extends Dictionary.PronunciationType>(
    pronunciations: Dictionary.Pronunciation[],
    type: T,
): Dictionary.PronunciationGeneric<T>[] {
    const results: Dictionary.PronunciationGeneric<T>[] = [];
    for (const pronunciation of pronunciations) {
        if (pronunciation.type === type) {
            results.push(pronunciation as Dictionary.PronunciationGeneric<T>);
        }
    }
    return results;
}

export function getTermFrequency(termTags: { score: number }[]): TermFrequencyType {
    let totalScore = 0;
    for (const { score } of termTags) {
        totalScore += score;
    }
    if (totalScore > 0) {
        return 'popular';
    }
    if (totalScore < 0) {
        return 'rare';
    }
    return 'normal';
}

export function getDisambiguations(
    headwords: Dictionary.TermHeadword[],
    headwordIndices: number[],
    allTermsSet: Set<string>,
    allReadingsSet: Set<string>,
): string[] {
    if (allTermsSet.size <= 1 && allReadingsSet.size <= 1) {
        return [];
    }
    const terms = new Set<string>();
    const readings = new Set<string>();
    for (const headwordIndex of headwordIndices) {
        const { term, reading } = headwords[headwordIndex];
        terms.add(term);
        readings.add(reading);
    }
    const disambiguations: string[] = [];
    const addTerms = !areSetsEqual(terms, allTermsSet);
    const addReadings = !areSetsEqual(readings, allReadingsSet);
    if (addTerms) {
        disambiguations.push(...getSetIntersection(terms, allTermsSet));
    }
    if (addReadings) {
        if (addTerms) {
            for (const term of terms) {
                readings.delete(term);
            }
        }
        disambiguations.push(...getSetIntersection(readings, allReadingsSet));
    }
    return disambiguations;
}

export function isNonNounVerbOrAdjective(wordClasses: string[]): boolean {
    let isVerbOrAdjective = false;
    let isSuruVerb = false;
    let isNoun = false;
    for (const wordClass of wordClasses) {
        switch (wordClass) {
            case 'v1':
            case 'v5':
            case 'vk':
            case 'vz':
            case 'adj-i':
                isVerbOrAdjective = true;
                break;
            case 'vs':
                isVerbOrAdjective = true;
                isSuruVerb = true;
                break;
            case 'n':
                isNoun = true;
                break;
        }
    }
    return isVerbOrAdjective && !(isSuruVerb && isNoun);
}

export function compareRevisions(current: string, latest: string): boolean {
    const simpleVersionTest = /^(\d+\.)*\d+$/;
    if (!simpleVersionTest.test(current) || !simpleVersionTest.test(latest)) {
        return current < latest;
    }
    const currentParts = current.split('.').map((part) => Number.parseInt(part, 10));
    const latestParts = latest.split('.').map((part) => Number.parseInt(part, 10));
    if (currentParts.length !== latestParts.length) {
        return current < latest;
    }
    for (let i = 0; i < currentParts.length; i++) {
        if (currentParts[i] !== latestParts[i]) {
            return currentParts[i] < latestParts[i];
        }
    }
    return false;
}

// Private helpers

function findExistingGroupedPronunciation(
    reading: string,
    pronunciation: Dictionary.Pronunciation,
    groupedPronunciationList: GroupedPronunciationInternal[],
): GroupedPronunciationInternal | null {
    return (
        groupedPronunciationList.find(
            (gp) => gp.reading === reading && arePronunciationsEquivalent(gp, pronunciation),
        ) ?? null
    );
}

function arePronunciationsEquivalent(
    { pronunciation: pronunciation1 }: GroupedPronunciationInternal,
    pronunciation2: Dictionary.Pronunciation,
): boolean {
    if (pronunciation1.type !== pronunciation2.type || !areTagListsEqual(pronunciation1.tags, pronunciation2.tags)) {
        return false;
    }
    switch (pronunciation1.type) {
        case 'pitch-accent': {
            const pitchAccent2 = pronunciation2 as Dictionary.PitchAccent;
            return (
                pronunciation1.positions === pitchAccent2.positions &&
                areSimpleArraysEqual(pronunciation1.nasalPositions, pitchAccent2.nasalPositions) &&
                areSimpleArraysEqual(pronunciation1.devoicePositions, pitchAccent2.devoicePositions)
            );
        }
        case 'phonetic-transcription': {
            const phoneticTranscription2 = pronunciation2 as Dictionary.PhoneticTranscription;
            return pronunciation1.ipa === phoneticTranscription2.ipa;
        }
    }
    return true;
}

function areSimpleArraysEqual<T>(array1: T[], array2: T[]): boolean {
    const ii = array1.length;
    if (ii !== array2.length) {
        return false;
    }
    for (let i = 0; i < ii; ++i) {
        if (array1[i] !== array2[i]) {
            return false;
        }
    }
    return true;
}

function areTagListsEqual(tagList1: Dictionary.Tag[], tagList2: Dictionary.Tag[]): boolean {
    const ii = tagList1.length;
    if (tagList2.length !== ii) {
        return false;
    }
    for (let i = 0; i < ii; ++i) {
        const tag1 = tagList1[i];
        const tag2 = tagList2[i];
        if (tag1.name !== tag2.name || !areSimpleArraysEqual(tag1.dictionaries, tag2.dictionaries)) {
            return false;
        }
    }
    return true;
}

function areSetsEqual<T>(set1: Set<T>, set2: Set<T>): boolean {
    if (set1.size !== set2.size) {
        return false;
    }
    for (const value of set1) {
        if (!set2.has(value)) {
            return false;
        }
    }
    return true;
}

function getSetIntersection<T>(set1: Set<T>, set2: Set<T>): T[] {
    const result: T[] = [];
    for (const value of set1) {
        if (set2.has(value)) {
            result.push(value);
        }
    }
    return result;
}

function createMapKey(array: unknown[]): string {
    return JSON.stringify(array);
}
