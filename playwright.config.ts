import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './packages/web/e2e',
    timeout: 60_000,
    workers: 2,
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
    use: { baseURL: 'http://127.0.0.1:4173' },
    webServer: {
        command: 'npx vite --config packages/web/e2e/vite.config.ts',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
});
