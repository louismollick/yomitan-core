import type { EventArgument, EventHandler, EventHandlerAny, EventNames, EventSurface } from '../types/core';

/**
 * Base class that controls basic event dispatching.
 */
export class EventDispatcher<TSurface extends EventSurface> {
    private _eventMap: Map<EventNames<TSurface>, EventHandlerAny[]>;

    constructor() {
        this._eventMap = new Map();
    }

    trigger<TName extends EventNames<TSurface>>(eventName: TName, details: EventArgument<TSurface, TName>): boolean {
        const callbacks = this._eventMap.get(eventName);
        if (typeof callbacks === 'undefined') {
            return false;
        }
        for (const callback of callbacks) {
            callback(details);
        }
        return true;
    }

    on<TName extends EventNames<TSurface>>(eventName: TName, callback: EventHandler<TSurface, TName>): void {
        let callbacks = this._eventMap.get(eventName);
        if (typeof callbacks === 'undefined') {
            callbacks = [];
            this._eventMap.set(eventName, callbacks);
        }
        callbacks.push(callback as EventHandlerAny);
    }

    off<TName extends EventNames<TSurface>>(eventName: TName, callback: EventHandler<TSurface, TName>): boolean {
        const callbacks = this._eventMap.get(eventName);
        if (typeof callbacks === 'undefined') {
            return false;
        }
        const ii = callbacks.length;
        for (let i = 0; i < ii; ++i) {
            if (callbacks[i] === callback) {
                callbacks.splice(i, 1);
                if (callbacks.length === 0) {
                    this._eventMap.delete(eventName);
                }
                return true;
            }
        }
        return false;
    }

    hasListeners<TName extends EventNames<TSurface>>(eventName: TName): boolean {
        const callbacks = this._eventMap.get(eventName);
        return typeof callbacks !== 'undefined' && callbacks.length > 0;
    }
}
