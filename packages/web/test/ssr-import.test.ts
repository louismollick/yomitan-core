import { expect, test } from 'vitest';

test('the package imports where there is no DOM (SSR, Node)', async () => {
    expect(typeof globalThis.HTMLElement).toBe('undefined');
    const web = await import('../src/index');
    expect(typeof web.defineYomitanEntries).toBe('function');
    expect(typeof web.createIndexedDbStorage).toBe('function');
});
