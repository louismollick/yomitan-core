import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['yomitan-core', 'better-sqlite3'],
});
