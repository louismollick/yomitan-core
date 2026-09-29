import { defineConfig } from 'vite';

export default defineConfig({
    root: 'packages/web/e2e',
    server: { host: '127.0.0.1', port: 4173, strictPort: true },
});
