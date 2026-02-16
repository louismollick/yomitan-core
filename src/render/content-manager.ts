/*
 * Copyright (C) 2023-2025  Yomitan Authors
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

/**
 * Interface for managing media content loading within dictionary entries.
 * Implementations handle loading images and other media from dictionary archives.
 */
export interface ContentManager {
    /**
     * Loads a media resource from a dictionary.
     * @param path - The path to the media file within the dictionary archive.
     * @param dictionary - The name of the dictionary containing the media.
     * @param mediaType - The MIME type or category of the media (e.g., 'image').
     * @returns A URL string that can be used to display the media, or empty string if unavailable.
     */
    loadMedia(path: string, dictionary: string, mediaType: string): string;

    /**
     * Prepares a link element for navigation.
     * @param element - The anchor element to prepare.
     * @param href - The URL to link to.
     * @param internal - Whether the link is internal to the application.
     */
    prepareLink(element: HTMLAnchorElement, href: string, internal: boolean): void;

    /**
     * Unloads all previously loaded media resources.
     */
    unloadAll(): void;
}

/**
 * A no-op implementation of ContentManager that returns empty values.
 * Useful for rendering dictionary entries without media support.
 */
export class NoOpContentManager implements ContentManager {
    loadMedia(_path: string, _dictionary: string, _mediaType: string): string {
        return '';
    }

    prepareLink(element: HTMLAnchorElement, href: string, _internal: boolean): void {
        element.href = href;
    }

    unloadAll(): void {}
}
