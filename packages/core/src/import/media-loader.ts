export interface MediaLoader {
    getImageDetails(
        content: ArrayBuffer,
        mediaType: string,
    ): Promise<{
        content: ArrayBuffer;
        width: number;
        height: number;
    }>;
}

export class NoOpMediaLoader implements MediaLoader {
    async getImageDetails(
        content: ArrayBuffer,
        _mediaType: string,
    ): Promise<{
        content: ArrayBuffer;
        width: number;
        height: number;
    }> {
        return { content, width: 0, height: 0 };
    }
}
