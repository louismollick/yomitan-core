/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `Element.matches` for the string DOM. Supports the selector subset Yomitan's style data and
 * display code use: type, universal, class, id, attribute tests (=, ~=, ^=, $=, *=, |=), the
 * descendant, child and sibling combinators, and :root, :not(), :first-child, :last-child,
 * :nth-of-type(), :nth-last-of-type(). Interaction pseudo-classes (:hover, :focus, :active) never
 * match; pseudo-elements throw like a browser's `matches()` does.
 */

import type { StringElement } from './string-dom';

type AttributeTest = { name: string; operator: string | null; value: string };
type Compound = {
    tag: string | null;
    ids: string[];
    classes: string[];
    attributes: AttributeTest[];
    pseudos: { name: string; argument: string | null }[];
};
type Complex = { compounds: Compound[]; combinators: string[] };

const cache = new Map<string, Complex[]>();

function splitTopLevel(input: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let start = 0;
    for (let i = 0; i < input.length; ++i) {
        const char = input[i];
        if (quote !== null) {
            if (char === quote) {
                quote = null;
            }
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '(' || char === '[') {
            ++depth;
        } else if (char === ')' || char === ']') {
            --depth;
        } else if (char === separator && depth === 0) {
            parts.push(input.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(input.slice(start));
    return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function parseCompound(source: string): Compound {
    const compound: Compound = { tag: null, ids: [], classes: [], attributes: [], pseudos: [] };
    let i = 0;
    const readIdentifier = () => {
        const match = /^-?[_a-zA-Z0-9 -￿-]+/.exec(source.slice(i));
        if (match === null) {
            throw new SyntaxError(`Invalid selector: ${source}`);
        }
        i += match[0].length;
        return match[0];
    };
    if (source[0] === '*') {
        i = 1;
    } else if (/[a-zA-Z]/.test(source[0] ?? '')) {
        compound.tag = readIdentifier().toLowerCase();
    }
    while (i < source.length) {
        const char = source[i];
        if (char === '.') {
            ++i;
            compound.classes.push(readIdentifier());
        } else if (char === '#') {
            ++i;
            compound.ids.push(readIdentifier());
        } else if (char === '[') {
            const end = source.indexOf(']', i);
            const body = source.slice(i + 1, end).trim();
            i = end + 1;
            const match = /^([^~^$*|=\s]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?$/.exec(body);
            if (match === null) {
                throw new SyntaxError(`Invalid attribute selector: [${body}]`);
            }
            compound.attributes.push({
                name: match[1].toLowerCase(),
                operator: match[2] ?? null,
                value: match[3] ?? match[4] ?? match[5] ?? '',
            });
        } else if (char === ':') {
            if (source[i + 1] === ':') {
                throw new SyntaxError(`Pseudo-elements cannot be matched: ${source}`);
            }
            ++i;
            const name = readIdentifier().toLowerCase();
            let argument: string | null = null;
            if (source[i] === '(') {
                let depth = 0;
                const start = i + 1;
                for (; i < source.length; ++i) {
                    if (source[i] === '(') {
                        ++depth;
                    } else if (source[i] === ')' && --depth === 0) {
                        break;
                    }
                }
                argument = source.slice(start, i);
                ++i;
            }
            compound.pseudos.push({ name, argument });
        } else {
            throw new SyntaxError(`Invalid selector: ${source}`);
        }
    }
    return compound;
}

function parseComplex(source: string): Complex {
    const compounds: Compound[] = [];
    const combinators: string[] = [];
    // Tokenize on combinators outside brackets and parentheses.
    let depth = 0;
    let current = '';
    let pendingCombinator: string | null = null;
    const flush = () => {
        if (current.trim().length === 0) {
            return;
        }
        if (compounds.length > 0) {
            combinators.push(pendingCombinator ?? ' ');
        }
        compounds.push(parseCompound(current.trim()));
        current = '';
        pendingCombinator = null;
    };
    for (let i = 0; i < source.length; ++i) {
        const char = source[i];
        if (char === '(' || char === '[') {
            ++depth;
        } else if (char === ')' || char === ']') {
            --depth;
        }
        if (depth === 0 && (char === '>' || char === '~' || char === '+')) {
            flush();
            pendingCombinator = char;
        } else if (depth === 0 && /\s/.test(char)) {
            flush();
        } else {
            current += char;
        }
    }
    flush();
    return { compounds, combinators };
}

function parseSelectorList(selector: string): Complex[] {
    let parsed = cache.get(selector);
    if (parsed === undefined) {
        parsed = splitTopLevel(selector, ',').map(parseComplex);
        cache.set(selector, parsed);
    }
    return parsed;
}

function elementSiblings(element: StringElement): StringElement[] {
    return element.parentNode?.children ?? [element];
}

function matchesNth(expression: string, position: number): boolean {
    const text = expression.trim().toLowerCase();
    if (text === 'odd') {
        return position % 2 === 1;
    }
    if (text === 'even') {
        return position % 2 === 0;
    }
    const match = /^([+-]?\d*)n\s*(?:([+-])\s*(\d+))?$/.exec(text);
    if (match === null) {
        return position === Number.parseInt(text, 10);
    }
    const a = match[1] === '' || match[1] === '+' ? 1 : match[1] === '-' ? -1 : Number.parseInt(match[1], 10);
    const b = match[2] === undefined ? 0 : Number.parseInt(`${match[2]}${match[3]}`, 10);
    if (a === 0) {
        return position === b;
    }
    const n = (position - b) / a;
    return Number.isInteger(n) && n >= 0;
}

function matchesAttribute(element: StringElement, { name, operator, value }: AttributeTest): boolean {
    const actual = element.getAttribute(name);
    if (actual === null) {
        return false;
    }
    switch (operator) {
        case null:
            return true;
        case '=':
            return actual === value;
        case '~=':
            return actual.split(/\s+/).includes(value);
        case '^=':
            return value.length > 0 && actual.startsWith(value);
        case '$=':
            return value.length > 0 && actual.endsWith(value);
        case '*=':
            return value.length > 0 && actual.includes(value);
        case '|=':
            return actual === value || actual.startsWith(`${value}-`);
        default:
            return false;
    }
}

function matchesCompound(element: StringElement, compound: Compound): boolean {
    if (compound.tag !== null && element.localName.toLowerCase() !== compound.tag) {
        return false;
    }
    if (compound.ids.some((id) => element.getAttribute('id') !== id)) {
        return false;
    }
    if (compound.classes.length > 0) {
        const classes = (element.getAttribute('class') ?? '').split(/\s+/);
        if (compound.classes.some((name) => !classes.includes(name))) {
            return false;
        }
    }
    if (compound.attributes.some((test) => !matchesAttribute(element, test))) {
        return false;
    }
    for (const { name, argument } of compound.pseudos) {
        switch (name) {
            case 'root':
                if (element.parentElement !== null || element.ownerDocument.documentElement !== element) {
                    return false;
                }
                break;
            case 'not':
                if (argument !== null && matchesSelector(element, argument)) {
                    return false;
                }
                break;
            case 'first-child':
                if (elementSiblings(element)[0] !== element) {
                    return false;
                }
                break;
            case 'last-child': {
                const siblings = elementSiblings(element);
                if (siblings[siblings.length - 1] !== element) {
                    return false;
                }
                break;
            }
            case 'nth-of-type':
            case 'nth-last-of-type': {
                const sameType = elementSiblings(element).filter((sibling) => sibling.localName === element.localName);
                const index = sameType.indexOf(element);
                const position = name === 'nth-of-type' ? index + 1 : sameType.length - index;
                if (argument === null || !matchesNth(argument, position)) {
                    return false;
                }
                break;
            }
            case 'hover':
            case 'focus':
            case 'active':
            case 'focus-visible':
            case 'focus-within':
                return false;
            default:
                throw new SyntaxError(`Unsupported pseudo-class :${name}`);
        }
    }
    return true;
}

function matchesComplexAt(element: StringElement, complex: Complex, index: number): boolean {
    if (!matchesCompound(element, complex.compounds[index])) {
        return false;
    }
    if (index === 0) {
        return true;
    }
    const combinator = complex.combinators[index - 1];
    switch (combinator) {
        case '>': {
            const parent = element.parentElement;
            return parent !== null && matchesComplexAt(parent, complex, index - 1);
        }
        case ' ': {
            for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
                if (matchesComplexAt(parent, complex, index - 1)) {
                    return true;
                }
            }
            return false;
        }
        case '+':
        case '~': {
            const siblings = elementSiblings(element);
            const position = siblings.indexOf(element);
            if (combinator === '+') {
                return position > 0 && matchesComplexAt(siblings[position - 1], complex, index - 1);
            }
            return siblings.slice(0, position).some((sibling) => matchesComplexAt(sibling, complex, index - 1));
        }
        default:
            return false;
    }
}

export function matchesSelector(element: StringElement, selector: string): boolean {
    return parseSelectorList(selector).some(
        (complex) => complex.compounds.length > 0 && matchesComplexAt(element, complex, complex.compounds.length - 1),
    );
}
