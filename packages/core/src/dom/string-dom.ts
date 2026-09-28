/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A small DOM for running Yomitan's display and Anki generators where there is no browser DOM
 * (Node, React Native, workers). It implements what those vendored modules use, and serializes
 * exactly like a browser (the HTML fragment serialization algorithm, attribute order preserved,
 * CSSOM-style `style` attributes), so output matches upstream's goldens, which were produced with
 * jsdom. It is not a general-purpose DOM.
 */

import { parseFragmentInto } from './string-dom-parser';
import { matchesSelector } from './string-dom-selectors';

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export const NODE_TYPES = {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3,
    COMMENT_NODE: 8,
    DOCUMENT_NODE: 9,
    DOCUMENT_FRAGMENT_NODE: 11,
} as const;

const VOID_ELEMENTS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'source',
    'track',
    'wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

export class StringNode {
    readonly nodeType: number;
    ownerDocument: StringDocument;
    parentNode: StringParentNode | null = null;

    constructor(nodeType: number, ownerDocument: StringDocument) {
        this.nodeType = nodeType;
        this.ownerDocument = ownerDocument;
    }

    get parentElement(): StringElement | null {
        return this.parentNode instanceof StringElement ? this.parentNode : null;
    }

    get nextSibling(): StringNode | null {
        const siblings = this.parentNode?.childNodes;
        if (siblings === undefined) {
            return null;
        }
        return siblings[siblings.indexOf(this) + 1] ?? null;
    }

    get previousSibling(): StringNode | null {
        const siblings = this.parentNode?.childNodes;
        if (siblings === undefined) {
            return null;
        }
        return siblings[siblings.indexOf(this) - 1] ?? null;
    }

    get textContent(): string {
        return '';
    }

    set textContent(_value: string) {
        // Overridden where meaningful.
    }

    remove(): void {
        this.parentNode?.removeChild(this);
    }

    cloneNode(_deep = false): StringNode {
        throw new Error('cloneNode is not implemented for this node type');
    }
}

export class StringText extends StringNode {
    data: string;

    constructor(data: string, ownerDocument: StringDocument) {
        super(NODE_TYPES.TEXT_NODE, ownerDocument);
        this.data = data;
    }

    get nodeName(): string {
        return '#text';
    }

    get nodeValue(): string {
        return this.data;
    }

    set nodeValue(value: string) {
        this.data = value;
    }

    override get textContent(): string {
        return this.data;
    }

    override set textContent(value: string) {
        this.data = value;
    }

    override cloneNode(): StringText {
        return new StringText(this.data, this.ownerDocument);
    }
}

export class StringComment extends StringNode {
    data: string;

    constructor(data: string, ownerDocument: StringDocument) {
        super(NODE_TYPES.COMMENT_NODE, ownerDocument);
        this.data = data;
    }

    get nodeName(): string {
        return '#comment';
    }

    get nodeValue(): string {
        return this.data;
    }

    override cloneNode(): StringComment {
        return new StringComment(this.data, this.ownerDocument);
    }
}

export class StringParentNode extends StringNode {
    childNodes: StringNode[] = [];

    get firstChild(): StringNode | null {
        return this.childNodes[0] ?? null;
    }

    get lastChild(): StringNode | null {
        return this.childNodes[this.childNodes.length - 1] ?? null;
    }

    get children(): StringElement[] {
        return this.childNodes.filter((node): node is StringElement => node instanceof StringElement);
    }

    get firstElementChild(): StringElement | null {
        return this.children[0] ?? null;
    }

    get lastElementChild(): StringElement | null {
        const { children } = this;
        return children[children.length - 1] ?? null;
    }

    override get textContent(): string {
        let text = '';
        for (const node of this.childNodes) {
            if (node instanceof StringText || node instanceof StringParentNode) {
                text += node.textContent;
            }
        }
        return text;
    }

    override set textContent(value: string) {
        this.detachAll();
        if (value !== '' && value !== null && value !== undefined) {
            this.appendChild(new StringText(String(value), this.ownerDocument));
        }
    }

    appendChild<T extends StringNode>(node: T): T {
        return this.insertBefore(node, null);
    }

    insertBefore<T extends StringNode>(node: T, reference: StringNode | null): T {
        if (node instanceof StringDocumentFragment) {
            const nodes = [...node.childNodes];
            node.detachAll();
            for (const child of nodes) {
                this.insertBefore(child, reference);
            }
            return node;
        }
        node.parentNode?.removeChild(node);
        const index = reference === null ? -1 : this.childNodes.indexOf(reference);
        if (reference !== null && index < 0) {
            throw new Error('The node before which the new node is to be inserted is not a child of this node');
        }
        if (index < 0) {
            this.childNodes.push(node);
        } else {
            this.childNodes.splice(index, 0, node);
        }
        node.parentNode = this;
        return node;
    }

    append(...nodes: (StringNode | string)[]): void {
        for (const node of nodes) {
            this.appendChild(typeof node === 'string' ? new StringText(node, this.ownerDocument) : node);
        }
    }

    removeChild<T extends StringNode>(node: T): T {
        const index = this.childNodes.indexOf(node);
        if (index < 0) {
            throw new Error('The node to be removed is not a child of this node');
        }
        this.childNodes.splice(index, 1);
        node.parentNode = null;
        return node;
    }

    replaceChild<T extends StringNode>(node: StringNode, old: T): T {
        this.insertBefore(node, old);
        return this.removeChild(old);
    }

    replaceChildren(...nodes: (StringNode | string)[]): void {
        this.detachAll();
        this.append(...nodes);
    }

    contains(node: StringNode | null): boolean {
        for (let current: StringNode | null = node; current !== null; current = current.parentNode) {
            if (current === this) {
                return true;
            }
        }
        return false;
    }

    querySelectorAll(selector: string): StringElement[] {
        const results: StringElement[] = [];
        const visit = (parent: StringParentNode) => {
            for (const child of parent.childNodes) {
                if (child instanceof StringElement) {
                    if (child.matches(selector)) {
                        results.push(child);
                    }
                    visit(child);
                    if (child.content !== null) {
                        // Template contents are not part of the tree for selectors.
                    }
                }
            }
        };
        visit(this);
        return results;
    }

    querySelector(selector: string): StringElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    detachAll(): void {
        for (const node of this.childNodes) {
            node.parentNode = null;
        }
        this.childNodes = [];
    }

    protected cloneChildrenInto(target: StringParentNode): void {
        for (const child of this.childNodes) {
            target.appendChild(child.cloneNode(true));
        }
    }
}

export class StringDocumentFragment extends StringParentNode {
    constructor(ownerDocument: StringDocument) {
        super(NODE_TYPES.DOCUMENT_FRAGMENT_NODE, ownerDocument);
    }

    get nodeName(): string {
        return '#document-fragment';
    }

    override cloneNode(deep = false): StringDocumentFragment {
        const clone = new StringDocumentFragment(this.ownerDocument);
        if (deep) {
            this.cloneChildrenInto(clone);
        }
        return clone;
    }
}

function camelToKebab(name: string): string {
    return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function kebabToCamel(name: string): string {
    return name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

/** `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa` become `rgb()`/`rgba()`, as browsers serialize them. */
function normalizeColorToken(token: string): string {
    const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(token);
    if (match === null) {
        return token;
    }
    let hex = match[1];
    if (hex.length <= 4) {
        hex = [...hex].map((char) => char + char).join('');
    }
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    if (hex.length === 8) {
        const alpha = Math.round((Number.parseInt(hex.slice(6, 8), 16) / 255) * 1000) / 1000;
        return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return `rgb(${r}, ${g}, ${b})`;
}

function normalizeStyleValue(value: string): string {
    return value.trim().replace(/#[0-9a-f]{3,8}\b/gi, normalizeColorToken);
}

/** Enough of CSSStyleDeclaration for the vendored generators; it keeps the `style` attribute in sync. */
export class StringStyle {
    private readonly element: StringElement;
    private readonly properties = new Map<string, string>();

    constructor(element: StringElement) {
        this.element = element;
    }

    get cssText(): string {
        return [...this.properties].map(([name, value]) => `${name}: ${value};`).join(' ');
    }

    set cssText(value: string) {
        this.properties.clear();
        for (const declaration of value.split(';')) {
            const colon = declaration.indexOf(':');
            if (colon < 0) {
                continue;
            }
            const name = declaration.slice(0, colon).trim();
            const propertyValue = declaration.slice(colon + 1).trim();
            if (name.length > 0 && propertyValue.length > 0) {
                this.properties.set(name.startsWith('--') ? name : name.toLowerCase(), normalizeStyleValue(propertyValue));
            }
        }
        this.sync();
    }

    getPropertyValue(name: string): string {
        return this.properties.get(name) ?? '';
    }

    setProperty(name: string, value: string | null): void {
        const propertyName = name.startsWith('--') ? name : name.toLowerCase();
        if (value === null || value === '') {
            this.removeProperty(propertyName);
            return;
        }
        this.properties.set(propertyName, normalizeStyleValue(String(value)));
        this.sync();
    }

    removeProperty(name: string): string {
        const previous = this.properties.get(name) ?? '';
        this.properties.delete(name);
        this.sync();
        return previous;
    }

    /** Called when the `style` attribute is set directly. */
    loadFromAttribute(value: string | null): void {
        this.properties.clear();
        if (value !== null) {
            for (const declaration of value.split(';')) {
                const colon = declaration.indexOf(':');
                if (colon < 0) {
                    continue;
                }
                const name = declaration.slice(0, colon).trim();
                const propertyValue = declaration.slice(colon + 1).trim();
                if (name.length > 0 && propertyValue.length > 0) {
                    this.properties.set(name.startsWith('--') ? name : name.toLowerCase(), normalizeStyleValue(propertyValue));
                }
            }
        }
    }

    private sync(): void {
        this.element.setStyleAttributeFromStyle(this.properties.size > 0 ? this.cssText : null);
    }
}

function createStyleProxy(style: StringStyle): StringStyle & Record<string, string> {
    return new Proxy(style, {
        get(target, property, receiver) {
            if (typeof property === 'string' && !(property in target)) {
                return target.getPropertyValue(camelToKebab(property));
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, property, value) {
            if (typeof property === 'string' && !(property in target)) {
                target.setProperty(camelToKebab(property), value === null ? null : String(value));
                return true;
            }
            return Reflect.set(target, property, value);
        },
    }) as StringStyle & Record<string, string>;
}

function createDatasetProxy(element: StringElement): Record<string, string> {
    return new Proxy({} as Record<string, string>, {
        get(_target, property) {
            if (typeof property !== 'string') {
                return undefined;
            }
            return element.getAttribute(`data-${camelToKebab(property)}`) ?? undefined;
        },
        set(_target, property, value) {
            if (typeof property === 'string') {
                element.setAttribute(`data-${camelToKebab(property)}`, String(value));
            }
            return true;
        },
        deleteProperty(_target, property) {
            if (typeof property === 'string') {
                element.removeAttribute(`data-${camelToKebab(property)}`);
            }
            return true;
        },
        has(_target, property) {
            return typeof property === 'string' && element.hasAttribute(`data-${camelToKebab(property)}`);
        },
        ownKeys() {
            return element
                .getAttributeNames()
                .filter((name) => name.startsWith('data-'))
                .map((name) => kebabToCamel(name.slice(5)));
        },
        getOwnPropertyDescriptor(_target, property) {
            if (typeof property !== 'string') {
                return undefined;
            }
            const value = element.getAttribute(`data-${camelToKebab(property)}`);
            return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
        },
    });
}

class StringClassList {
    private readonly element: StringElement;

    constructor(element: StringElement) {
        this.element = element;
    }

    private get tokens(): string[] {
        const value = this.element.getAttribute('class');
        return value === null ? [] : value.split(/\s+/).filter((token) => token.length > 0);
    }

    contains(token: string): boolean {
        return this.tokens.includes(token);
    }

    add(...tokens: string[]): void {
        const current = this.tokens;
        for (const token of tokens) {
            if (!current.includes(token)) {
                current.push(token);
            }
        }
        this.element.setAttribute('class', current.join(' '));
    }

    remove(...tokens: string[]): void {
        this.element.setAttribute(
            'class',
            this.tokens.filter((token) => !tokens.includes(token)).join(' '),
        );
    }

    toggle(token: string, force?: boolean): boolean {
        const has = this.contains(token);
        const add = force ?? !has;
        if (add && !has) {
            this.add(token);
        } else if (!add && has) {
            this.remove(token);
        }
        return add;
    }

    get length(): number {
        return this.tokens.length;
    }
}

/** Element properties that reflect attributes. Numeric ones follow the unsigned-long reflection rules. */
const STRING_REFLECTIONS: Record<string, string> = {
    id: 'id',
    lang: 'lang',
    title: 'title',
    href: 'href',
    target: 'target',
    rel: 'rel',
    src: 'src',
    alt: 'alt',
    dir: 'dir',
    type: 'type',
    name: 'name',
};
const NUMBER_REFLECTIONS: Record<string, string> = {
    colSpan: 'colspan',
    rowSpan: 'rowspan',
    width: 'width',
    height: 'height',
    tabIndex: 'tabindex',
};

export class StringElement extends StringParentNode {
    readonly localName: string;
    readonly namespaceURI: string;
    private readonly attributeMap = new Map<string, string>();
    private styleInstance: StringStyle | null = null;
    private styleProxy: (StringStyle & Record<string, string>) | null = null;
    private datasetProxy: Record<string, string> | null = null;
    /** For `<template>`: its content fragment. */
    content: StringDocumentFragment | null;

    constructor(localName: string, namespaceURI: string, ownerDocument: StringDocument) {
        super(NODE_TYPES.ELEMENT_NODE, ownerDocument);
        this.localName = namespaceURI === HTML_NAMESPACE ? localName.toLowerCase() : localName;
        this.namespaceURI = namespaceURI;
        this.content =
            this.localName === 'template' && namespaceURI === HTML_NAMESPACE ? new StringDocumentFragment(ownerDocument) : null;
        return new Proxy(this, {
            get(target, property, receiver) {
                if (typeof property === 'string') {
                    if (property in STRING_REFLECTIONS && !(property in StringElement.prototype)) {
                        return target.getAttribute(STRING_REFLECTIONS[property]) ?? '';
                    }
                    if (property in NUMBER_REFLECTIONS) {
                        const value = Number.parseInt(target.getAttribute(NUMBER_REFLECTIONS[property]) ?? '', 10);
                        return Number.isNaN(value) ? 0 : value;
                    }
                }
                return Reflect.get(target, property, receiver);
            },
            set(target, property, value, receiver) {
                if (typeof property === 'string') {
                    if (property in STRING_REFLECTIONS && !(property in StringElement.prototype)) {
                        target.setAttribute(STRING_REFLECTIONS[property], String(value));
                        return true;
                    }
                    if (property in NUMBER_REFLECTIONS) {
                        target.setAttribute(NUMBER_REFLECTIONS[property], String(Math.trunc(Number(value)) >>> 0));
                        return true;
                    }
                }
                return Reflect.set(target, property, value, receiver);
            },
        });
    }

    get tagName(): string {
        return this.namespaceURI === HTML_NAMESPACE ? this.localName.toUpperCase() : this.localName;
    }

    get nodeName(): string {
        return this.tagName;
    }

    get className(): string {
        return this.getAttribute('class') ?? '';
    }

    set className(value: string) {
        this.setAttribute('class', value);
    }

    get classList(): StringClassList {
        return new StringClassList(this);
    }

    get dataset(): Record<string, string> {
        this.datasetProxy ??= createDatasetProxy(this);
        return this.datasetProxy;
    }

    get style(): StringStyle & Record<string, string> {
        if (this.styleProxy === null) {
            this.styleInstance = new StringStyle(this);
            this.styleInstance.loadFromAttribute(this.getAttribute('style'));
            this.styleProxy = createStyleProxy(this.styleInstance);
        }
        return this.styleProxy;
    }

    getAttribute(name: string): string | null {
        return this.attributeMap.get(this.normalizeAttributeName(name)) ?? null;
    }

    getAttributeNames(): string[] {
        return [...this.attributeMap.keys()];
    }

    hasAttribute(name: string): boolean {
        return this.attributeMap.has(this.normalizeAttributeName(name));
    }

    setAttribute(name: string, value: string): void {
        const attributeName = this.normalizeAttributeName(name);
        this.attributeMap.set(attributeName, String(value));
        if (attributeName === 'style') {
            this.styleInstance?.loadFromAttribute(String(value));
        }
    }

    removeAttribute(name: string): void {
        const attributeName = this.normalizeAttributeName(name);
        this.attributeMap.delete(attributeName);
        if (attributeName === 'style') {
            this.styleInstance?.loadFromAttribute(null);
        }
    }

    /** Used by {@link StringStyle}; does not reload the style object. */
    setStyleAttributeFromStyle(value: string | null): void {
        if (value === null) {
            this.attributeMap.delete('style');
        } else {
            this.attributeMap.set('style', value);
        }
    }

    matches(selector: string): boolean {
        return matchesSelector(this, selector);
    }

    closest(selector: string): StringElement | null {
        for (let element: StringElement | null = this; element !== null; element = element.parentElement) {
            if (element.matches(selector)) {
                return element;
            }
        }
        return null;
    }

    get innerHTML(): string {
        return serializeChildren(this.content ?? this);
    }

    set innerHTML(html: string) {
        const target = this.content ?? this;
        target.detachAll();
        parseFragmentInto(target, html, this);
    }

    get outerHTML(): string {
        return serializeNode(this);
    }

    override cloneNode(deep = false): StringElement {
        const clone = new StringElement(this.localName, this.namespaceURI, this.ownerDocument);
        for (const [name, value] of this.attributeMap) {
            clone.setAttribute(name, value);
        }
        if (deep) {
            this.cloneChildrenInto(clone);
            if (this.content !== null && clone.content !== null) {
                for (const child of this.content.childNodes) {
                    clone.content.appendChild(child.cloneNode(true));
                }
            }
        }
        return clone;
    }

    private normalizeAttributeName(name: string): string {
        return this.namespaceURI === HTML_NAMESPACE ? name.toLowerCase() : name;
    }
}

function escapeText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/"/g, '&quot;');
}

function serializeNode(node: StringNode): string {
    if (node instanceof StringText) {
        const parent = node.parentNode;
        if (parent instanceof StringElement && parent.namespaceURI === HTML_NAMESPACE && RAW_TEXT_ELEMENTS.has(parent.localName)) {
            return node.data;
        }
        return escapeText(node.data);
    }
    if (node instanceof StringComment) {
        return `<!--${node.data}-->`;
    }
    if (node instanceof StringElement) {
        const tagName = node.localName;
        let html = `<${tagName}`;
        for (const name of node.getAttributeNames()) {
            html += ` ${name}="${escapeAttribute(node.getAttribute(name) as string)}"`;
        }
        html += '>';
        if (node.namespaceURI === HTML_NAMESPACE && VOID_ELEMENTS.has(tagName)) {
            return html;
        }
        return `${html}${serializeChildren(node.content ?? node)}</${tagName}>`;
    }
    if (node instanceof StringParentNode) {
        return serializeChildren(node);
    }
    return '';
}

function serializeChildren(parent: StringParentNode): string {
    let html = '';
    for (const child of parent.childNodes) {
        html += serializeNode(child);
    }
    return html;
}

export class StringTreeWalker {
    readonly root: StringNode;
    private readonly whatToShow: number;
    private readonly order: StringNode[];
    private index = 0;

    constructor(root: StringNode, whatToShow: number) {
        this.root = root;
        this.whatToShow = whatToShow;
        this.order = [];
        const visit = (node: StringNode) => {
            if (node !== root && this.accepts(node)) {
                this.order.push(node);
            }
            if (node instanceof StringParentNode) {
                for (const child of node.childNodes) {
                    visit(child);
                }
            }
        };
        visit(root);
    }

    get currentNode(): StringNode {
        return this.index === 0 ? this.root : this.order[this.index - 1];
    }

    nextNode(): StringNode | null {
        if (this.index >= this.order.length) {
            return null;
        }
        return this.order[this.index++];
    }

    private accepts(node: StringNode): boolean {
        const bit =
            node.nodeType === NODE_TYPES.ELEMENT_NODE
                ? 0x1
                : node.nodeType === NODE_TYPES.TEXT_NODE
                  ? 0x4
                  : node.nodeType === NODE_TYPES.COMMENT_NODE
                    ? 0x80
                    : 0;
        return (this.whatToShow & bit) !== 0;
    }
}

export class StringDocument extends StringParentNode {
    readonly ELEMENT_NODE = NODE_TYPES.ELEMENT_NODE;
    readonly TEXT_NODE = NODE_TYPES.TEXT_NODE;
    readonly COMMENT_NODE = NODE_TYPES.COMMENT_NODE;
    readonly documentElement: StringElement;
    readonly head: StringElement;
    readonly body: StringElement;

    constructor() {
        super(NODE_TYPES.DOCUMENT_NODE, undefined as unknown as StringDocument);
        this.ownerDocument = this;
        this.documentElement = this.createElement('html');
        this.head = this.createElement('head');
        this.body = this.createElement('body');
        this.documentElement.append(this.head, this.body);
        this.appendChild(this.documentElement);
    }

    get nodeName(): string {
        return '#document';
    }

    createElement(tagName: string): StringElement {
        return new StringElement(tagName, HTML_NAMESPACE, this);
    }

    createElementNS(namespaceURI: string | null, qualifiedName: string): StringElement {
        return new StringElement(qualifiedName, namespaceURI ?? HTML_NAMESPACE, this);
    }

    createTextNode(data: string): StringText {
        return new StringText(String(data), this);
    }

    createComment(data: string): StringComment {
        return new StringComment(data, this);
    }

    createDocumentFragment(): StringDocumentFragment {
        return new StringDocumentFragment(this);
    }

    createTreeWalker(root: StringNode, whatToShow = 0xffffffff): StringTreeWalker {
        return new StringTreeWalker(root, whatToShow);
    }

    /** Forward iteration is all the vendored code uses; it matches a tree walker's order. */
    createNodeIterator(root: StringNode, whatToShow = 0xffffffff): StringTreeWalker {
        return new StringTreeWalker(root, whatToShow);
    }

    importNode<T extends StringNode>(node: T, deep = false): T {
        const clone = node.cloneNode(deep) as T;
        const adopt = (current: StringNode) => {
            current.ownerDocument = this;
            if (current instanceof StringParentNode) {
                current.childNodes.forEach(adopt);
            }
            if (current instanceof StringElement && current.content !== null) {
                current.content.ownerDocument = this;
                current.content.childNodes.forEach(adopt);
            }
        };
        adopt(clone);
        return clone;
    }

    getElementById(id: string): StringElement | null {
        return this.querySelectorAll('*').find((element) => element.getAttribute('id') === id) ?? null;
    }
}

/** A `window` for the vendored generators: only what they read. */
export function createStringWindow(document: StringDocument) {
    return {
        document,
        devicePixelRatio: 1,
        getComputedStyle: () => ({ getPropertyValue: () => '', whiteSpace: 'normal' }),
    };
}

/** `DOMParser` over the string DOM, for upstream's `HtmlTemplateCollection`. */
export class StringDOMParser {
    parseFromString(html: string, _type: string): StringDocument {
        const document = new StringDocument();
        parseFragmentInto(document.body, html, document.body);
        return document;
    }
}

export function isStringNode(value: unknown): value is StringNode {
    return value instanceof StringNode;
}
