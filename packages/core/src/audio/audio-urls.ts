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

/**
 * A resolver for `audio.urls`. Sources that read a web page or API (Jisho, LanguagePod101,
 * Wikimedia, `custom-json`) use `fetch`, so they need CORS access in browsers; direct-URL sources
 * (JapanesePod101, `custom`) need no request. A source that fails resolves to no URLs.
 */
export function createAudioUrlResolver(fetch: Fetch | undefined) {
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

    /** Candidate URLs in the profile's source order, then the default sources if enabled. */
    return async (options: ProfileOptions, term: string, reading: string): Promise<AudioUrl[]> => {
        if (term.length === 0 && reading.length === 0) {
            return [];
        }
        const iso = options.general.language;
        const languageSummary = getLanguageSummaries().find((summary: { iso: string }) => summary.iso === iso);
        if (languageSummary === undefined) {
            return [];
        }
        const { sources, enableDefaultAudioSources } = options.audio;
        const allSources: { type: AudioSourceType }[] = enableDefaultAudioSources
            ? [...sources, ...(getRequiredAudioSources(iso, sources) as { type: AudioSourceType }[])]
            : sources;
        const infoLists = await Promise.all(
            allSources.map((source) => getDownloader().getTermAudioInfoList(source, term, reading, languageSummary)),
        );
        const results: AudioUrl[] = [];
        const seen = new Set<string>();
        for (const [index, infos] of infoLists.entries()) {
            const source = allSources[index].type;
            for (const info of infos) {
                if (info.type !== 'url' || seen.has(info.url)) {
                    continue;
                }
                seen.add(info.url);
                results.push({
                    url: info.url,
                    source,
                    ...(info.name === undefined ? {} : { name: info.name }),
                    ...(source === 'jpod101' ? { skipHash: JPOD101_MISSING_AUDIO_MD5 } : {}),
                });
            }
        }
        return results;
    };
}
