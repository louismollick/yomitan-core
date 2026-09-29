/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export { createIndexedDbStorage } from './indexeddb-storage';
export { createBrowserImageInfoReader } from './browser-image-info';
export { createMemoryLockManager, createWebLockSessions } from './web-lock-sessions';
export { connectYomitan, exposeYomitan, type MessageEndpoint } from './worker';
export {
    type DictionaryEntry,
    type KanjiClickDetail,
    type LinkClickDetail,
    type NoteAddedDetail,
    type NoteErrorDetail,
    YomitanEntriesElement,
    defineYomitanEntries,
    scopeCssToHost,
} from './entries-element';
