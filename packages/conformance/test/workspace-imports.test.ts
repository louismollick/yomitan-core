import { describe, expect, it } from 'vitest';

describe('workspace package imports', () => {
    it('loads every platform entry point', async () => {
        const [core, web, node, reactNative, renderer] = await Promise.all([
            import('yomitan-core'),
            import('@yomitan-core/web'),
            import('@yomitan-core/node'),
            import('@yomitan-core/react-native'),
            import('@yomitan-core/web-renderer'),
        ]);

        expect(core.createYomitan).toBeTypeOf('function');
        expect(web.default).toBeTypeOf('function');
        expect(node.createNodeSqliteDictionaryDB).toBeTypeOf('function');
        expect(reactNative.createReactNativeYomitan).toBeTypeOf('function');
        expect(renderer.createTermEntryRenderer).toBeTypeOf('function');
    });
});
