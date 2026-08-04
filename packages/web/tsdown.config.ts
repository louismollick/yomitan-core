import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: { index: 'src/index.ts', render: 'src/render.ts', anki: 'src/anki.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    fixedExtension: false,
    clean: true,
    sourcemap: true,
    outputOptions: { exports: 'named' },
});
