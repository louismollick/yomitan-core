import type { DictionaryDatabaseBackend } from './database/backend';
import type { DictionaryUpdateInfo, FrequencyRankingResult, TermLookupResult, YomitanCore } from './index';
import type { FindTermsMode } from './lookup/translator';
import type { KanjiDictionaryEntry, TermDictionaryEntry } from './types/dictionary';
import type { ImportResult, OnProgressCallback, Summary } from './types/dictionary-importer';
import type { Utf16Range } from './types/parse';
import type { FindTermsTextReplacements, SearchResolution } from './types/translation';

export interface DictionarySelection {
    id: string;
    index: number;
    priority?: number;
    alias?: string;
    allowSecondarySearches?: boolean;
    partsOfSpeechFilter?: boolean;
    useDeinflections?: boolean;
}

export interface InstalledDictionary extends Summary {
    id: string;
}

export interface LookupOptions {
    scanLength?: number;
    mode?: FindTermsMode;
    matchType?: 'exact' | 'prefix' | 'suffix';
    deinflect?: boolean;
    removeNonJapaneseCharacters?: boolean;
    searchResolution?: SearchResolution;
    textReplacements?: FindTermsTextReplacements;
    mainDictionary?: string;
    sortFrequencyDictionary?: string | null;
    sortFrequencyDictionaryOrder?: 'ascending' | 'descending';
}

export interface HeadwordCandidate {
    term: string;
    reading: string;
}

export interface ScannedToken {
    text: string;
    range: Utf16Range;
    reading: string;
    selectable: boolean;
    headwords: HeadwordCandidate[];
}

export interface ScanLineRequest {
    text: string;
    language: string;
    dictionaries: DictionarySelection[];
    options?: LookupOptions;
}

export interface TermAtRequest extends ScanLineRequest {
    utf16Offset: number;
}

export interface TermsRequest extends ScanLineRequest {}

export interface KanjiRequest {
    text: string;
    dictionaries: DictionarySelection[];
    removeNonJapaneseCharacters?: boolean;
}

export interface TermAtResult extends TermLookupResult {
    range: Utf16Range;
}

export interface YomitanClient {
    initialize(): Promise<void>;
    dispose(): Promise<void>;
    readonly dictionaries: {
        list(): Promise<InstalledDictionary[]>;
        import(request: {
            source: ArrayBuffer;
            signal?: AbortSignal;
            onProgress?: OnProgressCallback;
        }): Promise<ImportResult>;
        remove(id: string): Promise<void>;
        checkUpdates(ids?: string[]): Promise<DictionaryUpdateInfo[]>;
    };
    readonly lookup: {
        scanLine(request: ScanLineRequest): Promise<ScannedToken[]>;
        termAt(request: TermAtRequest): Promise<TermAtResult | null>;
        terms(request: TermsRequest): Promise<TermLookupResult>;
        kanji(request: KanjiRequest): Promise<KanjiDictionaryEntry[]>;
        frequency(request: {
            term: string;
            reading?: string;
            dictionaries: DictionarySelection[];
        }): Promise<FrequencyRankingResult>;
    };
}

export interface CreateYomitanOptions {
    storage: DictionaryDatabaseBackend;
    initLanguage?: boolean;
}

export function createYomitanClient(core: YomitanCore): YomitanClient {
    return new YomitanClientImpl(core);
}

class YomitanClientImpl implements YomitanClient {
    private readonly core: YomitanCore;

    readonly dictionaries: YomitanClient['dictionaries'];
    readonly lookup: YomitanClient['lookup'];

    constructor(core: YomitanCore) {
        this.core = core;
        this.dictionaries = {
            list: async () =>
                (await this.core.getDictionaryInfo()).map((dictionary) => ({ ...dictionary, id: dictionary.title })),
            import: async ({ source, signal, onProgress }) => {
                signal?.throwIfAborted();
                const result = await this.core.importDictionary(source, {
                    signal,
                    onProgress: (progress) => {
                        onProgress?.(progress);
                    },
                });
                return result;
            },
            remove: async (id) => this.core.deleteDictionary(id),
            checkUpdates: async (ids) => this.core.checkForUpdates(ids),
        };
        this.lookup = {
            scanLine: async (request) => this.scanLine(request),
            termAt: async (request) => this.termAt(request),
            terms: async (request) => this.terms(request),
            kanji: async (request) =>
                this.core.findKanji(request.text, {
                    enabledDictionaryMap: toKanjiDictionaryMap(request.dictionaries),
                    removeNonJapaneseCharacters: request.removeNonJapaneseCharacters,
                }),
            frequency: async ({ term, reading, dictionaries }) =>
                this.core.getFrequencyRanking(
                    term,
                    dictionaries.map((dictionary) => dictionary.id),
                    reading,
                ),
        };
    }

    async initialize(): Promise<void> {
        await this.core.initialize();
    }

    async dispose(): Promise<void> {
        await this.core.dispose();
    }

    private async scanLine(request: ScanLineRequest): Promise<ScannedToken[]> {
        const parsed = await this.core.parseText(request.text, {
            language: request.language,
            enabledDictionaryMap: toTermDictionaryMap(request.dictionaries),
            scanLength: request.options?.scanLength,
            searchResolution: request.options?.searchResolution,
            removeNonJapaneseCharacters: request.options?.removeNonJapaneseCharacters,
            deinflect: request.options?.deinflect,
            textReplacements: request.options?.textReplacements,
        });
        const segments = parsed[0]?.content[0] ?? [];
        return segments.map((segment) => {
            const token: ScannedToken = {
                text: segment.text,
                range: segment.range,
                reading: segment.reading,
                selectable: Array.isArray(segment.headwords) && segment.headwords.length > 0,
                headwords: uniqueHeadwords(segment.headwords?.flat() ?? []),
            };
            return token;
        });
    }

    private async termAt(request: TermAtRequest): Promise<TermAtResult | null> {
        if (!isUtf16Boundary(request.text, request.utf16Offset) || request.utf16Offset === request.text.length) {
            return null;
        }
        const tokens = await this.scanLine(request);
        const token = tokens.find(
            ({ range, selectable }) =>
                selectable && range.startUtf16 <= request.utf16Offset && request.utf16Offset < range.endUtf16,
        );
        if (!token) {
            return null;
        }
        const result = await this.terms({ ...request, text: token.text });
        if (result.entries.length === 0 || result.originalTextLength <= 0) {
            return null;
        }
        return {
            ...result,
            range: token.range,
        };
    }

    private async terms(request: TermsRequest): Promise<TermLookupResult> {
        return this.core.findTerms(request.text, {
            mode: request.options?.mode,
            language: request.language,
            enabledDictionaryMap: toTermDictionaryMap(request.dictionaries),
            options: request.options,
        });
    }
}

function toTermDictionaryMap(dictionaries: DictionarySelection[]) {
    return new Map(
        dictionaries.map((dictionary) => [
            dictionary.id,
            {
                index: dictionary.index,
                priority: dictionary.priority ?? 0,
                alias: dictionary.alias ?? dictionary.id,
                allowSecondarySearches: dictionary.allowSecondarySearches ?? false,
                partsOfSpeechFilter: dictionary.partsOfSpeechFilter ?? true,
                useDeinflections: dictionary.useDeinflections ?? true,
            },
        ]),
    );
}

function toKanjiDictionaryMap(dictionaries: DictionarySelection[]) {
    return new Map(
        dictionaries.map((dictionary) => [
            dictionary.id,
            { index: dictionary.index, alias: dictionary.alias ?? dictionary.id },
        ]),
    );
}

function uniqueHeadwords(headwords: { term: string; reading: string }[]): HeadwordCandidate[] {
    const result: HeadwordCandidate[] = [];
    const seen = new Set<string>();
    for (const headword of headwords) {
        const key = `${headword.term}\u0000${headword.reading}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push({ term: headword.term, reading: headword.reading });
    }
    return result;
}

function isUtf16Boundary(text: string, offset: number): boolean {
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
        return false;
    }
    if (offset === 0 || offset === text.length) {
        return true;
    }
    const previous = text.charCodeAt(offset - 1);
    const current = text.charCodeAt(offset);
    return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

export type { KanjiDictionaryEntry, TermDictionaryEntry };
