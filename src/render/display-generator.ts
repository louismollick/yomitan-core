/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2019-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { distributeFurigana } from '../language/ja/furigana.js';
import { getLanguageFromText } from '../language/text-utilities.js';
import type * as DictionaryDataUtil from '../types/dictionary-data-util.js';
import type * as DictionaryData from '../types/dictionary-data.js';
import type * as DictionaryImporter from '../types/dictionary-importer.js';
import type * as Dictionary from '../types/dictionary.js';
import type * as StructuredContent from '../types/structured-content.js';
import {
    getDisambiguations,
    getGroupedPronunciations,
    getTermFrequency,
    groupKanjiFrequencies,
    groupTermFrequencies,
    groupTermTags,
    isNonNounVerbOrAdjective,
} from '../util/dictionary-data-util.js';
import type { ContentManager } from './content-manager.js';
import { HtmlTemplateCollection } from './html-template-collection.js';
import { getKanaMorae, getPitchCategory, isCodePointKanji } from './japanese-util.js';
import type { PitchCategory } from './japanese-util.js';
import { PronunciationGenerator } from './pronunciation-generator.js';
import { StructuredContentGenerator } from './structured-content-generator.js';

/**
 * Generates DOM elements for displaying dictionary entries.
 * This is the main rendering class that creates term entries, kanji entries,
 * and all associated sub-elements (headwords, definitions, tags, frequencies, etc.).
 */
export class DisplayGenerator {
    private _contentManager: ContentManager;
    private _templates: HtmlTemplateCollection;
    private _structuredContentGenerator: StructuredContentGenerator;
    private _pronunciationGenerator: PronunciationGenerator;
    private _language: string;
    private _document: Document;

    /**
     * Creates a new DisplayGenerator.
     * @param doc - The Document object to use for DOM operations.
     * @param contentManager - The content manager for loading media.
     * @param templateHtml - The HTML string containing display templates.
     */
    constructor(doc: Document, contentManager: ContentManager, templateHtml: string) {
        this._document = doc;
        this._contentManager = contentManager;
        this._templates = new HtmlTemplateCollection(doc);
        this._templates.loadFromString(templateHtml);
        this._structuredContentGenerator = new StructuredContentGenerator(this._contentManager, doc);
        this._pronunciationGenerator = new PronunciationGenerator(doc);
        this._language = 'ja';
    }

    /** The current content manager. */
    get contentManager(): ContentManager {
        return this._contentManager;
    }

    set contentManager(contentManager: ContentManager) {
        this._contentManager = contentManager;
    }

    /**
     * Updates the target language for rendering.
     * @param language - The BCP 47 language tag (e.g. 'ja', 'zh').
     */
    updateLanguage(language: string): void {
        this._language = language;
    }

    /**
     * Creates a complete term entry element from a dictionary entry.
     * @param dictionaryEntry - The term dictionary entry data.
     * @param dictionaryInfo - Array of dictionary summary information.
     * @returns An HTMLElement representing the full term entry.
     */
    createTermEntry(
        dictionaryEntry: Dictionary.TermDictionaryEntry,
        dictionaryInfo: DictionaryImporter.Summary[],
    ): HTMLElement {
        const node = this._instantiate('term-entry');

        const headwordsContainer = this._querySelector(node, '.headword-list');
        const inflectionRuleChainsContainer = this._querySelector(node, '.inflection-rule-chains');
        const groupedPronunciationsContainer = this._querySelector(node, '.pronunciation-group-list');
        const frequencyGroupListContainer = this._querySelector(node, '.frequency-group-list');
        const definitionsContainer = this._querySelector(node, '.definition-list');
        const headwordTagsContainer = this._querySelector(node, '.headword-list-tag-list');

        const { headwords, type, inflectionRuleChainCandidates, definitions, frequencies, pronunciations } =
            dictionaryEntry;
        const groupedPronunciations = getGroupedPronunciations(dictionaryEntry);
        const pronunciationCount = groupedPronunciations.reduce((i, v) => i + v.pronunciations.length, 0);
        const groupedFrequencies = groupTermFrequencies(dictionaryEntry, dictionaryInfo);
        const termTags = groupTermTags(dictionaryEntry);

        const uniqueTerms = new Set<string>();
        const uniqueReadings = new Set<string>();
        const primaryMatchTypes = new Set<Dictionary.TermSourceMatchType>();
        for (const { term, reading, sources } of headwords) {
            uniqueTerms.add(term);
            uniqueReadings.add(reading);
            for (const { matchType, isPrimary } of sources) {
                if (!isPrimary) {
                    continue;
                }
                primaryMatchTypes.add(matchType);
            }
        }

        node.dataset.format = type;
        node.dataset.headwordCount = `${headwords.length}`;
        node.dataset.definitionCount = `${definitions.length}`;
        node.dataset.pronunciationDictionaryCount = `${groupedPronunciations.length}`;
        node.dataset.pronunciationCount = `${pronunciationCount}`;
        node.dataset.uniqueTermCount = `${uniqueTerms.size}`;
        node.dataset.uniqueReadingCount = `${uniqueReadings.size}`;
        node.dataset.frequencyCount = `${frequencies.length}`;
        node.dataset.groupedFrequencyCount = `${groupedFrequencies.length}`;
        node.dataset.primaryMatchTypes = [...primaryMatchTypes].join(' ');

        for (let i = 0, ii = headwords.length; i < ii; ++i) {
            const node2 = this._createTermHeadword(headwords[i], i, pronunciations);
            node2.dataset.index = `${i}`;
            headwordsContainer.appendChild(node2);
        }
        headwordsContainer.dataset.count = `${headwords.length}`;

        this._appendMultiple(
            inflectionRuleChainsContainer,
            this._createInflectionRuleChain.bind(this),
            inflectionRuleChainCandidates,
        );
        this._appendMultiple(
            frequencyGroupListContainer,
            this._createFrequencyGroup.bind(this),
            groupedFrequencies,
            false,
        );
        this._appendMultiple(
            groupedPronunciationsContainer,
            this._createGroupedPronunciation.bind(this),
            groupedPronunciations,
        );
        this._appendMultiple(headwordTagsContainer, this._createTermTag.bind(this), termTags, headwords.length);

        for (const term of uniqueTerms) {
            headwordTagsContainer.appendChild(this._createSearchTag(term));
        }
        for (const reading of uniqueReadings) {
            if (uniqueTerms.has(reading)) {
                continue;
            }
            headwordTagsContainer.appendChild(this._createSearchTag(reading));
        }

        // Add definitions
        const dictionaryTag = this._createDictionaryTag('');
        for (let i = 0, ii = definitions.length; i < ii; ++i) {
            const definition = definitions[i];
            const { dictionary, dictionaryAlias } = definition;

            if (dictionaryTag.dictionaries.includes(dictionary)) {
                dictionaryTag.redundant = true;
            } else {
                dictionaryTag.redundant = false;
                dictionaryTag.dictionaries.push(dictionary);
                dictionaryTag.name = dictionaryAlias;
                dictionaryTag.content = [dictionary];

                const currentDictionaryInfo = dictionaryInfo.find(({ title }) => title === dictionary);
                if (currentDictionaryInfo) {
                    const dictionaryContentArray: string[] = [];
                    dictionaryContentArray.push(currentDictionaryInfo.title);
                    if (currentDictionaryInfo.author) {
                        dictionaryContentArray.push(`Author: ${currentDictionaryInfo.author}`);
                    }
                    if (currentDictionaryInfo.description) {
                        dictionaryContentArray.push(`Description: ${currentDictionaryInfo.description}`);
                    }
                    if (currentDictionaryInfo.url) {
                        dictionaryContentArray.push(`URL: ${currentDictionaryInfo.url}`);
                    }

                    const totalTerms = currentDictionaryInfo?.counts?.terms?.total;
                    if (totalTerms !== undefined && totalTerms > 0) {
                        dictionaryContentArray.push(`Term Count: ${totalTerms.toString()}`);
                    }

                    dictionaryTag.content = dictionaryContentArray;
                }
            }

            const node2 = this._createTermDefinition(definition, dictionaryTag, headwords, uniqueTerms, uniqueReadings);
            node2.dataset.index = `${i}`;
            definitionsContainer.appendChild(node2);
        }
        definitionsContainer.dataset.count = `${definitions.length}`;

        const dictionaryScopedStyleNode = this._createDictionaryScopedStyleNode(definitions, dictionaryInfo);
        if (dictionaryScopedStyleNode !== null) {
            node.appendChild(dictionaryScopedStyleNode);
        }

        return node;
    }

    /**
     * Creates a complete kanji entry element from a dictionary entry.
     * @param dictionaryEntry - The kanji dictionary entry data.
     * @param dictionaryInfo - Array of dictionary summary information.
     * @returns An HTMLElement representing the full kanji entry.
     */
    createKanjiEntry(
        dictionaryEntry: Dictionary.KanjiDictionaryEntry,
        dictionaryInfo: DictionaryImporter.Summary[],
    ): HTMLElement {
        const node = this._instantiate('kanji-entry');
        node.dataset.dictionary = dictionaryEntry.dictionary;

        const glyphContainer = this._querySelector(node, '.kanji-glyph');
        const frequencyGroupListContainer = this._querySelector(node, '.frequency-group-list');
        const tagContainer = this._querySelector(node, '.kanji-tag-list');
        const definitionsContainer = this._querySelector(node, '.kanji-gloss-list');
        const chineseReadingsContainer = this._querySelector(node, '.kanji-readings-chinese');
        const japaneseReadingsContainer = this._querySelector(node, '.kanji-readings-japanese');
        const statisticsContainer = this._querySelector(node, '.kanji-statistics');
        const classificationsContainer = this._querySelector(node, '.kanji-classifications');
        const codepointsContainer = this._querySelector(node, '.kanji-codepoints');
        const dictionaryIndicesContainer = this._querySelector(node, '.kanji-dictionary-indices');

        this._setTextContent(glyphContainer, dictionaryEntry.character, this._language);
        if (this._language === 'ja') {
            glyphContainer.style.fontFamily = 'kanji-stroke-orders, sans-serif';
        }
        const groupedFrequencies = groupKanjiFrequencies(dictionaryEntry.frequencies, dictionaryInfo);

        const dictionaryTag = this._createDictionaryTag('');
        dictionaryTag.name = dictionaryEntry.dictionaryAlias;
        dictionaryTag.content = [dictionaryEntry.dictionary];
        const currentDictionaryInfo = dictionaryInfo.find(({ title }) => title === dictionaryEntry.dictionary);
        if (currentDictionaryInfo) {
            const dictionaryContentArray: string[] = [];
            dictionaryContentArray.push(currentDictionaryInfo.title);
            if (currentDictionaryInfo.author) {
                dictionaryContentArray.push(`Author: ${currentDictionaryInfo.author}`);
            }
            if (currentDictionaryInfo.description) {
                dictionaryContentArray.push(`Description: ${currentDictionaryInfo.description}`);
            }
            if (currentDictionaryInfo.url) {
                dictionaryContentArray.push(`URL: ${currentDictionaryInfo.url}`);
            }

            const totalKanji = currentDictionaryInfo?.counts?.kanji?.total;
            if (totalKanji !== undefined && totalKanji > 0) {
                dictionaryContentArray.push(`Kanji Count: ${totalKanji.toString()}`);
            }

            dictionaryTag.content = dictionaryContentArray;
        }

        this._appendMultiple(
            frequencyGroupListContainer,
            this._createFrequencyGroup.bind(this),
            groupedFrequencies,
            true,
        );
        this._appendMultiple(tagContainer, this._createTag.bind(this), [...dictionaryEntry.tags, dictionaryTag]);
        this._appendMultiple(definitionsContainer, this._createKanjiDefinition.bind(this), dictionaryEntry.definitions);
        this._appendMultiple(chineseReadingsContainer, this._createKanjiReading.bind(this), dictionaryEntry.onyomi);
        this._appendMultiple(japaneseReadingsContainer, this._createKanjiReading.bind(this), dictionaryEntry.kunyomi);

        statisticsContainer.appendChild(this._createKanjiInfoTable(dictionaryEntry.stats.misc));
        classificationsContainer.appendChild(this._createKanjiInfoTable(dictionaryEntry.stats.class));
        codepointsContainer.appendChild(this._createKanjiInfoTable(dictionaryEntry.stats.code));
        dictionaryIndicesContainer.appendChild(this._createKanjiInfoTable(dictionaryEntry.stats.index));

        return node;
    }

    /**
     * Creates an empty footer notification element.
     */
    createEmptyFooterNotification(): HTMLElement {
        return this._instantiate('footer-notification');
    }

    /**
     * Instantiates a named template, returning the first element child.
     * @param name - The template name.
     */
    instantiateTemplate(name: string): HTMLElement {
        return this._instantiate(name);
    }

    /**
     * Instantiates a named template, returning the full DocumentFragment.
     * @param name - The template name.
     */
    instantiateTemplateFragment(name: string): DocumentFragment {
        return this._templates.instantiateFragment(name);
    }

    // Private

    private _createTermHeadword(
        headword: Dictionary.TermHeadword,
        headwordIndex: number,
        pronunciations: Dictionary.TermPronunciation[],
    ): HTMLElement {
        const { term, reading, tags, sources } = headword;

        let isPrimaryAny = false;
        const matchTypes = new Set<string>();
        const matchSources = new Set<string>();
        for (const { matchType, matchSource, isPrimary } of sources) {
            if (isPrimary) {
                isPrimaryAny = true;
            }
            matchTypes.add(matchType);
            matchSources.add(matchSource);
        }

        const node = this._instantiate('headword');

        const termContainer = this._querySelector(node, '.headword-term');

        node.dataset.isPrimary = `${isPrimaryAny}`;
        node.dataset.readingIsSame = `${reading === term}`;
        node.dataset.frequency = getTermFrequency(tags);
        node.dataset.matchTypes = [...matchTypes].join(' ');
        node.dataset.matchSources = [...matchSources].join(' ');

        const { wordClasses } = headword;
        const pronunciationCategories = this._getPronunciationCategories(
            reading,
            pronunciations,
            wordClasses,
            headwordIndex,
        );
        if (pronunciationCategories !== null) {
            node.dataset.pronunciationCategories = pronunciationCategories;
        }
        if (wordClasses.length > 0) {
            node.dataset.wordClasses = wordClasses.join(' ');
        }

        const headwordReading = this._querySelector(node, '.headword-reading');
        this._setTextContent(headwordReading, reading);

        this._appendFurigana(termContainer, term, reading, this._appendKanjiLinks.bind(this));

        return node;
    }

    private _createInflectionRuleChain(
        inflectionRuleChain: Dictionary.InflectionRuleChainCandidate,
    ): HTMLElement | null {
        const { source, inflectionRules } = inflectionRuleChain;
        if (!Array.isArray(inflectionRules) || inflectionRules.length === 0) {
            return null;
        }
        const fragment = this._instantiate('inflection-rule-chain');

        const sourceIcon = this._getInflectionSourceIcon(source);
        fragment.appendChild(sourceIcon);

        this._appendMultiple(fragment, this._createTermInflection.bind(this), inflectionRules);
        return fragment;
    }

    private _getInflectionSourceIcon(source: Dictionary.InflectionSource): HTMLElement {
        const icon = this._document.createElement('span');
        icon.classList.add('inflection-source-icon');
        icon.dataset.inflectionSource = source;
        switch (source) {
            case 'dictionary':
                icon.title = 'Dictionary Deinflection';
                return icon;
            case 'algorithm':
                icon.title = 'Algorithm Deinflection';
                return icon;
            case 'both':
                icon.title = 'Dictionary and Algorithm Deinflection';
                return icon;
        }
    }

    private _createTermInflection(inflection: Dictionary.InflectionRule): DocumentFragment {
        const { name, description } = inflection;
        const fragment = this._templates.instantiateFragment('inflection');
        const node = this._querySelector(fragment, '.inflection');
        this._setTextContent(node, name);
        if (description) {
            node.title = description;
        }
        node.dataset.reason = name;
        return fragment;
    }

    private _createTermDefinition(
        definition: Dictionary.TermDefinition,
        dictionaryTag: Dictionary.Tag,
        headwords: Dictionary.TermHeadword[],
        uniqueTerms: Set<string>,
        uniqueReadings: Set<string>,
    ): HTMLElement {
        const { dictionary, tags, headwordIndices, entries } = definition;
        const disambiguations = getDisambiguations(headwords, headwordIndices, uniqueTerms, uniqueReadings);

        const node = this._instantiate('definition-item');

        const tagListContainer = this._querySelector(node, '.definition-tag-list');
        const onlyListContainer = this._querySelector(node, '.definition-disambiguation-list');
        const entriesContainer = this._querySelector(node, '.gloss-list');

        node.dataset.dictionary = dictionary;

        this._appendMultiple(tagListContainer, this._createTag.bind(this), [...tags, dictionaryTag]);
        this._appendMultiple(onlyListContainer, this._createTermDisambiguation.bind(this), disambiguations);
        this._appendMultiple(entriesContainer, this._createTermDefinitionEntry.bind(this), entries, dictionary);
        return node;
    }

    private _createDictionaryScopedStyleNode(
        definitions: Dictionary.TermDefinition[],
        dictionaryInfo: DictionaryImporter.Summary[],
    ): HTMLStyleElement | null {
        const usedDictionaries = new Set<string>();
        for (const { dictionary } of definitions) {
            usedDictionaries.add(dictionary);
        }

        let scopedCss = '';
        for (const dictionary of usedDictionaries) {
            const info = dictionaryInfo.find(({ title }) => title === dictionary);
            const styles = info?.styles?.trim() ?? '';
            if (styles.length === 0) {
                continue;
            }

            // Match extension behavior: scope dictionary CSS to entry elements using data-dictionary.
            const escapedTitle = dictionary.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
            scopedCss += `\n[data-dictionary="${escapedTitle}"] {${styles}\n}`;
        }

        if (scopedCss.length === 0) {
            return null;
        }

        const node = this._document.createElement('style');
        node.className = 'dictionary-entry-styles';
        node.textContent = scopedCss;
        return node;
    }

    private _createTermDefinitionEntry(
        entry: DictionaryData.TermGlossaryContent,
        dictionary: string,
    ): HTMLElement | null {
        switch (typeof entry) {
            case 'string':
                return this._createTermDefinitionEntryText(entry);
            case 'object': {
                switch (entry.type) {
                    case 'image':
                        return this._createTermDefinitionEntryImage(entry, dictionary);
                    case 'structured-content':
                        return this._createTermDefinitionEntryStructuredContent(entry.content, dictionary);
                    case 'text':
                        break;
                }
                break;
            }
        }
        return null;
    }

    private _createTermDefinitionEntryText(text: string): HTMLElement {
        const node = this._instantiate('gloss-item');
        const container = this._querySelector(node, '.gloss-content');
        this._setMultilineTextContent(container, text);
        return node;
    }

    private _createTermDefinitionEntryImage(data: DictionaryData.TermGlossaryImage, dictionary: string): HTMLElement {
        const { description } = data;

        const node = this._instantiate('gloss-item');

        const contentContainer = this._querySelector(node, '.gloss-content');
        const image = this._structuredContentGenerator.createDefinitionImage(data, dictionary);
        contentContainer.appendChild(image);

        if (typeof description === 'string') {
            const fragment = this._templates.instantiateFragment('gloss-item-image-description');
            const container = this._querySelector(fragment, '.gloss-image-description');
            this._setMultilineTextContent(container, description);
            contentContainer.appendChild(fragment);
        }

        return node;
    }

    private _createTermDefinitionEntryStructuredContent(
        content: StructuredContent.Content,
        dictionary: string,
    ): HTMLElement {
        const node = this._instantiate('gloss-item');
        const contentContainer = this._querySelector(node, '.gloss-content');
        this._structuredContentGenerator.appendStructuredContent(contentContainer, content, dictionary);
        return node;
    }

    private _createTermDisambiguation(disambiguation: string): HTMLElement {
        const node = this._instantiate('definition-disambiguation');
        node.dataset.term = disambiguation;
        this._setTextContent(node, disambiguation, this._language);
        return node;
    }

    private _createKanjiLink(character: string): HTMLAnchorElement {
        const node = this._document.createElement('a');
        node.className = 'headword-kanji-link';
        this._setTextContent(node, character, this._language);
        return node;
    }

    private _createKanjiDefinition(text: string): HTMLElement {
        const node = this._instantiate('kanji-gloss-item');
        const container = this._querySelector(node, '.kanji-gloss-content');
        this._setMultilineTextContent(container, text);
        return node;
    }

    private _createKanjiReading(reading: string): HTMLElement {
        const node = this._instantiate('kanji-reading');
        this._setTextContent(node, reading, this._language);
        return node;
    }

    private _createKanjiInfoTable(details: Dictionary.KanjiStat[]): HTMLElement {
        const node = this._instantiate('kanji-info-table');
        const container = this._querySelector(node, '.kanji-info-table-body');

        const count = this._appendMultiple(container, this._createKanjiInfoTableItem.bind(this), details);
        if (count === 0) {
            const n = this._createKanjiInfoTableItemEmpty();
            container.appendChild(n);
        }

        return node;
    }

    private _createKanjiInfoTableItem(details: Dictionary.KanjiStat): HTMLElement {
        const { content, name, value } = details;
        const node = this._instantiate('kanji-info-table-item');
        const nameNode = this._querySelector(node, '.kanji-info-table-item-header');
        const valueNode = this._querySelector(node, '.kanji-info-table-item-value');
        this._setTextContent(nameNode, content.length > 0 ? content : name);
        this._setTextContent(valueNode, typeof value === 'string' ? value : `${value}`);
        return node;
    }

    private _createKanjiInfoTableItemEmpty(): HTMLElement {
        return this._instantiate('kanji-info-table-empty');
    }

    private _createTag(tag: Dictionary.Tag): HTMLElement {
        const { content, name, category, redundant } = tag;
        const node = this._instantiate('tag');

        const inner = this._querySelector(node, '.tag-label-content');

        const contentString = content.join('\n');

        node.title = contentString;
        this._setTextContent(inner, name);
        node.dataset.details = contentString.length > 0 ? contentString : name;
        node.dataset.category = category;
        if (redundant) {
            node.dataset.redundant = 'true';
        }

        return node;
    }

    private _createTermTag(tagInfo: DictionaryDataUtil.TagGroup, totalHeadwordCount: number): HTMLElement {
        const { tag, headwordIndices } = tagInfo;
        const node = this._createTag(tag);
        node.dataset.headwords = headwordIndices.join(' ');
        node.dataset.totalHeadwordCount = `${totalHeadwordCount}`;
        node.dataset.matchedHeadwordCount = `${headwordIndices.length}`;
        node.dataset.unmatchedHeadwordCount = `${Math.max(0, totalHeadwordCount - headwordIndices.length)}`;
        return node;
    }

    private _createTagData(name: string, category: string): Dictionary.Tag {
        return {
            name,
            category,
            order: 0,
            score: 0,
            content: [],
            dictionaries: [],
            redundant: false,
        };
    }

    private _createSearchTag(text: string): HTMLElement {
        return this._createTag(this._createTagData(text, 'search'));
    }

    private _createGroupedPronunciation(details: DictionaryDataUtil.DictionaryGroupedPronunciations): HTMLElement {
        const { dictionary, dictionaryAlias, pronunciations } = details;

        const node = this._instantiate('pronunciation-group');
        node.dataset.dictionary = dictionary;
        node.dataset.pronunciationsMulti = 'true';
        node.dataset.pronunciationsCount = `${pronunciations.length}`;

        const n1 = this._querySelector(node, '.pronunciation-group-tag-list');
        const tag = this._createTag(this._createTagData(dictionaryAlias, 'pronunciation-dictionary'));
        tag.dataset.details = dictionary;
        n1.appendChild(tag);

        let hasTags = false;
        for (const {
            pronunciation: { tags },
        } of pronunciations) {
            if (tags.length > 0) {
                hasTags = true;
                break;
            }
        }

        const n = this._querySelector(node, '.pronunciation-list');
        n.dataset.hasTags = `${hasTags}`;
        this._appendMultiple(n, this._createPronunciation.bind(this), pronunciations);

        return node;
    }

    private _createPronunciation(details: DictionaryDataUtil.GroupedPronunciation): HTMLElement {
        const { pronunciation } = details;
        switch (pronunciation.type) {
            case 'pitch-accent':
                return this._createPronunciationPitchAccent(pronunciation, details);
            case 'phonetic-transcription':
                return this._createPronunciationPhoneticTranscription(pronunciation, details);
        }
    }

    private _createPronunciationPhoneticTranscription(
        pronunciation: Dictionary.PhoneticTranscription,
        details: DictionaryDataUtil.GroupedPronunciation,
    ): HTMLElement {
        const { ipa, tags } = pronunciation;
        const { exclusiveTerms, exclusiveReadings } = details;

        const node = this._instantiate('pronunciation');

        node.dataset.pronunciationType = pronunciation.type;
        node.dataset.tagCount = `${tags.length}`;

        let n = this._querySelector(node, '.pronunciation-tag-list');
        this._appendMultiple(n, this._createTag.bind(this), tags);

        n = this._querySelector(node, '.pronunciation-disambiguation-list');
        this._createPronunciationDisambiguations(n, exclusiveTerms, exclusiveReadings);

        n = this._querySelector(node, '.pronunciation-text-container');
        this._setTextContent(n, ipa);

        return node;
    }

    private _createPronunciationPitchAccent(
        pitchAccent: Dictionary.PitchAccent,
        details: DictionaryDataUtil.GroupedPronunciation,
    ): HTMLElement {
        const { positions, nasalPositions, devoicePositions, tags } = pitchAccent;
        const { reading, exclusiveTerms, exclusiveReadings } = details;
        const morae = getKanaMorae(reading);

        const node = this._instantiate('pronunciation');

        node.dataset.pitchAccentDownstepPosition = `${positions}`;
        node.dataset.pronunciationType = pitchAccent.type;
        if (nasalPositions.length > 0) {
            node.dataset.nasalMoraPosition = nasalPositions.join(' ');
        }
        if (devoicePositions.length > 0) {
            node.dataset.devoiceMoraPosition = devoicePositions.join(' ');
        }
        node.dataset.tagCount = `${tags.length}`;

        let n = this._querySelector(node, '.pronunciation-tag-list');
        this._appendMultiple(n, this._createTag.bind(this), tags);

        n = this._querySelector(node, '.pronunciation-disambiguation-list');
        this._createPronunciationDisambiguations(n, exclusiveTerms, exclusiveReadings);

        n = this._querySelector(node, '.pronunciation-downstep-notation-container');
        n.appendChild(this._pronunciationGenerator.createPronunciationDownstepPosition(positions));

        n = this._querySelector(node, '.pronunciation-text-container');
        n.lang = this._language;
        n.appendChild(
            this._pronunciationGenerator.createPronunciationText(morae, positions, nasalPositions, devoicePositions),
        );

        n = this._querySelector(node, '.pronunciation-graph-container');
        n.appendChild(this._pronunciationGenerator.createPronunciationGraph(morae, positions));

        return node;
    }

    private _createPronunciationDisambiguations(
        container: HTMLElement,
        exclusiveTerms: string[],
        exclusiveReadings: string[],
    ): void {
        const templateName = 'pronunciation-disambiguation';
        for (const term of exclusiveTerms) {
            const node = this._instantiate(templateName);
            node.dataset.type = 'term';
            this._setTextContent(node, term, this._language);
            container.appendChild(node);
        }

        for (const exclusiveReading of exclusiveReadings) {
            const node = this._instantiate(templateName);
            node.dataset.type = 'reading';
            this._setTextContent(node, exclusiveReading, this._language);
            container.appendChild(node);
        }

        container.dataset.count = `${exclusiveTerms.length + exclusiveReadings.length}`;
        container.dataset.termCount = `${exclusiveTerms.length}`;
        container.dataset.readingCount = `${exclusiveReadings.length}`;
    }

    private _createFrequencyGroup(
        details:
            | DictionaryDataUtil.DictionaryFrequency<DictionaryDataUtil.TermFrequency>
            | DictionaryDataUtil.DictionaryFrequency<DictionaryDataUtil.KanjiFrequency>,
        kanji: boolean,
    ): HTMLElement {
        const { dictionary, dictionaryAlias, frequencies, freqCount } = details;

        const node = this._instantiate('frequency-group-item');
        const body = this._querySelector(node, '.tag-body-content');

        const tagLabel = this._querySelector(node, '.tag-label-content');
        const tag = this._querySelector(node, '.tag');

        this._setTextContent(tagLabel, dictionaryAlias);

        const ii = frequencies.length;
        for (let i = 0; i < ii; ++i) {
            const item = frequencies[i];
            const itemNode = kanji
                ? this._createKanjiFrequency(
                      item as DictionaryDataUtil.KanjiFrequency,
                      dictionary,
                      dictionaryAlias,
                      freqCount?.toString(),
                  )
                : this._createTermFrequency(
                      item as DictionaryDataUtil.TermFrequency,
                      dictionary,
                      dictionaryAlias,
                      freqCount?.toString(),
                  );
            itemNode.dataset.index = `${i}`;
            body.appendChild(itemNode);
        }

        body.dataset.count = `${ii}`;
        node.dataset.count = `${ii}`;
        node.dataset.details = dictionary;
        tag.dataset.details = `${dictionary}\nDictionary size: ${freqCount?.toString()}${kanji ? ' kanji' : ' terms'}`;
        return node;
    }

    private _createTermFrequency(
        details: DictionaryDataUtil.TermFrequency,
        dictionary: string,
        dictionaryAlias: string,
        freqCount: string | undefined,
    ): HTMLElement {
        const { term, reading, values } = details;
        const node = this._instantiate('term-frequency-item');
        const tagLabel = this._querySelector(node, '.tag-label-content');
        const tag = this._querySelector(node, '.tag');
        const disambiguationTerm = this._querySelector(node, '.frequency-disambiguation-term');
        const disambiguationReading = this._querySelector(node, '.frequency-disambiguation-reading');
        const frequencyValueList = this._querySelector(node, '.frequency-value-list');

        this._setTextContent(tagLabel, dictionaryAlias);
        this._setTextContent(disambiguationTerm, term, this._language);
        this._setTextContent(disambiguationReading, reading !== null ? reading : '', this._language);
        this._populateFrequencyValueList(frequencyValueList, values);

        node.dataset.term = term;
        if (typeof reading === 'string') {
            node.dataset.reading = reading;
        }
        node.dataset.hasReading = `${reading !== null}`;
        node.dataset.readingIsSame = `${reading === term}`;
        node.dataset.dictionary = dictionary;
        node.dataset.details = dictionary;
        tag.dataset.details = `${dictionary}\nDictionary size: ${freqCount ?? ''} terms`;
        return node;
    }

    private _createKanjiFrequency(
        details: DictionaryDataUtil.KanjiFrequency,
        dictionary: string,
        dictionaryAlias: string,
        freqCount: string | undefined,
    ): HTMLElement {
        const { character, values } = details;
        const node = this._instantiate('kanji-frequency-item');
        const tagLabel = this._querySelector(node, '.tag-label-content');
        const tag = this._querySelector(node, '.tag');
        const frequencyValueList = this._querySelector(node, '.frequency-value-list');

        this._setTextContent(tagLabel, dictionaryAlias);
        this._populateFrequencyValueList(frequencyValueList, values);

        node.dataset.character = character;
        node.dataset.dictionary = dictionary;
        node.dataset.details = dictionary;
        tag.dataset.details = `${dictionary}\nDictionary size: ${freqCount ?? ''} kanji`;

        return node;
    }

    private _populateFrequencyValueList(node: HTMLElement, values: DictionaryDataUtil.FrequencyValue[]): void {
        let fullFrequency = '';
        for (let i = 0, ii = values.length; i < ii; ++i) {
            const { frequency, displayValue } = values[i];
            const frequencyString = `${frequency}`;
            const text = displayValue !== null ? displayValue : `${frequency}`;

            if (i > 0) {
                const node2 = this._document.createElement('span');
                node2.className = 'frequency-value';
                node2.dataset.frequency = `${frequency}`;
                node2.textContent = ', ';
                node.appendChild(node2);
                fullFrequency += ', ';
            }

            const node2 = this._document.createElement('span');
            node2.className = 'frequency-value';
            node2.dataset.frequency = frequencyString;
            if (displayValue !== null) {
                node2.dataset.displayValue = `${displayValue}`;
                if (displayValue !== frequencyString) {
                    node2.title = frequencyString;
                }
            }
            this._setTextContent(node2, text, this._language);
            node.appendChild(node2);

            fullFrequency += text;
        }

        node.dataset.frequency = fullFrequency;
    }

    private _appendKanjiLinks(container: HTMLElement, text: string): void {
        let part = '';
        for (const c of text) {
            if (isCodePointKanji(c.codePointAt(0) as number)) {
                if (part.length > 0) {
                    container.appendChild(this._document.createTextNode(part));
                    part = '';
                }

                const link = this._createKanjiLink(c);
                container.appendChild(link);
            } else {
                part += c;
            }
        }
        if (part.length > 0) {
            container.appendChild(this._document.createTextNode(part));
        }
    }

    private _appendMultiple<TItem, TExtraArg = void>(
        container: HTMLElement,
        createItem: (item: TItem, arg: TExtraArg) => Node | null,
        detailsArray: TItem[],
        arg?: TExtraArg,
    ): number {
        let count = 0;
        const ELEMENT_NODE = 1;
        if (Array.isArray(detailsArray)) {
            for (const details of detailsArray) {
                const item = createItem(details, arg as TExtraArg);
                if (item === null) {
                    continue;
                }
                container.appendChild(item);
                if (item.nodeType === ELEMENT_NODE) {
                    (item as HTMLElement).dataset.index = `${count}`;
                }
                ++count;
            }
        }

        container.dataset.count = `${count}`;

        return count;
    }

    private _appendFurigana(
        container: HTMLElement,
        term: string,
        reading: string,
        addText: (element: HTMLElement, text: string) => void,
    ): void {
        container.lang = this._language;
        const segments = distributeFurigana(term, reading);
        for (const { text, reading: furigana } of segments) {
            if (furigana) {
                const ruby = this._document.createElement('ruby');
                const rt = this._document.createElement('rt');
                addText(ruby, text);
                ruby.appendChild(rt);
                rt.appendChild(this._document.createTextNode(furigana));
                container.appendChild(ruby);
            } else {
                addText(container, text);
            }
        }
    }

    private _createDictionaryTag(dictionary: string): Dictionary.Tag {
        return this._createTagData(dictionary, 'dictionary');
    }

    private _setTextContent(node: HTMLElement, value: string, language?: string): void {
        this._setElementLanguage(node, language, value);
        node.textContent = value;
    }

    private _setMultilineTextContent(node: HTMLElement, value: string, language?: string): void {
        this._setElementLanguage(node, language, value);

        let start = 0;
        while (true) {
            const end = value.indexOf('\n', start);
            if (end < 0) {
                break;
            }
            node.appendChild(this._document.createTextNode(value.substring(start, end)));
            node.appendChild(this._document.createElement('br'));
            start = end + 1;
        }

        if (start < value.length) {
            node.appendChild(this._document.createTextNode(start === 0 ? value : value.substring(start)));
        }
    }

    private _setElementLanguage(element: HTMLElement, language: string | undefined, content: string): void {
        if (typeof language === 'string') {
            element.lang = language;
        } else {
            const language2 = getLanguageFromText(content, this._language);
            if (language2 !== null) {
                element.lang = language2;
            }
        }
    }

    private _getPronunciationCategories(
        reading: string,
        termPronunciations: Dictionary.TermPronunciation[],
        wordClasses: string[],
        headwordIndex: number,
    ): string | null {
        if (termPronunciations.length === 0) {
            return null;
        }
        const isVerbOrAdjective = isNonNounVerbOrAdjective(wordClasses);
        const categories = new Set<PitchCategory>();
        for (const termPronunciation of termPronunciations) {
            if (termPronunciation.headwordIndex !== headwordIndex) {
                continue;
            }
            for (const pronunciation of termPronunciation.pronunciations) {
                if (pronunciation.type !== 'pitch-accent') {
                    continue;
                }
                const category = getPitchCategory(reading, pronunciation.positions, isVerbOrAdjective);
                if (category !== null) {
                    categories.add(category);
                }
            }
        }
        return categories.size > 0 ? [...categories].join(' ') : null;
    }

    private _instantiate(name: string): HTMLElement {
        return this._templates.instantiate(name);
    }

    private _querySelector(element: Element | DocumentFragment, selector: string): HTMLElement {
        const result = element.querySelector(selector);
        if (result === null) {
            throw new Error(`Failed to find element: ${selector}`);
        }
        return result as HTMLElement;
    }
}
