import { distributeFurigana } from '../language/ja/furigana';
import type * as Dictionary from '../types/dictionary';
import type * as DictionaryData from '../types/dictionary-data';
import {
    getDisambiguations,
    getGroupedPronunciations,
    getPronunciationsOfType,
    getTermFrequency,
    groupTermTags,
    isNonNounVerbOrAdjective,
} from '../util/dictionary-data-util';
import type {
    AnkiCardFormat,
    CommonData,
    Context,
    GlossaryLayoutMode,
    Media,
    ResultOutputMode,
} from './anki-note-builder';

// --- Anki template types ---

export type NoteData = {
    marker: string;
    definition: AnkiDictionaryEntry;
    glossaryLayoutMode: GlossaryLayoutMode;
    compactTags: boolean;
    group: boolean;
    merge: boolean;
    compactGlossaries: boolean;
    uniqueExpressions: string[];
    uniqueReadings: string[];
    pitches: PitchGroup[];
    pitchCount: number;
    phoneticTranscriptions: TranscriptionGroup[];
    context: PublicContext;
    media: Media;
    dictionaryEntry: Dictionary.DictionaryEntry;
};

export type PublicContext = {
    query: string;
    fullQuery: string;
    document: { title: string };
};

export type AnkiDictionaryEntry = AnkiTermDictionaryEntry | AnkiKanjiDictionaryEntry | Record<string, never>;

export type TermDictionaryEntryType = 'term' | 'termGrouped' | 'termMerged';

export type Tag = {
    name: string;
    category: string;
    notes: string;
    order: number;
    score: number;
    dictionary: string;
    redundant: boolean;
};

export type PitchTag = {
    name: string;
    category: string;
    order: number;
    score: number;
    content: string[];
    dictionaries: string[];
    redundant: boolean;
};

export type Pitch = {
    expressions: string[];
    reading: string;
    positions: number | string;
    nasalPositions: number[];
    devoicePositions: number[];
    tags: PitchTag[];
    exclusiveExpressions: string[];
    exclusiveReadings: string[];
};

export type PitchGroup = {
    dictionary: string;
    pitches: Pitch[];
};

export type Transcription = {
    expressions: string[];
    reading: string;
    ipa: string;
    tags: Dictionary.Tag[];
    exclusiveExpressions: string[];
    exclusiveReadings: string[];
};

export type TranscriptionGroup = {
    dictionary: string;
    phoneticTranscriptions: Transcription[];
};

export type FuriganaSegment = {
    text: string;
    furigana: string;
};

export type Cloze = {
    sentence: string;
    prefix: string;
    body: string;
    bodyKana: string;
    suffix: string;
};

export type FrequencyNumber = {
    dictionary: string;
    frequency: number;
};

export type TermFrequencyEntry = {
    index: number;
    expressionIndex: number;
    dictionary: string;
    dictionaryAlias: string;
    dictionaryOrder: { index: number };
    expression: string;
    reading: string;
    hasReading: boolean;
    frequency: number | string;
};

export type TermPitchAccent = {
    index: number;
    expressionIndex: number;
    dictionary: string;
    dictionaryAlias: string;
    dictionaryOrder: { index: number };
    expression: string;
    reading: string;
    pitches: { positions: number | string; tags: Tag[] }[];
};

export type TermPhoneticTranscription = {
    index: number;
    expressionIndex: number;
    dictionary: string;
    dictionaryAlias: string;
    dictionaryOrder: { index: number };
    expression: string;
    reading: string;
    phoneticTranscriptions: { ipa: string; tags: Tag[] }[];
};

export type TermHeadword = {
    sourceTerm: string;
    expression: string;
    reading: string;
    termTags: Tag[];
    frequencies: TermFrequencyEntry[];
    pitches: TermPitchAccent[];
    furiganaSegments: FuriganaSegment[];
    termFrequency: 'popular' | 'rare' | 'normal';
    wordClasses: string[];
};

export type TermDefinition = {
    sequence: number;
    dictionary: string;
    dictionaryAlias: string;
    glossaryScopedStyles: string;
    dictScopedStyles: string;
    glossary: DictionaryData.TermGlossaryContent[];
    definitionTags: Tag[];
    only?: string[];
};

export type KanjiStat = {
    name: string;
    category: string;
    notes: string;
    order: number;
    score: number;
    dictionary: string;
    value: number | string;
};

export type KanjiStatGroups = {
    [key: string]: KanjiStat[];
};

export type KanjiFrequencyEntry = {
    index: number;
    dictionary: string;
    dictionaryAlias: string;
    dictionaryOrder: { index: number };
    character: string;
    frequency: number | string;
};

export type AnkiTermDictionaryEntry = {
    type: TermDictionaryEntryType;
    id?: number;
    source: string | null;
    rawSource: string | null;
    sourceTerm?: string | null;
    inflectionRuleChainCandidates: Dictionary.InflectionRuleChainCandidate[];
    score: number;
    isPrimary?: boolean;
    sequence: number;
    dictionary: string;
    dictionaryAlias: string;
    dictionaryOrder: { index: number };
    dictionaryNames: string[];
    expression: string | string[];
    reading: string | string[];
    expressions: TermHeadword[];
    glossary?: DictionaryData.TermGlossaryContent[];
    glossaryScopedStyles?: string;
    dictScopedStyles?: string;
    definitionTags?: Tag[];
    termTags?: Tag[];
    definitions?: TermDefinition[];
    frequencies: TermFrequencyEntry[];
    frequencyNumbers: FrequencyNumber[];
    frequencyHarmonic: number;
    frequencyAverage: number;
    pitches: TermPitchAccent[];
    phoneticTranscriptions: TermPhoneticTranscription[];
    sourceTermExactMatchCount: number;
    url: string;
    cloze: Cloze;
    furiganaSegments?: FuriganaSegment[];
};

export type AnkiKanjiDictionaryEntry = {
    type: 'kanji';
    character: string;
    dictionary: string;
    dictionaryAlias: string;
    onyomi: string[];
    kunyomi: string[];
    glossary: string[];
    tags: Tag[];
    stats: KanjiStatGroups;
    frequencies: KanjiFrequencyEntry[];
    frequencyHarmonic: number;
    frequencyAverage: number;
    url: string;
    cloze: Cloze;
};

// --- Cached value helpers ---

type CachedValue<T> = {
    getter: () => T;
    hasValue: boolean;
    value: T | undefined;
};

export function createCachedValue<T>(getter: () => T): CachedValue<T> {
    return { getter, hasValue: false, value: undefined };
}

export function getCachedValue<T>(item: CachedValue<T>): T {
    if (item.hasValue) {
        return item.value as T;
    }
    const value = item.getter();
    item.value = value;
    item.hasValue = true;
    return value;
}

// --- Main function ---

/**
 * Creates a compatibility representation of the specified data for Anki template rendering.
 */
export function createAnkiNoteData(marker: string, details: CommonData): NoteData {
    const { dictionaryEntry, resultOutputMode, glossaryLayoutMode, compactTags, context, media, dictionaryStylesMap } =
        details;

    const definition = createCachedValue(() =>
        getDefinition(dictionaryEntry, context, resultOutputMode, dictionaryStylesMap, glossaryLayoutMode),
    );
    const uniqueExpressions = createCachedValue(() => getUniqueExpressions(dictionaryEntry));
    const uniqueReadings = createCachedValue(() => getUniqueReadings(dictionaryEntry));
    const context2 = createCachedValue(() => getPublicContext(context));
    const pitches = createCachedValue(() => getPitches(dictionaryEntry));
    const pitchCount = createCachedValue(() => getPitchCount(pitches));
    const phoneticTranscriptions = createCachedValue(() => getPhoneticTranscriptions(dictionaryEntry));

    let resolvedMedia: Media;
    if (typeof media !== 'object' || media === null || Array.isArray(media)) {
        resolvedMedia = {
            audio: undefined,
            screenshot: undefined,
            clipboardImage: undefined,
            clipboardText: undefined,
            popupSelectionText: undefined,
            textFurigana: [],
            dictionaryMedia: {},
        };
    } else {
        resolvedMedia = media;
    }

    const result: NoteData = {
        marker,
        get definition() {
            return getCachedValue(definition);
        },
        glossaryLayoutMode,
        compactTags,
        group: resultOutputMode === 'group',
        merge: resultOutputMode === 'merge',
        compactGlossaries: glossaryLayoutMode === 'compact-popup-anki',
        get uniqueExpressions() {
            return getCachedValue(uniqueExpressions);
        },
        get uniqueReadings() {
            return getCachedValue(uniqueReadings);
        },
        get pitches() {
            return getCachedValue(pitches);
        },
        get pitchCount() {
            return getCachedValue(pitchCount);
        },
        get phoneticTranscriptions() {
            return getCachedValue(phoneticTranscriptions);
        },
        get context() {
            return getCachedValue(context2);
        },
        media: resolvedMedia,
        dictionaryEntry,
    };
    Object.defineProperty(result, 'dictionaryEntry', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: dictionaryEntry,
    });
    return result;
}

// --- Private helpers ---

function getPrimarySource(dictionaryEntry: Dictionary.TermDictionaryEntry): Dictionary.TermSource | null {
    for (const headword of dictionaryEntry.headwords) {
        for (const source of headword.sources) {
            if (source.isPrimary) {
                return source;
            }
        }
    }
    return null;
}

function getUniqueExpressions(dictionaryEntry: Dictionary.DictionaryEntry): string[] {
    if (dictionaryEntry.type === 'term') {
        const results = new Set<string>();
        for (const { term } of dictionaryEntry.headwords) {
            results.add(term);
        }
        return [...results];
    }
    return [];
}

function getUniqueReadings(dictionaryEntry: Dictionary.DictionaryEntry): string[] {
    if (dictionaryEntry.type === 'term') {
        const results = new Set<string>();
        for (const { reading } of dictionaryEntry.headwords) {
            results.add(reading);
        }
        return [...results];
    }
    return [];
}

function getPublicContext(context: Context): PublicContext {
    let { documentTitle } = context;
    if (typeof documentTitle !== 'string') {
        documentTitle = '';
    }
    return {
        query: context.query,
        fullQuery: context.fullQuery,
        document: {
            title: documentTitle,
        },
    };
}

function getFrequencyNumbers(
    dictionaryEntry: Dictionary.TermDictionaryEntry | Dictionary.KanjiDictionaryEntry,
    requestedHeadwordIndex: number | null,
): FrequencyNumber[] {
    let previousDictionary: string | undefined;
    const frequencies: FrequencyNumber[] = [];
    for (const dictionaryEntryFrequency of dictionaryEntry.frequencies) {
        const { dictionary, frequency, displayValue } = dictionaryEntryFrequency;
        const wrongHeadwordIndex =
            Number.isInteger(requestedHeadwordIndex) &&
            'headwordIndex' in dictionaryEntryFrequency &&
            dictionaryEntryFrequency.headwordIndex !== requestedHeadwordIndex;
        if (dictionary === previousDictionary || wrongHeadwordIndex) {
            continue;
        }
        previousDictionary = dictionary;

        if (displayValue !== null) {
            const frequencyMatch = displayValue.match(/^\d+/);
            if (frequencyMatch !== null) {
                const frequencyParsed = Number.parseInt(frequencyMatch[0], 10);
                if (frequencyParsed > 0) {
                    frequencies.push({ dictionary, frequency: frequencyParsed });
                    continue;
                }
            }
        }
        if (frequency > 0) {
            frequencies.push({ dictionary, frequency });
        }
    }
    return frequencies;
}

export function getFrequencyHarmonic(
    dictionaryEntry: Dictionary.TermDictionaryEntry | Dictionary.KanjiDictionaryEntry,
    headwordIndex: number | null,
): number {
    const frequencies = getFrequencyNumbers(dictionaryEntry, headwordIndex);

    if (frequencies.length === 0) {
        return -1;
    }

    let total = 0;
    for (const frequency of frequencies) {
        total += 1 / frequency.frequency;
    }
    return Math.floor(frequencies.length / total);
}

function getFrequencyAverage(
    dictionaryEntry: Dictionary.TermDictionaryEntry | Dictionary.KanjiDictionaryEntry,
    headwordIndex: number | null,
): number {
    const frequencies = getFrequencyNumbers(dictionaryEntry, headwordIndex);

    if (frequencies.length === 0) {
        return -1;
    }

    let total = 0;
    for (const frequency of frequencies) {
        total += frequency.frequency;
    }
    return Math.floor(total / frequencies.length);
}

function getPitches(dictionaryEntry: Dictionary.DictionaryEntry): PitchGroup[] {
    const results: PitchGroup[] = [];
    if (dictionaryEntry.type === 'term') {
        for (const { dictionary, pronunciations } of getGroupedPronunciations(dictionaryEntry)) {
            const pitches: Pitch[] = [];
            for (const groupedPronunciation of pronunciations) {
                const { pronunciation } = groupedPronunciation;
                if (pronunciation.type !== 'pitch-accent') {
                    continue;
                }
                const { positions, nasalPositions, devoicePositions, tags } = pronunciation;
                const { terms, reading, exclusiveTerms, exclusiveReadings } = groupedPronunciation;
                pitches.push({
                    expressions: terms,
                    reading,
                    positions,
                    nasalPositions,
                    devoicePositions,
                    tags: convertPitchTags(tags),
                    exclusiveExpressions: exclusiveTerms,
                    exclusiveReadings,
                });
            }
            results.push({ dictionary, pitches });
        }
    }
    return results;
}

function getPhoneticTranscriptions(dictionaryEntry: Dictionary.DictionaryEntry): TranscriptionGroup[] {
    const results: TranscriptionGroup[] = [];
    if (dictionaryEntry.type === 'term') {
        for (const { dictionary, pronunciations } of getGroupedPronunciations(dictionaryEntry)) {
            const phoneticTranscriptions: Transcription[] = [];
            for (const groupedPronunciation of pronunciations) {
                const { pronunciation } = groupedPronunciation;
                if (pronunciation.type !== 'phonetic-transcription') {
                    continue;
                }
                const { ipa, tags } = pronunciation;
                const { terms, reading, exclusiveTerms, exclusiveReadings } = groupedPronunciation;
                phoneticTranscriptions.push({
                    expressions: terms,
                    reading,
                    ipa,
                    tags,
                    exclusiveExpressions: exclusiveTerms,
                    exclusiveReadings,
                });
            }
            results.push({ dictionary, phoneticTranscriptions });
        }
    }
    return results;
}

function getPitchCount(cachedPitches: CachedValue<PitchGroup[]>): number {
    const pitches = getCachedValue(cachedPitches);
    return pitches.reduce((i, v) => i + v.pitches.length, 0);
}

function getDefinition(
    dictionaryEntry: Dictionary.DictionaryEntry,
    context: Context,
    resultOutputMode: ResultOutputMode,
    dictionaryStylesMap: Map<string, string>,
    glossaryLayoutMode: GlossaryLayoutMode,
): AnkiDictionaryEntry {
    switch (dictionaryEntry.type) {
        case 'term':
            return getTermDefinition(
                dictionaryEntry,
                context,
                resultOutputMode,
                dictionaryStylesMap,
                glossaryLayoutMode,
            );
        case 'kanji':
            return getKanjiDefinition(dictionaryEntry, context);
        default:
            return {} as Record<string, never>;
    }
}

function getKanjiDefinition(
    dictionaryEntry: Dictionary.KanjiDictionaryEntry,
    context: Context,
): AnkiKanjiDictionaryEntry {
    const { character, dictionary, dictionaryAlias, onyomi, kunyomi, definitions } = dictionaryEntry;

    let { url } = context;
    if (typeof url !== 'string') {
        url = '';
    }

    const stats = createCachedValue(() => getKanjiStats(dictionaryEntry));
    const tags = createCachedValue(() => convertTags(dictionaryEntry.tags));
    const frequencies = createCachedValue(() => getKanjiFrequencies(dictionaryEntry));
    const frequencyHarmonic = createCachedValue(() => getFrequencyHarmonic(dictionaryEntry, null));
    const frequencyAverage = createCachedValue(() => getFrequencyAverage(dictionaryEntry, null));
    const cloze = createCachedValue(() => getCloze(dictionaryEntry, context));

    return {
        type: 'kanji',
        character,
        dictionary,
        dictionaryAlias,
        onyomi,
        kunyomi,
        glossary: definitions,
        get tags() {
            return getCachedValue(tags);
        },
        get stats() {
            return getCachedValue(stats);
        },
        get frequencies() {
            return getCachedValue(frequencies);
        },
        get frequencyHarmonic() {
            return getCachedValue(frequencyHarmonic);
        },
        get frequencyAverage() {
            return getCachedValue(frequencyAverage);
        },
        url,
        get cloze() {
            return getCachedValue(cloze);
        },
    };
}

function getKanjiStats(dictionaryEntry: Dictionary.KanjiDictionaryEntry): KanjiStatGroups {
    const results: KanjiStatGroups = {};
    for (const [key, value] of Object.entries(dictionaryEntry.stats)) {
        results[key] = value.map(convertKanjiStat);
    }
    return results;
}

function convertKanjiStat({
    name,
    category,
    content,
    order,
    score,
    dictionary,
    value,
}: Dictionary.KanjiStat): KanjiStat {
    return {
        name,
        category,
        notes: content,
        order,
        score,
        dictionary,
        value,
    };
}

function getKanjiFrequencies(dictionaryEntry: Dictionary.KanjiDictionaryEntry): KanjiFrequencyEntry[] {
    const results: KanjiFrequencyEntry[] = [];
    for (const {
        index,
        dictionary,
        dictionaryAlias,
        dictionaryIndex,
        character,
        frequency,
        displayValue,
    } of dictionaryEntry.frequencies) {
        results.push({
            index,
            dictionary,
            dictionaryAlias,
            dictionaryOrder: {
                index: dictionaryIndex,
            },
            character,
            frequency: displayValue !== null ? displayValue : frequency,
        });
    }
    return results;
}

function getTermDefinition(
    dictionaryEntry: Dictionary.TermDictionaryEntry,
    context: Context,
    resultOutputMode: ResultOutputMode,
    dictionaryStylesMap: Map<string, string>,
    glossaryLayoutMode: GlossaryLayoutMode,
): AnkiTermDictionaryEntry {
    let type: TermDictionaryEntryType = 'term';
    switch (resultOutputMode) {
        case 'group':
            type = 'termGrouped';
            break;
        case 'merge':
            type = 'termMerged';
            break;
    }

    const { inflectionRuleChainCandidates, score, dictionaryIndex, sourceTermExactMatchCount, definitions } =
        dictionaryEntry;

    let { url } = context;
    if (typeof url !== 'string') {
        url = '';
    }

    const primarySource = getPrimarySource(dictionaryEntry);

    const dictionaryAliases = createCachedValue(() => getTermDictionaryAliases(dictionaryEntry));
    const dictionaryNames = createCachedValue(() => getTermDictionaryNames(dictionaryEntry));
    const commonInfo = createCachedValue(() =>
        getTermDictionaryEntryCommonInfo(dictionaryEntry, type, dictionaryStylesMap, glossaryLayoutMode),
    );
    const termTags = createCachedValue(() => getTermTags(dictionaryEntry, type));
    const expressions = createCachedValue(() => getTermExpressions(dictionaryEntry));
    const frequencies = createCachedValue(() => getTermFrequenciesAnki(dictionaryEntry));
    const frequencyNumbersCV = createCachedValue(() => getFrequencyNumbers(dictionaryEntry, null));
    const frequencyHarmonic = createCachedValue(() => getFrequencyHarmonic(dictionaryEntry, null));
    const frequencyAverage = createCachedValue(() => getFrequencyAverage(dictionaryEntry, null));
    const pitches = createCachedValue(() => getTermPitches(dictionaryEntry));
    const phoneticTranscriptions = createCachedValue(() => getTermPhoneticTranscriptions(dictionaryEntry));
    const glossary = createCachedValue(() => getTermGlossaryArray(dictionaryEntry, type));
    const styleInfo = createCachedValue(() => getTermStyles(dictionaryEntry, type, dictionaryStylesMap));
    const cloze = createCachedValue(() => getCloze(dictionaryEntry, context));
    const furiganaSegments = createCachedValue(() => getTermFuriganaSegments(dictionaryEntry, type));
    const sequence = createCachedValue(() => getTermDictionaryEntrySequence(dictionaryEntry));

    return {
        type,
        id: type === 'term' && definitions.length > 0 ? definitions[0].id : undefined,
        source: primarySource !== null ? primarySource.transformedText : null,
        rawSource: primarySource !== null ? primarySource.originalText : null,
        sourceTerm: type !== 'termMerged' ? (primarySource !== null ? primarySource.deinflectedText : null) : undefined,
        inflectionRuleChainCandidates,
        score,
        isPrimary: type === 'term' ? dictionaryEntry.isPrimary : undefined,
        get sequence() {
            return getCachedValue(sequence);
        },
        get dictionary() {
            return getCachedValue(dictionaryNames)[0];
        },
        get dictionaryAlias() {
            return getCachedValue(dictionaryAliases)[0];
        },
        dictionaryOrder: {
            index: dictionaryIndex,
        },
        get dictionaryNames() {
            return getCachedValue(dictionaryNames);
        },
        get expression() {
            const { uniqueTerms } = getCachedValue(commonInfo);
            return (type === 'term' || type === 'termGrouped' ? uniqueTerms[0] : uniqueTerms) as string | string[];
        },
        get reading() {
            const { uniqueReadings } = getCachedValue(commonInfo);
            return (type === 'term' || type === 'termGrouped' ? uniqueReadings[0] : uniqueReadings) as
                | string
                | string[];
        },
        get expressions() {
            return getCachedValue(expressions);
        },
        get glossary() {
            return getCachedValue(glossary);
        },
        get glossaryScopedStyles() {
            return getCachedValue(styleInfo)?.glossaryScopedStyles;
        },
        get dictScopedStyles() {
            return getCachedValue(styleInfo)?.dictScopedStyles;
        },
        get definitionTags() {
            return type === 'term' ? getCachedValue(commonInfo).definitionTags : undefined;
        },
        get termTags() {
            return getCachedValue(termTags);
        },
        get definitions() {
            return getCachedValue(commonInfo).definitions;
        },
        get frequencies() {
            return getCachedValue(frequencies);
        },
        get frequencyNumbers() {
            return getCachedValue(frequencyNumbersCV);
        },
        get frequencyHarmonic() {
            return getCachedValue(frequencyHarmonic);
        },
        get frequencyAverage() {
            return getCachedValue(frequencyAverage);
        },
        get pitches() {
            return getCachedValue(pitches);
        },
        get phoneticTranscriptions() {
            return getCachedValue(phoneticTranscriptions);
        },
        sourceTermExactMatchCount,
        url,
        get cloze() {
            return getCachedValue(cloze);
        },
        get furiganaSegments() {
            return getCachedValue(furiganaSegments);
        },
    };
}

function getTermDictionaryNames(dictionaryEntry: Dictionary.TermDictionaryEntry): string[] {
    const dictionaryNames = new Set<string>();
    for (const { dictionary } of dictionaryEntry.definitions) {
        dictionaryNames.add(dictionary);
    }
    return [...dictionaryNames];
}

function getTermDictionaryAliases(dictionaryEntry: Dictionary.TermDictionaryEntry): string[] {
    const dictionaryAliases = new Set<string>();
    for (const { dictionaryAlias } of dictionaryEntry.definitions) {
        dictionaryAliases.add(dictionaryAlias);
    }
    return [...dictionaryAliases];
}

function getTermDictionaryEntryCommonInfo(
    dictionaryEntry: Dictionary.TermDictionaryEntry,
    type: TermDictionaryEntryType,
    _dictionaryStylesMap: Map<string, string>,
    _glossaryLayoutMode: GlossaryLayoutMode,
): { uniqueTerms: string[]; uniqueReadings: string[]; definitionTags: Tag[]; definitions?: TermDefinition[] } {
    const merged = type === 'termMerged';
    const hasDefinitions = type !== 'term';

    const allTermsSet = new Set<string>();
    const allReadingsSet = new Set<string>();
    for (const { term, reading } of dictionaryEntry.headwords) {
        allTermsSet.add(term);
        allReadingsSet.add(reading);
    }
    const uniqueTerms = [...allTermsSet];
    const uniqueReadings = [...allReadingsSet];

    const definitions: TermDefinition[] = [];
    const definitionTags: Tag[] = [];
    for (const {
        tags,
        headwordIndices,
        entries,
        dictionary,
        dictionaryAlias,
        sequences,
    } of dictionaryEntry.definitions) {
        const definitionTags2: Tag[] = [];
        for (const tag of tags) {
            definitionTags.push(convertTag(tag));
            definitionTags2.push(convertTag(tag));
        }
        if (!hasDefinitions) {
            continue;
        }
        const only = merged
            ? getDisambiguations(dictionaryEntry.headwords, headwordIndices, allTermsSet, allReadingsSet)
            : undefined;
        definitions.push({
            sequence: sequences[0],
            dictionary,
            dictionaryAlias,
            glossaryScopedStyles: '',
            dictScopedStyles: '',
            glossary: entries,
            definitionTags: definitionTags2,
            only,
        });
    }

    return {
        uniqueTerms,
        uniqueReadings,
        definitionTags,
        definitions: hasDefinitions ? definitions : undefined,
    };
}

function getTermFrequenciesAnki(dictionaryEntry: Dictionary.TermDictionaryEntry): TermFrequencyEntry[] {
    const results: TermFrequencyEntry[] = [];
    const { headwords } = dictionaryEntry;
    for (const {
        headwordIndex,
        dictionary,
        dictionaryAlias,
        dictionaryIndex,
        hasReading,
        frequency,
        displayValue,
    } of dictionaryEntry.frequencies) {
        const { term, reading } = headwords[headwordIndex];
        results.push({
            index: results.length,
            expressionIndex: headwordIndex,
            dictionary,
            dictionaryAlias,
            dictionaryOrder: {
                index: dictionaryIndex,
            },
            expression: term,
            reading,
            hasReading,
            frequency: displayValue !== null ? displayValue : frequency,
        });
    }
    return results;
}

function getTermPitches(dictionaryEntry: Dictionary.TermDictionaryEntry): TermPitchAccent[] {
    const results: TermPitchAccent[] = [];
    const { headwords } = dictionaryEntry;
    for (const {
        headwordIndex,
        dictionary,
        dictionaryAlias,
        dictionaryIndex,
        pronunciations,
    } of dictionaryEntry.pronunciations) {
        const { term, reading } = headwords[headwordIndex];
        const pitchAccents = getPronunciationsOfType(pronunciations, 'pitch-accent');
        const cachedPitches = createCachedValue(() => getTermPitchesInner(pitchAccents));
        results.push({
            index: results.length,
            expressionIndex: headwordIndex,
            dictionary,
            dictionaryAlias,
            dictionaryOrder: {
                index: dictionaryIndex,
            },
            expression: term,
            reading,
            get pitches() {
                return getCachedValue(cachedPitches);
            },
        });
    }
    return results;
}

function getTermPitchesInner(pitches: Dictionary.PitchAccent[]): { positions: number | string; tags: Tag[] }[] {
    const results: { positions: number | string; tags: Tag[] }[] = [];
    for (const { positions, tags } of pitches) {
        const cachedTags = createCachedValue(() => convertTags(tags));
        results.push({
            positions,
            get tags() {
                return getCachedValue(cachedTags);
            },
        });
    }
    return results;
}

function getTermPhoneticTranscriptions(dictionaryEntry: Dictionary.TermDictionaryEntry): TermPhoneticTranscription[] {
    const results: TermPhoneticTranscription[] = [];
    const { headwords } = dictionaryEntry;
    for (const {
        headwordIndex,
        dictionary,
        dictionaryAlias,
        dictionaryIndex,
        pronunciations,
    } of dictionaryEntry.pronunciations) {
        const { term, reading } = headwords[headwordIndex];
        const phoneticTranscriptions = getPronunciationsOfType(pronunciations, 'phonetic-transcription');
        const termPhoneticTranscriptions = getTermPhoneticTranscriptionsInner(phoneticTranscriptions);
        results.push({
            index: results.length,
            expressionIndex: headwordIndex,
            dictionary,
            dictionaryAlias,
            dictionaryOrder: {
                index: dictionaryIndex,
            },
            expression: term,
            reading,
            get phoneticTranscriptions() {
                return termPhoneticTranscriptions;
            },
        });
    }
    return results;
}

function getTermPhoneticTranscriptionsInner(
    phoneticTranscriptions: Dictionary.PhoneticTranscription[],
): { ipa: string; tags: Tag[] }[] {
    const results: { ipa: string; tags: Tag[] }[] = [];
    for (const { ipa, tags } of phoneticTranscriptions) {
        const cachedTags = createCachedValue(() => convertTags(tags));
        results.push({
            ipa,
            get tags() {
                return getCachedValue(cachedTags);
            },
        });
    }
    return results;
}

function getTermExpressions(dictionaryEntry: Dictionary.TermDictionaryEntry): TermHeadword[] {
    const results: TermHeadword[] = [];
    const { headwords } = dictionaryEntry;
    for (let i = 0, ii = headwords.length; i < ii; ++i) {
        const {
            term,
            reading,
            tags,
            sources: [{ deinflectedText }],
            wordClasses,
        } = headwords[i];
        const termTagsCV = createCachedValue(() => convertTags(tags));
        const frequenciesCV = createCachedValue(() => getTermExpressionFrequencies(dictionaryEntry, i));
        const pitchesCV = createCachedValue(() => getTermExpressionPitches(dictionaryEntry, i));
        const termFrequencyCV = createCachedValue(() => getTermExpressionTermFrequency(termTagsCV));
        const furiganaSegmentsCV = createCachedValue(() => getTermHeadwordFuriganaSegments(term, reading));
        const item: TermHeadword = {
            sourceTerm: deinflectedText,
            expression: term,
            reading,
            get termTags() {
                return getCachedValue(termTagsCV);
            },
            get frequencies() {
                return getCachedValue(frequenciesCV);
            },
            get pitches() {
                return getCachedValue(pitchesCV);
            },
            get furiganaSegments() {
                return getCachedValue(furiganaSegmentsCV);
            },
            get termFrequency() {
                return getCachedValue(termFrequencyCV);
            },
            wordClasses,
        };
        results.push(item);
    }
    return results;
}

function getTermExpressionFrequencies(
    dictionaryEntry: Dictionary.TermDictionaryEntry,
    i: number,
): TermFrequencyEntry[] {
    const results: TermFrequencyEntry[] = [];
    const { headwords, frequencies } = dictionaryEntry;
    for (const {
        headwordIndex,
        dictionary,
        dictionaryAlias,
        dictionaryIndex,
        hasReading,
        frequency,
        displayValue,
    } of frequencies) {
        if (headwordIndex !== i) {
            continue;
        }
        const { term, reading } = headwords[headwordIndex];
        results.push({
            index: results.length,
            expressionIndex: headwordIndex,
            dictionary,
            dictionaryAlias,
            dictionaryOrder: {
                index: dictionaryIndex,
            },
            expression: term,
            reading,
            hasReading,
            frequency: displayValue !== null ? displayValue : frequency,
        });
    }
    return results;
}

function getTermExpressionPitches(dictionaryEntry: Dictionary.TermDictionaryEntry, i: number): TermPitchAccent[] {
    const results: TermPitchAccent[] = [];
    const { headwords, pronunciations: termPronunciations } = dictionaryEntry;
    for (const { headwordIndex, dictionary, dictionaryAlias, dictionaryIndex, pronunciations } of termPronunciations) {
        if (headwordIndex !== i) {
            continue;
        }
        const { term, reading } = headwords[headwordIndex];
        const pitchAccents = getPronunciationsOfType(pronunciations, 'pitch-accent');
        const cachedPitches = createCachedValue(() => getTermPitchesInner(pitchAccents));
        results.push({
            index: results.length,
            expressionIndex: headwordIndex,
            dictionary,
            dictionaryAlias,
            dictionaryOrder: {
                index: dictionaryIndex,
            },
            expression: term,
            reading,
            get pitches() {
                return getCachedValue(cachedPitches);
            },
        });
    }
    return results;
}

function getTermExpressionTermFrequency(cachedTermTags: CachedValue<Tag[]>): 'popular' | 'rare' | 'normal' {
    const termTags = getCachedValue(cachedTermTags);
    return getTermFrequency(termTags);
}

function getTermGlossaryArray(
    dictionaryEntry: Dictionary.TermDictionaryEntry,
    type: TermDictionaryEntryType,
): DictionaryData.TermGlossaryContent[] | undefined {
    if (type === 'term') {
        const results: DictionaryData.TermGlossaryContent[] = [];
        for (const { entries } of dictionaryEntry.definitions) {
            results.push(...entries);
        }
        return results;
    }
    return undefined;
}

function getTermStyles(
    dictionaryEntry: Dictionary.TermDictionaryEntry,
    type: TermDictionaryEntryType,
    _dictionaryStylesMap: Map<string, string>,
): { glossaryScopedStyles: string; dictScopedStyles: string } | undefined {
    if (type !== 'term') {
        return undefined;
    }
    // In the library version, CSS scoping is simplified since we don't have
    // the full CSS manipulation utilities. Consumers can post-process styles.
    return { glossaryScopedStyles: '', dictScopedStyles: '' };
}

function getTermTags(
    dictionaryEntry: Dictionary.TermDictionaryEntry,
    type: TermDictionaryEntryType,
): Tag[] | undefined {
    if (type !== 'termMerged') {
        const results: Tag[] = [];
        for (const { tag } of groupTermTags(dictionaryEntry)) {
            results.push(convertTag(tag));
        }
        return results;
    }
    return undefined;
}

function convertTags(tags: Dictionary.Tag[]): Tag[] {
    const results: Tag[] = [];
    for (const tag of tags) {
        results.push(convertTag(tag));
    }
    return results;
}

function convertTag({ name, category, content, order, score, dictionaries, redundant }: Dictionary.Tag): Tag {
    return {
        name,
        category,
        notes: content.length > 0 ? content[0] : '',
        order,
        score,
        dictionary: dictionaries.length > 0 ? dictionaries[0] : '',
        redundant,
    };
}

function convertPitchTags(tags: Dictionary.Tag[]): PitchTag[] {
    const results: PitchTag[] = [];
    for (const tag of tags) {
        results.push(convertPitchTag(tag));
    }
    return results;
}

function convertPitchTag({ name, category, content, order, score, dictionaries, redundant }: Dictionary.Tag): PitchTag {
    return {
        name,
        category,
        order,
        score,
        content: [...content],
        dictionaries: [...dictionaries],
        redundant,
    };
}

function getCloze(dictionaryEntry: Dictionary.DictionaryEntry, context: Context): Cloze {
    let originalText = '';
    let term = '';
    let reading = '';
    switch (dictionaryEntry.type) {
        case 'term':
            {
                term = dictionaryEntry.headwords[0].term;
                reading = dictionaryEntry.headwords[0].reading;
                const primarySource = getPrimarySource(dictionaryEntry);
                if (primarySource !== null) {
                    originalText = primarySource.originalText;
                }
            }
            break;
        case 'kanji':
            originalText = dictionaryEntry.character;
            break;
    }

    const { sentence } = context;
    let text: string | undefined;
    let offset: number | undefined;
    if (typeof sentence === 'object' && sentence !== null) {
        ({ text, offset } = sentence);
    }
    if (typeof text !== 'string') {
        text = '';
    }
    if (typeof offset !== 'number') {
        offset = 0;
    }
    const textChars = [...text];

    const textSegments: string[] = [];
    for (const { text: text2, reading: reading2 } of distributeFurigana(
        term,
        textChars.slice(offset, offset + originalText.length).join(''),
    )) {
        textSegments.push(reading2.length > 0 ? reading2 : text2);
    }

    return {
        sentence: textChars.join(''),
        prefix: textChars.slice(0, offset).join(''),
        body: textChars.slice(offset, offset + originalText.length).join(''),
        bodyKana: textSegments.join(''),
        suffix: textChars.slice(offset + originalText.length).join(''),
    };
}

function getTermFuriganaSegments(
    dictionaryEntry: Dictionary.TermDictionaryEntry,
    type: TermDictionaryEntryType,
): FuriganaSegment[] | undefined {
    if (type === 'term') {
        for (const { term, reading } of dictionaryEntry.headwords) {
            return getTermHeadwordFuriganaSegments(term, reading);
        }
    }
    return undefined;
}

function getTermHeadwordFuriganaSegments(term: string, reading: string): FuriganaSegment[] {
    const result: FuriganaSegment[] = [];
    for (const { text, reading: reading2 } of distributeFurigana(term, reading)) {
        result.push({ text, furigana: reading2 });
    }
    return result;
}

function getTermDictionaryEntrySequence(dictionaryEntry: Dictionary.TermDictionaryEntry): number {
    let hasSequence = false;
    let mainSequence = -1;
    if (!dictionaryEntry.isPrimary) {
        return mainSequence;
    }
    for (const { sequences } of dictionaryEntry.definitions) {
        const sequence = sequences[0];
        if (!hasSequence) {
            mainSequence = sequence;
            hasSequence = true;
            if (mainSequence === -1) {
                break;
            }
        } else if (mainSequence !== sequence) {
            mainSequence = -1;
            break;
        }
    }
    return mainSequence;
}
