import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        database: 'src/database/index.ts',
        import: 'src/import/index.ts',
        lookup: 'src/lookup/index.ts',
        language: 'src/language/index.ts',
        anki: 'src/anki/index.ts',
        render: 'src/render/index.ts',
        audio: 'src/audio/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: { transformer: 'typescript' },
    clean: true,
    treeshake: true,
    splitting: true,
    sourcemap: true,
    external: ['linkedom', '@resvg/resvg-wasm', 'hangul-js', 'kanji-processor'],
});
