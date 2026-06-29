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
 * DOM-dependent CSS utility functions for sanitizing and scoping CSS.
 * These require a DOM environment (browser or JSDOM/linkedom).
 */

/**
 * Sanitizes a CSS string by parsing it through a CSSStyleSheet and
 * re-serializing it. This removes any invalid or potentially dangerous rules.
 * @param css - The raw CSS string to sanitize.
 * @returns The sanitized CSS string.
 */
export function sanitizeCSS(css: string): string {
    const sanitizer = new CSSStyleSheet();
    sanitizer.replaceSync(css);
    return Array.from(sanitizer.cssRules)
        .map((rule) => rule.cssText || '')
        .join('\n');
}

/**
 * Wraps a CSS string inside a scope selector using CSS nesting.
 * The resulting CSS will only apply within the scope of the given selector.
 * @param css - The CSS string to scope.
 * @param scopeSelector - The CSS selector to use as the scope.
 * @returns The scoped CSS string.
 */
export function addScopeToCss(css: string, scopeSelector: string): string {
    return `${scopeSelector} {${css}\n}`;
}

/**
 * Wraps a CSS string inside a scope selector using legacy (non-nesting) approach.
 * Each CSS rule's selector is prefixed with the scope selector.
 * This is compatible with older browsers that do not support CSS nesting.
 * @param css - The CSS string to scope.
 * @param scopeSelector - The CSS selector to use as the scope prefix.
 * @returns The scoped CSS string.
 */
export function addScopeToCssLegacy(css: string, scopeSelector: string): string {
    try {
        if (typeof CSSStyleSheet === 'undefined') {
            return addScopeToCssText(css, scopeSelector);
        }

        const stylesheet = new CSSStyleSheet();
        stylesheet.replaceSync(css);
        const newCSSRules: string[] = [];
        for (const cssRule of Array.from(stylesheet.cssRules)) {
            if (!('selectorText' in cssRule)) {
                continue;
            }

            const styleRule = cssRule as CSSStyleRule;
            const newSelectors: string[] = [];
            for (const selector of styleRule.selectorText.split(',')) {
                newSelectors.push(`${scopeSelector} ${selector}`);
            }
            const newRule = styleRule.cssText.replace(styleRule.selectorText, newSelectors.join(', '));
            newCSSRules.push(newRule);
        }
        stylesheet.replaceSync(newCSSRules.join('\n'));
        return Array.from(stylesheet.cssRules)
            .map((rule) => rule.cssText || '')
            .join('\n');
    } catch (_e) {
        return addScopeToCssText(css, scopeSelector);
    }
}

function addScopeToCssText(css: string, scopeSelector: string): string {
    return parseCssRules(css)
        .map((rule) => scopeCssRule(rule.selector, rule.body, scopeSelector))
        .filter((rule) => rule.length > 0)
        .join('\n');
}

function scopeCssRule(selectorText: string, body: string, scopeSelector: string): string {
    const selector = selectorText.trim();
    if (selector.length === 0) {
        return '';
    }

    if (selector.startsWith('@')) {
        const scopedBody = addScopeToCssText(body, scopeSelector);
        return scopedBody.length > 0 ? `${selector} {\n${scopedBody}\n}` : '';
    }

    const selectors = selector.split(',').map((item) => {
        const trimmed = item.trim();
        return scopeSelector.length > 0 ? `${scopeSelector} ${trimmed}` : trimmed;
    });
    const declarations: string[] = [];
    const nestedRules: string[] = [];
    let declarationStart = 0;

    for (const rule of parseCssRules(body)) {
        declarations.push(body.slice(declarationStart, rule.start).trim());
        declarationStart = rule.end;
        const nestedSelectors = rule.selector
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
            .map((item) =>
                selectors
                    .map((parentSelector) =>
                        item.includes('&') ? item.replace(/&/g, parentSelector) : `${parentSelector} ${item}`,
                    )
                    .join(', '),
            )
            .join(', ');
        nestedRules.push(scopeCssRule(nestedSelectors, rule.body, ''));
    }

    declarations.push(body.slice(declarationStart).trim());
    const declarationBlock = declarations.filter((item) => item.length > 0).join('\n');
    const scopedRules = declarationBlock.length > 0 ? [`${selectors.join(', ')} {\n${declarationBlock}\n}`] : [];
    scopedRules.push(...nestedRules.filter((item) => item.length > 0));
    return scopedRules.join('\n');
}

function parseCssRules(css: string): { selector: string; body: string; start: number; end: number }[] {
    const rules: { selector: string; body: string; start: number; end: number }[] = [];
    let i = 0;

    while (i < css.length) {
        const open = css.indexOf('{', i);
        if (open < 0) {
            break;
        }

        const selectorStart = findSelectorStart(css, open);
        const close = findMatchingBrace(css, open);
        if (close < 0) {
            break;
        }

        rules.push({
            selector: css.slice(selectorStart, open).trim(),
            body: css.slice(open + 1, close).trim(),
            start: selectorStart,
            end: close + 1,
        });
        i = close + 1;
    }

    return rules;
}

function findSelectorStart(css: string, openIndex: number): number {
    const previousRuleEnd = css.lastIndexOf('}', openIndex);
    const previousDeclarationEnd = css.lastIndexOf(';', openIndex);
    return Math.max(previousRuleEnd, previousDeclarationEnd) + 1;
}

function findMatchingBrace(css: string, openIndex: number): number {
    let depth = 0;
    let quote: string | null = null;

    for (let i = openIndex; i < css.length; i += 1) {
        const char = css[i];
        const previous = css[i - 1];
        if (quote !== null) {
            if (char === quote && previous !== '\\') {
                quote = null;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '{') {
            depth += 1;
            continue;
        }
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return i;
            }
        }
    }

    return -1;
}
