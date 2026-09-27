/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Browser and extension globals that vendored Yomitan modules reference. The sync script rewrites
 * those references to `upstreamEnv.<name>`, so the modules run unchanged against a real DOM in the
 * browser or the built-in string DOM elsewhere. Rendering is synchronous, so `withUpstreamEnv`
 * swaps the environment for the duration of one call.
 */
export type UpstreamEnv = {
    document: unknown;
    window: unknown;
    location: { protocol: string; host: string };
    Node: unknown;
    NodeFilter: unknown;
    DOMParser: unknown;
    DocumentFragment: unknown;
    chrome: unknown;
};

const nodeConstants = {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3,
    COMMENT_NODE: 8,
    DOCUMENT_NODE: 9,
    DOCUMENT_FRAGMENT_NODE: 11,
};

const chromeShim = {
    runtime: {
        getURL: (url: string) => url,
        lastError: undefined,
    },
    storage: undefined,
};

/** Internal lookup links render as `yomitan://lookup/search.html?query=...`; renderers intercept them. */
export const INTERNAL_LINK_LOCATION = { protocol: 'yomitan:', host: 'lookup' };

export const upstreamEnv: UpstreamEnv = {
    document: undefined,
    window: undefined,
    location: INTERNAL_LINK_LOCATION,
    Node: nodeConstants,
    NodeFilter: undefined,
    DOMParser: undefined,
    DocumentFragment: undefined,
    chrome: chromeShim,
};

/**
 * Runs `fn` with some globals replaced, restoring them afterwards. `fn` must be synchronous.
 */
export function withUpstreamEnv<T>(overrides: Partial<UpstreamEnv>, fn: () => T): T {
    const previous: Partial<UpstreamEnv> = {};
    for (const key of Object.keys(overrides) as (keyof UpstreamEnv)[]) {
        (previous as Record<string, unknown>)[key] = upstreamEnv[key];
        (upstreamEnv as Record<string, unknown>)[key] = overrides[key];
    }
    try {
        const result = fn();
        if (result instanceof Promise) {
            throw new Error('withUpstreamEnv callbacks must be synchronous');
        }
        return result;
    } finally {
        Object.assign(upstreamEnv, previous);
    }
}
