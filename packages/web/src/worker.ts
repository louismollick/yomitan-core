/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    DictionaryImportError,
    DuplicateNoteError,
    type Profile,
    SessionLostError,
    StorageBusyError,
    type Yomitan,
    YomitanAbortError,
    getDisplayAttributes,
    sentenceAt,
} from 'yomitan-core';

export interface MessageEndpoint {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    start?(): void;
}

type WireError = { name: string; message: string; code?: string; details?: unknown };
type Request =
    | { type: 'call'; id: number; path: string; args: unknown[] }
    | { type: 'cancel' | 'progress-ack'; id: number };
type Response =
    | { type: 'progress'; id: number; value: unknown }
    | { type: 'result'; id: number; value: unknown; profile?: Profile }
    | { type: 'error'; id: number; error: WireError };

const METHODS = new Set([
    'profile.get',
    'profile.set',
    'profile.defaults',
    'profile.migrate',
    'profile.importYomitanSettings',
    'profile.syncDictionaries',
    'dictionaries.list',
    'dictionaries.import',
    'dictionaries.delete',
    'dictionaries.checkUpdates',
    'dictionaries.update',
    'dictionaries.recommended',
    'dictionaries.getMedia',
    'lookup.terms',
    'lookup.kanji',
    'lookup.scan',
    'lookup.parse',
    'lookup.sentence',
    'render.html',
    'render.document',
    'render.css',
    'render.attributes',
    'anki.markers',
    'anki.defaultTemplates',
    'anki.buildNote',
    'dispose',
]);
const PROFILE_WRITES = new Set([
    'profile.set',
    'profile.importYomitanSettings',
    'profile.syncDictionaries',
    'dictionaries.import',
    'dictionaries.delete',
    'dictionaries.update',
]);

function serializeError(error: unknown): WireError {
    const value = error instanceof Error ? error : new Error(String(error));
    const coded = value as Error & { code?: string; errors?: Error[]; details?: unknown };
    return {
        name: value.name,
        message: value.message,
        ...(coded.code === undefined ? {} : { code: coded.code }),
        ...(coded.errors === undefined && coded.details === undefined
            ? {}
            : { details: coded.errors?.map(({ name, message }) => ({ name, message })) ?? coded.details }),
    };
}

function rebuildError(wire: WireError): Error {
    let error: Error;
    switch (wire.code ?? wire.name) {
        case 'import-failed':
        case 'DictionaryImportError':
            error = new DictionaryImportError(
                Array.isArray(wire.details)
                    ? wire.details.map((detail: { message: string }) => new Error(detail.message))
                    : [new Error(wire.message)],
            );
            break;
        case 'busy':
        case 'StorageBusyError':
            error = new StorageBusyError(wire.message);
            break;
        case 'session-lost':
        case 'SessionLostError':
            error = new SessionLostError(wire.message);
            break;
        case 'aborted':
        case 'AbortError':
            error = new YomitanAbortError(wire.message);
            break;
        case 'DuplicateNoteError':
            error = new DuplicateNoteError(wire.message);
            break;
        default:
            error = new Error(wire.message);
            error.name = wire.name;
    }
    if (wire.details !== undefined && !(error instanceof DictionaryImportError)) {
        Object.assign(error, { details: wire.details });
    }
    return error;
}

function transferables(value: unknown): Transferable[] {
    if (value instanceof ArrayBuffer) return [value];
    if (value instanceof Uint8Array) return [value.buffer as ArrayBuffer];
    if (value !== null && typeof value === 'object' && 'content' in value) {
        return transferables((value as { content: unknown }).content);
    }
    return [];
}

/** Serve one client over a Worker or MessagePort. Returns a listener cleanup function. */
export function exposeYomitan(endpoint: MessageEndpoint, yomitan: Yomitan): () => void {
    const active = new Map<number, AbortController>();
    const progressAcks = new Map<number, { count: number; resolve?: () => void }>();
    const listener = (event: MessageEvent) => {
        const message = event.data as Request;
        if (message.type === 'progress-ack') {
            const ack = progressAcks.get(message.id);
            if (ack) {
                ack.count = Math.max(0, ack.count - 1);
                if (ack.count === 0) ack.resolve?.();
            }
            return;
        }
        if (message.type === 'cancel') {
            active.get(message.id)?.abort();
            const ack = progressAcks.get(message.id);
            if (ack) {
                ack.count = 0;
                ack.resolve?.();
            }
            return;
        }
        if (message.type !== 'call') return;
        void (async () => {
            const { id, path } = message;
            const controller = new AbortController();
            active.set(id, controller);
            const ack = { count: 0, resolve: undefined as (() => void) | undefined };
            progressAcks.set(id, ack);
            const progress = (value: unknown) => {
                if (controller.signal.aborted) return;
                ++ack.count;
                endpoint.postMessage({ type: 'progress', id, value } satisfies Response);
            };
            try {
                if (!METHODS.has(path)) throw new Error(`Unknown Yomitan method: ${path}`);
                const [group, method] = path.split('.');
                const owner =
                    group === 'dispose'
                        ? (yomitan as unknown as Record<string, (...args: unknown[]) => unknown>)
                        : (yomitan as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>)[
                              group
                          ];
                const args = [...message.args];
                if (path === 'dictionaries.import' || path === 'dictionaries.update') {
                    const index = path === 'dictionaries.import' ? 0 : 1;
                    args[index] = {
                        ...(args[index] as object | undefined),
                        signal: controller.signal,
                        onProgress: progress,
                    };
                } else if (path === 'dictionaries.delete') {
                    args[1] = progress;
                }
                const value = await owner[method ?? 'dispose'](...args);
                if (ack.count > 0)
                    await new Promise<void>((resolve) => {
                        ack.resolve = resolve;
                    });
                if (controller.signal.aborted && path === 'dictionaries.import') {
                    await yomitan.dictionaries.delete((value as { title: string }).title);
                }
                if (controller.signal.aborted) throw new YomitanAbortError();
                const profile = PROFILE_WRITES.has(path) ? yomitan.profile.get() : undefined;
                endpoint.postMessage({ type: 'result', id, value, profile } satisfies Response, transferables(value));
            } catch (error) {
                endpoint.postMessage({ type: 'error', id, error: serializeError(error) } satisfies Response);
            } finally {
                active.delete(id);
                progressAcks.delete(id);
            }
        })();
    };
    endpoint.addEventListener('message', listener);
    endpoint.start?.();
    return () => {
        endpoint.removeEventListener('message', listener);
        for (const controller of active.values()) controller.abort();
    };
}

/** Connect to a hosted Yomitan. Profile reads stay synchronous through a local cache. */
export async function connectYomitan(endpoint: MessageEndpoint): Promise<Yomitan> {
    let sequence = 0;
    let disposed = false;
    let profile!: Profile;
    const pending = new Map<
        number,
        {
            resolve: (value: never) => void;
            reject: (error: Error) => void;
            progress?: (value: never) => void;
            signal?: AbortSignal;
            onAbort?: () => void;
        }
    >();
    const listener = (event: MessageEvent) => {
        const message = event.data as Response;
        const call = pending.get(message.id);
        if (call === undefined) return;
        if (message.type === 'progress') {
            try {
                call.progress?.(message.value as never);
            } catch {
                /* User progress cannot break a call. */
            }
            endpoint.postMessage({ type: 'progress-ack', id: message.id } satisfies Request);
            return;
        }
        pending.delete(message.id);
        if (call.signal && call.onAbort) call.signal.removeEventListener('abort', call.onAbort);
        if (message.type === 'error') call.reject(rebuildError(message.error));
        else {
            if (message.profile !== undefined) profile = message.profile;
            call.resolve(message.value as never);
        }
    };
    endpoint.addEventListener('message', listener);
    endpoint.start?.();

    const call = <T>(
        path: string,
        args: unknown[] = [],
        signal?: AbortSignal,
        progress?: (value: never) => void,
    ): Promise<T> => {
        if (disposed) return Promise.reject(new Error('This yomitan-core client has been disposed'));
        if (signal?.aborted) return Promise.reject(new YomitanAbortError());
        const id = ++sequence;
        return new Promise<T>((resolve, reject) => {
            const onAbort = () => endpoint.postMessage({ type: 'cancel', id } satisfies Request);
            pending.set(id, { resolve: resolve as (value: never) => void, reject, progress, signal, onAbort });
            signal?.addEventListener('abort', onAbort, { once: true });
            const transfer =
                path === 'dictionaries.import' ? transferables((args[0] as { source: unknown }).source) : [];
            endpoint.postMessage({ type: 'call', id, path, args } satisfies Request, transfer);
        });
    };
    profile = await call<Profile>('profile.get');
    const remote =
        (path: string) =>
        (...args: unknown[]) =>
            call(path, args);
    const client = {
        profile: {
            get: () => structuredClone(profile),
            set: remote('profile.set'),
            defaults: remote('profile.defaults'),
            migrate: remote('profile.migrate'),
            importYomitanSettings: remote('profile.importYomitanSettings'),
            syncDictionaries: remote('profile.syncDictionaries'),
        },
        dictionaries: {
            list: remote('dictionaries.list'),
            import: ({
                source,
                signal,
                onProgress,
            }: { source: unknown; signal?: AbortSignal; onProgress?: (value: never) => void }) =>
                call('dictionaries.import', [{ source }], signal, onProgress),
            delete: (title: string, options: { onProgress?: (value: never) => void } = {}) =>
                call('dictionaries.delete', [title], undefined, options.onProgress),
            checkUpdates: remote('dictionaries.checkUpdates'),
            update: (title: string, options: { signal?: AbortSignal; onProgress?: (value: never) => void } = {}) =>
                call('dictionaries.update', [title], options.signal, options.onProgress),
            recommended: remote('dictionaries.recommended'),
            getMedia: remote('dictionaries.getMedia'),
        },
        lookup: {
            terms: remote('lookup.terms'),
            kanji: remote('lookup.kanji'),
            scan: remote('lookup.scan'),
            parse: remote('lookup.parse'),
            sentence: (text: string, offset: number, length = 0) => sentenceAt(text, offset, length, profile.options),
        },
        render: {
            html: remote('render.html'),
            document: remote('render.document'),
            css: remote('render.css'),
            attributes: (theme?: Parameters<Yomitan['render']['attributes']>[0]) =>
                getDisplayAttributes(profile.options, theme),
        },
        anki: {
            markers: remote('anki.markers'),
            defaultTemplates: remote('anki.defaultTemplates'),
            buildNote: remote('anki.buildNote'),
        },
        async dispose() {
            if (disposed) return;
            disposed = true;
            endpoint.removeEventListener('message', listener);
            for (const [id, entry] of pending) {
                endpoint.postMessage({ type: 'cancel', id } satisfies Request);
                entry.reject(new Error('This yomitan-core client has been disposed'));
            }
            pending.clear();
            const id = ++sequence;
            endpoint.postMessage({ type: 'call', id, path: 'dispose', args: [] } satisfies Request);
        },
    };
    return client as unknown as Yomitan;
}
