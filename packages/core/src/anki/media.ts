/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Anki note media, following Yomitan's Backend._injectAnkNoteMedia: the note builder reports what a
 * card format's fields need (`requirements`), the files are stored in Anki, and the note is built
 * again with their names. Everything crossing the client is plain data, so this runs on the
 * consumer side, where the Anki transport is.
 */

import type { AudioSourceUrls } from '../audio/audio-urls';
import { type BlobLike, isBlobLike } from '../platform/types';
import { AnkiNoteBuilder } from '../upstream/ext/js/data/anki-note-builder.js';
import { generateAnkiNoteMediaFileName, mediaFileNameHashOrTimestamp } from '../upstream/ext/js/data/anki-util.js';
import { arrayBufferToBase64 } from '../upstream/ext/js/data/array-buffer-util.js';
import { getFileExtensionFromImageMediaType } from '../upstream/ext/js/media/media-util.js';
import type { DictionaryEntry } from '../upstream/types/ext/dictionary';
import type { AnkiTransport } from './anki';

/** What a card format's fields ask for that a build didn't have (Yomitan's note builder `Requirement`). */
export type MediaRequirement =
    | { type: 'audio' | 'screenshot' | 'clipboardImage' | 'clipboardText' | 'popupSelectionText' }
    | { type: 'textFurigana'; text: string; readingMode: 'hiragana' | 'katakana' | null }
    | { type: 'dictionaryMedia'; dictionary: string; path: string };

/** Media the host supplies for a note. Audio and dictionary images come from the profile and storage. */
export type NoteMedia = {
    /** An image for `{screenshot}`, such as a cropped manga panel. */
    screenshot?: { data: BlobLike | Uint8Array; mediaType: string };
};

/** Names of files stored in Anki, ready for `anki.buildNote({ storedMedia })`. */
export type StoredNoteMedia = {
    audio?: string;
    screenshot?: string;
    /** Glossary images; `fileName` is null for one that couldn't be stored. */
    dictionaryMedia?: { dictionary: string; path: string; fileName: string | null }[];
};

/** What storing media needs from a yomitan-core client. */
export type MediaClient = {
    audio: { sourceUrls(term: string, reading: string, index: number): Promise<AudioSourceUrls> };
    dictionaries: {
        getMedia(dictionary: string, path: string): Promise<{ mediaType: string; content: Uint8Array } | null>;
    };
};

/** The requirements this module can fill. Clipboard and selection media are not supported. */
export function isStorableRequirement(requirement: MediaRequirement): boolean {
    return requirement.type === 'audio' || requirement.type === 'screenshot' || requirement.type === 'dictionaryMedia';
}

/** Upstream types its base64 encoder for an `ArrayBuffer`, but it only wraps the argument in a `Uint8Array`. */
function toBase64(bytes: Uint8Array): string {
    return arrayBufferToBase64(bytes as unknown as ArrayBuffer) as string;
}

const AUDIO_EXTENSION = /\.(mp3|ogg|oga|wav|aac|flac|m4a|webm)$/i;

/** The extension of an audio URL's path, `.mp3` when it has none (JapanesePod101 serves `.php`). */
function audioExtension(url: string): string {
    try {
        return AUDIO_EXTENSION.exec(new URL(url).pathname)?.[0].toLowerCase() ?? '.mp3';
    } catch {
        return '.mp3';
    }
}

/**
 * Upstream's `yomitan_<type>_<timestamp>` name plus a random part, so two saves in the same
 * millisecond (AnkiConnect overwrites a file of the same name) never share a file.
 */
function uniqueFileName(prefix: string, extension: string, timestamp: number): string {
    const random =
        typeof globalThis.crypto?.randomUUID === 'function'
            ? globalThis.crypto.randomUUID().slice(0, 8)
            : Math.random().toString(16).slice(2, 10).padEnd(8, '0');
    return `${generateAnkiNoteMediaFileName(prefix, '', timestamp) as string}_${random}${extension}`;
}

const entryDetailsBuilder = new (
    AnkiNoteBuilder as unknown as new (
        api: object,
        templateRenderer: object,
    ) => {
        getDictionaryEntryDetailsForNote(
            entry: DictionaryEntry,
        ): { type: 'kanji'; character: string } | { type: 'term'; term: string; reading: string };
    }
)({}, {});

/**
 * Stores the media a note's `requirements` ask for, as Yomitan does when its save button is pressed.
 * The screenshot is the host's image; dictionary images come from storage; audio is downloaded by
 * Anki itself from the first of `audio.urls` that works, so nothing large passes through the
 * device. Failures are returned as `warnings`, and the matching marker renders empty (a term
 * with no audio, or only placeholder clips, is not a warning, as in Yomitan). `stored` is null when there is nothing to build with.
 */
export async function storeNoteMedia(
    anki: AnkiTransport,
    client: MediaClient,
    entry: DictionaryEntry,
    requirements: MediaRequirement[],
    media: NoteMedia = {},
): Promise<{ stored: StoredNoteMedia | null; warnings: string[] }> {
    const store = anki.storeMediaFile?.bind(anki);
    const stored: StoredNoteMedia = {};
    const warnings: string[] = [];
    if (store === undefined) {
        return { stored: null, warnings };
    }
    const timestamp = Date.now();
    const target = entryDetailsBuilder.getDictionaryEntryDetailsForNote(entry);
    const wants = (type: MediaRequirement['type']) => requirements.some((requirement) => requirement.type === type);
    const attempt = async (task: () => Promise<void>) => {
        try {
            await task();
        } catch (error) {
            warnings.push(error instanceof Error ? error.message : String(error));
        }
    };

    const tasks: Promise<void>[] = [];
    const { screenshot } = media;
    if (wants('screenshot') && screenshot !== undefined) {
        tasks.push(
            attempt(async () => {
                const extension = getFileExtensionFromImageMediaType(
                    screenshot.mediaType.split(';')[0].trim().toLowerCase(),
                ) as string | null;
                if (extension === null) {
                    throw new Error('Unknown media type for screenshot image');
                }
                const bytes = isBlobLike(screenshot.data)
                    ? new Uint8Array(await screenshot.data.arrayBuffer())
                    : screenshot.data;
                const name = uniqueFileName('yomitan_browser_screenshot', extension, timestamp);
                stored.screenshot = (await store(name, { data: toBase64(bytes) })) ?? undefined;
            }),
        );
    }
    if (wants('audio') && target.type === 'term') {
        tasks.push(
            attempt(async () => {
                // Sources are resolved one at a time, so a slow later source never delays a ready earlier one.
                const failures: string[] = [];
                for (let index = 0, more = true; more; ++index) {
                    const { urls, more: hasMore } = await client.audio.sourceUrls(target.term, target.reading, index);
                    more = hasMore;
                    for (const { url, skipHash } of urls) {
                        const name = uniqueFileName('yomitan_audio', audioExtension(url), timestamp).replace(/\]/g, '');
                        try {
                            // Anki downloads the file. `null` means it was the placeholder clip: a miss, not an error.
                            const fileName = await store(name, skipHash === undefined ? { url } : { url, skipHash });
                            if (fileName !== null) {
                                stored.audio = fileName;
                                return;
                            }
                        } catch (error) {
                            failures.push(error instanceof Error ? error.message : String(error));
                        }
                    }
                }
                if (failures.length > 0) {
                    warnings.push(`Could not store audio: ${failures[0]}`);
                }
            }),
        );
    }
    const dictionaryRequirements = requirements.filter(
        (requirement): requirement is Extract<MediaRequirement, { type: 'dictionaryMedia' }> =>
            requirement.type === 'dictionaryMedia',
    );
    if (dictionaryRequirements.length > 0) {
        tasks.push(
            attempt(async () => {
                stored.dictionaryMedia = await Promise.all(
                    dictionaryRequirements.map(async ({ dictionary, path }, index) => {
                        let fileName: string | null = null;
                        await attempt(async () => {
                            const found = await client.dictionaries.getMedia(dictionary, path);
                            if (found === null) {
                                return;
                            }
                            const content = toBase64(found.content);
                            const name = (await mediaFileNameHashOrTimestamp(
                                'yomitan_dictionary_media',
                                content,
                                getFileExtensionFromImageMediaType(found.mediaType) as string | null,
                                index,
                                timestamp,
                            )) as string;
                            fileName = await store(name, { data: content });
                        });
                        return { dictionary, path, fileName };
                    }),
                );
            }),
        );
    }
    await Promise.all(tasks);
    const any =
        stored.screenshot !== undefined ||
        stored.audio !== undefined ||
        stored.dictionaryMedia?.some(({ fileName }) => fileName !== null) === true;
    return { stored: any ? stored : null, warnings };
}
