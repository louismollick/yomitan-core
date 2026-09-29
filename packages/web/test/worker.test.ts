import 'fake-indexeddb/auto';
import { MessageChannel } from 'node:worker_threads';
import { describe, expect, test } from 'vitest';
import {
    type CreateYomitanOptions,
    DictionaryImportError,
    StorageBusyError,
    YomitanAbortError,
    createYomitan,
} from 'yomitan-core';
import { createDictionaryArchive, runClientContract, runRenderAnkiContract } from '../../contract-tests/src/index';
import { createIndexedDbStorage } from '../src/indexeddb-storage';
import { createMemoryLockManager } from '../src/web-lock-sessions';
import { type MessageEndpoint, connectYomitan, exposeYomitan } from '../src/worker';

const locks = createMemoryLockManager();
let sequence = 0;
const createStorage = () => createIndexedDbStorage({ name: `worker-contract-${++sequence}`, locks });

async function makeWorkerClient(options: CreateYomitanOptions) {
    const channel = new MessageChannel();
    const host = await createYomitan(options);
    exposeYomitan(channel.port1 as unknown as MessageEndpoint, host);
    return await connectYomitan(channel.port2 as unknown as MessageEndpoint);
}

runClientContract('MessageChannel', createStorage, makeWorkerClient);
runRenderAnkiContract('MessageChannel', createStorage, makeWorkerClient);

describe('worker protocol', () => {
    test('rebuilds typed import and busy errors', async () => {
        const client = await makeWorkerClient({ storage: createStorage() });
        const archive = await createDictionaryArchive('valid-dictionary1');
        await client.dictionaries.import({ source: archive });
        await expect(
            client.dictionaries.import({ source: await createDictionaryArchive('valid-dictionary1') }),
        ).rejects.toBeInstanceOf(DictionaryImportError);
        await client.dispose();

        const name = `worker-busy-${++sequence}`;
        const shared = createIndexedDbStorage({ name, locks });
        await shared.prepare();
        const session = await shared.sessions.begin('import', 'held');
        const busy = await makeWorkerClient({ storage: createIndexedDbStorage({ name, locks }) });
        await expect(
            busy.dictionaries.import({ source: await createDictionaryArchive('valid-dictionary1') }),
        ).rejects.toBeInstanceOf(StorageBusyError);
        await busy.dispose();
        await session.end();
        await shared.close();
    });

    test('tearing down the host mid-import releases the write lock', async () => {
        const storage = createStorage();
        const host = await createYomitan({ storage });
        const channel = new MessageChannel();
        const stop = exposeYomitan(channel.port1 as unknown as MessageEndpoint, host);
        // A caller that receives progress but never acknowledges it, then goes away.
        const port = channel.port2 as unknown as MessageEndpoint;
        const progressed = new Promise<void>((resolve) => {
            port.addEventListener('message', ((event: MessageEvent) => {
                if (event.data.type === 'progress') resolve();
            }) as EventListener);
        });
        port.start?.();
        const source = await createDictionaryArchive('valid-dictionary1');
        port.postMessage({ type: 'call', id: 1, path: 'dictionaries.import', args: [{ source }] });
        await progressed;
        stop();
        await expect.poll(async () => (await storage.sessions.listLiveTitles()).size, { timeout: 10_000 }).toBe(0);
        await host.dispose();
        channel.port1.close();
    });

    test('cancels an import after progress and preserves the empty dictionary list', async () => {
        const client = await makeWorkerClient({ storage: createStorage() });
        const abort = new AbortController();
        await expect(
            client.dictionaries.import({
                source: await createDictionaryArchive('valid-dictionary1'),
                signal: abort.signal,
                onProgress: () => abort.abort(),
            }),
        ).rejects.toBeInstanceOf(YomitanAbortError);
        expect(await client.dictionaries.list()).toEqual([]);
        await client.dispose();
    });

    test('transfers archive bytes and rejects a call when disposed', async () => {
        const client = await makeWorkerClient({ storage: createStorage() });
        const source = await createDictionaryArchive('valid-dictionary1');
        const importing = client.dictionaries.import({ source });
        expect(source.byteLength).toBe(0);
        await client.dispose();
        await expect(importing).rejects.toThrow('disposed');
    });
});
