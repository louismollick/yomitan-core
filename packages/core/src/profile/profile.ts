/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The profile is Yomitan's own profile options object (ADR-0002), versioned with upstream's options
 * format so upstream's migrations apply. The whole upstream shape is kept, including groups the
 * library does not act on (popup window, hotkeys, …), so settings exported from Yomitan survive a
 * round trip; the groups yomitan-core honours are listed in the overhaul plan §3.2.
 */

import type { Summary } from '../storage/types';
import { OptionsUtil } from '../upstream/ext/js/data/options-util.js';
import type { DictionaryOptions, Options, ProfileOptions } from '../upstream/types/ext/settings';

export type { DictionaryOptions, ProfileOptions };

export type Profile = {
    /** Upstream's options format version. */
    version: number;
    options: ProfileOptions;
};

type OptionsUtilInstance = {
    prepare(): Promise<void>;
    update(options: unknown, targetVersion?: number | null): Promise<Options>;
    getDefault(): Options;
};

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** Upstream `DictionaryController.createDefaultDictionarySettings`. */
export function createDefaultDictionarySettings(name: string, enabled: boolean, styles: string): DictionaryOptions {
    return {
        name,
        alias: name,
        enabled,
        allowSecondarySearches: false,
        definitionsCollapsible: 'not-collapsible',
        partsOfSpeechFilter: true,
        useDeinflections: true,
        styles: styles ?? '',
    } as DictionaryOptions;
}

/**
 * Upstream `DictionaryController.ensureDictionarySettings` for one profile: drops settings for
 * dictionaries that are no longer installed and appends installed ones that are missing, keeping the
 * existing order.
 */
export function syncDictionarySettings(
    options: ProfileOptions,
    installed: Pick<Summary, 'title' | 'styles'>[],
    newDictionariesEnabled: boolean,
): boolean {
    let modified = false;
    const missing = [...installed];
    const dictionaries = options.dictionaries;
    for (let i = dictionaries.length - 1; i >= 0; --i) {
        const index = missing.findIndex(({ title }) => title === dictionaries[i].name);
        if (index >= 0) {
            missing.splice(index, 1);
        } else {
            dictionaries.splice(i, 1);
            modified = true;
        }
    }
    for (const { title, styles } of missing) {
        dictionaries.push(createDefaultDictionarySettings(title, newDictionariesEnabled, styles));
        modified = true;
    }
    return modified;
}

export class ProfileFormat {
    private optionsUtil: OptionsUtilInstance | null = null;

    private async getOptionsUtil(): Promise<OptionsUtilInstance> {
        if (this.optionsUtil === null) {
            const optionsUtil = new OptionsUtil() as unknown as OptionsUtilInstance;
            await optionsUtil.prepare();
            this.optionsUtil = optionsUtil;
        }
        return this.optionsUtil;
    }

    /** Yomitan's default profile. */
    async defaults(): Promise<Profile> {
        const optionsUtil = await this.getOptionsUtil();
        const options = optionsUtil.getDefault();
        return { version: options.version, options: options.profiles[0].options };
    }

    /**
     * Brings a stored profile up to the current format with upstream's migrations (including default
     * Anki field template upgrades) and validates it against upstream's schema. Unknown or invalid
     * values fall back to defaults.
     */
    async migrate(profile: unknown): Promise<Profile> {
        const input = typeof profile === 'object' && profile !== null ? (profile as Partial<Profile>) : {};
        const wrapped = {
            version: typeof input.version === 'number' ? input.version : 0,
            profiles: [{ name: 'Default', conditionGroups: [], options: clone(input.options ?? {}) }],
            profileCurrent: 0,
        };
        const optionsUtil = await this.getOptionsUtil();
        const updated = await optionsUtil.update(wrapped);
        return { version: updated.version, options: updated.profiles[0].options };
    }

    /**
     * Imports one profile from a Yomitan settings export (the JSON from Yomitan's "Export settings").
     * Defaults to the export's current profile.
     */
    async importYomitanSettings(exported: unknown, profileIndex?: number): Promise<Profile> {
        const data = typeof exported === 'object' && exported !== null ? (exported as { options?: unknown }) : {};
        // Yomitan's export wraps the options object: {version, date, url, manifest, environment, userAgent, options}.
        const optionsInput = 'options' in data && typeof data.options === 'object' ? data.options : exported;
        const optionsUtil = await this.getOptionsUtil();
        const updated = await optionsUtil.update(clone(optionsInput));
        const index = profileIndex ?? updated.profileCurrent;
        const selected = updated.profiles[index];
        if (selected === undefined) {
            throw new RangeError(`The settings export has no profile ${index}`);
        }
        return { version: updated.version, options: selected.options };
    }
}
