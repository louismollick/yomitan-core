/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2021-2022  Yomichan Authors
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

import { getLanguageFromText } from '../language/text-utilities.js';
import type * as DictionaryData from '../types/dictionary-data.js';
import type * as StructuredContent from '../types/structured-content.js';
import type { ContentManager } from './content-manager.js';

/**
 * Generates DOM elements from structured content definitions found in
 * dictionary glossary entries. Handles images, links, tables, styled
 * elements, and other structured content types.
 */
export class StructuredContentGenerator {
    private _contentManager: ContentManager;
    private _document: Document;

    /**
     * Creates a new StructuredContentGenerator.
     * @param contentManager - The content manager for loading media resources.
     * @param doc - The Document object to use for creating DOM elements.
     */
    constructor(contentManager: ContentManager, doc: Document) {
        this._contentManager = contentManager;
        this._document = doc;
    }

    /**
     * Appends structured content to an existing node, adding the 'structured-content' class.
     * @param node - The container element to append content to.
     * @param content - The structured content to render.
     * @param dictionary - The dictionary name for resolving media references.
     */
    appendStructuredContent(node: HTMLElement, content: StructuredContent.Content, dictionary: string): void {
        node.classList.add('structured-content');
        this._appendStructuredContent(node, content, dictionary, null);
    }

    /**
     * Creates a new span element containing the rendered structured content.
     * @param content - The structured content to render.
     * @param dictionary - The dictionary name for resolving media references.
     * @returns A span element with class 'structured-content'.
     */
    createStructuredContent(content: StructuredContent.Content, dictionary: string): HTMLElement {
        const node = this._createElement('span', 'structured-content');
        this._appendStructuredContent(node, content, dictionary, null);
        return node;
    }

    /**
     * Creates an image element for a definition, wrapped in an anchor tag.
     * @param data - The image data from the dictionary.
     * @param dictionary - The dictionary name for resolving the image path.
     * @returns An anchor element containing the image.
     */
    createDefinitionImage(
        data: StructuredContent.ImageElement | DictionaryData.TermGlossaryImage,
        dictionary: string,
    ): HTMLAnchorElement {
        const {
            path,
            width = 100,
            height = 100,
            preferredWidth,
            preferredHeight,
            title,
            pixelated,
            imageRendering,
            appearance,
            background,
            collapsed,
            collapsible,
        } = data;

        const verticalAlign = 'verticalAlign' in data ? data.verticalAlign : undefined;
        const border = 'border' in data ? data.border : undefined;
        const borderRadius = 'borderRadius' in data ? data.borderRadius : undefined;
        const sizeUnits = 'sizeUnits' in data ? data.sizeUnits : undefined;

        const hasPreferredWidth = typeof preferredWidth === 'number';
        const hasPreferredHeight = typeof preferredHeight === 'number';
        const invAspectRatio =
            hasPreferredWidth && hasPreferredHeight
                ? (preferredHeight as number) / (preferredWidth as number)
                : height / width;
        const usedWidth = hasPreferredWidth
            ? (preferredWidth as number)
            : hasPreferredHeight
              ? (preferredHeight as number) / invAspectRatio
              : width;

        const node = this._createElement('a', 'gloss-image-link') as HTMLAnchorElement;
        node.target = '_blank';
        node.rel = 'noreferrer noopener';

        const imageContainer = this._createElement('span', 'gloss-image-container');
        node.appendChild(imageContainer);

        const aspectRatioSizer = this._createElement('span', 'gloss-image-sizer');
        imageContainer.appendChild(aspectRatioSizer);

        const imageBackground = this._createElement('span', 'gloss-image-background');
        imageContainer.appendChild(imageBackground);

        const overlay = this._createElement('span', 'gloss-image-container-overlay');
        imageContainer.appendChild(overlay);

        const linkText = this._createElement('span', 'gloss-image-link-text');
        linkText.textContent = 'Image';
        node.appendChild(linkText);

        node.dataset.path = path;
        node.dataset.dictionary = dictionary;
        node.dataset.imageLoadState = 'not-loaded';
        node.dataset.hasAspectRatio = 'true';
        node.dataset.imageRendering =
            typeof imageRendering === 'string' ? imageRendering : pixelated ? 'pixelated' : 'auto';
        node.dataset.appearance = typeof appearance === 'string' ? appearance : 'auto';
        node.dataset.background = typeof background === 'boolean' ? `${background}` : 'true';
        node.dataset.collapsed = typeof collapsed === 'boolean' ? `${collapsed}` : 'false';
        node.dataset.collapsible = typeof collapsible === 'boolean' ? `${collapsible}` : 'true';
        if (typeof verticalAlign === 'string') {
            node.dataset.verticalAlign = verticalAlign;
        }
        if (typeof sizeUnits === 'string' && (hasPreferredWidth || hasPreferredHeight)) {
            node.dataset.sizeUnits = sizeUnits;
        }

        aspectRatioSizer.style.paddingTop = `${invAspectRatio * 100}%`;

        if (typeof border === 'string') {
            imageContainer.style.border = border;
        }
        if (typeof borderRadius === 'string') {
            imageContainer.style.borderRadius = borderRadius;
        }
        imageContainer.style.width = `${usedWidth}em`;
        if (typeof title === 'string') {
            (imageContainer as HTMLElement).title = title;
        }

        // Load image via content manager
        const image = this._createElement('img', 'gloss-image') as HTMLImageElement;
        if (sizeUnits === 'em' && (hasPreferredWidth || hasPreferredHeight)) {
            image.style.width = `${usedWidth}em`;
            image.style.height = `${usedWidth * invAspectRatio}em`;
        }
        image.width = usedWidth;
        image.height = usedWidth * invAspectRatio;

        // Anki will not render images correctly without specifying to use 100% width and height
        image.style.width = '100%';
        image.style.height = '100%';

        imageContainer.appendChild(image);

        const url = this._contentManager.loadMedia(path, dictionary, 'image');
        if (url) {
            this._setImageData(node, image, imageBackground, url, false);
        }

        return node;
    }

    // Private

    private _appendStructuredContent(
        container: HTMLElement,
        content: StructuredContent.Content | undefined,
        dictionary: string,
        language: string | null,
    ): void {
        if (typeof content === 'string') {
            if (content.length > 0) {
                container.appendChild(this._createTextNode(content));
                if (language === null) {
                    const language2 = getLanguageFromText(content, language);
                    if (language2 !== null) {
                        container.lang = language2;
                    }
                }
            }
            return;
        }
        if (!(typeof content === 'object' && content !== null)) {
            return;
        }
        if (Array.isArray(content)) {
            for (const item of content) {
                this._appendStructuredContent(container, item, dictionary, language);
            }
            return;
        }
        const node = this._createStructuredContentGenericElement(content, dictionary, language);
        if (node !== null) {
            container.appendChild(node);
        }
    }

    private _createElement(tagName: string, className: string): HTMLElement {
        const node = this._document.createElement(tagName);
        node.className = className;
        return node;
    }

    private _createTextNode(data: string): Text {
        return this._document.createTextNode(data);
    }

    private _setElementDataset(element: HTMLElement, data: StructuredContent.Data): void {
        for (let [key, value] of Object.entries(data)) {
            if (key.length > 0) {
                key = `${key[0].toUpperCase()}${key.substring(1)}`;
            }
            key = `sc${key}`;
            try {
                element.dataset[key] = value;
            } catch (_e) {
                // DOMException if key is malformed
            }
        }
    }

    private _setImageData(
        node: HTMLAnchorElement,
        image: HTMLImageElement,
        imageBackground: HTMLElement,
        url: string | null,
        unloaded: boolean,
    ): void {
        if (url !== null) {
            image.src = url;
            node.href = url;
            node.dataset.imageLoadState = 'loaded';
            imageBackground.style.setProperty('--image', `url("${url}")`);
        } else {
            image.removeAttribute('src');
            node.removeAttribute('href');
            node.dataset.imageLoadState = unloaded ? 'unloaded' : 'load-error';
            imageBackground.style.removeProperty('--image');
        }
    }

    private _createStructuredContentGenericElement(
        content: StructuredContent.Element,
        dictionary: string,
        language: string | null,
    ): HTMLElement | null {
        const { tag } = content;
        switch (tag) {
            case 'br':
                return this._createStructuredContentElement(tag, content, dictionary, language, 'simple', false, false);
            case 'ruby':
            case 'rt':
            case 'rp':
                return this._createStructuredContentElement(tag, content, dictionary, language, 'simple', true, false);
            case 'table':
                return this._createStructuredContentTableElement(
                    tag,
                    content as StructuredContent.UnstyledElement,
                    dictionary,
                    language,
                );
            case 'thead':
            case 'tbody':
            case 'tfoot':
            case 'tr':
                return this._createStructuredContentElement(tag, content, dictionary, language, 'table', true, false);
            case 'th':
            case 'td':
                return this._createStructuredContentElement(
                    tag,
                    content,
                    dictionary,
                    language,
                    'table-cell',
                    true,
                    true,
                );
            case 'div':
            case 'span':
            case 'ol':
            case 'ul':
            case 'li':
            case 'details':
            case 'summary':
                return this._createStructuredContentElement(tag, content, dictionary, language, 'simple', true, true);
            case 'img':
                return this.createDefinitionImage(content as StructuredContent.ImageElement, dictionary);
            case 'a':
                return this._createLinkElement(content as StructuredContent.LinkElement, dictionary, language);
        }
        return null;
    }

    private _createStructuredContentTableElement(
        tag: string,
        content: StructuredContent.UnstyledElement,
        dictionary: string,
        language: string | null,
    ): HTMLElement {
        const container = this._createElement('div', 'gloss-sc-table-container');
        const table = this._createStructuredContentElement(tag, content, dictionary, language, 'table', true, false);
        container.appendChild(table);
        return container;
    }

    private _createStructuredContentElement(
        tag: string,
        content:
            | StructuredContent.StyledElement
            | StructuredContent.UnstyledElement
            | StructuredContent.TableElement
            | StructuredContent.LineBreak,
        dictionary: string,
        language: string | null,
        type: 'simple' | 'table' | 'table-cell',
        hasChildren: boolean,
        hasStyle: boolean,
    ): HTMLElement {
        const node = this._createElement(tag, `gloss-sc-${tag}`);
        const { data, lang } = content;
        if (typeof data === 'object' && data !== null) {
            this._setElementDataset(node, data);
        }
        if (typeof lang === 'string') {
            node.lang = lang;
            language = lang;
        }
        switch (type) {
            case 'table-cell':
                {
                    const cell = node as HTMLTableCellElement;
                    const { colSpan, rowSpan } = content as StructuredContent.TableElement;
                    if (typeof colSpan === 'number') {
                        cell.colSpan = colSpan;
                    }
                    if (typeof rowSpan === 'number') {
                        cell.rowSpan = rowSpan;
                    }
                }
                break;
        }
        if (hasStyle) {
            const { style, title, open } = content as StructuredContent.StyledElement;
            if (typeof style === 'object' && style !== null) {
                this._setStructuredContentElementStyle(node, style);
            }
            if (typeof title === 'string') {
                node.title = title;
            }
            if (typeof open === 'boolean' && open) {
                node.setAttribute('open', '');
            }
        }
        if (hasChildren) {
            this._appendStructuredContent(
                node,
                (content as StructuredContent.StyledElement).content,
                dictionary,
                language,
            );
        }
        return node;
    }

    private _setStructuredContentElementStyle(
        node: HTMLElement,
        contentStyle: StructuredContent.StructuredContentStyle,
    ): void {
        const { style } = node;
        const {
            fontStyle,
            fontWeight,
            fontSize,
            color,
            background,
            backgroundColor,
            textDecorationLine,
            textDecorationStyle,
            textDecorationColor,
            borderColor,
            borderStyle,
            borderRadius,
            borderWidth,
            clipPath,
            verticalAlign,
            textAlign,
            textEmphasis,
            textShadow,
            margin,
            marginTop,
            marginLeft,
            marginRight,
            marginBottom,
            padding,
            paddingTop,
            paddingLeft,
            paddingRight,
            paddingBottom,
            wordBreak,
            whiteSpace,
            cursor,
            listStyleType,
        } = contentStyle;
        if (typeof fontStyle === 'string') {
            style.fontStyle = fontStyle;
        }
        if (typeof fontWeight === 'string') {
            style.fontWeight = fontWeight;
        }
        if (typeof fontSize === 'string') {
            style.fontSize = fontSize;
        }
        if (typeof color === 'string') {
            style.color = color;
        }
        if (typeof background === 'string') {
            style.background = background;
        }
        if (typeof backgroundColor === 'string') {
            style.backgroundColor = backgroundColor;
        }
        if (typeof verticalAlign === 'string') {
            style.verticalAlign = verticalAlign;
        }
        if (typeof textAlign === 'string') {
            style.textAlign = textAlign;
        }
        if (typeof textEmphasis === 'string') {
            (style as unknown as Record<string, string>).textEmphasis = textEmphasis;
        }
        if (typeof textShadow === 'string') {
            style.textShadow = textShadow;
        }
        if (typeof textDecorationLine === 'string') {
            style.textDecoration = textDecorationLine;
        } else if (Array.isArray(textDecorationLine)) {
            style.textDecoration = textDecorationLine.join(' ');
        }
        if (typeof textDecorationStyle === 'string') {
            (style as unknown as Record<string, string>).textDecorationStyle = textDecorationStyle;
        }
        if (typeof textDecorationColor === 'string') {
            (style as unknown as Record<string, string>).textDecorationColor = textDecorationColor;
        }
        if (typeof borderColor === 'string') {
            style.borderColor = borderColor;
        }
        if (typeof borderStyle === 'string') {
            style.borderStyle = borderStyle;
        }
        if (typeof borderRadius === 'string') {
            style.borderRadius = borderRadius;
        }
        if (typeof borderWidth === 'string') {
            style.borderWidth = borderWidth;
        }
        if (typeof clipPath === 'string') {
            (style as unknown as Record<string, string>).clipPath = clipPath;
        }
        if (typeof margin === 'string') {
            style.margin = margin;
        }
        if (typeof marginTop === 'number') {
            style.marginTop = `${marginTop}em`;
        }
        if (typeof marginTop === 'string') {
            style.marginTop = marginTop;
        }
        if (typeof marginLeft === 'number') {
            style.marginLeft = `${marginLeft}em`;
        }
        if (typeof marginLeft === 'string') {
            style.marginLeft = marginLeft;
        }
        if (typeof marginRight === 'number') {
            style.marginRight = `${marginRight}em`;
        }
        if (typeof marginRight === 'string') {
            style.marginRight = marginRight;
        }
        if (typeof marginBottom === 'number') {
            style.marginBottom = `${marginBottom}em`;
        }
        if (typeof marginBottom === 'string') {
            style.marginBottom = marginBottom;
        }
        if (typeof padding === 'string') {
            style.padding = padding;
        }
        if (typeof paddingTop === 'string') {
            style.paddingTop = paddingTop;
        }
        if (typeof paddingLeft === 'string') {
            style.paddingLeft = paddingLeft;
        }
        if (typeof paddingRight === 'string') {
            style.paddingRight = paddingRight;
        }
        if (typeof paddingBottom === 'string') {
            style.paddingBottom = paddingBottom;
        }
        if (typeof wordBreak === 'string') {
            (style as unknown as Record<string, string>).wordBreak = wordBreak;
        }
        if (typeof whiteSpace === 'string') {
            style.whiteSpace = whiteSpace;
        }
        if (typeof cursor === 'string') {
            style.cursor = cursor;
        }
        if (typeof listStyleType === 'string') {
            style.listStyleType = listStyleType;
        }
    }

    private _createLinkElement(
        content: StructuredContent.LinkElement,
        dictionary: string,
        language: string | null,
    ): HTMLAnchorElement {
        const { href } = content;
        const internal = href.startsWith('?');

        const node = this._createElement('a', 'gloss-link') as HTMLAnchorElement;
        node.dataset.external = `${!internal}`;

        const text = this._createElement('span', 'gloss-link-text');
        node.appendChild(text);

        const { lang } = content;
        if (typeof lang === 'string') {
            node.lang = lang;
            language = lang;
        }

        this._appendStructuredContent(text, content.content, dictionary, language);

        if (!internal) {
            const icon = this._createElement('span', 'gloss-link-external-icon icon');
            icon.dataset.icon = 'external-link';
            node.appendChild(icon);
        }

        this._contentManager.prepareLink(node, href, internal);
        return node;
    }
}
