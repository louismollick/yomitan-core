import { distributeFurigana } from '../language/ja/furigana';
import { NoOpContentManager } from '../render/content-manager';
import { StructuredContentGenerator } from '../render/structured-content-generator';
import type { SafeAny, SerializableObject, TypeofResult } from '../types/core';
import type * as Dictionary from '../types/dictionary';
import type * as DictionaryData from '../types/dictionary-data';
import type * as StructuredContent from '../types/structured-content';
import { getPronunciationsOfType, isNonNounVerbOrAdjective } from '../util/dictionary-data-util';
import type { CommonData, Media, Requirement, TextFuriganaReadingMode } from './anki-note-builder';
import { createAnkiNoteData } from './anki-note-data-creator';
import type { NoteData } from './anki-note-data-creator';

// --- Types ---

export type HelperOptions = {
    fn?: (context: unknown) => string;
    inverse?: (context: unknown) => string;
    hash: SerializableObject;
    data: { root: NoteData };
};

export type HelperFunction<T = unknown> = (args: unknown[], context: unknown, options: HelperOptions) => T;

export type DataType = {
    modifier: (data: CompositeRenderData) => NoteData;
    composeData: (data: PartialRenderData, commonData: CommonData) => CompositeRenderData;
};

export type PartialRenderData = {
    marker: string;
    commonData?: CommonData;
};

export type CompositeRenderData = {
    marker: string;
    commonData: CommonData;
};

export type RenderResult = {
    result: string;
    requirements: Requirement[];
};

export type RenderMultiItem = {
    template: string;
    templateItems: RenderMultiTemplateItem[];
};

export type RenderMultiTemplateItem = {
    type: string;
    commonData: CommonData;
    datas: PartialRenderData[];
};

export type RenderMultiResponse = {
    result?: RenderResult;
    error?: { name?: string; message?: string; stack?: string; data?: unknown };
};

/**
 * Interface for a Handlebars-compatible template engine.
 * Consumers should provide an implementation that wraps their Handlebars instance.
 */
export interface HandlebarsInstance {
    compileAST(template: string): (data: NoteData) => string;
    registerHelper(name: string, helper: (...args: unknown[]) => unknown): void;
    SafeString: new (value: string) => unknown;
    Utils: {
        escapeExpression(value: string): string;
    };
}

/**
 * Manages media access during template rendering.
 */
class TemplateRendererMediaProvider {
    private _requirements: Requirement[] | null;

    constructor() {
        this._requirements = null;
    }

    get requirements(): Requirement[] | null {
        return this._requirements;
    }

    set requirements(value: Requirement[] | null) {
        this._requirements = value;
    }

    hasMedia(root: NoteData, args: unknown[], namedArgs: SerializableObject): boolean {
        const { media } = root;
        const data = this._getMediaData(media as Media, args, namedArgs);
        return data !== null;
    }

    getMedia(
        root: NoteData,
        args: unknown[],
        namedArgs: SerializableObject,
        handlebars: HandlebarsInstance,
    ): string | null {
        const { media } = root;
        const data = this._getMediaData(media as Media, args, namedArgs);
        if (data !== null) {
            const result = this._getFormattedValue(data, namedArgs, handlebars);
            if (typeof result === 'string') {
                return result.replaceAll('\n', '<br>\n');
            }
        }
        const defaultValue = namedArgs.default;
        return defaultValue === null || typeof defaultValue === 'string' ? (defaultValue as string | null) : '';
    }

    private _addRequirement(value: Requirement): void {
        if (this._requirements === null) {
            return;
        }
        this._requirements.push(value);
    }

    private _getFormattedValue(
        data: { value: string },
        namedArgs: SerializableObject,
        handlebars: HandlebarsInstance,
    ): string {
        let { value } = data;
        const { escape = true } = namedArgs;
        if (escape) {
            value = handlebars.Utils.escapeExpression(value);
        }
        return value;
    }

    private _getMediaData(media: Media, args: unknown[], namedArgs: SerializableObject): { value: string } | null {
        const type = args[0];
        switch (type) {
            case 'audio':
                return this._getSimpleMediaData(media, 'audio');
            case 'screenshot':
                return this._getSimpleMediaData(media, 'screenshot');
            case 'clipboardImage':
                return this._getSimpleMediaData(media, 'clipboardImage');
            case 'clipboardText':
                return this._getSimpleMediaData(media, 'clipboardText');
            case 'popupSelectionText':
                return this._getSimpleMediaData(media, 'popupSelectionText');
            case 'textFurigana':
                return this._getTextFurigana(media, args[1], namedArgs, 'furiganaHtml');
            case 'textFuriganaPlain':
                return this._getTextFurigana(media, args[1], namedArgs, 'furiganaPlain');
            case 'dictionaryMedia':
                return this._getDictionaryMedia(media, args[1], namedArgs);
            default:
                return null;
        }
    }

    private _getSimpleMediaData(
        media: Media,
        type: 'audio' | 'screenshot' | 'clipboardImage' | 'clipboardText' | 'popupSelectionText',
    ): { value: string } | null {
        const result = media[type];
        if (typeof result === 'object' && result !== null) {
            return result;
        }
        this._addRequirement({ type } as Requirement);
        return null;
    }

    private _getDictionaryMedia(media: Media, path: unknown, namedArgs: SerializableObject): { value: string } | null {
        if (typeof path !== 'string') {
            return null;
        }
        const { dictionaryMedia } = media;
        const { dictionary } = namedArgs;
        if (typeof dictionary !== 'string') {
            return null;
        }
        if (
            typeof dictionaryMedia !== 'undefined' &&
            Object.prototype.hasOwnProperty.call(dictionaryMedia, dictionary)
        ) {
            const dictionaryMedia2 = dictionaryMedia[dictionary];
            if (Object.prototype.hasOwnProperty.call(dictionaryMedia2, path)) {
                const result = dictionaryMedia2[path];
                if (typeof result === 'object' && result !== null) {
                    return result;
                }
            }
        }
        this._addRequirement({
            type: 'dictionaryMedia',
            dictionary,
            path,
        });
        return null;
    }

    private _getTextFurigana(
        media: Media,
        text: unknown,
        namedArgs: SerializableObject,
        furiganaFormat: 'furiganaHtml' | 'furiganaPlain',
    ): { value: string } | null {
        if (typeof text !== 'string') {
            return null;
        }
        const readingMode = this._normalizeReadingMode(namedArgs.readingMode);
        const { textFurigana } = media;
        if (Array.isArray(textFurigana)) {
            for (const entry of textFurigana) {
                if (entry.text !== text || entry.readingMode !== readingMode) {
                    continue;
                }
                switch (furiganaFormat) {
                    case 'furiganaHtml':
                        return entry.detailsHtml;
                    case 'furiganaPlain':
                        return entry.detailsPlain;
                }
            }
        }
        this._addRequirement({
            type: 'textFurigana',
            text,
            readingMode,
        });
        return null;
    }

    private _normalizeReadingMode(value: unknown): TextFuriganaReadingMode | null {
        switch (value) {
            case 'hiragana':
            case 'katakana':
                return value;
            default:
                return null;
        }
    }
}

// --- Template Renderer ---

class TemplateRendererCore {
    private _cache: Map<string, (data: NoteData) => string>;
    private _cacheMaxSize: number;
    private _dataTypes: Map<string, DataType>;
    private _renderSetup: ((data: NoteData) => { requirements: Requirement[] }) | null;
    private _renderCleanup: ((data: NoteData) => void) | null;
    private _handlebars: HandlebarsInstance;

    constructor(handlebars: HandlebarsInstance) {
        this._cache = new Map();
        this._cacheMaxSize = 5;
        this._dataTypes = new Map();
        this._renderSetup = null;
        this._renderCleanup = null;
        this._handlebars = handlebars;
    }

    registerHelpers(helpers: [string, HelperFunction][]): void {
        for (const [name, helper] of helpers) {
            this._registerHelper(name, helper);
        }
    }

    registerDataType(name: string, details: DataType): void {
        this._dataTypes.set(name, details);
    }

    setRenderCallbacks(
        setup: ((data: NoteData) => { requirements: Requirement[] }) | null,
        cleanup: ((data: NoteData) => void) | null,
    ): void {
        this._renderSetup = setup;
        this._renderCleanup = cleanup;
    }

    render(template: string, data: PartialRenderData, type: string): RenderResult {
        const instance = this._getTemplateInstance(template);
        const modifiedData = this._getModifiedData(data, undefined, type);
        return this._renderTemplate(instance, modifiedData);
    }

    renderMulti(items: RenderMultiItem[]): RenderMultiResponse[] {
        const results: RenderMultiResponse[] = [];
        for (const { template, templateItems } of items) {
            const instance = this._getTemplateInstance(template);
            for (const { type, commonData, datas } of templateItems) {
                for (const data of datas) {
                    let result: RenderMultiResponse;
                    try {
                        const data2 = this._getModifiedData(data, commonData, type);
                        const renderResult = this._renderTemplate(instance, data2);
                        result = { result: renderResult };
                    } catch (error) {
                        const e = error instanceof Error ? error : new Error(`${error}`);
                        result = { error: { name: e.name, message: e.message, stack: e.stack } };
                    }
                    results.push(result);
                }
            }
        }
        return results;
    }

    getModifiedData(data: CompositeRenderData, type: string): NoteData {
        return this._getModifiedData(data, undefined, type);
    }

    private _getTemplateInstance(template: string): (data: NoteData) => string {
        const cache = this._cache;
        let instance = cache.get(template);
        if (typeof instance === 'undefined') {
            this._updateCacheSize(this._cacheMaxSize - 1);
            instance = this._handlebars.compileAST(template);
            cache.set(template, instance);
        }
        return instance;
    }

    private _renderTemplate(instance: (data: NoteData) => string, data: NoteData): RenderResult {
        const renderSetup = this._renderSetup;
        const renderCleanup = this._renderCleanup;
        let result: string;
        let additions1: { requirements: Requirement[] } | null;
        try {
            additions1 = typeof renderSetup === 'function' ? renderSetup(data) : null;
            result = instance(data).replace(/^\n+|\n+$/g, '');
        } finally {
            if (typeof renderCleanup === 'function') {
                renderCleanup(data);
            }
        }
        return {
            result,
            requirements: additions1?.requirements ?? [],
        };
    }

    private _getModifiedData(data: PartialRenderData, commonData: CommonData | undefined, type: string): NoteData {
        if (typeof type === 'string') {
            const typeInfo = this._dataTypes.get(type);
            if (typeof typeInfo !== 'undefined') {
                let compositeData: CompositeRenderData;
                if (typeof commonData !== 'undefined') {
                    compositeData = typeInfo.composeData(data, commonData);
                } else if (typeof (data as CompositeRenderData).commonData === 'undefined') {
                    throw new Error('Incomplete data');
                } else {
                    compositeData = data as CompositeRenderData;
                }
                return typeInfo.modifier(compositeData);
            }
        }
        throw new Error(`Invalid type: ${type}`);
    }

    private _updateCacheSize(maxSize: number): void {
        const cache = this._cache;
        let removeCount = cache.size - maxSize;
        if (removeCount <= 0) {
            return;
        }

        for (const key of cache.keys()) {
            cache.delete(key);
            if (--removeCount <= 0) {
                break;
            }
        }
    }

    private _registerHelper(name: string, helper: HelperFunction): void {
        const wrapper = function (this: unknown, ...args: unknown[]): unknown {
            const argCountM1 = Math.max(0, args.length - 1);
            const options = args[argCountM1] as HelperOptions;
            args.length = argCountM1;
            return helper(args, this, options);
        };
        this._handlebars.registerHelper(name, wrapper);
    }
}

// --- Main AnkiTemplateRenderer ---

/**
 * This class contains all Anki-specific template rendering functionality.
 * It registers all 25+ Handlebars helpers and provides template rendering.
 *
 * Requires a Handlebars-compatible engine to be injected via the constructor.
 */
export class AnkiTemplateRenderer {
    private _templateRenderer: TemplateRendererCore;
    private _mediaProvider: TemplateRendererMediaProvider;
    private _stateStack: Map<string, unknown>[] | null;
    private _requirements: Requirement[] | null;
    private _cleanupCallbacks: (() => void)[];
    private _document: Document | null;
    private _handlebars: HandlebarsInstance;

    constructor(handlebars: HandlebarsInstance) {
        this._handlebars = handlebars;
        this._templateRenderer = new TemplateRendererCore(handlebars);
        this._mediaProvider = new TemplateRendererMediaProvider();
        this._stateStack = null;
        this._requirements = null;
        this._cleanupCallbacks = [];
        this._document = typeof document !== 'undefined' ? document : null;
    }

    /**
     * Gets the core TemplateRenderer instance.
     */
    get templateRenderer(): TemplateRendererCore {
        return this._templateRenderer;
    }

    /**
     * Prepares the renderer by registering all Handlebars helpers and data types.
     */
    async prepare(): Promise<void> {
        this._templateRenderer.registerHelpers([
            ['dumpObject', this._dumpObject.bind(this)],
            ['furigana', this._furigana.bind(this)],
            ['furiganaPlain', this._furiganaPlain.bind(this)],
            ['multiLine', this._multiLine.bind(this)],
            ['regexReplace', this._regexReplace.bind(this)],
            ['regexMatch', this._regexMatch.bind(this)],
            ['mergeTags', this._mergeTags.bind(this)],
            ['eachUpTo', this._eachUpTo.bind(this)],
            ['spread', this._spread.bind(this)],
            ['op', this._op.bind(this)],
            ['get', this._get.bind(this)],
            ['set', this._set.bind(this)],
            ['scope', this._scope.bind(this)],
            ['property', this._property.bind(this)],
            ['noop', this._noop.bind(this)],
            ['isMoraPitchHigh', this._isMoraPitchHigh.bind(this)],
            ['getKanaMorae', this._getKanaMorae.bind(this)],
            ['typeof', this._getTypeof.bind(this)],
            ['join', this._join.bind(this)],
            ['concat', this._concat.bind(this)],
            ['pitchCategories', this._pitchCategories.bind(this)],
            ['formatGlossary', this._formatGlossary.bind(this)],
            ['formatGlossaryPlain', this._formatGlossaryPlain.bind(this)],
            ['hasMedia', this._hasMedia.bind(this)],
            ['getMedia', this._getMedia.bind(this)],
            ['hiragana', this._hiragana.bind(this)],
            ['katakana', this._katakana.bind(this)],
        ]);
        this._templateRenderer.registerDataType('ankiNote', {
            modifier: ({ marker, commonData }: CompositeRenderData) => createAnkiNoteData(marker, commonData),
            composeData: ({ marker }: PartialRenderData, commonData: CommonData): CompositeRenderData => ({
                marker,
                commonData,
            }),
        });
        this._templateRenderer.setRenderCallbacks(this._onRenderSetup.bind(this), this._onRenderCleanup.bind(this));
    }

    /**
     * Renders a single template with given data.
     */
    render(template: string, data: PartialRenderData, type: string): RenderResult {
        return this._templateRenderer.render(template, data, type);
    }

    /**
     * Renders multiple templates with given data.
     */
    renderMulti(items: RenderMultiItem[]): RenderMultiResponse[] {
        return this._templateRenderer.renderMulti(items);
    }

    /**
     * Gets modified data for a given type.
     */
    getModifiedData(data: CompositeRenderData, type: string): NoteData {
        return this._templateRenderer.getModifiedData(data, type);
    }

    // Private - callbacks

    private _onRenderSetup(): { requirements: Requirement[] } {
        const requirements: Requirement[] = [];
        this._stateStack = [new Map()];
        this._requirements = requirements;
        this._mediaProvider.requirements = requirements;
        return { requirements };
    }

    private _onRenderCleanup(): void {
        for (const callback of this._cleanupCallbacks) {
            callback();
        }
        this._stateStack = null;
        this._requirements = null;
        this._mediaProvider.requirements = null;
        this._cleanupCallbacks.length = 0;
    }

    private _safeString(text: string): unknown {
        return new this._handlebars.SafeString(text);
    }

    // Template helpers

    private _dumpObject(args: unknown[]): string {
        return JSON.stringify(args[0], null, 4);
    }

    private _furigana(args: unknown[], context: unknown, options: HelperOptions): unknown {
        const { expression, reading } = this._getFuriganaExpressionAndReading(args);
        const segments = distributeFurigana(expression, reading);

        let result = '';
        for (const { text, reading: reading2 } of segments) {
            result += reading2.length > 0 ? `<ruby>${text}<rt>${reading2}</rt></ruby>` : text;
        }

        return this._safeString(result);
    }

    private _furiganaPlain(args: unknown[]): string {
        const { expression, reading } = this._getFuriganaExpressionAndReading(args);
        const segments = distributeFurigana(expression, reading);

        let result = '';
        for (const { text, reading: reading2 } of segments) {
            if (reading2.length > 0) {
                if (result.length > 0) {
                    result += ' ';
                }
                result += `${text}[${reading2}]`;
            } else {
                result += text;
            }
        }

        return result;
    }

    private _getFuriganaExpressionAndReading(args: unknown[]): { expression: string; reading: string } {
        let expression: unknown;
        let reading: unknown;
        if (args.length >= 2) {
            [expression, reading] = args;
        } else {
            const obj = args[0] as Record<string, unknown>;
            ({ expression, reading } = obj);
        }
        return {
            expression: typeof expression === 'string' ? expression : '',
            reading: typeof reading === 'string' ? reading : '',
        };
    }

    private _stringToMultiLineHtml(string: string): string {
        return string.split('\n').join('<br>');
    }

    private _multiLine(_args: unknown[], context: unknown, options: HelperOptions): unknown {
        return this._safeString(this._stringToMultiLineHtml(this._computeValueString(options, context)));
    }

    private _regexReplace(args: unknown[], context: unknown, options: HelperOptions): string {
        const argCount = args.length;
        let value = this._computeValueString(options, context);
        if (argCount > 3) {
            value = `${(args.slice(3) as string[]).join('')}${value}`;
        }
        if (argCount > 1) {
            try {
                const [pattern, replacement, flags] = args as [string, string, string?];
                if (typeof pattern !== 'string') {
                    throw new Error('Invalid pattern');
                }
                if (typeof replacement !== 'string') {
                    throw new Error('Invalid replacement');
                }
                const regex = new RegExp(pattern, typeof flags === 'string' ? flags : 'g');
                value = value.replace(regex, replacement);
            } catch (e) {
                return `${e}`;
            }
        }
        return value;
    }

    private _regexMatch(args: unknown[], context: unknown, options: HelperOptions): string {
        const argCount = args.length;
        let value = this._computeValueString(options, context);
        if (argCount > 2) {
            value = `${(args.slice(2) as string[]).join('')}${value}`;
        }
        if (argCount > 0) {
            try {
                const [pattern, flags] = args as [string, string?];
                if (typeof pattern !== 'string') {
                    throw new Error('Invalid pattern');
                }
                const regex = new RegExp(pattern, typeof flags === 'string' ? flags : '');
                const parts: string[] = [];
                value.replace(regex, (g0: string) => {
                    parts.push(g0);
                    return g0;
                });
                value = parts.join('');
            } catch (e) {
                return `${e}`;
            }
        }
        return value;
    }

    private _mergeTags(args: unknown[]): string {
        const [object, isGroupMode, isMergeMode] = args as [Record<string, SafeAny>, boolean, boolean];
        const tagSources: { name: string }[][] = [];
        if (Array.isArray(object.termTags)) {
            tagSources.push(object.termTags);
        }
        if (isGroupMode || isMergeMode) {
            const { definitions } = object;
            if (Array.isArray(definitions)) {
                for (const definition of definitions) {
                    tagSources.push(definition.definitionTags);
                }
            }
        } else {
            if (Array.isArray(object.definitionTags)) {
                tagSources.push(object.definitionTags);
            }
        }

        const tags = new Set<string>();
        for (const tagSource of tagSources) {
            for (const tag of tagSource) {
                tags.add(tag.name);
            }
        }

        return [...tags].join(', ');
    }

    private _eachUpTo(args: unknown[], context: unknown, options: HelperOptions): string {
        const [iterable, maxCount] = args as [Iterable<unknown>, number];
        if (iterable) {
            const results: string[] = [];
            let any = false;
            for (const entry of iterable) {
                any = true;
                if (results.length >= maxCount) {
                    break;
                }
                const processedEntry = this._computeValue(options, entry);
                results.push(`${processedEntry}`);
            }
            if (any) {
                return results.join('');
            }
        }
        return this._computeInverseString(options, context);
    }

    private _spread(args: unknown[]): unknown[] {
        const result: unknown[] = [];
        for (const array of args as Iterable<unknown>[]) {
            try {
                result.push(...array);
            } catch (_e) {
                // NOP
            }
        }
        return result;
    }

    private _op(args: unknown[]): unknown {
        const [operator] = args as [string];
        switch (args.length) {
            case 2:
                return this._evaluateUnaryExpression(operator, args[1]);
            case 3:
                return this._evaluateBinaryExpression(operator, args[1], args[2]);
            case 4:
                return this._evaluateTernaryExpression(operator, args[1], args[2], args[3]);
            default:
                return undefined;
        }
    }

    private _evaluateUnaryExpression(operator: string, operand1: SafeAny): unknown {
        switch (operator) {
            case '+':
                return +operand1;
            case '-':
                return -operand1;
            case '~':
                return ~operand1;
            case '!':
                return !operand1;
            default:
                return undefined;
        }
    }

    private _evaluateBinaryExpression(operator: string, operand1: SafeAny, operand2: SafeAny): unknown {
        switch (operator) {
            case '+':
                return operand1 + operand2;
            case '-':
                return operand1 - operand2;
            case '/':
                return operand1 / operand2;
            case '*':
                return operand1 * operand2;
            case '%':
                return operand1 % operand2;
            case '**':
                return operand1 ** operand2;
            case '==':
                return operand1 === operand2;
            case '!=':
                return operand1 !== operand2;
            case '===':
                return operand1 === operand2;
            case '!==':
                return operand1 !== operand2;
            case '<':
                return operand1 < operand2;
            case '<=':
                return operand1 <= operand2;
            case '>':
                return operand1 > operand2;
            case '>=':
                return operand1 >= operand2;
            case '<<':
                return operand1 << operand2;
            case '>>':
                return operand1 >> operand2;
            case '>>>':
                return operand1 >>> operand2;
            case '&':
                return operand1 & operand2;
            case '|':
                return operand1 | operand2;
            case '^':
                return operand1 ^ operand2;
            case '&&':
                return operand1 && operand2;
            case '||':
                return operand1 || operand2;
            default:
                return undefined;
        }
    }

    private _evaluateTernaryExpression(
        operator: string,
        operand1: SafeAny,
        operand2: SafeAny,
        operand3: SafeAny,
    ): unknown {
        switch (operator) {
            case '?:':
                return operand1 ? operand2 : operand3;
            default:
                return undefined;
        }
    }

    private _get(args: unknown[]): unknown {
        const [key] = args as [string];
        const stateStack = this._stateStack;
        if (stateStack === null) {
            throw new Error('Invalid state');
        }
        for (let i = stateStack.length; --i >= 0; ) {
            const map = stateStack[i];
            if (map.has(key)) {
                return map.get(key);
            }
        }
        return undefined;
    }

    private _set(args: unknown[], context: unknown, options: HelperOptions): string {
        const stateStack = this._stateStack;
        if (stateStack === null) {
            throw new Error('Invalid state');
        }
        switch (args.length) {
            case 1:
                {
                    const [key] = args as [string];
                    const value = this._computeValue(options, context);
                    stateStack[stateStack.length - 1].set(key, value);
                }
                break;
            case 2:
                {
                    const [key, value] = args as [string, unknown];
                    stateStack[stateStack.length - 1].set(key, value);
                }
                break;
        }
        return '';
    }

    private _scope(_args: unknown[], context: unknown, options: HelperOptions): unknown {
        const stateStack = this._stateStack;
        if (stateStack === null) {
            throw new Error('Invalid state');
        }
        try {
            stateStack.push(new Map());
            return this._computeValue(options, context);
        } finally {
            if (stateStack.length > 1) {
                stateStack.pop();
            }
        }
    }

    private _property(args: unknown[]): unknown {
        const ii = args.length;
        if (ii <= 0) {
            return undefined;
        }

        try {
            let value: unknown = args[0];
            for (let i = 1; i < ii; ++i) {
                if (typeof value !== 'object' || value === null) {
                    throw new Error('Invalid object');
                }
                const key = args[i];
                switch (typeof key) {
                    case 'number':
                    case 'string':
                    case 'symbol':
                        break;
                    default:
                        throw new Error('Invalid key');
                }
                value = (value as Record<string | number | symbol, unknown>)[key];
            }
            return value;
        } catch (_e) {
            return undefined;
        }
    }

    private _noop(_args: unknown[], context: unknown, options: HelperOptions): unknown {
        return this._computeValue(options, context);
    }

    private _isMoraPitchHigh(args: unknown[]): boolean {
        const [index, position] = args as [number, number];
        return isMoraPitchHigh(index, position);
    }

    private _getKanaMorae(args: unknown[]): string[] {
        const [text] = args as [string];
        return getKanaMorae(`${text}`);
    }

    private _getTypeof(args: unknown[], context: unknown, options: HelperOptions): TypeofResult {
        const ii = args.length;
        const value = ii > 0 ? args[0] : this._computeValue(options, context);
        return typeof value;
    }

    private _join(args: unknown[]): string {
        return args.length > 0 ? (args.slice(1, args.length) as unknown[]).flat().join(args[0] as string) : '';
    }

    private _concat(args: unknown[]): string {
        let result = '';
        for (let i = 0, ii = args.length; i < ii; ++i) {
            result += args[i];
        }
        return result;
    }

    private _pitchCategories(args: unknown[]): string[] {
        const [data] = args as [NoteData];
        const { dictionaryEntry } = data;
        if (dictionaryEntry.type !== 'term') {
            return [];
        }
        const { pronunciations: termPronunciations, headwords } = dictionaryEntry;
        const categories = new Set<string>();
        for (const { headwordIndex, pronunciations } of termPronunciations) {
            const { reading, wordClasses } = headwords[headwordIndex];
            const isVerbOrAdjective = isNonNounVerbOrAdjective(wordClasses);
            const pitches = getPronunciationsOfType(pronunciations, 'pitch-accent');
            for (const { positions } of pitches) {
                const category = getPitchCategory(reading, positions, isVerbOrAdjective);
                if (category !== null) {
                    categories.add(category);
                }
            }
        }
        return [...categories];
    }

    private _formatGlossary(args: unknown[], _context: unknown, options: HelperOptions): unknown {
        const [_dictionary, content] = args as [string, DictionaryData.TermGlossaryContent];
        if (typeof content === 'string') {
            return this._safeString(this._stringToMultiLineHtml(content));
        }
        if (!(typeof content === 'object' && content !== null)) {
            return '';
        }
        switch (content.type) {
            case 'text':
                return this._safeString(this._stringToMultiLineHtml(content.text));
            case 'image':
                return '';
            case 'structured-content':
                return this._safeString(this._formatStructuredContent(content, _dictionary));
        }
        return '';
    }

    private _formatGlossaryPlain(args: unknown[]): unknown {
        const [_dictionary, content] = args as [string, DictionaryData.TermGlossaryContent];
        if (typeof content === 'string') {
            return this._safeString(content);
        }
        if (!(typeof content === 'object' && content !== null)) {
            return '';
        }
        switch (content.type) {
            case 'text':
                return this._safeString(content.text);
            case 'image':
                return '';
            case 'structured-content':
                return this._safeString(this._extractStructuredContentText(content.content));
        }
        return '';
    }

    private _formatStructuredContent(
        content: DictionaryData.TermGlossaryStructuredContent,
        dictionary: string,
    ): string {
        const node = this._createStructuredContentNode(content.content, dictionary);
        if (node === null) {
            return this._stringToMultiLineHtml(this._extractStructuredContentText(content.content));
        }
        return this._getNodeHtml(node);
    }

    private _createStructuredContentNode(content: StructuredContent.Content, dictionary: string): HTMLElement | null {
        if (this._document === null) {
            return null;
        }
        const generator = new StructuredContentGenerator(new NoOpContentManager(), this._document);
        return generator.createStructuredContent(content, dictionary);
    }

    private _getNodeHtml(node: HTMLElement): string {
        if (this._document === null) {
            return '';
        }
        const container = this._document.createElement('div');
        container.appendChild(node);
        return container.innerHTML;
    }

    private _extractStructuredContentText(content: StructuredContent.Content): string {
        const text = this._extractStructuredContentTextParts(content).join('');
        return text
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
    }

    private _extractStructuredContentTextParts(content: StructuredContent.Content): string[] {
        if (typeof content === 'string') {
            return [content];
        }
        if (Array.isArray(content)) {
            const parts: string[] = [];
            for (const item of content) {
                parts.push(...this._extractStructuredContentTextParts(item));
            }
            return parts;
        }
        if (!(typeof content === 'object' && content !== null)) {
            return [];
        }

        if (content.tag === 'br') {
            return ['\n'];
        }

        // Hide ruby annotations in plain fallback output and keep base text.
        if (content.tag === 'rt' || content.tag === 'rp') {
            return [];
        }

        const inner =
            typeof content.content !== 'undefined'
                ? this._extractStructuredContentTextParts(content.content as StructuredContent.Content)
                : [];

        switch (content.tag) {
            case 'li':
                return [...inner, '\n'];
            case 'td':
            case 'th':
                return [...inner, ' '];
            case 'div':
            case 'ol':
            case 'ul':
            case 'table':
            case 'thead':
            case 'tbody':
            case 'tfoot':
            case 'tr':
            case 'details':
            case 'summary':
                return [...inner, '\n'];
            default:
                return inner;
        }
    }

    private _hasMedia(args: unknown[], _context: unknown, options: HelperOptions): boolean {
        const data = this._getNoteDataFromOptions(options);
        return this._mediaProvider.hasMedia(data, args, options.hash);
    }

    private _getMedia(args: unknown[], _context: unknown, options: HelperOptions): string | null {
        const data = this._getNoteDataFromOptions(options);
        return this._mediaProvider.getMedia(data, args, options.hash, this._handlebars);
    }

    private _hiragana(args: unknown[], context: unknown, options: HelperOptions): string {
        const ii = args.length;
        const value = ii > 0 ? args[0] : this._computeValue(options, context);
        return typeof value === 'string' ? convertKatakanaToHiragana(value) : '';
    }

    private _katakana(args: unknown[], context: unknown, options: HelperOptions): string {
        const ii = args.length;
        const value = ii > 0 ? args[0] : this._computeValue(options, context);
        return typeof value === 'string' ? convertHiraganaToKatakana(value) : '';
    }

    // Utility helpers

    private _getNoteDataFromOptions(options: HelperOptions): NoteData {
        return options.data.root;
    }

    private _asString(value: unknown): string {
        return typeof value === 'string' ? value : `${value}`;
    }

    private _computeValue(options: HelperOptions, context: unknown): unknown {
        return typeof options.fn === 'function' ? options.fn(context) : '';
    }

    private _computeValueString(options: HelperOptions, context: unknown): string {
        return this._asString(this._computeValue(options, context));
    }

    private _computeInverse(options: HelperOptions, context: unknown): unknown {
        return typeof options.inverse === 'function' ? options.inverse(context) : '';
    }

    private _computeInverseString(options: HelperOptions, context: unknown): string {
        return this._asString(this._computeInverse(options, context));
    }
}

// --- Japanese utility functions needed by helpers ---

const HIRAGANA_CONVERSION_RANGE: [number, number] = [0x3041, 0x3096];
const KATAKANA_CONVERSION_RANGE: [number, number] = [0x30a1, 0x30f6];
const KANA_PROLONGED_SOUND_MARK_CODE_POINT = 0x30fc;

function convertKatakanaToHiragana(text: string, keepProlongedSoundMarks = false): string {
    let result = '';
    const offset = HIRAGANA_CONVERSION_RANGE[0] - KATAKANA_CONVERSION_RANGE[0];
    for (const char of text) {
        const codePoint = char.codePointAt(0)!;
        if (codePoint === KANA_PROLONGED_SOUND_MARK_CODE_POINT && !keepProlongedSoundMarks) {
            result += char;
        } else if (codePoint >= KATAKANA_CONVERSION_RANGE[0] && codePoint <= KATAKANA_CONVERSION_RANGE[1]) {
            result += String.fromCodePoint(codePoint + offset);
        } else {
            result += char;
        }
    }
    return result;
}

function convertHiraganaToKatakana(text: string): string {
    let result = '';
    const offset = KATAKANA_CONVERSION_RANGE[0] - HIRAGANA_CONVERSION_RANGE[0];
    for (const char of text) {
        const codePoint = char.codePointAt(0)!;
        if (codePoint >= HIRAGANA_CONVERSION_RANGE[0] && codePoint <= HIRAGANA_CONVERSION_RANGE[1]) {
            result += String.fromCodePoint(codePoint + offset);
        } else {
            result += char;
        }
    }
    return result;
}

function isMoraPitchHigh(moraIndex: number, pitchAccentPosition: number | string): boolean {
    const pos =
        typeof pitchAccentPosition === 'string' ? Number.parseInt(pitchAccentPosition, 10) : pitchAccentPosition;
    if (pos === 0) {
        return moraIndex > 0;
    }
    if (moraIndex === 0) {
        return pos > 1;
    }
    return moraIndex < pos;
}

function getKanaMorae(text: string): string[] {
    const morae: string[] = [];
    const SMALL_KANA_SET = new Set('ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ');
    for (const char of text) {
        if (morae.length > 0 && SMALL_KANA_SET.has(char)) {
            morae[morae.length - 1] += char;
        } else {
            morae.push(char);
        }
    }
    return morae;
}

function getPitchCategory(reading: string, positions: number | string, isVerbOrAdjective: boolean): string | null {
    const pos = typeof positions === 'string' ? Number.parseInt(positions, 10) : positions;
    if (pos === 0) {
        return 'heiban';
    }
    if (pos === 1) {
        return 'atamadaka';
    }
    const morae = getKanaMorae(reading);
    if (pos >= morae.length) {
        return isVerbOrAdjective ? 'kifuku' : 'odaka';
    }
    return isVerbOrAdjective ? 'kifuku' : 'nakadaka';
}
