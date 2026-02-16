import { convertHiraganaToKatakana } from './japanese';
import { HIRAGANA_TO_ROMAJI, ROMAJI_TO_HIRAGANA } from './japanese-kana-romaji-dicts';

export type KanaIMEOutput = {
    kanaString: string;
    newSelectionStart: number;
};

export function convertToHiragana(text: string): string {
    let newText = text.toLowerCase();
    for (const [romaji, kana] of Object.entries(ROMAJI_TO_HIRAGANA)) {
        newText = newText.replaceAll(romaji, kana);
    }
    return fillSokuonGaps(newText);
}

export function convertToKanaIME(text: string, selectionStart: number): KanaIMEOutput {
    const prevSelectionStart = selectionStart;
    const prevLength = text.length;
    let kanaString = '';

    const textLowered = text.toLowerCase();
    if (
        textLowered[prevSelectionStart - 1] === 'n' &&
        textLowered
            .slice(0, prevSelectionStart - 1)
            .replaceAll('nn', '')
            .at(-1) !== 'n'
    ) {
        const n = text.slice(prevSelectionStart - 1, prevSelectionStart);
        const beforeN = text.slice(0, prevSelectionStart - 1);
        const afterN = text.slice(prevSelectionStart);
        kanaString = convertToKana(beforeN) + n + convertToKana(afterN);
    } else if (textLowered.slice(prevSelectionStart - 2, prevSelectionStart) === 'ny') {
        const ny = text.slice(prevSelectionStart - 2, prevSelectionStart);
        const beforeN = text.slice(0, prevSelectionStart - 2);
        const afterN = text.slice(prevSelectionStart);
        kanaString = convertToKana(beforeN) + ny + convertToKana(afterN);
    } else {
        kanaString = convertToKana(text);
    }

    const selectionOffset = kanaString.length - prevLength;

    return { kanaString, newSelectionStart: prevSelectionStart + selectionOffset };
}

export function convertToKana(text: string): string {
    let newText = text;
    for (const [romaji, kana] of Object.entries(ROMAJI_TO_HIRAGANA)) {
        newText = newText.replaceAll(romaji, kana);
        newText = newText.replaceAll(romaji.toUpperCase(), convertHiraganaToKatakana(kana).toUpperCase());
    }
    return fillSokuonGaps(newText);
}

function fillSokuonGaps(text: string): string {
    return text.replaceAll(/っ[a-z](?=っ)/g, 'っっ').replaceAll(/ッ[A-Z](?=ッ)/g, 'ッッ');
}

export function convertToRomaji(text: string): string {
    let newText = text;
    for (const [kana, romaji] of Object.entries(HIRAGANA_TO_ROMAJI)) {
        newText = newText.replaceAll(kana, romaji);
        newText = newText.replaceAll(convertHiraganaToKatakana(kana), romaji);
    }
    return newText;
}

export function convertAlphabeticToKana(text: string): string {
    let part = '';
    let result = '';

    for (const char of text) {
        let c = char.codePointAt(0) as number;
        if (c >= 0x41 && c <= 0x5a) {
            // ['A', 'Z']
            c += 0x61 - 0x41;
        } else if (c >= 0x61 && c <= 0x7a) {
            // ['a', 'z']
            // NOP
        } else if (c >= 0xff21 && c <= 0xff3a) {
            // ['A', 'Z'] fullwidth
            c += 0x61 - 0xff21;
        } else if (c >= 0xff41 && c <= 0xff5a) {
            // ['a', 'z'] fullwidth
            c += 0x61 - 0xff41;
        } else if (c === 0x2d || c === 0xff0d) {
            // '-' or fullwidth dash
            c = 0x2d;
        } else {
            if (part.length > 0) {
                result += convertToHiragana(part);
                part = '';
            }
            result += char;
            continue;
        }
        part += String.fromCodePoint(c);
    }

    if (part.length > 0) {
        result += convertToHiragana(part);
    }
    return result;
}
