/*
 * Audio source URL resolution (`audio.urls`) and the AnkiConnect `storeMediaFile` capability.
 * Storing media for notes end to end is covered by the render-anki contract.
 */

import { describe, expect, test } from 'vitest';
import { createAnkiConnectTransport } from '../src/anki/anki';
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
