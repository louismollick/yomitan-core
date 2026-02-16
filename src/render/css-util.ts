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
        return addScopeToCss(css, scopeSelector);
    }
}
