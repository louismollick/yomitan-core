/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Replaces upstream's fetch-utilities.js. Upstream fetches extension-relative assets with
 * chrome.runtime.getURL; here the same paths resolve to assets bundled by the sync script.
 */

import { upstreamAssets } from '../../../assets.js';

/**
 * @param {string} url
 * @returns {Promise<unknown>}
 */
async function loadAsset(url) {
    const load = upstreamAssets[url];
    if (typeof load !== 'function') {
        throw new Error(`Failed to fetch ${url}: asset is not bundled`);
    }
    return (await load()).default;
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchText(url) {
    const value = await loadAsset(url);
    return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * @template [T=unknown]
 * @param {string} url
 * @returns {Promise<T>}
 */
export async function fetchJson(url) {
    const value = await loadAsset(url);
    // Callers may mutate the result; never hand out the shared module value.
    return /** @type {T} */ (typeof value === 'string' ? JSON.parse(value) : structuredCloneJson(value));
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function structuredCloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
