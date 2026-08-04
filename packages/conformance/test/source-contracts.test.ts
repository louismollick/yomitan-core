import { readFile } from 'node:fs/promises';

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

    it('allows compatible core minor releases in private facades', async () => {
        const manifests = await Promise.all(
            ['web', 'node', 'react-native', 'web-renderer'].map(async (workspace) =>
                JSON.parse(await readFile(new URL(`../../${workspace}/package.json`, import.meta.url), 'utf8')),
            ),
        );

        for (const manifest of manifests) {
            expect(manifest.dependencies['yomitan-core']).toBe('^2.0.0');
        }
    });
});
