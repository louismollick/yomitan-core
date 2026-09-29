import { type AnkiTransport, type Yomitan, createDisplayController, createYomitan } from 'yomitan-core';
import type { YomitanEntriesElement } from '../src/entries-element';
import { createBrowserImageInfoReader, createIndexedDbStorage, defineYomitanEntries } from '../src/index';
import type { IndexedDbDictionaryStorage } from '../src/indexeddb-storage';

let client: Yomitan;
let storage: IndexedDbDictionaryStorage;
let releaseImport: (() => void) | undefined;
let importReady: (() => void) | undefined;
let importWaiting: Promise<void>;
let importGate: Promise<void>;
const revoked: string[] = [];
const originalRevoke = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = (url) => {
    revoked.push(url);
    originalRevoke(url);
};

function bytes(array: number[]): ArrayBuffer {
    return new Uint8Array(array).buffer;
}

const web = {
    async open(name: string) {
        storage = createIndexedDbStorage({ name });
        client = await createYomitan({
            storage,
            imageInfoReader: createBrowserImageInfoReader(),
        });
    },
    async import(array: number[]) {
        return await client.dictionaries.import({ source: bytes(array) });
    },
    async lookup(text: string) {
        const result = await client.lookup.terms(text);
        return { count: result.entries.length, term: result.entries[0]?.headwords[0]?.term };
    },
    async media() {
        const media = await client.dictionaries.getMedia('Test Dictionary', 'image.gif');
        return media === null ? null : [media.width, media.height, media.content.length];
    },
    async storageSubset() {
        const info = await storage.getDictionaryInfo();
        const counts = await storage.getDictionaryCounts(['Test Dictionary'], true);
        const terms = await storage.findTermsBulk(
            ['打ち込む'],
            new Map([['Test Dictionary', { alias: 'Test Dictionary', allowSecondarySearches: false }]]),
            'exact',
        );
        return { title: info[0]?.title, termCount: counts.total?.terms ?? 0, matchCount: terms.length };
    },
    async startPausedImport(array: number[]) {
        importWaiting = new Promise((resolve) => {
            importReady = resolve;
        });
        importGate = new Promise((resolve) => {
            releaseImport = resolve;
        });
        client = await createYomitan({
            storage: createIndexedDbStorage({ name: 'two-tab' }),
            imageInfoReader: {
                async getImageDetails(content, mediaType) {
                    importReady?.();
                    await importGate;
                    return await createBrowserImageInfoReader().getImageDetails(content, mediaType);
                },
            },
        });
        void client.dictionaries.import({ source: bytes(array) });
        await importWaiting;
    },
    releasePausedImport() {
        releaseImport?.();
    },
    async render(text: string) {
        defineYomitanEntries();
        const element = document.createElement('yomitan-entries') as YomitanEntriesElement;
        element.client = client;
        element.themeContext = { browserTheme: 'dark' };
        const profile = client.profile.get();
        profile.options.general.popupTheme = 'browser';
        profile.options.anki.cardFormats[0] = {
            ...profile.options.anki.cardFormats[0],
            deck: 'Mining',
            model: 'Basic',
            fields: { Front: { value: '{expression}', overwriteMode: 'coalesce' } },
        } as never;
        await client.profile.set(profile);
        const notes = new Map<number, unknown>();
        const transport: AnkiTransport = {
            async addNote(note) {
                notes.set(1, note);
                return 1;
            },
            async updateNoteFields(note) {
                notes.set(note.id, note);
            },
            async canAddNotes(list) {
                return list.map(() => notes.size === 0);
            },
            async canAddNotesWithErrorDetail(list) {
                return list.map(() =>
                    notes.size === 0
                        ? { canAdd: true, error: null }
                        : { canAdd: false, error: 'cannot create note because it is a duplicate' },
                );
            },
            async findNoteIds(list) {
                return list.map(() => [...notes.keys()]);
            },
            async notesInfo(ids) {
                return ids.map(() => null);
            },
            async guiBrowseNotes() {},
        };
        element.controller = createDisplayController(client, { anki: transport });
        document.body.appendChild(element);
        element.entries = (await client.lookup.terms(text)).entries;
        await element.render();
        return {
            entryCount: element.shadowRoot?.querySelectorAll('.entry').length,
            image: element.shadowRoot?.querySelector('img[src^="blob:"]')?.getAttribute('src') ?? null,
            theme: element.getAttribute('data-theme'),
            color: getComputedStyle(element.shadowRoot?.querySelector('.entry') as Element).color,
        };
    },
    async rerender(text: string) {
        const element = document.querySelector('yomitan-entries') as YomitanEntriesElement;
        element.entries = (await client.lookup.terms(text)).entries;
        await element.render();
        return revoked;
    },
};

declare global {
    interface Window {
        __web: typeof web;
    }
}
window.__web = web;
