export type TypeofResult = 'string' | 'number' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SafeAny = any;

export type RejectionReason = SafeAny;

export type SerializableObject = { [key: string]: unknown };

export type UnknownObject = { [key: string | symbol]: unknown };

export type TokenString = string;

export type TokenObject = Record<string, never>;

export type DeferredPromiseDetails<T = unknown> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: RejectionReason) => void;
};

export type EventSurface = { [name: string]: unknown };

export type EventNames<TSurface extends EventSurface> = keyof TSurface & string;

export type EventArgument<TSurface extends EventSurface, TName extends EventNames<TSurface>> = TSurface[TName];

export type EventHandler<TSurface extends EventSurface, TName extends EventNames<TSurface>> = (
    details: EventArgument<TSurface, TName>,
) => void;

export type EventHandlerAny = (details: SafeAny) => void;

export type EventDispatcherOffGeneric = {
    off(eventName: string, callback: (...args: SafeAny) => void): boolean;
};

export type Timeout = number | ReturnType<typeof setTimeout>;
