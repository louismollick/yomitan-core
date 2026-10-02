/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ImageInfoReader } from 'yomitan-core';

/** Decode media in the browser, matching the dimensions reported by Yomitan's Image loader. */
export function createBrowserImageInfoReader(): ImageInfoReader {
    return {
        async getImageDetails(content, mediaType) {
            const blob = new Blob([content], { type: mediaType });
            if (typeof Image === 'undefined') {
                const bitmap = await createImageBitmap(blob);
                const { width, height } = bitmap;
                bitmap.close();
                return { content, width, height };
            }
            const url = URL.createObjectURL(blob);
            try {
                const image = new Image();
                const loaded = new Promise<void>((resolve, reject) => {
                    image.onload = () => resolve();
                    image.onerror = () => reject(new Error('Image failed to load'));
                });
                image.src = url;
                await loaded;
                return { content, width: image.naturalWidth, height: image.naturalHeight };
            } finally {
                URL.revokeObjectURL(url);
            }
        },
    };
}
