/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The yomitan-core client (overhaul plan §3.2). Calls take and return plain data (ADR-0005);
 * construction dependencies (storage, fetch, archive readers) stay wherever the client runs.
 */

import { type ArchiveEntry, type ArchiveReader, createZipArchiveReader } from '../import/archive';
import type { ImageInfoReader } from '../import/image-info';
import { type ImportProgress, importDictionaryArchive, validateDictionaryArchive } from '../import/importer';
import {
    type FindTermsDetails,
    type FindTermsMode,
    getFindKanjiOptions,
    getFindTermsOptions,
} from '../lookup/find-options';
import { type ParseToken, type ScanResult, parseText, scanText, sentenceAt } from '../lookup/text-lookup';
import type { Sentence } from '../lookup/text-source';
import { type AbortSignalLike, type BlobLike, isBlobLike } from '../platform/types';
import { setUpstreamFetch } from '../platform/upstream-env';
import { type Profile, ProfileFormat, syncDictionarySettings } from '../profile/profile';
import { recoverWriteSessions } from '../storage/sessions';
import type { Summary, YomitanStorage } from '../storage/types';
import { compareRevisions } from '../upstream/ext/js/dictionary/dictionary-data-util.js';
import { Translator } from '../upstream/ext/js/language/translator.js';
import { dictionaryIndex as validateDictionaryIndex } from '../upstream/ext/lib/validate-schemas.js';
import type { KanjiDictionaryEntry, TermDictionaryEntry } from '../upstream/types/ext/dictionary';

type Fetch = (
    input: string,
    init?: object,
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown> }>;

/** Where a dictionary archive comes from. All variants are plain data. */
export type ArchiveSource =
    | ArrayBuffer
    | Uint8Array
    | BlobLike
    | { url: string }
    | { path: string }
    | { directory: string };

export type ArchiveReaderFactories = {
    /** Reads a `.zip` file from a path (Node: `createZipFileArchiveReader`). */
    path?: (path: string) => ArchiveReader | Promise<ArchiveReader>;
    /** Reads an unpacked archive directory (Node / React Native). */
    directory?: (path: string) => ArchiveReader | Promise<ArchiveReader>;
};

export type CreateYomitanOptions = {
    storage: YomitanStorage;
    /** Used for URL imports, update checks and AnkiConnect. Defaults to the global `fetch`. */
    fetch?: Fetch;
    archiveReaders?: ArchiveReaderFactories;
    imageInfoReader?: ImageInfoReader;
    /** A stored profile, migrated on load. Defaults to Yomitan's defaults. */
    profile?: unknown;
};

export type InstalledDictionary = Summary;

export type RecommendedDictionary = {
    name: string;
    description: string;
    homepage?: string;
    downloadUrl: string;
    kind: 'terms' | 'kanji' | 'frequency' | 'grammar' | 'pronunciation';
};

export type DictionaryUpdate = { title: string; currentRevision: string; latestRevision: string; downloadUrl: string };

export type ImportOptions = {
    source: ArchiveSource;
    signal?: AbortSignalLike;
    onProgress?: (progress: ImportProgress) => void;
};

export type TermLookupOptions = FindTermsDetails & { mode?: FindTermsMode };

export type TermLookupResult = { entries: TermDictionaryEntry[]; originalTextLength: number };

export type Media = {
    dictionary: string;
    path: string;
    mediaType: string;
    width: number;
    height: number;
    content: Uint8Array;
};

export class YomitanAbortError extends Error {
    readonly code = 'aborted';

    constructor(message = 'The operation was aborted') {
        super(message);
        this.name = 'AbortError';
    }
}

export class DictionaryImportError extends Error {
    readonly code = 'import-failed';
    readonly errors: Error[];

    constructor(errors: Error[]) {
        super(errors.map((error) => error.message).join('\n') || 'Dictionary import failed');
        this.name = 'DictionaryImportError';
        this.errors = errors;
    }
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function throwIfAborted(signal: AbortSignalLike | undefined): void {
    // AbortSignal.throwIfAborted is missing from React Native's polyfill.
    if (signal?.aborted) {
        throw new YomitanAbortError();
    }
}

async function readIndexTitle(reader: ArchiveReader): Promise<{ entries: ArchiveEntry[]; title: string }> {
    const entries = await reader.entries();
    const index = entries.find(({ name }) => name === 'index.json');
    if (index === undefined) {
        throw new DictionaryImportError([new Error('No dictionary index found in archive')]);
    }
    const parsed = JSON.parse(await index.text()) as { title?: unknown };
    if (typeof parsed.title !== 'string' || parsed.title.length === 0) {
        throw new DictionaryImportError([new Error('Unrecognized dictionary format')]);
    }
    return { entries, title: parsed.title };
}

export type Yomitan = Awaited<ReturnType<typeof createYomitan>>;

export async function createYomitan(options: CreateYomitanOptions) {
    const { storage } = options;
    const fetchImpl: Fetch | undefined = options.fetch ?? (globalThis as { fetch?: Fetch }).fetch;
    if (options.fetch !== undefined) {
        setUpstreamFetch(options.fetch as never);
    }
    const format = new ProfileFormat();
    if (!storage.isPrepared()) {
        await storage.prepare();
    }
    await recoverWriteSessions(storage, storage.sessions);

    let profile: Profile =
        options.profile === undefined ? await format.defaults() : await format.migrate(options.profile);
    const translator = new Translator(storage) as unknown as {
        prepare(): void;
        clearDatabaseCaches(): void;
        findTerms(
            mode: string,
            text: string,
            options: unknown,
        ): Promise<{ dictionaryEntries: TermDictionaryEntry[]; originalTextLength: number }>;
        findKanji(text: string, options: unknown): Promise<KanjiDictionaryEntry[]>;
    };
    translator.prepare();
    let disposed = false;

    const assertUsable = () => {
        if (disposed) {
            throw new Error('This yomitan-core client has been disposed');
        }
    };

    const listInstalled = async (): Promise<InstalledDictionary[]> => {
        const live = await storage.sessions.listLiveTitles();
        return (await storage.getDictionaryInfo()).filter(
            (summary) => summary.importSuccess !== false && !live.has(summary.title),
        );
    };

    const syncProfile = async (enableNew: boolean) => {
        syncDictionarySettings(profile.options, await listInstalled(), enableNew);
    };

    const toReader = async (source: ArchiveSource, signal?: AbortSignalLike): Promise<ArchiveReader> => {
        if (source instanceof ArrayBuffer || source instanceof Uint8Array || isBlobLike(source)) {
            return createZipArchiveReader(source);
        }
        if ('url' in source) {
            if (fetchImpl === undefined) {
                throw new Error('No fetch available to download the dictionary');
            }
            const response = await fetchImpl(source.url, signal === undefined ? {} : { signal });
            if (!response.ok) {
                throw new Error(`Failed to download ${source.url}: HTTP ${response.status}`);
            }
            return createZipArchiveReader(await response.arrayBuffer());
        }
        if ('path' in source) {
            if (options.archiveReaders?.path === undefined) {
                throw new Error('This platform has no path archive reader; pass archiveReaders.path to createYomitan');
            }
            return await options.archiveReaders.path(source.path);
        }
        if (options.archiveReaders?.directory === undefined) {
            throw new Error(
                'This platform has no directory archive reader; pass archiveReaders.directory to createYomitan',
            );
        }
        return await options.archiveReaders.directory((source as { directory: string }).directory);
    };

    /** An archive whose index has been read, ready to import. */
    type PreparedArchive = { reader: ArchiveReader; title: string };

    const prepareArchive = async (source: ArchiveSource, signal?: AbortSignalLike): Promise<PreparedArchive> => {
        throwIfAborted(signal);
        const reader = await toReader(source, signal);
        try {
            const { entries, title } = await readIndexTitle(reader);
            return { reader: { entries: async () => entries, close: reader.close?.bind(reader) }, title };
        } catch (error) {
            await reader.close?.();
            throw error;
        }
    };

    /** User progress callbacks must not be able to interrupt a write half-way. */
    const safely =
        <T>(callback: ((value: T) => void) | undefined) =>
        (value: T) => {
            try {
                callback?.(value);
            } catch {
                // Ignored: a failing progress listener is the caller's problem, not the database's.
            }
        };

    const importPrepared = async (
        { reader, title }: PreparedArchive,
        { signal, onProgress }: Omit<ImportOptions, 'source'>,
    ): Promise<InstalledDictionary> => {
        let session: Awaited<ReturnType<typeof storage.sessions.begin>>;
        try {
            throwIfAborted(signal);
            session = await storage.sessions.begin('import', title);
        } catch (error) {
            await reader.close?.();
            throw error;
        }
        let installed: InstalledDictionary;
        try {
            // Checked inside the exclusive session: a duplicate is refused before anything is written,
            // so the installed dictionary is never touched by the failure cleanup below.
            if (await storage.dictionaryExists(title)) {
                await reader.close?.();
                throw new DictionaryImportError([new Error(`Dictionary ${title} is already imported, skipped it.`)]);
            }
            const guarded = storage.withWriteGuard(async () => {
                await session.guard();
                throwIfAborted(signal);
            });
            let outcome: Awaited<ReturnType<typeof importDictionaryArchive>>;
            try {
                outcome = await importDictionaryArchive(guarded, reader, {
                    imageInfoReader: options.imageInfoReader,
                    onProgress: safely(onProgress),
                });
            } catch (error) {
                outcome = { result: null, errors: [error instanceof Error ? error : new Error(String(error))] };
            }
            const { result, errors } = outcome;
            if (errors.length > 0 || result === null || signal?.aborted) {
                // Atomic import: remove whatever was written (a listed deviation from upstream).
                await storage.withWriteGuard(session.guard).deleteDictionary(title, 1000, () => {});
                if (signal?.aborted) {
                    throw new YomitanAbortError();
                }
                throw new DictionaryImportError(errors);
            }
            installed = result;
        } finally {
            await session.end();
        }
        translator.clearDatabaseCaches();
        // Yomitan enables a newly imported dictionary in the current profile.
        await syncProfile(true);
        return installed;
    };

    const importFrom = async ({ source, signal, onProgress }: ImportOptions): Promise<InstalledDictionary> =>
        await importPrepared(await prepareArchive(source, signal), { signal, onProgress });

    const deleteDictionary = async (
        title: string,
        onProgress?: (progress: { processed: number; count: number }) => void,
    ) => {
        const session = await storage.sessions.begin('delete', title);
        try {
            const report = safely(onProgress);
            await storage
                .withWriteGuard(session.guard)
                .deleteDictionary(title, 1000, (progress) =>
                    report({ processed: progress.processed, count: progress.count }),
                );
        } catch (error) {
            // Partially deleted: leave the session to go stale so recovery finishes the delete.
            session.abandon();
            throw error;
        }
        await session.end();
        translator.clearDatabaseCaches();
        await syncProfile(true);
    };

    const checkUpdates = async (titles?: string[]): Promise<DictionaryUpdate[]> => {
        if (fetchImpl === undefined) {
            throw new Error('No fetch available to check for updates');
        }
        const updates: DictionaryUpdate[] = [];
        for (const summary of await listInstalled()) {
            if (titles !== undefined && !titles.includes(summary.title)) {
                continue;
            }
            const { isUpdatable, indexUrl, revision, downloadUrl } = summary;
            if (!isUpdatable || !indexUrl || !downloadUrl) {
                continue;
            }
            const response = await fetchImpl(indexUrl);
            const index = await response.json();
            if (!validateDictionaryIndex(index)) {
                throw new Error(`Invalid dictionary index for ${summary.title}`);
            }
            const latest = index as { revision: string; downloadUrl?: string };
            if (!compareRevisions(revision, latest.revision)) {
                continue;
            }
            updates.push({
                title: summary.title,
                currentRevision: revision,
                latestRevision: latest.revision,
                downloadUrl: latest.downloadUrl ?? downloadUrl,
            });
        }
        return updates;
    };

    /** Upstream `Backend._onApiTermsFind`: the profile's result mode, truncated to `maxResults`. */
    const findTerms = async (
        text: string,
        details: FindTermsDetails = {},
        mode?: FindTermsMode,
    ): Promise<TermLookupResult> => {
        const { general } = profile.options;
        const findMode = mode ?? (general.resultOutputMode as FindTermsMode);
        const { dictionaryEntries, originalTextLength } = await translator.findTerms(
            findMode,
            text,
            getFindTermsOptions(findMode, details, profile.options),
        );
        dictionaryEntries.splice(general.maxResults);
        return { entries: dictionaryEntries, originalTextLength };
    };

    /** Upstream's scanning parser calls the translator in `simple` mode without truncation. */
    const findTermsForParse = async (text: string, details: FindTermsDetails = {}) => {
        return await translator.findTerms('simple', text, getFindTermsOptions('simple', details, profile.options));
    };

    return {
        profile: {
            /** The current profile. Persist it and pass it back to `createYomitan` next time. */
            get(): Profile {
                return clone(profile);
            },
            /** Replaces the profile (migrated and validated like a stored one). */
            async set(next: unknown): Promise<Profile> {
                profile = await format.migrate(next);
                return clone(profile);
            },
            defaults: () => format.defaults(),
            migrate: (value: unknown) => format.migrate(value),
            /** Replaces the profile with one from a Yomitan settings export, then syncs dictionaries. */
            async importYomitanSettings(
                exported: unknown,
                { profileIndex }: { profileIndex?: number } = {},
            ): Promise<Profile> {
                profile = await format.importYomitanSettings(exported, profileIndex);
                await syncProfile(false);
                return clone(profile);
            },
            /** Adds installed dictionaries missing from the profile and drops removed ones, keeping order. */
            async syncDictionaries(): Promise<Profile> {
                await syncProfile(true);
                return clone(profile);
            },
        },

        dictionaries: {
            list: listInstalled,
            import: importFrom,
            delete: deleteDictionary,
            checkUpdates,
            /** Re-imports a dictionary from its update URL, keeping its profile settings and position. */
            async update(
                title: string,
                { signal, onProgress }: Omit<ImportOptions, 'source'> = {},
            ): Promise<InstalledDictionary> {
                const [update] = await checkUpdates([title]);
                if (update === undefined) {
                    throw new Error(`No update available for ${title}`);
                }
                // Download and read the new archive before touching the installed dictionary.
                const prepared = await prepareArchive({ url: update.downloadUrl }, signal);
                if (prepared.title !== title) {
                    await prepared.reader.close?.();
                    throw new DictionaryImportError([
                        new Error(`The update for ${title} contains a different dictionary (${prepared.title})`),
                    ]);
                }
                // Upstream's importer validates every bank before writing; run it that far first, so a
                // broken update never costs the installed version.
                const validationErrors = await validateDictionaryArchive(prepared.reader);
                if (validationErrors.length > 0) {
                    await prepared.reader.close?.();
                    throw new DictionaryImportError(validationErrors);
                }
                throwIfAborted(signal);
                const index = profile.options.dictionaries.findIndex(({ name }) => name === title);
                const settings = index >= 0 ? clone(profile.options.dictionaries[index]) : null;
                await deleteDictionary(title);
                const result = await importPrepared(prepared, { signal, onProgress });
                if (settings !== null) {
                    const current = profile.options.dictionaries.findIndex(({ name }) => name === result.title);
                    if (current >= 0) {
                        profile.options.dictionaries.splice(current, 1);
                    }
                    const alias = settings.alias === settings.name ? result.title : settings.alias;
                    profile.options.dictionaries.splice(index, 0, {
                        ...settings,
                        name: result.title,
                        alias,
                        styles: result.styles,
                    });
                }
                return result;
            },
            /** Yomitan's recommended dictionaries for a language. */
            async recommended(language: string): Promise<RecommendedDictionary[]> {
                const { default: data } = (await import('../upstream/ext/data/recommended-dictionaries.json.js')) as {
                    default: Record<
                        string,
                        Record<RecommendedDictionary['kind'], Omit<RecommendedDictionary, 'kind'>[]>
                    >;
                };
                const groups = data[language];
                if (groups === undefined) {
                    return [];
                }
                return (
                    Object.entries(groups) as [RecommendedDictionary['kind'], Omit<RecommendedDictionary, 'kind'>[]][]
                ).flatMap(([kind, dictionaries]) => dictionaries.map((dictionary) => ({ ...dictionary, kind })));
            },
            async getMedia(dictionary: string, path: string): Promise<Media | null> {
                const [media] = await storage.getMedia([{ dictionary, path }]);
                if (media === undefined) {
                    return null;
                }
                return {
                    dictionary: media.dictionary,
                    path: media.path,
                    mediaType: media.mediaType,
                    width: media.width,
                    height: media.height,
                    content: new Uint8Array(media.content),
                };
            },
        },

        lookup: {
            /** Yomitan's term search with the profile's options (result mode, dictionaries, `maxResults`). */
            terms(text: string, { mode, ...details }: TermLookupOptions = {}): Promise<TermLookupResult> {
                assertUsable();
                return findTerms(text, details, mode);
            },
            async kanji(text: string): Promise<KanjiDictionaryEntry[]> {
                assertUsable();
                const entries = await translator.findKanji(text, getFindKanjiOptions(profile.options));
                entries.splice(profile.options.general.maxResults);
                return entries;
            },
            /** What Yomitan shows when the pointer lands at `offset` (UTF-16) in `text`. */
            scan(text: string, offset: number): Promise<ScanResult | null> {
                assertUsable();
                return scanText(text, offset, profile.options, async (searchText) => {
                    const { entries, originalTextLength } = await findTerms(searchText);
                    return { dictionaryEntries: entries, originalTextLength };
                });
            },
            /** Splits text into terms like Yomitan's "parse text" (scanning parser). */
            parse(text: string): Promise<ParseToken[]> {
                assertUsable();
                return parseText(text, profile.options, findTermsForParse);
            },
            /** The sentence around `[offset, offset + length)` under the profile's sentence rules. */
            sentence(text: string, offset: number, length = 0): Sentence {
                return sentenceAt(text, offset, length, profile.options);
            },
        },

        async dispose(): Promise<void> {
            if (disposed) {
                return;
            }
            disposed = true;
            if (storage.isPrepared()) {
                await storage.close();
            }
        },
    };
}
