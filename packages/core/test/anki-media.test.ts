/*
 * Audio source URL resolution (`audio.urls`) and the AnkiConnect `storeMediaFile` capability.
 * Storing media for notes end to end is covered by the render-anki contract.
 */

import { describe, expect, test, vi } from 'vitest';
import type { AnkiNote, AnkiTransport } from '../src/anki/anki';
import { createAnkiConnectTransport } from '../src/anki/anki';
import { storeNoteMedia } from '../src/anki/media';
import { createAudioUrlResolver } from '../src/audio/audio-urls';
import { createYomitan } from '../src/client/yomitan';
import { createMemoryStorage } from '../src/storage/memory-storage';

type AudioSources = { type: string; url?: string; voice?: string }[];

async function createClient(
    sources: AudioSources,
    { enableDefaultAudioSources = false, fetch }: { enableDefaultAudioSources?: boolean; fetch?: never } = {},
) {
    const client = await createYomitan({ storage: createMemoryStorage(), fetch });
    const profile = client.profile.get();
    profile.options.audio.sources = sources.map(({ type, url = '', voice = '' }) => ({ type, url, voice })) as never;
    profile.options.audio.enableDefaultAudioSources = enableDefaultAudioSources;
    await client.profile.set(profile);
    return client;
}

const JPOD101 = 'https://assets.languagepod101.com/dictionary/japanese/audiomp3.php';
const JPOD101_SKIP_HASH = '7e2c2f954ef6051373ba916f000168dc';

describe('audio.urls', () => {
    test('resolves JapanesePod101 to its direct URL, with the hash of its placeholder clip', async () => {
        const client = await createClient([{ type: 'jpod101' }]);
        const params = new URLSearchParams({ kanji: '猫', kana: 'ねこ' });
        expect(await client.audio.urls('猫', 'ねこ')).toEqual([
            { url: `${JPOD101}?${params}`, source: 'jpod101', skipHash: JPOD101_SKIP_HASH },
        ]);
        // A kana-only term is looked up by reading alone, as upstream does.
        const kana = await client.audio.urls('ねこ', 'ねこ');
        expect(kana.map(({ url }) => url)).toEqual([`${JPOD101}?${new URLSearchParams({ kana: 'ねこ' })}`]);
    });

    test('fills {term}, {reading} and {language} in a custom URL', async () => {
        const client = await createClient([
            { type: 'custom', url: 'https://audio.test/{language}/{term}/{reading}.ogg' },
        ]);
        expect(await client.audio.urls('猫', 'ねこ')).toEqual([
            { url: 'https://audio.test/ja/猫/ねこ.ogg', source: 'custom' },
        ]);
    });

    test('keeps the profile source order, drops duplicates and sources that fail, and adds default sources last', async () => {
        const failing = (async () => {
            throw new Error('offline');
        }) as never;
        const client = await createClient(
            [
                { type: 'custom', url: 'https://audio.test/{term}.mp3' },
                { type: 'jisho' },
                { type: 'jpod101' },
                { type: 'custom', url: 'https://audio.test/{term}.mp3' },
            ],
            { fetch: failing },
        );
        expect((await client.audio.urls('猫', 'ねこ')).map(({ source }) => source)).toEqual(['custom', 'jpod101']);

        const withDefaults = await createClient([{ type: 'custom', url: 'https://audio.test/{term}.mp3' }], {
            enableDefaultAudioSources: true,
            fetch: failing,
        });
        // Default sources: JapanesePod101 resolves without a request; Jisho and LanguagePod101 fail offline.
        expect((await withDefaults.audio.urls('猫', 'ねこ')).map(({ source }) => source)).toEqual([
            'custom',
            'jpod101',
        ]);
    });

    test('reads a custom-json list through the client fetch', async () => {
        const requested: string[] = [];
        const fetch = (async (url: string) => {
            requested.push(url);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    type: 'audioSourceList',
                    audioSources: [
                        { url: 'https://audio.test/a.mp3', name: 'Speaker A' },
                        { url: 'https://audio.test/b.mp3' },
                    ],
                }),
            };
        }) as never;
        const client = await createClient([{ type: 'custom-json', url: 'https://list.test/?q={term}' }], { fetch });
        expect(await client.audio.urls('猫', 'ねこ')).toEqual([
            { url: 'https://audio.test/a.mp3', source: 'custom-json', name: 'Speaker A' },
            { url: 'https://audio.test/b.mp3', source: 'custom-json' },
        ]);
        expect(requested).toEqual(['https://list.test/?q=猫']);
    });

    test('has no URLs for an empty term', async () => {
        const client = await createClient([{ type: 'jpod101' }]);
        expect(await client.audio.urls('', '')).toEqual([]);
    });
});

describe('AnkiConnect storeMediaFile', () => {
    function mockAnkiConnect(storeResult: unknown = 'stored.mp3') {
        const requests: { action: string; params: Record<string, unknown>; key?: string }[] = [];
        const fetch = (async (_url: string, init?: object) => {
            const body = JSON.parse((init as { body: string }).body);
            requests.push({ action: body.action, params: body.params, key: body.key });
            const result = body.action === 'version' ? 6 : storeResult;
            return { ok: true, status: 200, text: async () => JSON.stringify(result) };
        }) as never;
        return { requests, fetch };
    }

    test('sends base64 data', async () => {
        const { requests, fetch } = mockAnkiConnect('shot.webp');
        const anki = createAnkiConnectTransport({ fetch, apiKey: 'secret' });
        expect(await anki.storeMediaFile('shot.webp', { data: 'AQID' })).toBe('shot.webp');
        expect(requests.find(({ action }) => action === 'storeMediaFile')).toEqual({
            action: 'storeMediaFile',
            params: { filename: 'shot.webp', data: 'AQID' },
            key: 'secret',
        });
    });

    test('has Anki download a URL, passing skipHash', async () => {
        const { requests, fetch } = mockAnkiConnect();
        const anki = createAnkiConnectTransport({ fetch });
        await anki.storeMediaFile('a.mp3', { url: 'https://audio.test/a.mp3', skipHash: JPOD101_SKIP_HASH });
        await anki.storeMediaFile('b.mp3', { url: 'https://audio.test/b.mp3' });
        const stores = requests.filter(({ action }) => action === 'storeMediaFile').map(({ params }) => params);
        expect(stores).toEqual([
            { filename: 'a.mp3', url: 'https://audio.test/a.mp3', skipHash: JPOD101_SKIP_HASH },
            { filename: 'b.mp3', url: 'https://audio.test/b.mp3' },
        ]);
    });

    test('resolves to null when Anki skips the file', async () => {
        const { fetch } = mockAnkiConnect(null);
        const anki = createAnkiConnectTransport({ fetch });
        expect(await anki.storeMediaFile('a.mp3', { url: 'https://audio.test/a.mp3', skipHash: 'x' })).toBeNull();
    });
});

describe('audio source timeouts', () => {
    const stalled = (() => new Promise(() => {})) as never;
    const profile = async (sources: AudioSources) => (await createClient(sources)).profile.get().options;

    test('a stalled fetching source does not hold up a direct URL', async () => {
        const resolver = createAudioUrlResolver(stalled, 30);
        const options = await profile([
            { type: 'custom-json', url: 'https://list.test/?q={term}' },
            { type: 'jpod101' },
        ]);
        const urls = await resolver.all(options, '猫', 'ねこ');
        expect(urls.map(({ source }) => source)).toEqual(['jpod101']);
        // Resolving by source leaves the stalled one out of the way until it is asked for.
        const second = await resolver.source(options, '猫', 'ねこ', 1);
        expect(second.more).toBe(false);
        expect(second.urls.map(({ source }) => source)).toEqual(['jpod101']);
        const first = await resolver.source(options, '猫', 'ねこ', 0);
        expect(first).toEqual({ urls: [], more: true });
    });
});

describe('storing note media', () => {
    const entry = { type: 'term', headwords: [{ term: '猫', reading: 'ねこ', sources: [] }] } as never;

    function fakeTransport(failUrls: (url: string) => 'error' | 'skip' | 'ok') {
        const stored: { fileName: string; source: unknown }[] = [];
        const anki = {
            storeMediaFile: async (fileName: string, source: { data: string } | { url: string }) => {
                stored.push({ fileName, source });
                const outcome = 'url' in source ? failUrls(source.url) : 'ok';
                if (outcome === 'error') throw new Error(`download failed: ${'url' in source ? source.url : ''}`);
                return outcome === 'skip' ? null : fileName;
            },
        } as unknown as AnkiTransport;
        return { anki, stored };
    }

    const sourceList = (sources: { url: string; skipHash?: string }[][]) => {
        const calls: number[] = [];
        return {
            calls,
            client: {
                audio: {
                    sourceUrls: async (_term: string, _reading: string, index: number) => {
                        calls.push(index);
                        return {
                            urls: (sources[index] ?? []).map((item) => ({ ...item, source: 'custom' as const })),
                            more: index + 1 < sources.length,
                        };
                    },
                },
                dictionaries: { getMedia: async () => null },
            },
        };
    };

    test('names never collide for saves in the same millisecond', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
        const { anki, stored } = fakeTransport(() => 'ok');
        const { client } = sourceList([[{ url: 'https://audio.test/a.mp3' }]]);
        const media = { screenshot: { data: new Uint8Array([1]), mediaType: 'image/jpeg' } };
        const requirements = [{ type: 'audio' }, { type: 'screenshot' }] as never;
        await storeNoteMedia(anki, client, entry, requirements, media);
        await storeNoteMedia(anki, client, entry, requirements, media);
        vi.restoreAllMocks();
        const names = stored.map(({ fileName }) => fileName);
        expect(names).toHaveLength(4);
        expect(new Set(names).size).toBe(4);
        expect(names.filter((name) => name.startsWith('yomitan_audio_'))).toHaveLength(2);
        expect(names.filter((name) => name.startsWith('yomitan_browser_screenshot_'))).toHaveLength(2);
    });

    test('tries sources in order and only resolves the next one when needed', async () => {
        const { anki } = fakeTransport(() => 'ok');
        const ready = sourceList([[{ url: 'https://audio.test/a.mp3' }], [{ url: 'https://audio.test/b.mp3' }]]);
        const result = await storeNoteMedia(anki, ready.client, entry, [{ type: 'audio' }] as never);
        expect(result.stored?.audio).toBeDefined();
        expect(ready.calls).toEqual([0]);

        const { anki: second, stored } = fakeTransport((url) => (url.endsWith('a.mp3') ? 'skip' : 'ok'));
        const fallback = sourceList([[{ url: 'https://audio.test/a.mp3' }], [{ url: 'https://audio.test/b.mp3' }]]);
        await storeNoteMedia(second, fallback.client, entry, [{ type: 'audio' }] as never);
        expect(fallback.calls).toEqual([0, 1]);
        expect(stored).toHaveLength(2);
    });

    test('warns when every audio candidate fails, but not for placeholder clips or no sources', async () => {
        const failing = fakeTransport(() => 'error');
        const two = sourceList([[{ url: 'https://audio.test/a.mp3' }], [{ url: 'https://audio.test/b.mp3' }]]);
        const failed = await storeNoteMedia(failing.anki, two.client, entry, [{ type: 'audio' }] as never);
        expect(failed.stored).toBeNull();
        expect(failed.warnings).toEqual(['Could not store audio: download failed: https://audio.test/a.mp3']);

        const placeholder = fakeTransport(() => 'skip');
        const skipped = await storeNoteMedia(placeholder.anki, two.client, entry, [{ type: 'audio' }] as never);
        expect(skipped).toEqual({ stored: null, warnings: [] });

        const none = await storeNoteMedia(placeholder.anki, sourceList([]).client, entry, [{ type: 'audio' }] as never);
        expect(none).toEqual({ stored: null, warnings: [] });

        // An error before a success is not reported: the note got its audio.
        const mixed = fakeTransport((url) => (url.endsWith('a.mp3') ? 'error' : 'ok'));
        const recovered = await storeNoteMedia(mixed.anki, two.client, entry, [{ type: 'audio' }] as never);
        expect(recovered.stored?.audio).toBeDefined();
        expect(recovered.warnings).toEqual([]);
    });
});
