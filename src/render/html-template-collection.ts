/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2020-2022  Yomichan Authors
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
 * A collection of HTML templates parsed from raw HTML strings.
 * Templates are identified by their `id` attribute, which must end with `-template`.
 * The prefix before `-template` is used as the template name.
 */
export class HtmlTemplateCollection {
    private _templates: Map<string, HTMLTemplateElement>;
    private _document: Document;

    /**
     * Creates a new HtmlTemplateCollection.
     * @param doc - The Document object to use for DOM operations.
     */
    constructor(doc: Document) {
        this._templates = new Map();
        this._document = doc;
    }

    /**
     * Loads templates from a raw HTML string.
     * @param html - The HTML string containing `<template>` elements.
     */
    loadFromString(html: string): void {
        const parser = new (this._document.defaultView as unknown as { DOMParser: typeof DOMParser }).DOMParser();
        const templatesDocument = parser.parseFromString(html, 'text/html');
        this.load(templatesDocument);
    }

    /**
     * Loads templates from a Document source.
     * @param source - The Document containing template elements.
     */
    load(source: Document): void {
        const pattern = /^([\w\W]+)-template$/;
        for (const template of Array.from(source.querySelectorAll('template')) as HTMLTemplateElement[]) {
            const match = pattern.exec(template.id);
            if (match === null) {
                continue;
            }
            this._prepareTemplate(template);
            this._templates.set(match[1], template);
        }
    }

    /**
     * Instantiates a template by name, returning the first element child as a deep clone.
     * @param name - The template name (without the `-template` suffix).
     * @returns The cloned first element child.
     * @throws Error if the template or its content element is not found.
     */
    instantiate(name: string): HTMLElement {
        const { firstElementChild } = this.getTemplateContent(name);
        if (firstElementChild === null) {
            throw new Error(`Failed to find template content element: ${name}`);
        }
        return this._document.importNode(firstElementChild, true) as HTMLElement;
    }

    /**
     * Instantiates a template by name, returning the entire content as a DocumentFragment clone.
     * @param name - The template name (without the `-template` suffix).
     * @returns The cloned DocumentFragment.
     */
    instantiateFragment(name: string): DocumentFragment {
        return this._document.importNode(this.getTemplateContent(name), true);
    }

    /**
     * Gets the content DocumentFragment of a named template.
     * @param name - The template name (without the `-template` suffix).
     * @returns The template's content DocumentFragment.
     * @throws Error if the template is not found.
     */
    getTemplateContent(name: string): DocumentFragment {
        const template = this._templates.get(name);
        if (typeof template === 'undefined') {
            throw new Error(`Failed to find template: ${name}`);
        }
        return template.content;
    }

    /**
     * Returns an iterator over all template elements.
     */
    getAllTemplates(): IterableIterator<HTMLTemplateElement> {
        return this._templates.values();
    }

    // Private

    private _prepareTemplate(template: HTMLTemplateElement): void {
        if (template.dataset.removeWhitespaceText === 'true') {
            this._removeWhitespaceText(template);
        }
    }

    private _removeWhitespaceText(template: HTMLTemplateElement): void {
        const { content } = template;
        const { TEXT_NODE } = this._document.defaultView
            ? (this._document.defaultView as unknown as { Node: typeof Node }).Node
            : { TEXT_NODE: 3 };
        const iterator = this._document.createNodeIterator(content, 4 /* NodeFilter.SHOW_TEXT */);
        const removeNodes: Node[] = [];
        while (true) {
            const node = iterator.nextNode();
            if (node === null) {
                break;
            }
            if (node.nodeType === TEXT_NODE && (node.nodeValue ?? '').trim().length === 0) {
                removeNodes.push(node);
            }
        }
        for (const node of removeNodes) {
            const { parentNode } = node;
            if (parentNode !== null) {
                parentNode.removeChild(node);
            }
        }
    }
}
