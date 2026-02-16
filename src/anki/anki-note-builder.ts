import type { Note, NoteFields } from '../types/anki';
import type { DictionaryEntry, TermDictionaryEntry } from '../types/dictionary';
import { cloneFieldMarkerPattern, getRootDeckName } from '../util/anki-util';
import { YomitanError } from '../util/errors';
import { deferPromise } from '../util/utilities';

// --- Interfaces for injection ---

/**
 * Represents a template rendering result.
 */
export type RenderResult = {
    result: string;
    requirements: Requirement[];
};

/**
 * Represents a rendering response from renderMulti.
 */
export type RenderMultiResponse = {
    result?: RenderResult;
    error?: SerializedError;
};

export type SerializedError = {
    name?: string;
    message?: string;
    stack?: string;
    data?: unknown;
};

/**
 * Interface for a template renderer that can be injected into AnkiNoteBuilder.
 */
export interface TemplateRenderer {
    getModifiedData(data: { marker: string; commonData: CommonData }, type: string): Promise<NoteData>;
    renderMulti(items: RenderMultiItem[]): Promise<RenderMultiResponse[]>;
}

export type RenderMultiItem = {
    template: string;
    templateItems: RenderMultiTemplateItem[];
};

export type RenderMultiTemplateItem = {
    type: string;
    commonData: CommonData;
    datas: PartialRenderData[];
};

export type PartialRenderData = {
    marker: string;
};

/**
 * Common data passed through the template rendering process.
 */
export type CommonData = {
    dictionaryEntry: DictionaryEntry;
    cardFormat: AnkiCardFormat;
    context: Context;
    resultOutputMode: ResultOutputMode;
    glossaryLayoutMode: GlossaryLayoutMode;
    compactTags: boolean;
    media?: Media;
    dictionaryStylesMap: Map<string, string>;
};

export type AnkiCardFormat = {
    deck: string;
    model: string;
    fields: { [fieldName: string]: { value: string } };
};

export type Context = {
    url: string;
    sentence?: { text: string; offset: number };
    query: string;
    fullQuery: string;
    documentTitle?: string;
};

export type ResultOutputMode = 'group' | 'merge' | 'split';
export type GlossaryLayoutMode = 'default' | 'compact' | 'compact-popup-anki';

export type MediaObject = { value: string };

export type Media = {
    audio?: MediaObject;
    screenshot?: MediaObject;
    clipboardImage?: MediaObject;
    clipboardText?: MediaObject;
    popupSelectionText?: MediaObject;
    textFurigana: TextFuriganaSegment[];
    dictionaryMedia: DictionaryMedia;
};

export type TextFuriganaSegment = {
    text: string;
    readingMode: TextFuriganaReadingMode | null;
    detailsHtml: MediaObject;
    detailsPlain: MediaObject;
};

export type TextFuriganaReadingMode = 'hiragana' | 'katakana';

export type DictionaryMedia = {
    [dictionary: string]: {
        [path: string]: MediaObject;
    };
};

export type NoteData = Record<string, unknown>;

export type Requirement =
    | { type: 'audio' }
    | { type: 'screenshot' }
    | { type: 'clipboardImage' }
    | { type: 'clipboardText' }
    | { type: 'popupSelectionText' }
    | { type: 'textFurigana'; text: string; readingMode: TextFuriganaReadingMode | null }
    | { type: 'dictionaryMedia'; dictionary: string; path: string };

export type CreateNoteDetails = {
    dictionaryEntry: DictionaryEntry;
    cardFormat: AnkiCardFormat;
    context: Context;
    template: string;
    tags?: string[];
    requirements?: Requirement[];
    duplicateScope?: string;
    duplicateScopeCheckAllModels?: boolean;
    resultOutputMode?: ResultOutputMode;
    glossaryLayoutMode?: GlossaryLayoutMode;
    compactTags?: boolean;
    mediaOptions?: MediaOptions | null;
    dictionaryStylesMap?: Map<string, string>;
};

export type MediaOptions = {
    audio?: {
        sources: { type: string; url: string; voice: string }[];
        preferredAudioIndex: number | null;
        idleTimeout: number | null;
        languageSummary: unknown;
        enableDefaultAudioSources: boolean;
    };
    screenshot?: {
        format: string;
        quality: number;
        contentOrigin: { tabId: number; frameId: number };
    };
    textParsing?: {
        optionsContext: unknown;
        scanLength: number;
    };
};

export type CreateNoteResult = {
    note: Note;
    errors: Error[];
    requirements: Requirement[];
};

export type InjectAnkiNoteMediaDefinitionDetails =
    | { type: 'kanji'; character: string }
    | { type: 'term'; term: string; reading: string };

// Batched request types
type BatchedRequestData = {
    resolve: (value: RenderResult) => void;
    reject: (reason?: unknown) => void;
    marker: string;
};

type BatchedRequestGroup = {
    template: string;
    commonDataRequestsMap: Map<CommonData, BatchedRequestData[]>;
};

/**
 * Minimal API interface needed by AnkiNoteBuilder for media injection.
 */
export interface MinimalApi {
    injectAnkiNoteMedia(
        timestamp: number,
        dictionaryEntryDetails: InjectAnkiNoteMediaDefinitionDetails,
        audioDetails: unknown,
        screenshotDetails: unknown,
        clipboardDetails: { image: boolean; text: boolean },
        dictionaryMediaDetails: { dictionary: string; path: string }[],
    ): Promise<{
        audioFileName: string | null;
        screenshotFileName: string | null;
        clipboardImageFileName: string | null;
        clipboardText: string | null;
        dictionaryMedia: { dictionary: string; path: string; fileName: string | null }[];
        errors: SerializedError[];
    }>;
    parseText(
        text: string,
        optionsContext: unknown,
        scanLength: number,
        useInternalParser: boolean,
        useMecabParser: boolean,
    ): Promise<{ source: string; content: unknown }[]>;
}

/**
 * Builds Anki notes from dictionary entries using template rendering.
 */
export class AnkiNoteBuilder {
    private _api: MinimalApi | null;
    private _markerPattern: RegExp;
    private _templateRenderer: TemplateRenderer;
    private _batchedRequests: BatchedRequestGroup[];
    private _batchedRequestsQueued: boolean;

    constructor(templateRenderer: TemplateRenderer, api?: MinimalApi) {
        this._api = api ?? null;
        this._markerPattern = cloneFieldMarkerPattern(true);
        this._templateRenderer = templateRenderer;
        this._batchedRequests = [];
        this._batchedRequestsQueued = false;
    }

    async createNote({
        dictionaryEntry,
        cardFormat,
        context,
        template,
        tags = [],
        requirements = [],
        duplicateScope = 'collection',
        duplicateScopeCheckAllModels = false,
        resultOutputMode = 'split',
        glossaryLayoutMode = 'default',
        compactTags = false,
        mediaOptions = null,
        dictionaryStylesMap = new Map(),
    }: CreateNoteDetails): Promise<CreateNoteResult> {
        const { deck: deckName, model: modelName, fields: fieldsSettings } = cardFormat;
        const fields = Object.entries(fieldsSettings);
        let duplicateScopeDeckName: string | null = null;
        let duplicateScopeCheckChildren = false;
        if (duplicateScope === 'deck-root') {
            duplicateScope = 'deck';
            duplicateScopeDeckName = getRootDeckName(deckName);
            duplicateScopeCheckChildren = true;
        }

        const allErrors: Error[] = [];
        let media: Media | undefined;
        if (requirements.length > 0 && mediaOptions !== null && this._api !== null) {
            let errors: SerializedError[];
            ({ media, errors } = await this._injectMedia(dictionaryEntry, requirements, mediaOptions));
            for (const error of errors) {
                allErrors.push(this._deserializeError(error));
            }
        }

        const commonData = this._createData(
            dictionaryEntry,
            cardFormat,
            context,
            resultOutputMode,
            glossaryLayoutMode,
            compactTags,
            media,
            dictionaryStylesMap,
        );
        const formattedFieldValuePromises = [];
        for (const [, { value: fieldValue }] of fields) {
            const formattedFieldValuePromise = this._formatField(fieldValue, commonData, template);
            formattedFieldValuePromises.push(formattedFieldValuePromise);
        }

        const formattedFieldValues = await Promise.all(formattedFieldValuePromises);
        const uniqueRequirements = new Map<string, Requirement>();
        const noteFields: NoteFields = {};
        for (let i = 0, ii = fields.length; i < ii; ++i) {
            const fieldName = fields[i][0];
            const { value, errors: fieldErrors, requirements: fieldRequirements } = formattedFieldValues[i];
            noteFields[fieldName] = value;
            allErrors.push(...fieldErrors);
            for (const requirement of fieldRequirements) {
                const key = JSON.stringify(requirement);
                if (uniqueRequirements.has(key)) {
                    continue;
                }
                uniqueRequirements.set(key, requirement);
            }
        }

        const note: Note = {
            fields: noteFields,
            tags,
            deckName,
            modelName,
            options: {
                allowDuplicate: true,
                duplicateScope,
                duplicateScopeOptions: {
                    deckName: duplicateScopeDeckName,
                    checkChildren: duplicateScopeCheckChildren,
                    checkAllModels: duplicateScopeCheckAllModels,
                },
            },
        };
        return { note, errors: allErrors, requirements: [...uniqueRequirements.values()] };
    }

    async getRenderingData({
        dictionaryEntry,
        cardFormat,
        context,
        resultOutputMode = 'split',
        glossaryLayoutMode = 'default',
        compactTags = false,
        marker,
        dictionaryStylesMap,
    }: {
        dictionaryEntry: DictionaryEntry;
        cardFormat: AnkiCardFormat;
        context: Context;
        resultOutputMode?: ResultOutputMode;
        glossaryLayoutMode?: GlossaryLayoutMode;
        compactTags?: boolean;
        marker: string;
        dictionaryStylesMap: Map<string, string>;
    }): Promise<NoteData> {
        const commonData = this._createData(
            dictionaryEntry,
            cardFormat,
            context,
            resultOutputMode,
            glossaryLayoutMode,
            compactTags,
            undefined,
            dictionaryStylesMap,
        );
        return await this._templateRenderer.getModifiedData({ marker, commonData }, 'ankiNote');
    }

    getDictionaryEntryDetailsForNote(dictionaryEntry: DictionaryEntry): InjectAnkiNoteMediaDefinitionDetails {
        const { type } = dictionaryEntry;
        if (type === 'kanji') {
            const { character } = dictionaryEntry;
            return { type, character };
        }

        const { headwords } = dictionaryEntry;
        let bestIndex = -1;
        for (let i = 0, ii = headwords.length; i < ii; ++i) {
            const { term, reading, sources } = headwords[i];
            for (const { deinflectedText } of sources) {
                if (term === deinflectedText) {
                    bestIndex = i;
                    i = ii;
                    break;
                }
                if (reading === deinflectedText && bestIndex < 0) {
                    bestIndex = i;
                    break;
                }
            }
        }

        const { term, reading } = headwords[Math.max(0, bestIndex)];
        return { type, term, reading };
    }

    // Private

    private _createData(
        dictionaryEntry: DictionaryEntry,
        cardFormat: AnkiCardFormat,
        context: Context,
        resultOutputMode: ResultOutputMode,
        glossaryLayoutMode: GlossaryLayoutMode,
        compactTags: boolean,
        media: Media | undefined,
        dictionaryStylesMap: Map<string, string>,
    ): CommonData {
        return {
            dictionaryEntry,
            cardFormat,
            context,
            resultOutputMode,
            glossaryLayoutMode,
            compactTags,
            media,
            dictionaryStylesMap,
        };
    }

    private async _formatField(
        field: string,
        commonData: CommonData,
        template: string,
    ): Promise<{ value: string; errors: YomitanError[]; requirements: Requirement[] }> {
        const errors: YomitanError[] = [];
        const requirements: Requirement[] = [];
        const value = await this._stringReplaceAsync(field, this._markerPattern, async (match) => {
            const marker = match[1];
            try {
                const { result, requirements: fieldRequirements } = await this._renderTemplateBatched(
                    template,
                    commonData,
                    marker,
                );
                requirements.push(...fieldRequirements);
                return result;
            } catch (e) {
                const error = new YomitanError(`Template render error for {${marker}}`);
                error.data = { error: e };
                errors.push(error);
                return `{${marker}-render-error}`;
            }
        });
        return { value, errors, requirements };
    }

    private async _stringReplaceAsync(
        str: string,
        regex: RegExp,
        replacer: (match: RegExpExecArray, index: number, str: string) => string | Promise<string>,
    ): Promise<string> {
        let match: RegExpExecArray | null;
        let index = 0;
        const parts: (Promise<string> | string)[] = [];
        while ((match = regex.exec(str)) !== null) {
            parts.push(str.substring(index, match.index), replacer(match, match.index, str));
            index = regex.lastIndex;
        }
        if (parts.length === 0) {
            return str;
        }
        parts.push(str.substring(index));
        return (await Promise.all(parts)).join('');
    }

    private _getBatchedTemplateGroup(template: string): BatchedRequestGroup {
        for (const item of this._batchedRequests) {
            if (item.template === template) {
                return item;
            }
        }

        const result: BatchedRequestGroup = { template, commonDataRequestsMap: new Map() };
        this._batchedRequests.push(result);
        return result;
    }

    private _renderTemplateBatched(template: string, commonData: CommonData, marker: string): Promise<RenderResult> {
        const { promise, resolve, reject } = deferPromise<RenderResult>();
        const { commonDataRequestsMap } = this._getBatchedTemplateGroup(template);
        let requests = commonDataRequestsMap.get(commonData);
        if (typeof requests === 'undefined') {
            requests = [];
            commonDataRequestsMap.set(commonData, requests);
        }
        requests.push({ resolve, reject, marker });
        this._runBatchedRequestsDelayed();
        return promise;
    }

    private _runBatchedRequestsDelayed(): void {
        if (this._batchedRequestsQueued) {
            return;
        }
        this._batchedRequestsQueued = true;
        void Promise.resolve().then(() => {
            this._batchedRequestsQueued = false;
            this._runBatchedRequests();
        });
    }

    private _runBatchedRequests(): void {
        if (this._batchedRequests.length === 0) {
            return;
        }

        const allRequests: BatchedRequestData[] = [];
        const items: RenderMultiItem[] = [];
        for (const { template, commonDataRequestsMap } of this._batchedRequests) {
            const templateItems: RenderMultiTemplateItem[] = [];
            for (const [commonData, requests] of commonDataRequestsMap.entries()) {
                const datas: PartialRenderData[] = [];
                for (const { marker } of requests) {
                    datas.push({ marker });
                }
                allRequests.push(...requests);
                templateItems.push({
                    type: 'ankiNote',
                    commonData,
                    datas,
                });
            }
            items.push({ template, templateItems });
        }

        this._batchedRequests.length = 0;

        void this._resolveBatchedRequests(items, allRequests);
    }

    private async _resolveBatchedRequests(items: RenderMultiItem[], requests: BatchedRequestData[]): Promise<void> {
        let responses: RenderMultiResponse[];
        try {
            responses = await this._templateRenderer.renderMulti(items);
        } catch (e) {
            for (const { reject } of requests) {
                reject(e);
            }
            return;
        }

        for (let i = 0, ii = requests.length; i < ii; ++i) {
            const request = requests[i];
            try {
                const response = responses[i];
                const { error } = response;
                if (typeof error !== 'undefined') {
                    throw this._deserializeError(error);
                }
                request.resolve(response.result!);
            } catch (e) {
                request.reject(e);
            }
        }
    }

    private async _injectMedia(
        dictionaryEntry: DictionaryEntry,
        requirements: Requirement[],
        mediaOptions: MediaOptions,
    ): Promise<{ media: Media; errors: SerializedError[] }> {
        const timestamp = Date.now();

        // Parse requirements
        let injectAudio = false;
        let injectScreenshot = false;
        let injectClipboardImage = false;
        let injectClipboardText = false;
        let injectPopupSelectionText = false;
        const dictionaryMediaDetails: { dictionary: string; path: string }[] = [];
        for (const requirement of requirements) {
            const { type } = requirement;
            switch (type) {
                case 'audio':
                    injectAudio = true;
                    break;
                case 'screenshot':
                    injectScreenshot = true;
                    break;
                case 'clipboardImage':
                    injectClipboardImage = true;
                    break;
                case 'clipboardText':
                    injectClipboardText = true;
                    break;
                case 'popupSelectionText':
                    injectPopupSelectionText = true;
                    break;
                case 'dictionaryMedia':
                    {
                        const { dictionary, path } = requirement;
                        dictionaryMediaDetails.push({ dictionary, path });
                    }
                    break;
            }
        }

        // Generate request data
        const dictionaryEntryDetails = this.getDictionaryEntryDetailsForNote(dictionaryEntry);
        let audioDetails: unknown = null;
        let screenshotDetails: unknown = null;
        const clipboardDetails = { image: injectClipboardImage, text: injectClipboardText };
        if (injectAudio && dictionaryEntryDetails.type !== 'kanji') {
            const audioOptions = mediaOptions.audio;
            if (typeof audioOptions === 'object' && audioOptions !== null) {
                const { sources, preferredAudioIndex, idleTimeout, languageSummary, enableDefaultAudioSources } =
                    audioOptions;
                audioDetails = {
                    sources,
                    preferredAudioIndex,
                    idleTimeout,
                    languageSummary,
                    enableDefaultAudioSources,
                };
            }
        }
        if (injectScreenshot) {
            const screenshotOptions = mediaOptions.screenshot;
            if (typeof screenshotOptions === 'object' && screenshotOptions !== null) {
                const {
                    format,
                    quality,
                    contentOrigin: { tabId, frameId },
                } = screenshotOptions;
                if (typeof tabId === 'number' && typeof frameId === 'number') {
                    screenshotDetails = { tabId, frameId, format, quality };
                }
            }
        }

        // Inject media
        const injectedMedia = await this._api?.injectAnkiNoteMedia(
            timestamp,
            dictionaryEntryDetails,
            audioDetails,
            screenshotDetails,
            clipboardDetails,
            dictionaryMediaDetails,
        );
        if (!injectedMedia) {
            throw new Error('Media injection API is not available');
        }
        const {
            audioFileName,
            screenshotFileName,
            clipboardImageFileName,
            clipboardText,
            dictionaryMedia: dictionaryMediaArray,
            errors,
        } = injectedMedia;

        // Format results
        const dictionaryMedia: DictionaryMedia = {};
        for (const { dictionary, path, fileName } of dictionaryMediaArray) {
            if (fileName === null) {
                continue;
            }
            const dictionaryMedia2 = Object.prototype.hasOwnProperty.call(dictionaryMedia, dictionary)
                ? dictionaryMedia[dictionary]
                : (dictionaryMedia[dictionary] = {});
            dictionaryMedia2[path] = { value: fileName };
        }
        const media: Media = {
            audio: typeof audioFileName === 'string' ? { value: audioFileName } : undefined,
            screenshot: typeof screenshotFileName === 'string' ? { value: screenshotFileName } : undefined,
            clipboardImage: typeof clipboardImageFileName === 'string' ? { value: clipboardImageFileName } : undefined,
            clipboardText: typeof clipboardText === 'string' ? { value: clipboardText } : undefined,
            popupSelectionText: injectPopupSelectionText ? { value: '' } : undefined,
            textFurigana: [],
            dictionaryMedia,
        };
        return { media, errors };
    }

    private _deserializeError(error: SerializedError): Error {
        const e = new YomitanError(error.message ?? 'Unknown error');
        e.data = error.data;
        return e;
    }
}
