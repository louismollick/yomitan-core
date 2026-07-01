import type * as DictionaryDatabase from '../types/dictionary-database';
import type * as DictionaryImporter from '../types/dictionary-importer';

export type DictionaryDatabaseBackend = {
    open(): Promise<void>;
    close(): void;
    readonly isOpen: boolean;
    purge(): Promise<boolean>;
    deleteDictionary(
        dictionaryName: string,
        onProgress?: DictionaryDatabase.DeleteDictionaryProgressCallback,
    ): Promise<void>;
    findTermsBulk(
        termList: string[],
        dictionaries: DictionaryDatabase.DictionarySet,
        matchType: DictionaryDatabase.MatchType,
    ): Promise<DictionaryDatabase.TermEntry[]>;
    findTermsExactBulk(
        termList: DictionaryDatabase.TermExactRequest[],
        dictionaries: DictionaryDatabase.DictionarySet,
    ): Promise<DictionaryDatabase.TermEntry[]>;
    findTermsBySequenceBulk(
        items: DictionaryDatabase.DictionaryAndQueryRequest[],
    ): Promise<DictionaryDatabase.TermEntry[]>;
    findTermMetaBulk(
        termList: string[],
        dictionaries: DictionaryDatabase.DictionarySet,
    ): Promise<DictionaryDatabase.TermMeta[]>;
    findKanjiBulk(
        kanjiList: string[],
        dictionaries: DictionaryDatabase.DictionarySet,
    ): Promise<DictionaryDatabase.KanjiEntry[]>;
    findKanjiMetaBulk(
        kanjiList: string[],
        dictionaries: DictionaryDatabase.DictionarySet,
    ): Promise<DictionaryDatabase.KanjiMeta[]>;
    findTagMetaBulk(
        items: DictionaryDatabase.DictionaryAndQueryRequest[],
    ): Promise<(DictionaryDatabase.Tag | undefined)[]>;
    findTagForTitle(name: string, dictionary: string): Promise<DictionaryDatabase.Tag | undefined>;
    getMedia(items: DictionaryDatabase.MediaRequest[]): Promise<DictionaryDatabase.Media[]>;
    getDictionaryInfo(): Promise<DictionaryImporter.Summary[]>;
    getDictionaryCounts(dictionaryNames: string[], getTotal: boolean): Promise<DictionaryDatabase.DictionaryCounts>;
    dictionaryExists(title: string): Promise<boolean>;
    bulkAdd(
        objectStoreName: DictionaryDatabase.ObjectStoreName,
        items: unknown[],
        start: number,
        count: number,
    ): Promise<void>;
    addWithResult(objectStoreName: DictionaryDatabase.ObjectStoreName, item: unknown): Promise<number>;
    bulkUpdate(
        objectStoreName: DictionaryDatabase.ObjectStoreName,
        items: { primaryKey: number; data: unknown }[],
        start: number,
        count: number,
    ): Promise<void>;
};
