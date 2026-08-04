import { describe, expect, it } from 'vitest';

describe('workspace source contracts', () => {
    it('exposes the compatibility symbols before packaging', async () => {
        const [web, webAnki, node, renderer] = await Promise.all([
            import('../../web/src/index'),
            import('../../web/src/anki'),
            import('../../node/src/index'),
            import('../../web-renderer/src/index'),
        ]);

        expect(web.default).toBeTypeOf('function');
        expect(webAnki.buildAnkiNoteFromDictionaryEntry).toBeTypeOf('function');
        expect(node.createNodeSqliteDictionaryDB).toBeTypeOf('function');
        expect(renderer.createTermEntryRenderer).toBeTypeOf('function');
    });
});
