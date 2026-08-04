import type {
    AudioInfo,
    AudioSourceInfo,
    AudioSourceType,
    AudioUrlInfo,
    CustomAudioList,
    WikimediaCommonsFileResponse,
    WikimediaCommonsLookupResponse,
} from '../types/audio';
import type { LanguageSummary } from '../types/language';
import { readResponseJson } from '../util/json';

/**
 * Interface for parsing HTML content. Consumers can inject
 * a DOM parser implementation (e.g. linkedom, jsdom, or the browser's native DOMParser).
 */
export interface SimpleDOMParser {
    getElementById(id: string): Element | null;
    getElementsByClassName(className: string, root?: Element): Element[];
    getElementByTagName(tagName: string, root?: Element): Element | null;
    getAttribute(element: Element, attribute: string): string | null;
    getTextContent(element: Element): string;
}

/**
 * A default DOM parser implementation that uses the standard DOMParser API
 * (available in browsers and some Node.js DOM libraries like linkedom/jsdom).
 */
export class NativeSimpleDOMParser implements SimpleDOMParser {
    private _document: Document;

    constructor(content: string) {
        const parser = new DOMParser();
        this._document = parser.parseFromString(content, 'text/html');
    }

    getElementById(id: string): Element | null {
        return this._document.getElementById(id);
    }

    getElementsByClassName(className: string, root?: Element): Element[] {
        const parent = root ?? this._document;
        return [...parent.getElementsByClassName(className)];
    }

    getElementByTagName(tagName: string, root?: Element): Element | null {
        const parent = root ?? this._document;
        const elements = parent.getElementsByTagName(tagName);
        return elements.length > 0 ? elements[0] : null;
    }

    getAttribute(element: Element, attribute: string): string | null {
        return element.getAttribute(attribute);
    }

    getTextContent(element: Element): string {
        return element.textContent ?? '';
    }
}

const DEFAULT_REQUEST_INIT_PARAMS: RequestInit = {
    method: 'GET',
    mode: 'cors',
    cache: 'default',
    credentials: 'omit',
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
};

type GetInfoHandler = (
    term: string,
    reading: string,
    source: AudioSourceInfo,
    languageSummary: LanguageSummary,
) => Promise<AudioInfo[]>;

/**
 * Generates audio URLs for dictionary terms from various audio sources.
 * Ported from Yomitan's AudioDownloader, but only extracts URL generation logic (not download).
 */
export class AudioUrlGenerator {
    private _getInfoHandlers: Map<AudioSourceType, GetInfoHandler>;
    private _regionNames: Intl.DisplayNames;
    private _domParserFactory: ((content: string) => SimpleDOMParser) | null;
    private _customAudioListSchema: object | null;

    constructor(options?: {
        domParserFactory?: (content: string) => SimpleDOMParser;
    }) {
        this._domParserFactory = options?.domParserFactory ?? null;
        this._customAudioListSchema = null;
        this._regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

        this._getInfoHandlers = new Map<AudioSourceType, GetInfoHandler>([
            ['jpod101', this._getInfoJpod101.bind(this)],
            ['language-pod-101', this._getInfoLanguagePod101.bind(this)],
            ['jisho', this._getInfoJisho.bind(this)],
            ['lingua-libre', this._getInfoLinguaLibre.bind(this)],
            ['wiktionary', this._getInfoWiktionary.bind(this)],
            ['text-to-speech', this._getInfoTextToSpeech.bind(this)],
            ['text-to-speech-reading', this._getInfoTextToSpeechReading.bind(this)],
            ['custom', this._getInfoCustom.bind(this)],
            ['custom-json', this._getInfoCustomJson.bind(this)],
        ]);
    }

    /**
     * Gets audio URL info for a single source.
     */
    async getTermAudioInfoList(
        source: AudioSourceInfo,
        term: string,
        reading: string,
        languageSummary: LanguageSummary,
    ): Promise<AudioInfo[]> {
        const handler = this._getInfoHandlers.get(source.type);
        if (typeof handler === 'function') {
            try {
                return await handler(term, reading, source, languageSummary);
            } catch (_e) {
                // NOP
            }
        }
        return [];
    }

    /**
     * Gets audio URLs for a term from multiple sources.
     */
    async getUrls(
        term: string,
        reading: string,
        sources: AudioSourceInfo[],
        languageSummary: LanguageSummary,
    ): Promise<AudioInfo[]> {
        const results: AudioInfo[] = [];
        for (const source of sources) {
            const infoList = await this.getTermAudioInfoList(source, term, reading, languageSummary);
            results.push(...infoList);
        }
        return results;
    }

    // Private

    private _normalizeUrl(url: string, base: string): string {
        return new URL(url, base).href;
    }

    private _createSimpleDOMParser(content: string): SimpleDOMParser {
        if (this._domParserFactory !== null) {
            return this._domParserFactory(content);
        }
        // Try native DOMParser
        if (typeof DOMParser !== 'undefined') {
            return new NativeSimpleDOMParser(content);
        }
        throw new Error('DOM parsing not supported. Provide a domParserFactory in the constructor.');
    }

    private async _getInfoJpod101(term: string, reading: string): Promise<AudioInfo[]> {
        if (reading === term && this._isStringEntirelyKana(term)) {
            reading = term;
            term = '';
        }

        const params = new URLSearchParams();
        if (term.length > 0) {
            params.set('kanji', term);
        }
        if (reading.length > 0) {
            params.set('kana', reading);
        }

        const url = `https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?${params.toString()}`;
        return [{ type: 'url', url }];
    }

    private async _getInfoLanguagePod101(
        term: string,
        reading: string,
        _details: AudioSourceInfo,
        languageSummary: LanguageSummary,
    ): Promise<AudioInfo[]> {
        const { name: language } = languageSummary;

        const fetchUrl = this._getLanguagePod101FetchUrl(language);
        const data = new URLSearchParams({
            post: 'dictionary_reference',
            match_type: 'exact',
            search_query: term,
            vulgar: 'true',
        });
        const response = await fetch(fetchUrl, {
            ...DEFAULT_REQUEST_INIT_PARAMS,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: data,
        });
        const responseText = await response.text();

        const dom = this._createSimpleDOMParser(responseText);
        const urls = new Set<string>();
        for (const row of dom.getElementsByClassName('dc-result-row')) {
            try {
                const audio = dom.getElementByTagName('audio', row);
                if (audio === null) {
                    continue;
                }

                const source = dom.getElementByTagName('source', audio);
                if (source === null) {
                    continue;
                }

                let url = dom.getAttribute(source, 'src');
                if (url === null) {
                    continue;
                }

                if (!this._validateLanguagePod101Row(language, dom, row, term, reading)) {
                    continue;
                }
                url = this._normalizeUrl(url, response.url);
                urls.add(url);
            } catch (_e) {
                // NOP
            }
        }
        return [...urls].map((url): AudioUrlInfo => ({ type: 'url', url }));
    }

    private _validateLanguagePod101Row(
        language: string,
        dom: SimpleDOMParser,
        row: Element,
        term: string,
        reading: string,
    ): boolean {
        switch (language) {
            case 'Japanese':
                {
                    const htmlReadings = dom.getElementsByClassName('dc-vocab_kana', row);
                    if (htmlReadings.length === 0) {
                        return false;
                    }

                    const htmlReading = dom.getTextContent(htmlReadings[0]);
                    if (!htmlReading) {
                        return false;
                    }
                    if (reading !== term && reading !== htmlReading) {
                        return false;
                    }
                }
                break;
            default: {
                const vocab = dom.getElementsByClassName('dc-vocab', row);
                if (vocab.length === 0) {
                    return false;
                }

                if (term !== dom.getTextContent(vocab[0])) {
                    return false;
                }
            }
        }
        return true;
    }

    private _getLanguagePod101FetchUrl(language: string): string {
        const podOrClass = this._getLanguagePod101PodOrClass(language);
        const lowerCaseLanguage = language.toLowerCase();
        return `https://www.${lowerCaseLanguage}${podOrClass}101.com/learningcenter/reference/dictionary_post`;
    }

    private _getLanguagePod101PodOrClass(language: string): 'pod' | 'class' {
        switch (language) {
            case 'Afrikaans':
            case 'Arabic':
            case 'Bulgarian':
            case 'Dutch':
            case 'Filipino':
            case 'Finnish':
            case 'French':
            case 'German':
            case 'Greek':
            case 'Hebrew':
            case 'Hindi':
            case 'Hungarian':
            case 'Indonesian':
            case 'Italian':
            case 'Japanese':
            case 'Persian':
            case 'Polish':
            case 'Portuguese':
            case 'Romanian':
            case 'Russian':
            case 'Spanish':
            case 'Swahili':
            case 'Swedish':
            case 'Thai':
            case 'Urdu':
            case 'Vietnamese':
                return 'pod';
            case 'Cantonese':
            case 'Chinese':
            case 'Czech':
            case 'Danish':
            case 'English':
            case 'Korean':
            case 'Norwegian':
            case 'Turkish':
                return 'class';
            default:
                throw new Error('Invalid language for LanguagePod101');
        }
    }

    private async _getInfoJisho(term: string, reading: string): Promise<AudioInfo[]> {
        const fetchUrl = `https://jisho.org/search/${term}`;
        const response = await fetch(fetchUrl, DEFAULT_REQUEST_INIT_PARAMS);
        const responseText = await response.text();

        const dom = this._createSimpleDOMParser(responseText);
        try {
            const audio = dom.getElementById(`audio_${term}:${reading}`);
            if (audio !== null) {
                const source = dom.getElementByTagName('source', audio);
                if (source !== null) {
                    let url = dom.getAttribute(source, 'src');
                    if (url !== null) {
                        url = this._normalizeUrl(url, response.url);
                        return [{ type: 'url', url }];
                    }
                }
            }
        } catch (_e) {
            // NOP
        }

        throw new Error('Failed to find audio URL');
    }

    private async _getInfoLinguaLibre(
        term: string,
        _reading: string,
        _details: AudioSourceInfo,
        languageSummary: LanguageSummary,
    ): Promise<AudioInfo[]> {
        if (typeof languageSummary !== 'object' || languageSummary === null) {
            throw new Error('Invalid arguments');
        }
        const { iso639_3 } = languageSummary;
        const searchCategory = `incategory:"Lingua_Libre_pronunciation-${iso639_3}"`;
        const searchString = `-${term}.wav`;
        const fetchUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=intitle:/${searchString}/i+${searchCategory}&srnamespace=6&origin=*`;

        const validateFilename = (filename: string, fileUser: string): boolean => {
            const validFilenameTest = new RegExp(`^File:LL-Q\\d+\\s+\\(${iso639_3}\\)-${fileUser}-${term}\\.wav$`, 'i');
            return validFilenameTest.test(filename);
        };

        return await this._getInfoWikimediaCommons(fetchUrl, validateFilename);
    }

    private async _getInfoWiktionary(
        term: string,
        _reading: string,
        _details: AudioSourceInfo,
        languageSummary: LanguageSummary,
    ): Promise<AudioInfo[]> {
        if (typeof languageSummary !== 'object' || languageSummary === null) {
            throw new Error('Invalid arguments');
        }
        const { iso } = languageSummary;
        const searchString = `${iso}(-[a-zA-Z]{2})?-${term}[0123456789]*.ogg`;
        const fetchUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=intitle:/${searchString}/i&srnamespace=6&origin=*`;

        const validateFilename = (filename: string): boolean => {
            const validFilenameTest = new RegExp(`^File:${iso}(-\\w\\w)?-${term}\\d*\\.ogg$`, 'i');
            return validFilenameTest.test(filename);
        };

        const displayName = (filename: string, fileUser: string): string => {
            const match = filename.match(new RegExp(`^File:${iso}(-\\w\\w)-${term}`, 'i'));
            if (match === null) {
                return fileUser;
            }
            const region = match[1].substring(1).toUpperCase();
            const regionName = this._regionNames.of(region);
            return `(${regionName}) ${fileUser}`;
        };

        return await this._getInfoWikimediaCommons(fetchUrl, validateFilename, displayName);
    }

    private async _getInfoWikimediaCommons(
        fetchUrl: string,
        validateFilename: (filename: string, fileUser: string) => boolean,
        displayName: (filename: string, fileUser: string) => string = (_filename, fileUser) => fileUser,
    ): Promise<AudioUrlInfo[]> {
        const response = await fetch(fetchUrl, DEFAULT_REQUEST_INIT_PARAMS);

        const lookupResponse = await readResponseJson<WikimediaCommonsLookupResponse>(response);
        const lookupResults = lookupResponse.query.search;

        const fetchFileInfos = lookupResults.map(async ({ title }) => {
            const fileInfoURL = `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${title}&prop=imageinfo&iiprop=user|url&origin=*`;
            const response2 = await fetch(fileInfoURL, DEFAULT_REQUEST_INIT_PARAMS);
            const fileResponse = await readResponseJson<WikimediaCommonsFileResponse>(response2);
            const fileResults = fileResponse.query.pages;
            const results: AudioUrlInfo[] = [];
            for (const page of Object.values(fileResults)) {
                const fileUrl = page.imageinfo[0].url;
                const fileUser = page.imageinfo[0].user;
                if (validateFilename(title, fileUser)) {
                    results.push({ type: 'url', url: fileUrl, name: displayName(title, fileUser) });
                }
            }
            return results;
        });

        return (await Promise.all(fetchFileInfos)).flat();
    }

    private async _getInfoTextToSpeech(term: string, _reading: string, details: AudioSourceInfo): Promise<AudioInfo[]> {
        if (typeof details !== 'object' || details === null) {
            throw new Error('Invalid arguments');
        }
        const { voice } = details;
        if (typeof voice !== 'string') {
            throw new Error('Invalid voice');
        }
        return [{ type: 'tts', text: term, voice }];
    }

    private async _getInfoTextToSpeechReading(
        _term: string,
        reading: string,
        details: AudioSourceInfo,
    ): Promise<AudioInfo[]> {
        if (typeof details !== 'object' || details === null) {
            throw new Error('Invalid arguments');
        }
        const { voice } = details;
        if (typeof voice !== 'string') {
            throw new Error('Invalid voice');
        }
        return [{ type: 'tts', text: reading, voice }];
    }

    private async _getInfoCustom(
        term: string,
        reading: string,
        details: AudioSourceInfo,
        languageSummary: LanguageSummary,
    ): Promise<AudioInfo[]> {
        if (typeof details !== 'object' || details === null) {
            throw new Error('Invalid arguments');
        }
        let { url } = details;
        if (typeof url !== 'string') {
            throw new Error('Invalid url');
        }
        url = this._getCustomUrl(term, reading, url, languageSummary);
        return [{ type: 'url', url }];
    }

    private async _getInfoCustomJson(
        term: string,
        reading: string,
        details: AudioSourceInfo,
        languageSummary: LanguageSummary,
    ): Promise<AudioInfo[]> {
        if (typeof details !== 'object' || details === null) {
            throw new Error('Invalid arguments');
        }
        let { url } = details;
        if (typeof url !== 'string') {
            throw new Error('Invalid url');
        }
        url = this._getCustomUrl(term, reading, url, languageSummary);

        const response = await fetch(url, DEFAULT_REQUEST_INIT_PARAMS);

        if (!response.ok) {
            throw new Error(`Invalid response: ${response.status}`);
        }

        const responseJson = await readResponseJson<CustomAudioList>(response);

        this._validateCustomAudioList(responseJson);

        const results: AudioInfo[] = [];
        for (const { url: url2, name } of responseJson.audioSources) {
            const info: AudioUrlInfo = { type: 'url', url: url2 };
            if (typeof name === 'string') {
                info.name = name;
            }
            results.push(info);
        }
        return results;
    }

    private _getCustomUrl(term: string, reading: string, url: string, languageSummary: LanguageSummary): string {
        if (typeof url !== 'string') {
            throw new Error('No custom URL defined');
        }
        const data: Record<string, string> = {
            term,
            reading,
            language: languageSummary.iso,
        };
        const replacer = (m0: string, m1: string): string =>
            Object.prototype.hasOwnProperty.call(data, m1) ? `${data[m1]}` : m0;
        return url.replace(/\{([^}]*)\}/g, replacer);
    }

    private _validateCustomAudioList(data: unknown): void {
        if (typeof data !== 'object' || data === null) {
            throw new Error('Invalid custom audio list response');
        }
        const obj = data as Record<string, unknown>;
        if (obj.type !== 'audioSourceList') {
            throw new Error('Invalid custom audio list type');
        }
        if (!Array.isArray(obj.audioSources)) {
            throw new Error('Invalid custom audio list audioSources');
        }
    }

    /**
     * Simple check for whether a string is entirely kana (hiragana/katakana).
     */
    private _isStringEntirelyKana(str: string): boolean {
        if (str.length === 0) {
            return false;
        }
        for (const char of str) {
            const code = char.codePointAt(0);
            if (code === undefined) {
                return false;
            }
            // Hiragana: U+3040-U+309F, Katakana: U+30A0-U+30FF
            if (!((code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff))) {
                return false;
            }
        }
        return true;
    }
}

/**
 * Returns the set of required audio source types for a given language ISO code.
 */
export function getRequiredAudioSourceList(language: string): Set<AudioSourceType> {
    return language === 'ja'
        ? new Set<AudioSourceType>(['jpod101', 'language-pod-101', 'jisho'])
        : new Set<AudioSourceType>(['lingua-libre', 'language-pod-101', 'wiktionary']);
}

/**
 * Returns required audio sources that are not already present in the given sources list.
 */
export function getRequiredAudioSources(language: string, sources: AudioSourceInfo[]): AudioSourceInfo[] {
    const requiredSources = getRequiredAudioSourceList(language);

    for (const { type } of sources) {
        requiredSources.delete(type);
    }

    return [...requiredSources].map((type): AudioSourceInfo => ({ type, url: '', voice: '' }));
}
