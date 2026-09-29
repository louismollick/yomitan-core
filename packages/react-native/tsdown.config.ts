import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'neutral',
    target: 'es2020',
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['yomitan-core', '@op-engineering/op-sqlite'],
});
