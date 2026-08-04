const matchReplacementPattern = /\$(?:\$|&|`|'|(\d\d?)|<([^>]*)>)/g;

/**
 * Applies string.replace using a regular expression and replacement string as arguments.
 */
export function applyTextReplacement(text: string, pattern: RegExp, replacement: string): string {
    const isGlobal = pattern.global;
    if (isGlobal) {
        pattern.lastIndex = 0;
    }
    for (let loop = true; loop; loop = isGlobal) {
        const match = pattern.exec(text);
        if (match === null) {
            break;
        }

        const matchText = match[0];
        const index = match.index;
        const actualReplacement = applyMatchReplacement(replacement, match);
        const actualReplacementLength = actualReplacement.length;
        const delta = actualReplacementLength - (matchText.length > 0 ? matchText.length : -1);

        text = `${text.substring(0, index)}${actualReplacement}${text.substring(index + matchText.length)}`;
        pattern.lastIndex += delta;
    }
    return text;
}

/**
 * Applies the replacement string for a given regular expression match.
 */
export function applyMatchReplacement(replacement: string, match: RegExpExecArray): string {
    const pattern = matchReplacementPattern;
    pattern.lastIndex = 0;
    const replacer = (g0: string, g1: string | undefined, g2: string | undefined): string => {
        if (typeof g1 !== 'undefined') {
            const matchIndex = Number.parseInt(g1, 10);
            if (matchIndex >= 1 && matchIndex <= match.length) {
                return match[matchIndex];
            }
        } else if (typeof g2 !== 'undefined') {
            const { groups } = match;
            if (typeof groups === 'object' && groups !== null && Object.prototype.hasOwnProperty.call(groups, g2)) {
                return groups[g2];
            }
        } else {
            let { index } = match;
            if (typeof index !== 'number') {
                index = 0;
            }
            switch (g0) {
                case '$':
                    return '$';
                case '&':
                    return match[0];
                case '`':
                    return replacement.substring(0, index);
                case "'":
                    return replacement.substring(index + g0.length);
            }
        }
        return g0;
    };
    return replacement.replace(pattern, replacer);
}
