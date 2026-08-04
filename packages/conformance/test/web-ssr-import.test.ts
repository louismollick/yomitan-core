import { describe, expect, it } from 'vitest';

describe('@yomitan-core/web renderer import', () => {
    it('loads without browser globals', async () => {
        expect(globalThis).not.toHaveProperty('document');
        expect(globalThis).not.toHaveProperty('window');

        const renderer = await import('../../web/src/render');

        expect(renderer.createTermEntryRenderer).toBeTypeOf('function');
    });
});
