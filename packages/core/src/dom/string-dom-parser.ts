/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * HTML parsing for the string DOM, with parse5 (the HTML parser upstream itself bundles).
 */

import { parseFragment } from '../upstream/ext/lib/parse5.js';
import type { StringDocument, StringElement, StringParentNode } from './string-dom';

type Parse5Node = {
    nodeName: string;
    tagName?: string;
    namespaceURI?: string;
    attrs?: { name: string; value: string; prefix?: string }[];
    childNodes?: Parse5Node[];
    value?: string;
    data?: string;
    content?: { childNodes: Parse5Node[] };
};

function appendParse5Nodes(target: StringParentNode, nodes: Parse5Node[], document: StringDocument): void {
    for (const node of nodes) {
        if (node.nodeName === '#text') {
            target.appendChild(document.createTextNode(node.value ?? ''));
        } else if (node.nodeName === '#comment') {
            target.appendChild(document.createComment(node.data ?? ''));
        } else if (typeof node.tagName === 'string') {
            const element = document.createElementNS(node.namespaceURI ?? null, node.tagName) as StringElement;
            for (const { name, value, prefix } of node.attrs ?? []) {
                element.setAttribute(prefix ? `${prefix}:${name}` : name, value);
            }
            if (element.content !== null && node.content !== undefined) {
                appendParse5Nodes(element.content, node.content.childNodes, document);
            } else {
                appendParse5Nodes(element, node.childNodes ?? [], document);
            }
            target.appendChild(element);
        }
    }
}

/** Parses `html` as a fragment in the context of `contextElement` and appends it to `target`. */
export function parseFragmentInto(target: StringParentNode, html: string, contextElement: StringElement): void {
    const fragment = (parseFragment as (html: string) => Parse5Node)(html);
    appendParse5Nodes(target, fragment.childNodes ?? [], contextElement.ownerDocument);
}
