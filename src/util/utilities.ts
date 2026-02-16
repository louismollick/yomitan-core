import type { DeferredPromiseDetails, RejectionReason, SerializableObject, UnknownObject } from '../types/core';

/**
 * Converts any string into a form that can be passed into the RegExp constructor.
 */
export function escapeRegExp(string: string): string {
    return string.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reverses a string.
 */
export function stringReverse(string: string): string {
    return [...string].reverse().join('');
}

/**
 * Creates a deep clone of an object or value.
 */
export function clone<T = unknown>(value: T): T {
    if (value === null) {
        return null as T;
    }
    switch (typeof value) {
        case 'boolean':
        case 'number':
        case 'string':
        case 'bigint':
        case 'symbol':
        case 'undefined':
            return value;
        default:
            return cloneInternal(value, new Set());
    }
}

function cloneInternal<T = unknown>(value: T, visited: Set<unknown>): T {
    if (value === null) {
        return null as T;
    }
    switch (typeof value) {
        case 'boolean':
        case 'number':
        case 'string':
        case 'bigint':
        case 'symbol':
        case 'undefined':
            return value;
        case 'object':
            return (
                Array.isArray(value)
                    ? cloneArray(value, visited)
                    : cloneObject(value as unknown as SerializableObject, visited)
            ) as T;
        default:
            throw new Error(`Cannot clone object of type ${typeof value}`);
    }
}

function cloneArray(value: unknown[], visited: Set<unknown>): unknown[] {
    if (visited.has(value)) {
        throw new Error('Circular');
    }
    try {
        visited.add(value);
        const result = [];
        for (const item of value) {
            result.push(cloneInternal(item, visited));
        }
        return result;
    } finally {
        visited.delete(value);
    }
}

function cloneObject(value: SerializableObject, visited: Set<unknown>): SerializableObject {
    if (visited.has(value)) {
        throw new Error('Circular');
    }
    try {
        visited.add(value);
        const result: SerializableObject = {};
        for (const key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                result[key] = cloneInternal(value[key], visited);
            }
        }
        return result;
    } finally {
        visited.delete(value);
    }
}

/**
 * Checks if an object or value is deeply equal to another object or value.
 */
export function deepEqual(value1: unknown, value2: unknown): boolean {
    if (value1 === value2) {
        return true;
    }
    const type = typeof value1;
    if (typeof value2 !== type) {
        return false;
    }
    switch (type) {
        case 'object':
        case 'function':
            return deepEqualInternal(value1, value2, new Set());
        default:
            return false;
    }
}

function deepEqualInternal(value1: unknown, value2: unknown, visited1: Set<unknown>): boolean {
    if (value1 === value2) {
        return true;
    }
    const type = typeof value1;
    if (typeof value2 !== type) {
        return false;
    }
    switch (type) {
        case 'object':
        case 'function': {
            if (value1 === null || value2 === null) {
                return false;
            }
            const array = Array.isArray(value1);
            if (array !== Array.isArray(value2)) {
                return false;
            }
            if (visited1.has(value1)) {
                return false;
            }
            visited1.add(value1);
            return array
                ? areArraysEqual(value1 as unknown[], value2 as unknown[], visited1)
                : areObjectsEqual(value1 as UnknownObject, value2 as UnknownObject, visited1);
        }
        default:
            return false;
    }
}

function areObjectsEqual(value1: UnknownObject, value2: UnknownObject, visited1: Set<unknown>): boolean {
    const keys1 = Object.keys(value1);
    const keys2 = Object.keys(value2);
    if (keys1.length !== keys2.length) {
        return false;
    }
    const keys1Set = new Set(keys1);
    for (const key of keys2) {
        if (!keys1Set.has(key) || !deepEqualInternal(value1[key], value2[key], visited1)) {
            return false;
        }
    }
    return true;
}

function areArraysEqual(value1: unknown[], value2: unknown[], visited1: Set<unknown>): boolean {
    const length = value1.length;
    if (length !== value2.length) {
        return false;
    }
    for (let i = 0; i < length; ++i) {
        if (!deepEqualInternal(value1[i], value2[i], visited1)) {
            return false;
        }
    }
    return true;
}

/**
 * Creates a new base-16 string of a sequence of random bytes.
 */
export function generateId(length: number): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    let id = '';
    for (const value of array) {
        id += value.toString(16).padStart(2, '0');
    }
    return id;
}

/**
 * Creates an unresolved promise that can be resolved later.
 */
export function deferPromise<T = unknown>(): DeferredPromiseDetails<T> {
    let resolve: ((value: T) => void) | undefined;
    let reject: ((reason?: RejectionReason) => void) | undefined;
    const promise = new Promise<T>((resolve2, reject2) => {
        resolve = resolve2;
        reject = reject2;
    });
    return {
        promise,
        resolve: resolve as (value: T) => void,
        reject: reject as (reason?: RejectionReason) => void,
    };
}

/**
 * Creates a promise that is resolved after a set delay.
 */
export function promiseTimeout(delay: number): Promise<void> {
    return delay <= 0
        ? Promise.resolve()
        : new Promise((resolve) => {
              setTimeout(resolve, delay);
          });
}

/**
 * Checks if a value is a non-null object that is not an array.
 */
export function isObjectNotArray(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
