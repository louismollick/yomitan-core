/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Structural stand-ins for web platform types, so published declarations compile in Node and
 * React Native projects without the DOM lib. Real `Blob` and `AbortSignal` objects satisfy them.
 */

export type BlobLike = { readonly size: number; arrayBuffer(): Promise<ArrayBuffer> };

export type AbortSignalLike = { readonly aborted: boolean };

export function isBlobLike(value: unknown): value is BlobLike {
    return (
        typeof value === 'object' &&
        value !== null &&
        !(value instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(value) &&
        typeof (value as BlobLike).arrayBuffer === 'function'
    );
}
