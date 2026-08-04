/**
 * Custom error class for yomitan-core which can contain extra data.
 */
export class YomitanError extends Error {
    public data: unknown;

    constructor(message: string, data?: unknown) {
        super(message);
        this.name = 'YomitanError';
        this.data = data;
    }
}

/**
 * Utility function to convert an unknown value to an error.
 */
export function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(`${value}`);
}
