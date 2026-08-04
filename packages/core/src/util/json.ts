/**
 * Safe JSON.parse wrapper that returns unknown instead of any.
 */
export function parseJson<T = unknown>(value: string): T {
    return JSON.parse(value) as T;
}

/**
 * Safe Response.json wrapper.
 */
export async function readResponseJson<T = unknown>(response: Response): Promise<T> {
    return (await response.json()) as T;
}
