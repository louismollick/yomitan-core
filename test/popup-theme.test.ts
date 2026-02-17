import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { applyPopupTheme, resolvePopupTheme } from '../src/render';

describe('popup theme resolution', () => {
    it('resolves light theme', () => {
        const result = resolvePopupTheme({ theme: 'light', browserTheme: 'dark' });
        expect(result.theme).toBe('light');
        expect(result.themeRaw).toBe('light');
    });

    it('resolves dark theme', () => {
        const result = resolvePopupTheme({ theme: 'dark', browserTheme: 'light' });
        expect(result.theme).toBe('dark');
        expect(result.themeRaw).toBe('dark');
    });

    it('resolves browser theme from provided browser value', () => {
        const result = resolvePopupTheme({ theme: 'browser', browserTheme: 'dark' });
        expect(result.theme).toBe('dark');
        expect(result.browserTheme).toBe('dark');
        expect(result.themeRaw).toBe('browser');
    });

    it('resolves site theme from document background colors', () => {
        const { window } = new JSDOM(
            '<!doctype html><html style="background-color: rgb(0, 0, 0)"><body style="background-color: rgba(0, 0, 0, 0.9)"></body></html>',
        );
        const result = resolvePopupTheme({ theme: 'site', document: window.document, browserTheme: 'light' });
        expect(result.siteTheme).toBe('dark');
        expect(result.theme).toBe('dark');
    });

    it('resolves site theme to browser theme when siteOverride is true', () => {
        const result = resolvePopupTheme({
            theme: 'site',
            siteTheme: 'dark',
            browserTheme: 'light',
            siteOverride: true,
        });
        expect(result.theme).toBe('light');
        expect(result.siteTheme).toBe('dark');
        expect(result.browserTheme).toBe('light');
    });

    it('falls back to light for SSR-like usage without DOM', () => {
        const result = resolvePopupTheme({ theme: 'site' });
        expect(result.theme).toBe('light');
        expect(result.siteTheme).toBe('light');
        expect(result.browserTheme).toBe('light');
    });
});

describe('applyPopupTheme', () => {
    it('writes resolved popup theme attributes to document dataset', () => {
        const { window } = new JSDOM('<!doctype html><html><body></body></html>');
        applyPopupTheme(window.document.documentElement, {
            theme: 'browser',
            browserTheme: 'dark',
        });

        const data = window.document.documentElement.dataset;
        expect(data.theme).toBe('dark');
        expect(data.themeRaw).toBe('browser');
        expect(data.siteTheme).toBeDefined();
        expect(data.browserTheme).toBe('dark');
    });
});
