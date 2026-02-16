/**
 * Reads code points from a string in the forward direction.
 */
export function readCodePointsForward(text: string, position: number, count: number): string {
    const textLength = text.length;
    let result = '';
    for (; count > 0; --count) {
        const char = text[position];
        result += char;
        if (++position >= textLength) {
            break;
        }
        const charCode = char.charCodeAt(0);
        if (charCode >= 0xd800 && charCode < 0xdc00) {
            const char2 = text[position];
            const charCode2 = char2.charCodeAt(0);
            if (charCode2 >= 0xdc00 && charCode2 < 0xe000) {
                result += char2;
                if (++position >= textLength) {
                    break;
                }
            }
        }
    }
    return result;
}

/**
 * Reads code points from a string in the backward direction.
 */
export function readCodePointsBackward(text: string, position: number, count: number): string {
    let result = '';
    for (; count > 0; --count) {
        const char = text[position];
        result = char + result;
        if (--position < 0) {
            break;
        }
        const charCode = char.charCodeAt(0);
        if (charCode >= 0xdc00 && charCode < 0xe000) {
            const char2 = text[position];
            const charCode2 = char2.charCodeAt(0);
            if (charCode2 >= 0xd800 && charCode2 < 0xdc00) {
                result = char2 + result;
                if (--position < 0) {
                    break;
                }
            }
        }
    }
    return result;
}

/**
 * Trims and condenses trailing whitespace and adds a space on the end if it needed trimming.
 */
export function trimTrailingWhitespacePlusSpace(text: string): string {
    return text.replaceAll(/(\n+$|^\n+)/g, '\n').replaceAll(/[^\S\n]+$/g, ' ');
}
