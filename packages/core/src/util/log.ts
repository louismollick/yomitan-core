export type LogLevel = 'log' | 'warn' | 'error';

export type LogContext = {
    url: string;
};

/**
 * Simplified console logger for yomitan-core (no EventDispatcher dependency).
 */
class Logger {
    private _name: string;

    constructor() {
        this._name = 'yomitan-core';
    }

    configure(name: string): void {
        this._name = name;
    }

    log(message: unknown, ...optionalParams: unknown[]): void {
        console.log(message, ...optionalParams);
    }

    warn(error: unknown): void {
        this.logGenericError(error, 'warn');
    }

    error(error: unknown): void {
        this.logGenericError(error, 'error');
    }

    logGenericError(error: unknown, level: LogLevel, context?: LogContext): void {
        if (typeof context === 'undefined') {
            context = { url: 'unknown' };
        }

        let errorString: string;
        try {
            if (typeof error === 'string') {
                errorString = error;
            } else {
                errorString = typeof error === 'object' && error !== null ? (error as object).toString() : `${error}`;
                if (/^\[object \w+\]$/.test(errorString)) {
                    errorString = JSON.stringify(error);
                }
            }
        } catch (_e) {
            errorString = `${error}`;
        }

        let errorStack = '';
        try {
            if (error instanceof Error && typeof error.stack === 'string') {
                errorStack = error.stack.trimEnd();
            }
        } catch (_e) {
            // NOP
        }

        if (errorStack.startsWith(errorString)) {
            errorString = errorStack;
        } else if (errorStack.length > 0) {
            errorString += `\n${errorStack}`;
        }

        let message = `${this._name} has encountered a problem.`;
        message += `\nOriginating URL: ${context.url}\n`;
        message += errorString;

        switch (level) {
            case 'log':
                console.log(message);
                break;
            case 'warn':
                console.warn(message);
                break;
            case 'error':
                console.error(message);
                break;
        }
    }
}

export const log = new Logger();
