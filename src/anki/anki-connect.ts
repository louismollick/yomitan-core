import type {
    ApiReflectResult,
    CanAddNotesDetail,
    CardId,
    CardInfo,
    MessageBody,
    Note,
    NoteFieldInfo,
    NoteId,
    NoteInfo,
} from '../types/anki';
import { getRootDeckName } from '../util/anki-util';
import { YomitanError } from '../util/errors';
import { parseJson } from '../util/json';
import { isObjectNotArray } from '../util/utilities';

/**
 * This class controls communication with Anki via the AnkiConnect plugin.
 */
export class AnkiConnect {
    private _enabled: boolean;
    private _server: string | null;
    private _localVersion: number;
    private _remoteVersion: number;
    private _versionCheckPromise: Promise<number> | null;
    private _apiKey: string | null;

    constructor(config?: { server?: string; apiKey?: string }) {
        this._enabled = false;
        this._server = config?.server ?? null;
        this._localVersion = 2;
        this._remoteVersion = 0;
        this._versionCheckPromise = null;
        this._apiKey = config?.apiKey ?? null;
    }

    get server(): string | null {
        return this._server;
    }

    set server(value: string) {
        this._server = value;
    }

    get enabled(): boolean {
        return this._enabled;
    }

    set enabled(value: boolean) {
        this._enabled = value;
    }

    get apiKey(): string | null {
        return this._apiKey;
    }

    set apiKey(value: string | null) {
        this._apiKey = value;
    }

    /**
     * Checks whether a connection to AnkiConnect can be established.
     */
    async isConnected(): Promise<boolean> {
        try {
            await this._getVersion();
            return true;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Gets the AnkiConnect API version number.
     */
    async getVersion(): Promise<number | null> {
        if (!this._enabled) {
            return null;
        }
        await this._checkVersion();
        return await this._getVersion();
    }

    async addNote(note: Note): Promise<NoteId | null> {
        if (!this._enabled) {
            return null;
        }
        await this._checkVersion();
        const result = await this._invoke('addNote', { note });
        if (result !== null && typeof result !== 'number') {
            throw this._createUnexpectedResultError('number|null', result);
        }
        return result as NoteId | null;
    }

    async addNotes(notes: Note[]): Promise<(number | null)[] | null> {
        if (!this._enabled) {
            return null;
        }
        await this._checkVersion();
        const result = await this._invoke('addNotes', { notes });
        if (result !== null && !Array.isArray(result)) {
            throw this._createUnexpectedResultError('(number | null)[] | null', result);
        }
        return result as (number | null)[] | null;
    }

    async updateNoteFields(noteWithId: Note & { id?: NoteId }): Promise<null> {
        if (!this._enabled) {
            return null;
        }
        await this._checkVersion();
        const result = await this._invoke('updateNoteFields', { note: noteWithId });
        if (result !== null) {
            throw this._createUnexpectedResultError('null', result);
        }
        return result;
    }

    async canAddNotes(notes: Note[]): Promise<boolean[]> {
        if (!this._enabled) {
            return new Array(notes.length).fill(false) as boolean[];
        }
        await this._checkVersion();
        const result = await this._invoke('canAddNotes', { notes });
        return this._normalizeArray<boolean>(result, notes.length, 'boolean');
    }

    async canAddNotesWithErrorDetail(notes: Note[]): Promise<CanAddNotesDetail[]> {
        if (!this._enabled) {
            return notes.map(() => ({ canAdd: false, error: null }));
        }
        await this._checkVersion();
        const result = await this._invoke('canAddNotesWithErrorDetail', { notes });
        return this._normalizeCanAddNotesWithErrorDetailArray(result, notes.length);
    }

    async notesInfo(noteIds: NoteId[]): Promise<(NoteInfo | null)[]> {
        if (!this._enabled) {
            return [];
        }
        await this._checkVersion();
        const result = await this._invoke('notesInfo', { notes: noteIds });
        return this._normalizeNoteInfoArray(result);
    }

    async cardsInfo(cardIds: CardId[]): Promise<(CardInfo | null)[]> {
        if (!this._enabled) {
            return [];
        }
        await this._checkVersion();
        const result = await this._invoke('cardsInfo', { cards: cardIds });
        return this._normalizeCardInfoArray(result);
    }

    async getDeckNames(): Promise<string[]> {
        if (!this._enabled) {
            return [];
        }
        await this._checkVersion();
        const result = await this._invoke('deckNames', {});
        return this._normalizeArray<string>(result, -1, 'string');
    }

    async getModelNames(): Promise<string[]> {
        if (!this._enabled) {
            return [];
        }
        await this._checkVersion();
        const result = await this._invoke('modelNames', {});
        return this._normalizeArray<string>(result, -1, 'string');
    }

    async getModelFieldNames(modelName: string): Promise<string[]> {
        if (!this._enabled) {
            return [];
        }
        await this._checkVersion();
        const result = await this._invoke('modelFieldNames', { modelName });
        return this._normalizeArray<string>(result, -1, 'string');
    }

    async guiBrowse(query: string): Promise<CardId[]> {
        if (!this._enabled) {
            return [];
        }
        await this._checkVersion();
        const result = await this._invoke('guiBrowse', { query });
        return this._normalizeArray<CardId>(result, -1, 'number');
    }

    async guiBrowseNote(noteId: NoteId): Promise<CardId[]> {
        return await this.guiBrowse(`nid:${noteId}`);
    }

    async guiBrowseNotes(noteIds: NoteId[]): Promise<CardId[]> {
        return await this.guiBrowse(`nid:${noteIds.join(',')}`);
    }

    async guiEditNote(noteId: NoteId): Promise<void> {
        await this._invoke('guiEditNote', { note: noteId });
    }

    /**
     * Stores a file with the specified base64-encoded content inside Anki's media folder.
     */
    async storeMediaFile(fileName: string, content: string): Promise<string | null> {
        if (!this._enabled) {
            throw new Error('AnkiConnect not enabled');
        }
        await this._checkVersion();
        const result = await this._invoke('storeMediaFile', { filename: fileName, data: content });
        if (result !== null && typeof result !== 'string') {
            throw this._createUnexpectedResultError('string|null', result);
        }
        return result as string | null;
    }

    /**
     * Finds notes matching a query.
     */
    async findNotes(query: string): Promise<NoteId[]> {
        if (!this._enabled) {
            return [];
        }
        await this._checkVersion();
        const result = await this._invoke('findNotes', { query });
        return this._normalizeArray<NoteId>(result, -1, 'number');
    }

    async findNoteIds(notes: Note[]): Promise<NoteId[][]> {
        if (!this._enabled) {
            return [];
        }
        await this._checkVersion();

        const actions: { action: string; params: Record<string, unknown> }[] = [];
        const actionsTargetsList: NoteId[][][] = [];
        const actionsTargetsMap = new Map<string, NoteId[][]>();
        const allNoteIds: NoteId[][] = [];

        for (const note of notes) {
            const query = this._getNoteQuery(note);
            let actionsTargets = actionsTargetsMap.get(query);
            if (typeof actionsTargets === 'undefined') {
                actionsTargets = [];
                actionsTargetsList.push(actionsTargets);
                actionsTargetsMap.set(query, actionsTargets);
                actions.push({ action: 'findNotes', params: { query } });
            }
            const noteIds: NoteId[] = [];
            allNoteIds.push(noteIds);
            actionsTargets.push(noteIds);
        }

        const result = await this._invokeMulti(actions);
        for (let i = 0, ii = Math.min(result.length, actionsTargetsList.length); i < ii; ++i) {
            const noteIds = this._normalizeArray<number>(result[i], -1, 'number');
            for (const actionsTargets of actionsTargetsList[i]) {
                for (const noteId of noteIds) {
                    actionsTargets.push(noteId);
                }
            }
        }
        return allNoteIds;
    }

    async suspendCards(cardIds: CardId[]): Promise<boolean> {
        if (!this._enabled) {
            return false;
        }
        await this._checkVersion();
        const result = await this._invoke('suspend', { cards: cardIds });
        return typeof result === 'boolean' && result;
    }

    async findCards(query: string): Promise<CardId[]> {
        if (!this._enabled) {
            return [];
        }
        await this._checkVersion();
        const result = await this._invoke('findCards', { query });
        return this._normalizeArray<CardId>(result, -1, 'number');
    }

    async findCardsForNote(noteId: NoteId): Promise<CardId[]> {
        return await this.findCards(`nid:${noteId}`);
    }

    /**
     * Gets information about the AnkiConnect APIs available.
     */
    async apiReflect(scopes: string[], actions: string[] | null = null): Promise<ApiReflectResult> {
        const result = await this._invoke('apiReflect', { scopes, actions });
        if (!(typeof result === 'object' && result !== null)) {
            throw this._createUnexpectedResultError('object', result);
        }
        const { scopes: resultScopes, actions: resultActions } = result as Record<string, unknown>;
        const resultScopes2 = this._normalizeArray<string>(resultScopes, -1, 'string', ', field scopes');
        const resultActions2 = this._normalizeArray<string>(resultActions, -1, 'string', ', field actions');
        return {
            scopes: resultScopes2,
            actions: resultActions2,
        };
    }

    /**
     * Checks whether a specific API action exists.
     */
    async apiExists(action: string): Promise<boolean> {
        const { actions } = await this.apiReflect(['actions'], [action]);
        return actions.includes(action);
    }

    /**
     * Checks if a specific error object corresponds to an unsupported action.
     */
    isErrorUnsupportedAction(error: Error): boolean {
        if (error instanceof YomitanError) {
            const { data } = error;
            if (
                typeof data === 'object' &&
                data !== null &&
                (data as Record<string, unknown>).apiError === 'unsupported action'
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Makes Anki sync.
     */
    async makeAnkiSync(): Promise<unknown | null> {
        if (!this._enabled) {
            return null;
        }
        const version = await this._checkVersion();
        const result = await this._invoke('sync', { version });
        return result === null;
    }

    // Private

    private async _checkVersion(): Promise<void> {
        if (this._remoteVersion < this._localVersion) {
            if (this._versionCheckPromise === null) {
                const promise = this._getVersion();
                promise
                    .catch(() => {})
                    .finally(() => {
                        this._versionCheckPromise = null;
                    });
                this._versionCheckPromise = promise;
            }
            this._remoteVersion = await this._versionCheckPromise;
            if (this._remoteVersion < this._localVersion) {
                throw new Error('Extension and plugin versions incompatible');
            }
        }
    }

    private async _invoke(action: string, params: Record<string, unknown>): Promise<unknown> {
        const body: MessageBody = { action, params, version: this._localVersion };
        if (this._apiKey !== null) {
            body.key = this._apiKey;
        }
        let response: Response;
        try {
            if (this._server === null) {
                throw new Error('Server URL is null');
            }
            response = await fetch(this._server, {
                method: 'POST',
                mode: 'cors',
                cache: 'default',
                credentials: 'omit',
                headers: {
                    'Content-Type': 'application/json',
                },
                redirect: 'follow',
                referrerPolicy: 'no-referrer',
                body: JSON.stringify(body),
            });
        } catch (e) {
            const error = new YomitanError('Anki connection failure');
            error.data = { action, params, originalError: e };
            throw error;
        }

        if (!response.ok) {
            const error = new YomitanError(`Anki connection error: ${response.status}`);
            error.data = { action, params, status: response.status };
            throw error;
        }

        let responseText: string | null = null;
        let result: unknown;
        try {
            responseText = await response.text();
            result = parseJson(responseText);
        } catch (e) {
            const error = new YomitanError('Invalid Anki response');
            error.data = { action, params, status: response.status, responseText, originalError: e };
            throw error;
        }

        if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
            const apiError = (result as Record<string, unknown>).error;
            if (typeof apiError !== 'undefined') {
                const error = new YomitanError(`Anki error: ${apiError}`);
                error.data = {
                    action,
                    params,
                    status: response.status,
                    apiError: typeof apiError === 'string' ? apiError : `${apiError}`,
                };
                throw error;
            }
        }

        return result;
    }

    private async _invokeMulti(actions: { action: string; params: Record<string, unknown> }[]): Promise<unknown[]> {
        const result = await this._invoke('multi', { actions });
        if (!Array.isArray(result)) {
            throw this._createUnexpectedResultError('array', result);
        }
        return result as unknown[];
    }

    private _escapeQuery(text: string): string {
        return text.replace(/"/g, '');
    }

    private _fieldsToQuery(fields: Record<string, string>): string {
        const fieldNames = Object.keys(fields);
        if (fieldNames.length === 0) {
            return '';
        }

        const key = fieldNames[0];
        return `"${key.toLowerCase()}:${this._escapeQuery(fields[key])}"`;
    }

    private _getDuplicateScopeFromNote(note: Note): 'collection' | 'deck' | 'deck-root' | null {
        const { options } = note;
        if (typeof options === 'object' && options !== null) {
            const { duplicateScope } = options;
            if (typeof duplicateScope !== 'undefined') {
                return duplicateScope as 'collection' | 'deck' | 'deck-root';
            }
        }
        return null;
    }

    private _getNoteQuery(note: Note): string {
        let query = '';
        switch (this._getDuplicateScopeFromNote(note)) {
            case 'deck':
                query = `"deck:${this._escapeQuery(note.deckName)}" `;
                break;
            case 'deck-root':
                query = `"deck:${this._escapeQuery(getRootDeckName(note.deckName))}" `;
                break;
        }
        query += this._fieldsToQuery(note.fields);
        return query;
    }

    private async _getVersion(): Promise<number> {
        const version = await this._invoke('version', {});
        return typeof version === 'number' ? version : 0;
    }

    private _createError(message: string, data: unknown): YomitanError {
        return new YomitanError(message, data);
    }

    private _createUnexpectedResultError(expectedType: string, result: unknown, context?: string): YomitanError {
        return this._createError(
            `Unexpected type${typeof context === 'string' ? context : ''}: expected ${expectedType}, received ${this._getTypeName(result)}`,
            result,
        );
    }

    private _getTypeName(value: unknown): string {
        if (value === null) {
            return 'null';
        }
        return Array.isArray(value) ? 'array' : typeof value;
    }

    private _normalizeArray<T = unknown>(
        result: unknown,
        expectedCount: number,
        type: 'boolean' | 'string' | 'number',
        context?: string,
    ): T[] {
        if (!Array.isArray(result)) {
            throw this._createUnexpectedResultError(`${type}[]`, result, context);
        }
        if (expectedCount < 0) {
            expectedCount = result.length;
        } else if (expectedCount !== result.length) {
            throw this._createError(
                `Unexpected result array size${context ?? ''}: expected ${expectedCount}, received ${result.length}`,
                result,
            );
        }
        for (let i = 0; i < expectedCount; ++i) {
            const item = result[i] as unknown;
            if (typeof item !== type) {
                throw this._createError(
                    `Unexpected result type at index ${i}${context ?? ''}: expected ${type}, received ${this._getTypeName(item)}`,
                    result,
                );
            }
        }
        return result as T[];
    }

    private _normalizeNoteInfoArray(result: unknown): (NoteInfo | null)[] {
        if (!Array.isArray(result)) {
            throw this._createUnexpectedResultError('array', result, '');
        }
        const result2: (NoteInfo | null)[] = [];
        for (let i = 0, ii = result.length; i < ii; ++i) {
            const item = result[i] as unknown;
            if (item === null || typeof item !== 'object') {
                throw this._createError(
                    `Unexpected result type at index ${i}: expected Notes.NoteInfo, received ${this._getTypeName(item)}`,
                    result,
                );
            }
            const { noteId } = item as Record<string, unknown>;
            if (typeof noteId !== 'number') {
                result2.push(null);
                continue;
            }

            const { tags, fields, modelName, cards } = item as Record<string, unknown>;
            if (typeof modelName !== 'string') {
                throw this._createError(
                    `Unexpected result type at index ${i}, field modelName: expected string, received ${this._getTypeName(modelName)}`,
                    result,
                );
            }
            if (!isObjectNotArray(fields)) {
                throw this._createError(
                    `Unexpected result type at index ${i}, field fields: expected object, received ${this._getTypeName(fields)}`,
                    result,
                );
            }
            const tags2 = this._normalizeArray<string>(tags, -1, 'string', ', field tags');
            const cards2 = this._normalizeArray<number>(cards, -1, 'number', ', field cards');
            const fields2: { [key: string]: NoteFieldInfo } = {};
            for (const [key, fieldInfo] of Object.entries(fields)) {
                if (!isObjectNotArray(fieldInfo)) {
                    continue;
                }
                const { value, order } = fieldInfo;
                if (typeof value !== 'string' || typeof order !== 'number') {
                    continue;
                }
                fields2[key] = { value, order };
            }
            const item2: NoteInfo = {
                noteId,
                tags: tags2,
                fields: fields2,
                modelName,
                cards: cards2,
                cardsInfo: [],
            };
            result2.push(item2);
        }
        return result2;
    }

    private _normalizeCardInfoArray(result: unknown): (CardInfo | null)[] {
        if (!Array.isArray(result)) {
            throw this._createUnexpectedResultError('array', result, '');
        }
        const result2: (CardInfo | null)[] = [];
        for (let i = 0, ii = result.length; i < ii; ++i) {
            const item = result[i] as unknown;
            if (item === null || typeof item !== 'object') {
                throw this._createError(
                    `Unexpected result type at index ${i}: expected Cards.CardInfo, received ${this._getTypeName(item)}`,
                    result,
                );
            }
            const { cardId } = item as Record<string, unknown>;
            if (typeof cardId !== 'number') {
                result2.push(null);
                continue;
            }
            const { note, flags, queue } = item as Record<string, unknown>;
            if (typeof note !== 'number') {
                result2.push(null);
                continue;
            }

            const item2: CardInfo = {
                noteId: note,
                cardId,
                flags: typeof flags === 'number' ? flags : 0,
                cardState: typeof queue === 'number' ? queue : 0,
            };
            result2.push(item2);
        }
        return result2;
    }

    private _normalizeCanAddNotesWithErrorDetailArray(result: unknown, expectedCount: number): CanAddNotesDetail[] {
        if (!Array.isArray(result)) {
            throw this._createUnexpectedResultError('array', result, '');
        }
        if (expectedCount !== result.length) {
            throw this._createError(
                `Unexpected result array size: expected ${expectedCount}, received ${result.length}`,
                result,
            );
        }
        const result2: CanAddNotesDetail[] = [];
        for (let i = 0; i < expectedCount; ++i) {
            const item = result[i] as unknown;
            if (item === null || typeof item !== 'object') {
                throw this._createError(
                    `Unexpected result type at index ${i}: expected object, received ${this._getTypeName(item)}`,
                    result,
                );
            }

            const { canAdd, error } = item as Record<string, unknown>;
            if (typeof canAdd !== 'boolean') {
                throw this._createError(
                    `Unexpected result type at index ${i}, field canAdd: expected boolean, received ${this._getTypeName(canAdd)}`,
                    result,
                );
            }

            const item2 = {
                canAdd,
                error: typeof error === 'string' ? error : null,
            };

            result2.push(item2);
        }
        return result2;
    }
}
