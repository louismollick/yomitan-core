/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export {
    type ArchiveEntry,
    type ArchiveReader,
    createFilesArchiveReader,
    createZipArchiveReader,
    decodeUtf8,
} from './import/archive';
export { headerImageInfoReader, type ImageInfoReader, type ImageSize, readImageSize } from './import/image-info';
export {
    type ImportDictionaryOptions,
    type ImportProgress,
    type ImportResult,
    importDictionaryArchive,
} from './import/importer';
export { IndexedDictionaryStorage } from './storage/indexed-storage';
export { createMemoryStorage, MemoryDictionaryStorage } from './storage/memory-storage';
export {
    InProcessWriteSessions,
    recoverWriteSessions,
    SessionLostError,
    StorageBusyError,
    type WriteKind,
    type WriteSession,
    type WriteSessionRecord,
    type WriteSessionStore,
} from './storage/sessions';
export type { SqlDriver, SqlRunResult, SqlValue } from './storage/sql/driver';
export {
    createSqlStorage,
    SQL_SCHEMA_VERSION,
    SqlBackend,
    SqlDictionaryStorage,
    type SqlStorageOptions,
    type SqlWriteSessionOptions,
    SqlWriteSessions,
} from './storage/sql/sql-storage';
export type {
    DictionarySet,
    DictionaryStorage,
    KeyRange,
    StorageBackend,
    StoredRow,
    WriteGuard,
    YomitanStorage,
} from './storage/types';
export { upstreamPin } from './upstream-pin';
export type { AbortSignalLike, BlobLike } from './platform/types';
export {
    type ArchiveReaderFactories,
    type ArchiveSource,
    type CreateYomitanOptions,
    createYomitan,
    DictionaryImportError,
    type DictionaryUpdate,
    type ImportOptions,
    type InstalledDictionary,
    type Media,
    type RecommendedDictionary,
    type TermLookupOptions,
    type TermLookupResult,
    type Yomitan,
    YomitanAbortError,
} from './client/yomitan';
export type { FindTermsDetails, FindTermsMode } from './lookup/find-options';
export type { ParseHeadword, ParseSegment, ParseToken, ScanResult, TextRange } from './lookup/text-lookup';
export type { Sentence } from './lookup/text-source';
export type { DictionaryOptions, Profile, ProfileOptions } from './profile/profile';
export type { KanjiDictionaryEntry, TermDictionaryEntry } from './upstream/types/ext/dictionary';
export {
    type AnkiConnectOptions,
    type AnkiNote,
    type AnkiNoteContext,
    type AnkiNoteInfo,
    type AnkiTransport,
    type BuildNoteOptions,
    type BuiltNote,
    createAnkiConnectTransport,
    type FieldOverwriteMode,
    type NoteState,
} from './anki/anki';
export {
    type AddNoteResult,
    type CardFormatState,
    createDisplayController,
    type DisplayController,
    type DisplayControllerClient,
    DuplicateNoteError,
    type EntryNoteStates,
    type SaveAction,
} from './display/display-controller';
export {
    type ThemeContext,
    addScopeToCss,
    getCustomCss,
    getDisplayAttributes,
    getFontStyle,
} from './render/display-options';
export {
    type DomEnvironment,
    EntryRenderer,
    findGlossImages,
    type GlossImage,
    type LinkHandler,
    createStringDomEnvironment,
    setGlossImageSource,
} from './render/entry-renderer';
export { type HtmlMediaMode, getPopupCss } from './render/html';
export { upstreamEnv, withUpstreamEnv } from './platform/upstream-env';
