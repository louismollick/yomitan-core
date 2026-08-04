import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ loads: 0, create: vi.fn(() => ({ initialize: vi.fn() })) }));

vi.mock('yomitan-core', () => {
    state.loads += 1;
    return { createYomitan: state.create };
});

describe('@yomitan-core/react-native', () => {
    it('does not evaluate core until client creation', async () => {
        const reactNative = await import('../../react-native/src/index');

        expect(state.loads).toBe(0);

        const options = { storage: {} as never };
        await reactNative.createReactNativeYomitan(options);

        expect(state.loads).toBe(1);
        expect(state.create).toHaveBeenCalledWith(options);
    });
});
