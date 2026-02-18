const DEBUG_GLOBAL_FLAG = '__YOMITAN_CORE_DEBUG__';
const DEBUG_STORAGE_KEY = 'yomitan-core:debug';
const DEBUG_QUERY_PARAM = 'debugYomitanCore';

function getGlobalDebugFlagValue(): unknown {
    try {
        return (globalThis as Record<string, unknown>)[DEBUG_GLOBAL_FLAG];
    } catch (_e) {
        return undefined;
    }
}

function isTruthyFlag(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
}

export function isYomitanCoreDebugEnabled(): boolean {
    const globalFlag = getGlobalDebugFlagValue();
    if (isTruthyFlag(globalFlag)) return true;

    if (typeof window === 'undefined') return false;

    const queryValue = new URLSearchParams(window.location.search).get(DEBUG_QUERY_PARAM);
    if (isTruthyFlag(queryValue)) {
        return true;
    }

    try {
        const storageValue = window.localStorage.getItem(DEBUG_STORAGE_KEY);
        return isTruthyFlag(storageValue);
    } catch (_e) {
        return false;
    }
}

export function debugYomitanCore(scope: string, message: string, details?: Record<string, unknown>): void {
    if (!isYomitanCoreDebugEnabled()) return;
    console.info(`[YomitanCoreDebug][${scope}] ${message}`, details ?? {});
}

export function codePointPreview(text: string, limit = 48): string[] {
    return Array.from(text.slice(0, limit)).map((char) =>
        `U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`,
    );
}

