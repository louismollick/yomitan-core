const markerPattern = /\{([\p{Letter}\p{Number}_-]+)\}/gu;

/**
 * Gets the root deck name of a full deck name.
 */
export function getRootDeckName(deckName: string): string {
    const index = deckName.indexOf('::');
    return index >= 0 ? deckName.substring(0, index) : deckName;
}

/**
 * Checks whether or not any marker is contained in a string.
 */
export function stringContainsAnyFieldMarker(string: string): boolean {
    const result = markerPattern.test(string);
    markerPattern.lastIndex = 0;
    return result;
}

/**
 * Gets a list of all markers that are contained in a string.
 */
export function getFieldMarkers(string: string): string[] {
    const pattern = markerPattern;
    const markers: string[] = [];
    while (true) {
        const match = pattern.exec(string);
        if (match === null) {
            break;
        }
        markers.push(match[1]);
    }
    return markers;
}

/**
 * Returns a regular expression which can be used to find markers in a string.
 */
export function cloneFieldMarkerPattern(global: boolean): RegExp {
    return new RegExp(markerPattern.source, global ? 'gu' : 'u');
}

/**
 * Checks whether or not a note object is valid.
 */
export function isNoteDataValid(note: {
    fields: Record<string, string>;
    deckName: string;
    modelName: string;
}): boolean {
    const { fields, deckName, modelName } = note;
    return (
        typeof deckName === 'string' &&
        deckName.length > 0 &&
        typeof modelName === 'string' &&
        modelName.length > 0 &&
        Object.entries(fields).length > 0
    );
}

export const INVALID_NOTE_ID = -1;

/**
 * Generates a file name for Anki note media.
 */
export function generateAnkiNoteMediaFileName(prefix: string, extension: string, timestamp: number): string {
    let fileName = prefix;
    fileName += `_${ankNoteDateToString(new Date(timestamp))}`;
    fileName += extension;
    fileName = replaceInvalidFileNameCharacters(fileName);
    return fileName;
}

function replaceInvalidFileNameCharacters(fileName: string): string {
    // eslint-disable-next-line no-control-regex
    return fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-');
}

function ankNoteDateToString(date: Date): string {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth().toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    const milliseconds = date.getUTCMilliseconds().toString().padStart(3, '0');
    return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}-${milliseconds}`;
}
