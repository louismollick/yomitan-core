// Main entry point for yomitan-core
import { DictionaryDB } from './database/dictionary-database';
import type { DictionaryImporterClass } from './import/dictionary-importer';
import { getAllLanguageTextProcessors, getLanguageSummaries, isTextLookupWorthy } from './language/languages';
import { MultiLanguageTransformer } from './language/multi-language-transformer';
import type { BatchProcessor as BatchProcessorClass } from './lookup/batch-processor';
import type { FrequencyRanker as FrequencyRankerClass } from './lookup/frequency-ranking';
import type { SentenceParser as SentenceParserClass } from './lookup/sentence-parser';
import type { FindTermsMode, Translator as TranslatorClass } from './lookup/translator';
import type * as Dictionary from './types/dictionary';
import type * as DictionaryDatabase from './types/dictionary-database';
import type * as DictionaryImporterTypes from './types/dictionary-importer';
import type * as Translation from './types/translation';

// Re-export all types
export * from './types/index';

// Re-export utilities
export { YomitanError, toError } from './util/errors';
export { EventDispatcher } from './util/event-dispatcher';
export { log } from './util/log';

// Re-export key classes from submodules
export { DictionaryDB } from './database/dictionary-database';
export { YomitanDatabase } from './database/schema';

export interface YomitanCoreConfig {
    /** Database name (default: 'dict') */
    databaseName?: string;
    /** Whether to automatically initialize language transformers (default: true) */
    initLanguage?: boolean;
}

export interface TermLookupResult {
    entries: Dictionary.TermDictionaryEntry[];
    originalTextLength: number;
}

export interface FuriganaSegment {
    text: string;
    reading: string;
}

export interface FrequencyRankingResult {
    frequencies: { dictionary: string; frequency: number; displayValue: string | null }[];
    harmonicMean: number;
}

export interface DictionaryUpdateInfo {
    dictionaryName: string;
    currentRevision: string;
    latestRevision: string;
    hasUpdate: boolean;
    downloadUrl?: string;
}

export class YomitanCore {
    private _db: DictionaryDB;
    private _multiLanguageTransformer: MultiLanguageTransformer;
    private _translator: TranslatorClass | null = null;
    private _sentenceParser: SentenceParserClass | null = null;
    private _batchProcessor: BatchProcessorClass | null = null;
    private _frequencyRanker: FrequencyRankerClass | null = null;
    private _initialized = false;
    private _config: Required<YomitanCoreConfig>;

    constructor(config?: YomitanCoreConfig) {
        this._config = {
            databaseName: config?.databaseName ?? 'dict',
            initLanguage: config?.initLanguage ?? true,
        };
        this._db = new DictionaryDB(this._config.databaseName);
        this._multiLanguageTransformer = new MultiLanguageTransformer();
    }

    async initialize(): Promise<void> {
        if (this._initialized) {
            return;
        }

        await this._db.open();

        if (this._config.initLanguage) {
            this._multiLanguageTransformer.prepare();
        }

        this._initialized = true;
    }

    async dispose(): Promise<void> {
        if (!this._initialized) {
            return;
        }
        this._db.close();
        this._translator = null;
        this._sentenceParser = null;
        this._batchProcessor = null;
        this._frequencyRanker = null;
        this._initialized = false;
    }

    get isReady(): boolean {
        return this._initialized;
    }

    get database(): DictionaryDB {
        this._ensureInitialized();
        return this._db;
    }

    async getTranslator(): Promise<TranslatorClass> {
        this._ensureInitialized();
        if (!this._translator) {
            const { Translator } = await import('./lookup/translator');
            this._translator = new Translator(this._db);
            this._translator.prepare();
        }
        return this._translator;
    }

    get language(): {
        summaries: ReturnType<typeof getLanguageSummaries>;
        textProcessors: ReturnType<typeof getAllLanguageTextProcessors>;
        transformer: MultiLanguageTransformer;
        isTextLookupWorthy: typeof isTextLookupWorthy;
    } {
        return {
            summaries: getLanguageSummaries(),
            textProcessors: getAllLanguageTextProcessors(),
            transformer: this._multiLanguageTransformer,
            isTextLookupWorthy,
        };
    }

    // ---- Dictionary Management ----

    async importDictionary(
        archive: ArrayBuffer,
        options?: {
            onProgress?: DictionaryImporterTypes.OnProgressCallback;
            prefixWildcardsSupported?: boolean;
            yomitanVersion?: string;
        },
    ): Promise<DictionaryImporterTypes.ImportResult> {
        this._ensureInitialized();
        const { DictionaryImporterClass: DictionaryImporter } = await import('./import/dictionary-importer');
        const { NoOpMediaLoader } = await import('./import/media-loader');

        const importer = new DictionaryImporter(new NoOpMediaLoader(), options?.onProgress);
        const details: DictionaryImporterTypes.ImportDetails = {
            prefixWildcardsSupported: options?.prefixWildcardsSupported ?? false,
            yomitanVersion: options?.yomitanVersion ?? '0.0.0',
        };
        return await importer.importDictionary(this._db, archive, details);
    }

    async deleteDictionary(
        name: string,
        onProgress?: DictionaryDatabase.DeleteDictionaryProgressCallback,
    ): Promise<void> {
        this._ensureInitialized();
        await this._db.deleteDictionary(name, onProgress);
    }

    async getDictionaryInfo(): Promise<DictionaryImporterTypes.Summary[]> {
        this._ensureInitialized();
        return await this._db.getDictionaryInfo();
    }

    // ---- Core Lookup ----

    async findTerms(
        text: string,
        config: {
            mode?: FindTermsMode;
            language?: string;
            enabledDictionaryMap: Translation.TermEnabledDictionaryMap;
            options?: Partial<Translation.FindTermsOptions>;
        },
    ): Promise<TermLookupResult> {
        this._ensureInitialized();
        const translator = await this.getTranslator();
        const mode: FindTermsMode = config.mode ?? 'group';

        const findOptions: Translation.FindTermsOptions = {
            matchType: config.options?.matchType ?? 'exact',
            deinflect: config.options?.deinflect ?? true,
            primaryReading: config.options?.primaryReading ?? '',
            mainDictionary: config.options?.mainDictionary ?? '',
            sortFrequencyDictionary: config.options?.sortFrequencyDictionary ?? null,
            sortFrequencyDictionaryOrder: config.options?.sortFrequencyDictionaryOrder ?? 'descending',
            removeNonJapaneseCharacters: config.options?.removeNonJapaneseCharacters ?? false,
            textReplacements: config.options?.textReplacements ?? [null],
            enabledDictionaryMap: config.enabledDictionaryMap,
            excludeDictionaryDefinitions: config.options?.excludeDictionaryDefinitions ?? null,
            searchResolution: config.options?.searchResolution ?? 'letter',
            language: config.language ?? 'ja',
        };

        const { dictionaryEntries, originalTextLength } = await translator.findTerms(mode, text, findOptions);

        return { entries: dictionaryEntries, originalTextLength };
    }

    async findKanji(
        text: string,
        config: {
            enabledDictionaryMap: Translation.KanjiEnabledDictionaryMap;
            removeNonJapaneseCharacters?: boolean;
        },
    ): Promise<Dictionary.KanjiDictionaryEntry[]> {
        this._ensureInitialized();
        const translator = await this.getTranslator();

        const findOptions: Translation.FindKanjiOptions = {
            enabledDictionaryMap: config.enabledDictionaryMap,
            removeNonJapaneseCharacters: config.removeNonJapaneseCharacters ?? true,
        };

        return await translator.findKanji(text, findOptions);
    }

    // ---- Additional Features ----

    async parseText(
        text: string,
        options: {
            language?: string;
            enabledDictionaryMap: Map<string, { index: number; priority: number }>;
            maxLength?: number;
        },
    ): Promise<unknown[]> {
        this._ensureInitialized();
        if (!this._sentenceParser) {
            const translator = await this.getTranslator();
            const { SentenceParser } = await import('./lookup/sentence-parser');
            this._sentenceParser = new SentenceParser(translator);
        }
        return await this._sentenceParser.parseText(text, options.language ?? 'ja', {
            enabledDictionaryMap: options.enabledDictionaryMap,
            maxLength: options.maxLength,
        });
    }

    async generateFurigana(text: string, reading: string): Promise<FuriganaSegment[]> {
        const { generateFurigana } = await import('./language/ja/furigana');
        return generateFurigana(text, reading);
    }

    async batchLookup(
        texts: string[],
        config: {
            language?: string;
            enabledDictionaryMap: Map<string, { index: number; priority: number }>;
            concurrency?: number;
        },
    ): Promise<Map<string, TermLookupResult>> {
        this._ensureInitialized();
        if (!this._batchProcessor) {
            const translator = await this.getTranslator();
            const { BatchProcessor } = await import('./lookup/batch-processor');
            this._batchProcessor = new BatchProcessor(translator);
        }
        const results = await this._batchProcessor.batchLookup(texts, {
            language: config.language,
            enabledDictionaryMap: config.enabledDictionaryMap,
            concurrency: config.concurrency,
        });
        const mapped = new Map<string, TermLookupResult>();
        for (const [key, value] of results) {
            mapped.set(key, { entries: value.entries, originalTextLength: value.originalTextLength });
        }
        return mapped;
    }

    async getFrequencyRanking(term: string, dictionaries: string[], reading?: string): Promise<FrequencyRankingResult> {
        this._ensureInitialized();
        if (!this._frequencyRanker) {
            const { FrequencyRanker } = await import('./lookup/frequency-ranking');
            this._frequencyRanker = new FrequencyRanker(this._db);
        }
        return await this._frequencyRanker.getFrequencyRanking(term, dictionaries, reading);
    }

    async checkForUpdates(names?: string[]): Promise<DictionaryUpdateInfo[]> {
        this._ensureInitialized();
        const { DictionaryUpdateChecker } = await import('./import/dictionary-update-checker');
        const checker = new DictionaryUpdateChecker(this._db);
        return await checker.checkForUpdates(names);
    }

    async getAudioUrls(
        term: string,
        reading: string,
        sources: { type: string; url: string; voice: string }[],
        languageSummary: { name: string; iso: string; exampleText: string },
    ): Promise<unknown[]> {
        const { AudioUrlGenerator } = await import('./audio/audio-url-generator');
        const generator = new AudioUrlGenerator();
        return (await generator.getUrls(term, reading, sources as any[], languageSummary as any)) as unknown[];
    }

    // ---- Factory Methods ----

    async createAnkiClient(config?: { server?: string; apiKey?: string }): Promise<unknown> {
        const { AnkiConnect } = await import('./anki/anki-connect');
        return new AnkiConnect(config);
    }

    async createRenderer(): Promise<{
        DisplayGenerator: unknown;
        StructuredContentGenerator: unknown;
        PronunciationGenerator: unknown;
    }> {
        const displayGen = await import('./render/display-generator');
        const structuredGen = await import('./render/structured-content-generator');
        const pronunciationGen = await import('./render/pronunciation-generator');
        return {
            DisplayGenerator: displayGen.DisplayGenerator,
            StructuredContentGenerator: structuredGen.StructuredContentGenerator,
            PronunciationGenerator: pronunciationGen.PronunciationGenerator,
        };
    }

    async createAudioUrlGenerator(): Promise<unknown> {
        const { AudioUrlGenerator } = await import('./audio/audio-url-generator');
        return new AudioUrlGenerator();
    }

    // ---- Private ----

    private _ensureInitialized(): void {
        if (!this._initialized) {
            throw new Error('YomitanCore is not initialized. Call initialize() first.');
        }
    }
}

// Default export
export default YomitanCore;
