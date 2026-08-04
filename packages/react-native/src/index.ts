import type { CreateYomitanOptions, YomitanClient } from 'yomitan-core';

export type * from 'yomitan-core';

export async function createReactNativeYomitan(options: CreateYomitanOptions): Promise<YomitanClient> {
    const { createYomitan } = await import('yomitan-core');
    return createYomitan(options);
}
