/**
 * Gets the file extension of a file path.
 */
export function getFileNameExtension(path: string): string {
    const match = /\.[^./\\]*$/.exec(path);
    return match !== null ? match[0] : '';
}

/**
 * Gets an image file's media type using a file path.
 */
export function getImageMediaTypeFromFileName(path: string): string | null {
    switch (getFileNameExtension(path).toLowerCase()) {
        case '.apng':
            return 'image/apng';
        case '.avif':
            return 'image/avif';
        case '.bmp':
            return 'image/bmp';
        case '.gif':
            return 'image/gif';
        case '.ico':
        case '.cur':
            return 'image/x-icon';
        case '.jpg':
        case '.jpeg':
        case '.jfif':
        case '.pjpeg':
        case '.pjp':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.svg':
            return 'image/svg+xml';
        case '.tif':
        case '.tiff':
            return 'image/tiff';
        case '.webp':
            return 'image/webp';
        default:
            return null;
    }
}

/**
 * Gets the file extension for a corresponding image media type.
 */
export function getFileExtensionFromImageMediaType(mediaType: string): string | null {
    switch (mediaType) {
        case 'image/apng':
            return '.apng';
        case 'image/avif':
            return '.avif';
        case 'image/bmp':
            return '.bmp';
        case 'image/gif':
            return '.gif';
        case 'image/x-icon':
            return '.ico';
        case 'image/jpeg':
            return '.jpeg';
        case 'image/png':
            return '.png';
        case 'image/svg+xml':
            return '.svg';
        case 'image/tiff':
            return '.tiff';
        case 'image/webp':
            return '.webp';
        default:
            return null;
    }
}

/**
 * Gets the file extension for a corresponding audio media type.
 */
export function getFileExtensionFromAudioMediaType(mediaType: string): string | null {
    switch (mediaType) {
        case 'audio/aac':
            return '.aac';
        case 'audio/mpeg':
        case 'audio/mp3':
            return '.mp3';
        case 'audio/mp4':
            return '.mp4';
        case 'audio/ogg':
        case 'audio/vorbis':
        case 'application/ogg':
            return '.ogg';
        case 'audio/vnd.wav':
        case 'audio/wave':
        case 'audio/wav':
        case 'audio/x-wav':
        case 'audio/x-pn-wav':
            return '.wav';
        case 'audio/flac':
            return '.flac';
        case 'audio/webm':
            return '.webm';
        default:
            return null;
    }
}
