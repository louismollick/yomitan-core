/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Per-dictionary glossary HTML for hosts that render the rest of an entry themselves.
 */

import type { StringElement } from '../dom/string-dom';
import type { TermDictionaryEntry } from '../upstream/types/ext/dictionary';

/** One dictionary's definitions for a term entry, as Yomitan's popup renders them. */
export type GlossaryBlock = {
    dictionary: string;
    dictionaryAlias: string;
    /**
     * An `<ol class="definition-list">` of Yomitan's `<li class="definition-item">` elements: definition
     * tags, disambiguation and glosses (text, structured content, images). Style it with `render.css()`.
     */
    html: string;
};

/**
 * Groups the `.definition-item` elements of a rendered term entry by dictionary, in the order the
 * dictionaries first appear in the entry. `node` is the output of Yomitan's DisplayGenerator, whose
 * `n`th item renders `entry.definitions[n]`.
 */
export function groupGlossaryBlocks(entry: TermDictionaryEntry, node: StringElement): GlossaryBlock[] {
    const items = node.querySelector('.definition-list')?.children ?? [];
    const groups = new Map<string, { dictionaryAlias: string; items: string[] }>();
    for (const [i, { dictionary, dictionaryAlias }] of entry.definitions.entries()) {
        const group = groups.get(dictionary) ?? { dictionaryAlias, items: [] };
        group.items.push(items[i].outerHTML);
        groups.set(dictionary, group);
    }
    return [...groups].map(([dictionary, group]) => ({
        dictionary,
        dictionaryAlias: group.dictionaryAlias,
        html: `<ol class="definition-list" data-count="${group.items.length}">${group.items.join('')}</ol>`,
    }));
}
