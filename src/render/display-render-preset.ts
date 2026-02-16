/*
 * Copyright (C) 2023-2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Default document dataset values used by Yomitan extension popup rendering.
 * These values drive conditional display CSS behavior.
 */
export const EXTENSION_DISPLAY_DATASET_DEFAULTS = {
    ankiEnabled: 'true',
    language: 'ja',
    resultOutputMode: 'group',
    glossaryLayoutMode: 'default',
    compactTags: 'false',
    averageFrequency: 'false',
    frequencyDisplayMode: 'split-tags-grouped',
    termDisplayMode: 'ruby',
    enableSearchTags: 'false',
    showPronunciationText: 'true',
    showPronunciationDownstepPosition: 'true',
    showPronunciationGraph: 'false',
    debug: 'false',
    popupDisplayMode: 'default',
    popupCurrentIndicatorMode: 'triangle',
    popupActionBarVisibility: 'auto',
    popupActionBarLocation: 'top',
} as const;

/**
 * Applies extension-equivalent rendering defaults to an HTML element dataset.
 * Typically this should be called with `document.documentElement`.
 */
export function applyExtensionDisplayDefaults(documentElement: HTMLElement): void {
    for (const [key, value] of Object.entries(EXTENSION_DISPLAY_DATASET_DEFAULTS)) {
        documentElement.dataset[key] = value;
    }
}

