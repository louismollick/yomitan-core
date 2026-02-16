import { BlobWriter, TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js';
import type { Entry, WritableWriter, Writer } from '@zip.js/zip.js';
import type { DictionaryDB } from '../database/dictionary-database';
import type * as DictionaryData from '../types/dictionary-data';
import type * as DictionaryDatabase from '../types/dictionary-database';
import type * as DictionaryImporter from '../types/dictionary-importer';
import type * as StructuredContent from '../types/structured-content';
import { compareRevisions } from '../util/dictionary-data-util';
import { YomitanError, toError } from '../util/errors';
import { parseJson } from '../util/json';
import { getFileExtensionFromImageMediaType, getImageMediaTypeFromFileName } from '../util/media-util';
import { stringReverse } from '../util/utilities';
import type { MediaLoader } from './media-loader';
import { NoOpMediaLoader } from './media-loader';
import { getSchemaValidators } from './schema-validators';

const INDEX_FILE_NAME = 'index.json';

export class DictionaryImporterClass {
    private _mediaLoader: MediaLoader;
    private _onProgress: DictionaryImporter.OnProgressCallback;
    private _progressData: DictionaryImporter.ProgressData;

    constructor(mediaLoader?: MediaLoader, onProgress?: DictionaryImporter.OnProgressCallback) {
        this._mediaLoader = mediaLoader ?? new NoOpMediaLoader();
        this._onProgress = typeof onProgress === 'function' ? onProgress : () => {};
        this._progressData = this._createProgressData();
    }

    async importDictionary(
        dictionaryDatabase: DictionaryDB,
        archiveContent: ArrayBuffer,
        details: DictionaryImporter.ImportDetails,
    ): Promise<DictionaryImporter.ImportResult> {
        if (!dictionaryDatabase) {
            throw new Error('Invalid database');
        }
        if (!dictionaryDatabase.isOpen) {
            throw new Error('Database is not ready');
        }

        const errors: Error[] = [];
        const maxTransactionLength = 1000;
        const bulkAddProgressAllowance = 1000;

        const bulkAdd = async (
            objectStoreName: DictionaryDatabase.ObjectStoreName,
            entries: unknown[],
        ): Promise<void> => {
            const entryCount = entries.length;

            let progressIndexIncrease = bulkAddProgressAllowance / Math.ceil(entryCount / maxTransactionLength);
            if (entryCount < maxTransactionLength) {
                progressIndexIncrease = bulkAddProgressAllowance;
            }
            if (entryCount === 0) {
                this._progressData.index += progressIndexIncrease;
            }

            for (let i = 0; i < entryCount; i += maxTransactionLength) {
                const count = Math.min(maxTransactionLength, entryCount - i);

                try {
                    await dictionaryDatabase.bulkAdd(objectStoreName, entries, i, count);
                } catch (e) {
                    errors.push(toError(e));
                }

                this._progressData.index += progressIndexIncrease;
                this._progress();
            }
        };

        this._progressReset();

        // Read archive
        const fileMap = await this._getFilesFromArchive(archiveContent);
        const index = await this._readAndValidateIndex(fileMap);

        const dictionaryTitle = index.title;
        const version = (
            typeof index.format === 'number' ? index.format : index.version
        ) as DictionaryData.IndexVersion;

        // Verify database is not already imported
        if (await dictionaryDatabase.dictionaryExists(dictionaryTitle)) {
            return {
                errors: [new Error(`Dictionary ${dictionaryTitle} is already imported, skipped it.`)],
                result: null,
            };
        }

        // Load schemas
        this._progressNextStep(0);
        const dataBankSchemas = this._getDataBankSchemas(version);

        // Files
        const queryDetails: DictionaryImporter.QueryDetails = [
            ['termFiles', /^term_bank_(\d+)\.json$/],
            ['termMetaFiles', /^term_meta_bank_(\d+)\.json$/],
            ['kanjiFiles', /^kanji_bank_(\d+)\.json$/],
            ['kanjiMetaFiles', /^kanji_meta_bank_(\d+)\.json$/],
            ['tagFiles', /^tag_bank_(\d+)\.json$/],
        ];
        const archiveFiles = Object.fromEntries(this._getArchiveFiles(fileMap, queryDetails));
        const termFiles = archiveFiles.termFiles as Entry[];
        const termMetaFiles = archiveFiles.termMetaFiles as Entry[];
        const kanjiFiles = archiveFiles.kanjiFiles as Entry[];
        const kanjiMetaFiles = archiveFiles.kanjiMetaFiles as Entry[];
        const tagFiles = archiveFiles.tagFiles as Entry[];

        // Load data
        const prefixWildcardsSupported = !!details.prefixWildcardsSupported;

        this._progressNextStep(
            termFiles.length + termMetaFiles.length + kanjiFiles.length + kanjiMetaFiles.length + tagFiles.length,
        );

        for (const termFile of termFiles) {
            await this._validateFile(termFile, dataBankSchemas[0]);
        }
        for (const termMetaFile of termMetaFiles) {
            await this._validateFile(termMetaFile, dataBankSchemas[1]);
        }
        for (const kanjiFile of kanjiFiles) {
            await this._validateFile(kanjiFile, dataBankSchemas[2]);
        }
        for (const kanjiMetaFile of kanjiMetaFiles) {
            await this._validateFile(kanjiMetaFile, dataBankSchemas[3]);
        }
        for (const tagFile of tagFiles) {
            await this._validateFile(tagFile, dataBankSchemas[4]);
        }

        // termFiles is doubled due to media importing
        this._progressNextStep(
            (termFiles.length * 2 +
                termMetaFiles.length +
                kanjiFiles.length +
                kanjiMetaFiles.length +
                tagFiles.length) *
                bulkAddProgressAllowance,
        );

        let importSuccess = false;

        const counts: DictionaryImporter.SummaryCounts = {
            terms: { total: 0 },
            termMeta: { total: 0 },
            kanji: { total: 0 },
            kanjiMeta: { total: 0 },
            tagMeta: { total: 0 },
            media: { total: 0 },
        };

        const yomitanVersion = details.yomitanVersion;
        let summaryDetails: DictionaryImporter.SummaryDetails = {
            prefixWildcardsSupported,
            counts,
            styles: '',
            yomitanVersion,
            importSuccess,
        };

        let summary = this._createSummary(dictionaryTitle, version, index, summaryDetails);
        const primaryKey = await dictionaryDatabase.addWithResult('dictionaries', summary);

        try {
            const uniqueMediaPaths = new Set<string>();
            for (const termFile of termFiles) {
                const requirements: DictionaryImporter.ImportRequirement[] = [];
                let termList = await (version === 1
                    ? this._readFileSequence<DictionaryData.TermV1, DictionaryDatabase.DatabaseTermEntry>(
                          [termFile],
                          this._convertTermBankEntryV1.bind(this),
                          dictionaryTitle,
                      )
                    : this._readFileSequence<DictionaryData.TermV3, DictionaryDatabase.DatabaseTermEntry>(
                          [termFile],
                          this._convertTermBankEntryV3.bind(this),
                          dictionaryTitle,
                      ));

                // Prefix wildcard support
                if (prefixWildcardsSupported) {
                    for (const entry of termList) {
                        entry.expressionReverse = stringReverse(entry.expression);
                        entry.readingReverse = stringReverse(entry.reading);
                    }
                }

                // Extended data support
                for (let i = 0, ii = termList.length; i < ii; ++i) {
                    const entry = termList[i];
                    const glossaryList = entry.glossary;
                    for (let j = 0, jj = glossaryList.length; j < jj; ++j) {
                        const glossary = glossaryList[j];
                        if (typeof glossary !== 'object' || glossary === null || Array.isArray(glossary)) {
                            continue;
                        }
                        glossaryList[j] = this._formatDictionaryTermGlossaryObject(
                            glossary as
                                | DictionaryData.TermGlossaryText
                                | DictionaryData.TermGlossaryImage
                                | DictionaryData.TermGlossaryStructuredContent,
                            entry,
                            requirements,
                        );
                    }
                }

                const alreadyAddedRequirements = requirements.filter((x) => {
                    return uniqueMediaPaths.has(x.source.path);
                });
                const notAddedRequirements = requirements.filter((x) => {
                    return !uniqueMediaPaths.has(x.source.path);
                });
                for (const requirement of requirements) {
                    uniqueMediaPaths.add(requirement.source.path);
                }

                await this._resolveAsyncRequirements(alreadyAddedRequirements, fileMap); // already added must also be resolved for the term dict to have correct data
                let { media } = await this._resolveAsyncRequirements(notAddedRequirements, fileMap);
                await bulkAdd('media', media);
                counts.media.total += media.length;

                this._progress();

                await bulkAdd('terms', termList);
                counts.terms.total += termList.length;

                this._progress();

                termList = [];
                media = [];
            }

            for (const termMetaFile of termMetaFiles) {
                let termMetaList = await this._readFileSequence<
                    DictionaryData.TermMeta,
                    DictionaryDatabase.DatabaseTermMeta
                >([termMetaFile], this._convertTermMetaBankEntry.bind(this), dictionaryTitle);

                await bulkAdd('termMeta', termMetaList);
                for (const [key, value] of Object.entries(this._getMetaCounts(termMetaList))) {
                    if (key in counts.termMeta) {
                        counts.termMeta[key] += value;
                    } else {
                        counts.termMeta[key] = value;
                    }
                }

                this._progress();

                termMetaList = [];
            }

            for (const kanjiFile of kanjiFiles) {
                let kanjiList = await (version === 1
                    ? this._readFileSequence<DictionaryData.KanjiV1, DictionaryDatabase.DatabaseKanjiEntry>(
                          [kanjiFile],
                          this._convertKanjiBankEntryV1.bind(this),
                          dictionaryTitle,
                      )
                    : this._readFileSequence<DictionaryData.KanjiV3, DictionaryDatabase.DatabaseKanjiEntry>(
                          [kanjiFile],
                          this._convertKanjiBankEntryV3.bind(this),
                          dictionaryTitle,
                      ));

                await bulkAdd('kanji', kanjiList);
                counts.kanji.total += kanjiList.length;

                this._progress();

                kanjiList = [];
            }

            for (const kanjiMetaFile of kanjiMetaFiles) {
                let kanjiMetaList = await this._readFileSequence<
                    DictionaryData.KanjiMeta,
                    DictionaryDatabase.DatabaseKanjiMeta
                >([kanjiMetaFile], this._convertKanjiMetaBankEntry.bind(this), dictionaryTitle);

                await bulkAdd('kanjiMeta', kanjiMetaList);
                for (const [key, value] of Object.entries(this._getMetaCounts(kanjiMetaList))) {
                    if (key in counts.kanjiMeta) {
                        counts.kanjiMeta[key] += value;
                    } else {
                        counts.kanjiMeta[key] = value;
                    }
                }

                this._progress();

                kanjiMetaList = [];
            }

            for (const tagFile of tagFiles) {
                let tagList = await this._readFileSequence<DictionaryData.Tag, DictionaryDatabase.Tag>(
                    [tagFile],
                    this._convertTagBankEntry.bind(this),
                    dictionaryTitle,
                );
                this._addOldIndexTags(index, tagList, dictionaryTitle);

                await bulkAdd('tagMeta', tagList);
                counts.tagMeta.total += tagList.length;

                this._progress();

                tagList = [];
            }

            importSuccess = true;
        } catch (e) {
            errors.push(toError(e));
        }

        // Update dictionary descriptor
        this._progressNextStep(0);

        const stylesFileName = 'styles.css';
        const stylesFile = fileMap.get(stylesFileName);
        let styles = '';
        if (typeof stylesFile !== 'undefined') {
            styles = await this._getData(stylesFile as Entry, new TextWriter());
            const cssErrors = this._validateCss(styles);
            if (cssErrors.length > 0) {
                return {
                    errors: cssErrors,
                    result: null,
                };
            }
        }

        summaryDetails = { prefixWildcardsSupported, counts, styles, yomitanVersion, importSuccess };
        summary = this._createSummary(dictionaryTitle, version, index, summaryDetails);
        await dictionaryDatabase.bulkUpdate('dictionaries', [{ data: summary, primaryKey }], 0, 1);

        this._progress();

        return { result: summary, errors };
    }

    // Archive reading

    private async _getFilesFromArchive(archiveContent: ArrayBuffer): Promise<DictionaryImporter.ArchiveFileMap> {
        const zipFileReader = new Uint8ArrayReader(new Uint8Array(archiveContent));
        const zipReader = new ZipReader(zipFileReader, { useWebWorkers: false });
        const zipEntries = await zipReader.getEntries();
        const fileMap: DictionaryImporter.ArchiveFileMap = new Map();
        for (const entry of zipEntries) {
            fileMap.set(entry.filename, entry);
        }
        return fileMap;
    }

    private _findRedundantDirectories(fileMap: DictionaryImporter.ArchiveFileMap): string | null {
        let indexPath = '';
        for (const file of fileMap) {
            if (file[0].replace(/.*\//, '') === INDEX_FILE_NAME) {
                indexPath = file[0];
            }
        }
        const redundantDirectoriesRegex = new RegExp(`.*(?=${INDEX_FILE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`);
        const redundantDirectories = indexPath.match(redundantDirectoriesRegex);
        return redundantDirectories ? redundantDirectories[0] : null;
    }

    private async _readAndValidateIndex(fileMap: DictionaryImporter.ArchiveFileMap): Promise<DictionaryData.Index> {
        const indexFile = fileMap.get(INDEX_FILE_NAME);
        if (typeof indexFile === 'undefined') {
            const redundantDirectories = this._findRedundantDirectories(fileMap);
            if (redundantDirectories) {
                throw new Error(
                    `Dictionary index found nested in redundant directories: "${redundantDirectories}" when it must be in the archive\'s root directory`,
                );
            }
            throw new Error('No dictionary index found in archive');
        }

        const indexContent = await this._getData(indexFile as Entry, new TextWriter());
        const index: unknown = parseJson(indexContent);

        const ajvSchemas = getSchemaValidators();
        if (!ajvSchemas.dictionaryIndex(index)) {
            throw this._formatAjvSchemaError(ajvSchemas.dictionaryIndex, INDEX_FILE_NAME);
        }

        const validIndex = index as DictionaryData.Index;

        const version = typeof validIndex.format === 'number' ? validIndex.format : validIndex.version;
        validIndex.version = version;

        const { title, revision } = validIndex;
        if (typeof version !== 'number' || !title || !revision) {
            throw new Error('Unrecognized dictionary format');
        }

        return validIndex;
    }

    // Progress tracking

    private _createProgressData(): DictionaryImporter.ProgressData {
        return {
            index: 0,
            count: 0,
        };
    }

    private _progressReset(): void {
        this._progressData = this._createProgressData();
        this._progress(true);
    }

    private _progressNextStep(count: number): void {
        this._progressData.index = 0;
        this._progressData.count = count;
        this._progress(true);
    }

    private _progress(nextStep = false): void {
        this._onProgress({ ...this._progressData, nextStep });
    }

    // Summary creation

    private _createSummary(
        dictionaryTitle: string,
        version: number,
        index: DictionaryData.Index,
        details: DictionaryImporter.SummaryDetails,
    ): DictionaryImporter.Summary {
        const indexSequenced = index.sequenced;
        const { prefixWildcardsSupported, counts, styles, importSuccess } = details;
        const summary: DictionaryImporter.Summary = {
            title: dictionaryTitle,
            revision: index.revision,
            sequenced: typeof indexSequenced === 'boolean' && indexSequenced,
            version,
            importDate: Date.now(),
            prefixWildcardsSupported,
            counts,
            styles,
            importSuccess,
        };

        const {
            minimumYomitanVersion,
            author,
            url,
            description,
            attribution,
            frequencyMode,
            isUpdatable,
            sourceLanguage,
            targetLanguage,
        } = index;
        if (typeof minimumYomitanVersion === 'string') {
            if (details.yomitanVersion === '0.0.0.0') {
                // Running a development version
            } else if (compareRevisions(details.yomitanVersion, minimumYomitanVersion)) {
                throw new Error(
                    `Dictionary is incompatible with this version of Yomitan (${details.yomitanVersion}; minimum required: ${minimumYomitanVersion})`,
                );
            }
            summary.minimumYomitanVersion = minimumYomitanVersion;
        }
        if (typeof author === 'string') {
            summary.author = author;
        }
        if (typeof url === 'string') {
            summary.url = url;
        }
        if (typeof description === 'string') {
            summary.description = description;
        }
        if (typeof attribution === 'string') {
            summary.attribution = attribution;
        }
        if (typeof frequencyMode === 'string') {
            summary.frequencyMode = frequencyMode;
        }
        if (typeof sourceLanguage === 'string') {
            summary.sourceLanguage = sourceLanguage;
        }
        if (typeof targetLanguage === 'string') {
            summary.targetLanguage = targetLanguage;
        }
        if (typeof isUpdatable === 'boolean') {
            const { indexUrl, downloadUrl } = index;
            if (!isUpdatable || !this._validateUrl(indexUrl) || !this._validateUrl(downloadUrl)) {
                throw new Error('Invalid index data for updatable dictionary');
            }
            summary.isUpdatable = isUpdatable;
            summary.indexUrl = indexUrl;
            summary.downloadUrl = downloadUrl;
        }
        return summary;
    }

    private _validateUrl(string: string | undefined): boolean {
        if (typeof string !== 'string') {
            return false;
        }
        let url;
        try {
            url = new URL(string);
        } catch (_) {
            return false;
        }
        return url.protocol === 'http:' || url.protocol === 'https:';
    }

    // Schema validation

    private _formatAjvSchemaError(schema: import('ajv').ValidateFunction, fileName: string): YomitanError {
        const e = new YomitanError(`Dictionary has invalid data in '${fileName}' '${JSON.stringify(schema.errors)}'`);
        e.data = schema.errors;
        return e;
    }

    private _getDataBankSchemas(version: number): DictionaryImporter.CompiledSchemaNameArray {
        const termBank: DictionaryImporter.CompiledSchemaName =
            version === 1 ? 'dictionaryTermBankV1' : 'dictionaryTermBankV3';
        const termMetaBank: DictionaryImporter.CompiledSchemaName = 'dictionaryTermMetaBankV3';
        const kanjiBank: DictionaryImporter.CompiledSchemaName =
            version === 1 ? 'dictionaryKanjiBankV1' : 'dictionaryKanjiBankV3';
        const kanjiMetaBank: DictionaryImporter.CompiledSchemaName = 'dictionaryKanjiMetaBankV3';
        const tagBank: DictionaryImporter.CompiledSchemaName = 'dictionaryTagBankV3';

        return [termBank, termMetaBank, kanjiBank, kanjiMetaBank, tagBank];
    }

    private _validateCss(css: string): Error[] {
        return css ? [] : [new Error('No styles found')];
    }

    // Term glossary formatting

    private _formatDictionaryTermGlossaryObject(
        data:
            | DictionaryData.TermGlossaryText
            | DictionaryData.TermGlossaryImage
            | DictionaryData.TermGlossaryStructuredContent,
        entry: DictionaryDatabase.DatabaseTermEntry,
        requirements: DictionaryImporter.ImportRequirement[],
    ): DictionaryData.TermGlossary {
        switch (data.type) {
            case 'text':
                return data.text;
            case 'image':
                return this._formatDictionaryTermGlossaryImage(data, entry, requirements);
            case 'structured-content':
                return this._formatStructuredContent(data, entry, requirements);
            default:
                throw new Error(`Unhandled data type: ${(data as { type: string }).type}`);
        }
    }

    private _formatDictionaryTermGlossaryImage(
        data: DictionaryData.TermGlossaryImage,
        entry: DictionaryDatabase.DatabaseTermEntry,
        requirements: DictionaryImporter.ImportRequirement[],
    ): DictionaryData.TermGlossaryImage {
        const target: DictionaryData.TermGlossaryImage = {
            type: 'image',
            path: '', // Will be populated during requirement resolution
        };
        requirements.push({ type: 'image', target, source: data, entry });
        return target;
    }

    private _formatStructuredContent(
        data: DictionaryData.TermGlossaryStructuredContent,
        entry: DictionaryDatabase.DatabaseTermEntry,
        requirements: DictionaryImporter.ImportRequirement[],
    ): DictionaryData.TermGlossaryStructuredContent {
        const content = this._prepareStructuredContent(data.content, entry, requirements);
        return {
            type: 'structured-content',
            content,
        };
    }

    private _prepareStructuredContent(
        content: StructuredContent.Content,
        entry: DictionaryDatabase.DatabaseTermEntry,
        requirements: DictionaryImporter.ImportRequirement[],
    ): StructuredContent.Content {
        if (typeof content === 'string' || !(typeof content === 'object' && content !== null)) {
            return content;
        }
        if (Array.isArray(content)) {
            for (let i = 0, ii = content.length; i < ii; ++i) {
                content[i] = this._prepareStructuredContent(content[i], entry, requirements);
            }
            return content;
        }
        const { tag } = content;
        switch (tag) {
            case 'img':
                return this._prepareStructuredContentImage(
                    content as StructuredContent.ImageElement,
                    entry,
                    requirements,
                );
        }
        const childContent = content.content;
        if (typeof childContent !== 'undefined') {
            content.content = this._prepareStructuredContent(childContent, entry, requirements);
        }
        return content;
    }

    private _prepareStructuredContentImage(
        content: StructuredContent.ImageElement,
        entry: DictionaryDatabase.DatabaseTermEntry,
        requirements: DictionaryImporter.ImportRequirement[],
    ): StructuredContent.ImageElement {
        const target: StructuredContent.ImageElement = {
            tag: 'img',
            path: '', // Will be populated during requirement resolution
        };
        requirements.push({ type: 'structured-content-image', target, source: content, entry });
        return target;
    }

    // Async requirement resolution

    private async _resolveAsyncRequirements(
        requirements: DictionaryImporter.ImportRequirement[],
        fileMap: DictionaryImporter.ArchiveFileMap,
    ): Promise<{ media: DictionaryDatabase.MediaDataArrayBufferContent[] }> {
        const media = new Map<string, DictionaryDatabase.MediaDataArrayBufferContent>();
        const context: DictionaryImporter.ImportRequirementContext = { fileMap, media };

        for (const requirement of requirements) {
            await this._resolveAsyncRequirement(context, requirement);
        }

        return {
            media: [...media.values()],
        };
    }

    private async _resolveAsyncRequirement(
        context: DictionaryImporter.ImportRequirementContext,
        requirement: DictionaryImporter.ImportRequirement,
    ): Promise<void> {
        switch (requirement.type) {
            case 'image':
                await this._resolveDictionaryTermGlossaryImage(
                    context,
                    requirement.target,
                    requirement.source,
                    requirement.entry,
                );
                break;
            case 'structured-content-image':
                await this._resolveStructuredContentImage(
                    context,
                    requirement.target,
                    requirement.source,
                    requirement.entry,
                );
                break;
            default:
                return;
        }
    }

    private async _resolveDictionaryTermGlossaryImage(
        context: DictionaryImporter.ImportRequirementContext,
        target: DictionaryData.TermGlossaryImage,
        source: DictionaryData.TermGlossaryImage,
        entry: DictionaryDatabase.DatabaseTermEntry,
    ): Promise<void> {
        await this._createImageData(context, target, source, entry);
    }

    private async _resolveStructuredContentImage(
        context: DictionaryImporter.ImportRequirementContext,
        target: StructuredContent.ImageElement,
        source: StructuredContent.ImageElement,
        entry: DictionaryDatabase.DatabaseTermEntry,
    ): Promise<void> {
        const { verticalAlign, border, borderRadius, sizeUnits } = source;
        await this._createImageData(context, target, source, entry);
        if (typeof verticalAlign === 'string') {
            target.verticalAlign = verticalAlign;
        }
        if (typeof border === 'string') {
            target.border = border;
        }
        if (typeof borderRadius === 'string') {
            target.borderRadius = borderRadius;
        }
        if (typeof sizeUnits === 'string') {
            target.sizeUnits = sizeUnits;
        }
    }

    private async _createImageData(
        context: DictionaryImporter.ImportRequirementContext,
        target: StructuredContent.ImageElementBase,
        source: StructuredContent.ImageElementBase,
        entry: DictionaryDatabase.DatabaseTermEntry,
    ): Promise<void> {
        const {
            path,
            width: preferredWidth,
            height: preferredHeight,
            title,
            alt,
            description,
            pixelated,
            imageRendering,
            appearance,
            background,
            collapsed,
            collapsible,
        } = source;
        const { width, height } = await this._getImageMedia(context, path, entry);
        target.path = path;
        target.width = width;
        target.height = height;
        if (typeof preferredWidth === 'number') {
            target.preferredWidth = preferredWidth;
        }
        if (typeof preferredHeight === 'number') {
            target.preferredHeight = preferredHeight;
        }
        if (typeof title === 'string') {
            target.title = title;
        }
        if (typeof alt === 'string') {
            target.alt = alt;
        }
        if (typeof description === 'string') {
            target.description = description;
        }
        if (typeof pixelated === 'boolean') {
            target.pixelated = pixelated;
        }
        if (typeof imageRendering === 'string') {
            target.imageRendering = imageRendering;
        }
        if (typeof appearance === 'string') {
            target.appearance = appearance;
        }
        if (typeof background === 'boolean') {
            target.background = background;
        }
        if (typeof collapsed === 'boolean') {
            target.collapsed = collapsed;
        }
        if (typeof collapsible === 'boolean') {
            target.collapsible = collapsible;
        }
    }

    private async _getImageMedia(
        context: DictionaryImporter.ImportRequirementContext,
        path: string,
        entry: DictionaryDatabase.DatabaseTermEntry,
    ): Promise<DictionaryDatabase.MediaDataArrayBufferContent> {
        const { media } = context;
        const { dictionary } = entry;

        const createError = (message: string): Error => {
            const { expression, reading } = entry;
            const readingSource = reading.length > 0 ? ` (${reading})` : '';
            return new Error(
                `${message} at path ${JSON.stringify(path)} for ${expression}${readingSource} in ${dictionary}`,
            );
        };

        // Check if already added
        let mediaData = media.get(path);
        if (typeof mediaData !== 'undefined') {
            if (getFileExtensionFromImageMediaType(mediaData.mediaType) === null) {
                throw createError('Media file is not a valid image');
            }
            return mediaData;
        }

        // Find file in archive
        const file = context.fileMap.get(path);
        if (typeof file === 'undefined') {
            throw createError('Could not find image');
        }

        // Load file content
        let content = await (await this._getData(file as Entry, new BlobWriter())).arrayBuffer();

        const mediaType = getImageMediaTypeFromFileName(path);
        if (mediaType === null) {
            throw createError('Could not determine media type for image');
        }

        // Load image data
        let width: number;
        let height: number;
        try {
            ({ content, width, height } = await this._mediaLoader.getImageDetails(content, mediaType));
        } catch (e) {
            throw createError('Could not load image');
        }

        // Create image data
        mediaData = {
            dictionary,
            path,
            mediaType,
            width,
            height,
            content,
        };
        media.set(path, mediaData);

        return mediaData;
    }

    // Bank entry converters

    private _convertTermBankEntryV1(
        entry: DictionaryData.TermV1,
        dictionary: string,
    ): DictionaryDatabase.DatabaseTermEntry {
        let [expression, reading, definitionTags, rules, score, ...glossary] = entry;
        reading = reading.length > 0 ? reading : expression;
        return { expression, reading, definitionTags, rules, score, glossary, dictionary };
    }

    private _convertTermBankEntryV3(
        entry: DictionaryData.TermV3,
        dictionary: string,
    ): DictionaryDatabase.DatabaseTermEntry {
        let [expression, reading, definitionTags, rules, score, glossary, sequence, termTags] = entry;
        reading = reading.length > 0 ? reading : expression;
        return { expression, reading, definitionTags, rules, score, glossary, sequence, termTags, dictionary };
    }

    private _convertTermMetaBankEntry(
        entry: DictionaryData.TermMeta,
        dictionary: string,
    ): DictionaryDatabase.DatabaseTermMeta {
        const [expression, mode, data] = entry;
        return { expression, mode, data, dictionary } as DictionaryDatabase.DatabaseTermMeta;
    }

    private _convertKanjiBankEntryV1(
        entry: DictionaryData.KanjiV1,
        dictionary: string,
    ): DictionaryDatabase.DatabaseKanjiEntry {
        const [character, onyomi, kunyomi, tags, ...meanings] = entry;
        return { character, onyomi, kunyomi, tags, meanings, dictionary };
    }

    private _convertKanjiBankEntryV3(
        entry: DictionaryData.KanjiV3,
        dictionary: string,
    ): DictionaryDatabase.DatabaseKanjiEntry {
        const [character, onyomi, kunyomi, tags, meanings, stats] = entry;
        return { character, onyomi, kunyomi, tags, meanings, stats, dictionary };
    }

    private _convertKanjiMetaBankEntry(
        entry: DictionaryData.KanjiMeta,
        dictionary: string,
    ): DictionaryDatabase.DatabaseKanjiMeta {
        const [character, mode, data] = entry;
        return { character, mode, data, dictionary };
    }

    private _convertTagBankEntry(entry: DictionaryData.Tag, dictionary: string): DictionaryDatabase.Tag {
        const [name, category, order, notes, score] = entry;
        return { name, category, order, notes, score, dictionary };
    }

    private _addOldIndexTags(index: DictionaryData.Index, results: DictionaryDatabase.Tag[], dictionary: string): void {
        const { tagMeta } = index;
        if (typeof tagMeta !== 'object' || tagMeta === null) {
            return;
        }
        for (const [name, value] of Object.entries(tagMeta)) {
            const { category, order, notes, score } = value;
            results.push({ name, category, order, notes, score, dictionary });
        }
    }

    // Archive file helpers

    private _getArchiveFiles(
        fileMap: DictionaryImporter.ArchiveFileMap,
        queryDetails: DictionaryImporter.QueryDetails,
    ): DictionaryImporter.QueryResult {
        const results: DictionaryImporter.QueryResult = new Map();

        for (const [fileType] of queryDetails) {
            results.set(fileType, []);
        }

        for (const [fileName, fileEntry] of fileMap.entries()) {
            for (const [fileType, fileNameFormat] of queryDetails) {
                if (!fileNameFormat.test(fileName)) {
                    continue;
                }
                const entries = results.get(fileType);

                if (typeof entries !== 'undefined') {
                    entries.push(fileEntry);
                    break;
                }
            }
        }
        return results;
    }

    private async _readFileSequence<TEntry = unknown, TResult = unknown>(
        files: Entry[],
        convertEntry: (entry: TEntry, dictionaryTitle: string) => TResult,
        dictionaryTitle: string,
    ): Promise<TResult[]> {
        const results: TResult[] = [];
        for (const file of files) {
            const content = await this._getData(file, new TextWriter());
            let entries: unknown;

            try {
                entries = parseJson(content);
            } catch (error) {
                if (error instanceof Error) {
                    throw new Error(`${error.message} in '${file.filename}'`);
                }
            }

            if (Array.isArray(entries)) {
                for (const entry of entries as TEntry[]) {
                    results.push(convertEntry(entry, dictionaryTitle));
                }
            }
        }
        return results;
    }

    private async _validateFile(file: Entry, schemaName: DictionaryImporter.CompiledSchemaName): Promise<boolean> {
        const content = await this._getData(file, new TextWriter());
        let entries: unknown;

        try {
            entries = parseJson(content);
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`${error.message} in '${file.filename}'`);
            }
        }

        const ajvSchemas = getSchemaValidators();
        const schema = ajvSchemas[schemaName];
        if (!schema(entries)) {
            throw this._formatAjvSchemaError(schema, file.filename);
        }

        ++this._progressData.index;
        this._progress();

        return true;
    }

    // Meta counts

    private _getMetaCounts(
        metaList: DictionaryDatabase.DatabaseTermMeta[] | DictionaryDatabase.DatabaseKanjiMeta[],
    ): DictionaryImporter.SummaryMetaCount {
        const countsMap = new Map<string, number>();
        for (const { mode } of metaList) {
            let count = countsMap.get(mode);
            count = typeof count !== 'undefined' ? count + 1 : 1;
            countsMap.set(mode, count);
        }
        const counts: DictionaryImporter.SummaryMetaCount = { total: metaList.length };
        for (const [key, value] of countsMap.entries()) {
            if (Object.prototype.hasOwnProperty.call(counts, key)) {
                continue;
            }
            counts[key] = value;
        }
        return counts;
    }

    // Data extraction

    private async _getData<T = unknown>(entry: Entry, writer: Writer<T> | WritableWriter): Promise<T> {
        if (typeof (entry as any).getData === 'undefined') {
            throw new Error(`Cannot read ${entry.filename}`);
        }
        return await (entry as any).getData(writer);
    }
}
