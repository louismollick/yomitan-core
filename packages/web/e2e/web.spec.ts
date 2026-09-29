import { expect, test } from '@playwright/test';
import { createDictionaryArchive } from '../../contract-tests/src/fixtures';

const archive = async () => [...new Uint8Array(await createDictionaryArchive('valid-dictionary1'))];

test('imports and queries a dictionary in real IndexedDB', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__web !== undefined);
    const data = await archive();
    const result = await page.evaluate(async (array) => {
        await window.__web.open(`real-indexeddb-${Date.now()}`);
        const summary = await window.__web.import(array);
        return {
            title: summary.title,
            lookup: await window.__web.lookup('打ち込む'),
            media: await window.__web.media(),
            storage: await window.__web.storageSubset(),
        };
    }, data);
    expect(result.title).toBe('Test Dictionary');
    expect(result.lookup).toEqual({ count: expect.any(Number), term: '打ち込む' });
    expect(result.lookup.count).toBeGreaterThan(0);
    expect(result.media?.slice(0, 2)).toEqual([7, 7]);
    expect(result.storage.title).toBe('Test Dictionary');
    expect(result.storage.termCount).toBeGreaterThan(0);
    expect(result.storage.matchCount).toBeGreaterThan(0);
});

test('a second tab cannot import while the first tab owns the write lock', async ({ browser }) => {
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([first.goto('/'), second.goto('/')]);
    const data = await archive();
    await first.evaluate((array) => window.__web.startPausedImport(array), data);
    const error = await second.evaluate(async (array) => {
        await window.__web.open('two-tab');
        try {
            await window.__web.import(array);
            return null;
        } catch (caught) {
            return { name: (caught as Error).name, code: (caught as Error & { code?: string }).code };
        }
    }, data);
    expect(error).toEqual({ name: 'StorageBusyError', code: 'busy' });
    await first.evaluate(() => window.__web.releasePausedImport());
    await context.close();
});

test('entry element isolates styles, loads media, and handles Anki actions', async ({ page }) => {
    await page.goto('/');
    const data = await archive();
    const image = await page.evaluate(async (array) => {
        await window.__web.open(`element-${Date.now()}`);
        await window.__web.import(array);
        return await window.__web.render('画像');
    }, data);
    expect(image.entryCount).toBeGreaterThan(0);
    expect(image.image).toMatch(/^blob:/);
    expect(image.theme).toBe('dark');
    expect(image.color).not.toBe('rgb(255, 0, 0)');

    const revoked = await page.evaluate(() => window.__web.rerender('打ち込む'));
    expect(revoked).toContain(image.image);

    const events = await page.evaluate(async () => {
        const element = document.querySelector('yomitan-entries') as HTMLElement;
        const seen: string[] = [];
        for (const type of ['kanji-click', 'link-click', 'note-added']) {
            element.addEventListener(type, () => seen.push(type));
        }
        element.shadowRoot?.querySelector<HTMLElement>('.headword-kanji-link')?.click();
        const link = document.createElement('a');
        link.href = 'yomitan://lookup/search.html?query=test';
        element.shadowRoot?.append(link);
        link.click();
        element.shadowRoot?.querySelector<HTMLElement>('.action-button[data-action="save-note"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { seen, view: element.shadowRoot?.querySelector('.action-button[data-action="view-note"]') !== null };
    });
    expect(events.seen).toEqual(expect.arrayContaining(['kanji-click', 'link-click', 'note-added']));
    expect(events.view).toBe(true);
});
