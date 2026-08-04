import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addScopeToCssLegacy } from '../src/render/css-util';

describe('css utilities', () => {
    let originalCSSStyleSheet: typeof CSSStyleSheet | undefined;

    beforeEach(() => {
        originalCSSStyleSheet = globalThis.CSSStyleSheet;
        (globalThis as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet = undefined;
    });

    afterEach(() => {
        (globalThis as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet = originalCSSStyleSheet;
    });

    it('prefixes simple and comma-separated selectors without CSSStyleSheet', () => {
        const css = '.term { color: red; }\n.gloss, .gloss:is(.brief, .full) { font-weight: bold; }';

        const scoped = addScopeToCssLegacy(css, '.yomitan-glossary');

        expect(scoped).toContain('.yomitan-glossary .term { color: red; }');
        expect(scoped).toContain('.yomitan-glossary .gloss, .yomitan-glossary .gloss:is(.brief, .full)');
        expect(scoped).toContain('font-weight: bold;');
    });

    it('prefixes rules inside grouping at-rules without CSSStyleSheet', () => {
        const css = [
            '@media screen { .term { color: red; } }',
            '@supports (display: grid) { .grid { display: grid; } }',
        ].join('\n');

        const scoped = addScopeToCssLegacy(css, '.yomitan-glossary');

        expect(scoped).toContain('@media screen');
        expect(scoped).toContain('.yomitan-glossary .term { color: red; }');
        expect(scoped).toContain('@supports (display: grid)');
        expect(scoped).toContain('.yomitan-glossary .grid { display: grid; }');
    });

    it('preserves font-face and keyframes without selector prefixing', () => {
        const css = [
            '@font-face { font-family: Test; src: url("test.woff2"); }',
            '@keyframes fade { from { opacity: 0; } to { opacity: 1; } }',
            '.animated { animation: fade 1s; }',
        ].join('\n');

        const scoped = addScopeToCssLegacy(css, '.yomitan-glossary');

        expect(scoped).toContain('@font-face { font-family: Test; src: url("test.woff2"); }');
        expect(scoped).toContain('@keyframes fade { from { opacity: 0; } to { opacity: 1; } }');
        expect(scoped).toContain('.yomitan-glossary .animated { animation: fade 1s; }');
        expect(scoped).not.toContain('.yomitan-glossary from');
        expect(scoped).not.toContain('.yomitan-glossary to');
    });

    it('falls back to nested scoping when CSS parsing fails', () => {
        const css = '.term { color: red;';

        const scoped = addScopeToCssLegacy(css, '.yomitan-glossary');

        expect(scoped).toBe('.yomitan-glossary {.term { color: red;\n}');
    });
});
