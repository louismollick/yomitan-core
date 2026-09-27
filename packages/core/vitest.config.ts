import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts', 'src/upstream/test/**/*.test.js'],
        testTimeout: 30000,
    },
});
