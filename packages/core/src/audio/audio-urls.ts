/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Audio source URL resolution: Yomitan's own AudioDownloader (ext/js/media/audio-downloader.js)
 * resolves each configured source to playable URLs. Downloading and validating the audio stays with
 * the caller (a player, or AnkiConnect for notes), so this runs on every target.
 */

import type { Fetch } from '../platform/upstream-env';
import type { ProfileOptions } from '../profile/profile';
import { getLanguageSummaries } from '../upstream/ext/js/language/languages.js';
import { AudioDownloader, getRequiredAudioSources } from '../upstream/ext/js/media/audio-downloader.js';
import type { AudioSourceType } from '../upstream/types/ext/settings';

/** A playable audio URL for a term, as one of the profile's audio sources resolved it. */
export type AudioUrl = {
    url: string;
    source: AudioSourceType;
    /** What the source calls this recording, when it names them (for example a speaker). */
    name?: string;
    /**
     * For AnkiConnect's `storeMediaFile`: the MD5 of the source's "no audio for this term" clip, which
     * should be skipped. Set for JapanesePod101, which answers unknown terms with a placeholder clip.
     */
    skipHash?: string;
};

/** MD5 of JapanesePod101's placeholder clip (upstream rejects it by its SHA-256, `ae6398b5...`). */
const JPOD101_MISSING_AUDIO_MD5 = '7e2c2f954ef6051373ba916f000168dc';

/** One audio source's URLs, and whether further sources follow it. */
export type AudioSourceUrls = { urls: AudioUrl[]; more: boolean };

type SourceInfo = { type: 'url'; url: string; name?: string } | { type: 'tts' };

type Downloader = {
    getTermAudioInfoList(
        source: unknown,
        term: string,
        reading: string,
        languageSummary: unknown,
    ): Promise<SourceInfo[]>;
};

/**
 * Hermes has no `Intl.DisplayNames`, which the downloader's constructor creates (it only labels
 * Wiktionary regions, which this module never shows).
 */
function ensureIntlDisplayNames(): void {
    const intl = (globalThis as { Intl?: { DisplayNames?: unknown } }).Intl;
    if (intl !== undefined && intl.DisplayNames === undefined) {
        intl.DisplayNames = class {
            of(code: string) {
                return code;
            }
        };
    }
}

/** How long one fetching source (Jisho, `custom-json`, ...) may take before it counts as having no URLs. */
const SOURCE_TIMEOUT_MS = 5000;

/** Resolves to `fallback` if `promise` rejects or takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(fallback), ms);
        const settle = (value: T) => {
            clearTimeout(timer);
            resolve(value);
        };
        promise.then(settle, () => settle(fallback));
    });
}

/**
 * A resolver behind `audio.urls` and `audio.sourceUrls`. Sources that read a web page or API
 * (Jisho, LanguagePod101, Wikimedia, `custom-json`) use `fetch`, so they need CORS access in browsers;
 * direct-URL sources (JapanesePod101, `custom`) need no request. A source that fails or takes longer
 * than `timeoutMs` resolves to no URLs, so one stalled source never holds up the others.
 */
export function createAudioUrlResolver(fetch: Fetch | undefined, timeoutMs = SOURCE_TIMEOUT_MS) {
    let downloader: Downloader | null = null;
    const getDownloader = (): Downloader => {
        if (downloader === null) {
            ensureIntlDisplayNames();
            const requestBuilder = {
                fetchAnonymous: (url: string, init?: object) => {
                    if (fetch === undefined) {
                        throw new Error('No fetch available for audio sources');
                    }
                    return fetch(url, init);
                },
            };
            downloader = new (AudioDownloader as unknown as new (requestBuilder: unknown) => Downloader)(
                requestBuilder,
            );
        }
        return downloader;
    };

    /** The profile's sources, then the default sources if enabled (upstream's order). */
    const getSources = (options: ProfileOptions): { type: AudioSourceType }[] => {
        const { sources, enableDefaultAudioSources } = options.audio;
        return enableDefaultAudioSources
            ? [
                  ...sources,
                  ...(getRequiredAudioSources(options.general.language, sources) as { type: AudioSourceType }[]),
              ]
            : sources;
    };

    const resolveSource = async (
        source: { type: AudioSourceType },
        term: string,
        reading: string,
        languageSummary: unknown,
    ): Promise<AudioUrl[]> => {
        const infos = await withTimeout(
            (async () => getDownloader().getTermAudioInfoList(source, term, reading, languageSummary))(),
            timeoutMs,
            [] as SourceInfo[],
        );
        const results: AudioUrl[] = [];
        for (const info of infos) {
            if (info.type === 'url') {
                results.push({
                    url: info.url,
                    source: source.type,
                    ...(info.name === undefined ? {} : { name: info.name }),
                    ...(source.type === 'jpod101' ? { skipHash: JPOD101_MISSING_AUDIO_MD5 } : {}),
                });
            }
        }
        return results;
    };

    const findLanguage = (options: ProfileOptions) =>
        getLanguageSummaries().find((summary: { iso: string }) => summary.iso === options.general.language);

    return {
        /** Candidate URLs from every source, in source order, without duplicates. Sources run in parallel. */
        async all(options: ProfileOptions, term: string, reading: string): Promise<AudioUrl[]> {
            const languageSummary = findLanguage(options);
            if ((term.length === 0 && reading.length === 0) || languageSummary === undefined) {
                return [];
            }
            const lists = await Promise.all(
                getSources(options).map((source) => resolveSource(source, term, reading, languageSummary)),
            );
            const seen = new Set<string>();
            return lists.flat().filter(({ url }) => !seen.has(url) && seen.add(url));
        },

        /** One source's URLs, so a caller can try them before resolving the next. */
        async source(
            options: ProfileOptions,
            term: string,
            reading: string,
            index: number,
        ): Promise<{ urls: AudioUrl[]; more: boolean }> {
            const languageSummary = findLanguage(options);
            const sources = getSources(options);
            if (
                (term.length === 0 && reading.length === 0) ||
                languageSummary === undefined ||
                index >= sources.length
            ) {
                return { urls: [], more: false };
            }
            return {
                urls: await resolveSource(sources[index], term, reading, languageSummary),
                more: index + 1 < sources.length,
            };
        },
    };
}
