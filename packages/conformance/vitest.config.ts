import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
    root: workspaceRoot,
    test: {
        include: ['packages/conformance/test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: [
                'packages/web/src/**/*.ts',
                'packages/node/src/**/*.ts',
                'packages/react-native/src/**/*.ts',
                'packages/web-renderer/src/**/*.ts',
            ],
        },
    },
});
