import type { DictionaryDB } from '../database/dictionary-database';
import type { Summary } from '../types/dictionary-importer';
import { compareRevisions } from '../util/dictionary-data-util';

export interface DictionaryUpdateInfo {
    dictionaryName: string;
    currentRevision: string;
    latestRevision: string;
    hasUpdate: boolean;
    downloadUrl?: string;
}

export class DictionaryUpdateChecker {
    private _db: DictionaryDB;

    constructor(db: DictionaryDB) {
        this._db = db;
    }

    /**
     * Checks for available updates for installed dictionaries.
     * For each dictionary with an indexUrl, fetches the remote index
     * and compares the revision to the locally installed revision.
     *
     * @param names Optional list of dictionary names to check.
     *   If not provided, checks all updatable dictionaries.
     * @returns An array of update info objects for each checked dictionary.
     */
    async checkForUpdates(names?: string[]): Promise<DictionaryUpdateInfo[]> {
        const dictionaries = await this._db.getDictionaryInfo();

        const toCheck = this._filterDictionaries(dictionaries, names);
        const results: DictionaryUpdateInfo[] = [];

        for (const dict of toCheck) {
            const result = await this._checkSingleDictionary(dict);
            if (result !== null) {
                results.push(result);
            }
        }

        return results;
    }

    private _filterDictionaries(dictionaries: Summary[], names?: string[]): Summary[] {
        const updatable = dictionaries.filter((d) => d.isUpdatable === true && typeof d.indexUrl === 'string');

        if (typeof names === 'undefined' || names.length === 0) {
            return updatable;
        }

        const nameSet = new Set(names);
        return updatable.filter((d) => nameSet.has(d.title));
    }

    private async _checkSingleDictionary(dict: Summary): Promise<DictionaryUpdateInfo | null> {
        const { title, revision, indexUrl, downloadUrl } = dict;
        if (typeof indexUrl !== 'string') {
            return null;
        }

        try {
            const response = await fetch(indexUrl);
            if (!response.ok) {
                return {
                    dictionaryName: title,
                    currentRevision: revision,
                    latestRevision: revision,
                    hasUpdate: false,
                };
            }

            const remoteIndex = (await response.json()) as { revision?: string };
            const latestRevision = typeof remoteIndex.revision === 'string' ? remoteIndex.revision : revision;

            const hasUpdate = compareRevisions(revision, latestRevision);

            return {
                dictionaryName: title,
                currentRevision: revision,
                latestRevision,
                hasUpdate,
                downloadUrl: typeof downloadUrl === 'string' ? downloadUrl : undefined,
            };
        } catch (_e) {
            // Network or parsing error; treat as no update available
            return {
                dictionaryName: title,
                currentRevision: revision,
                latestRevision: revision,
                hasUpdate: false,
                downloadUrl: typeof downloadUrl === 'string' ? downloadUrl : undefined,
            };
        }
    }
}
