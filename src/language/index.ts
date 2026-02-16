export { LanguageTransformer } from './language-transformer';
export type { TransformedText, TraceFrame, Trace } from './language-transformer';
export { MultiLanguageTransformer } from './multi-language-transformer';
export {
    getLanguageSummaries,
    getAllLanguageReadingNormalizers,
    getAllLanguageTextProcessors,
    isTextLookupWorthy,
    getAllLanguageTransformDescriptors,
} from './languages';
export { languageDescriptorMap } from './language-descriptors';
export {
    basicTextProcessorOptions,
    decapitalize,
    capitalizeFirstLetter,
    removeAlphabeticDiacritics,
} from './text-processors';
export {
    CJK_IDEOGRAPH_RANGES,
    FULLWIDTH_CHARACTER_RANGES,
    CJK_PUNCTUATION_RANGE,
    isCodePointInRange,
    isCodePointInRanges,
    normalizeRadicals,
    normalizeRadicalCharacters,
} from './cjk-util';
export type { CodepointRange } from './cjk-util';
export { suffixInflection, prefixInflection, wholeWordInflection } from './language-transforms';
export { distributeFurigana, distributeFuriganaInflected, generateFurigana } from './ja/furigana';
export type { FuriganaSegment } from './ja/furigana';
export { getLanguageFromText } from './text-utilities';

// Japanese
export {
    isCodePointKanji,
    isCodePointKana,
    isCodePointJapanese,
    isStringEntirelyKana,
    isStringPartiallyJapanese,
    isMoraPitchHigh,
    getPitchCategory,
    getDownstepPositions,
    getKanaMorae,
    getKanaMoraCount,
    convertKatakanaToHiragana,
    convertHiraganaToKatakana,
    convertAlphanumericToFullWidth,
    convertFullWidthAlphanumericToNormal,
    convertHalfWidthKanaToFullWidth,
    getKanaDiacriticInfo,
    normalizeCombiningCharacters,
    normalizeCJKCompatibilityCharacters,
    isEmphaticCodePoint,
    collapseEmphaticSequences,
} from './ja/japanese';
export type { DiacriticType, PitchCategory, FuriganaGroup } from './ja/japanese';
export { japaneseTransforms } from './ja/japanese-transforms';
export {
    convertHalfWidthCharacters,
    alphabeticToHiragana,
    alphanumericWidthVariants,
    convertHiraganaToKatakana as convertHiraganaToKatakanaPreprocessor,
    collapseEmphaticSequences as collapseEmphaticSequencesPreprocessor,
    normalizeCombiningCharacters as normalizeCombiningCharactersPreprocessor,
    normalizeCJKCompatibilityCharacters as normalizeCJKCompatibilityCharactersPreprocessor,
} from './ja/japanese-text-preprocessors';
export {
    convertToHiragana,
    convertToKanaIME,
    convertToKana,
    convertToRomaji,
    convertAlphabeticToKana,
} from './ja/japanese-wanakana';
export type { KanaIMEOutput } from './ja/japanese-wanakana';
export { ROMAJI_TO_HIRAGANA, HIRAGANA_TO_ROMAJI } from './ja/japanese-kana-romaji-dicts';

// Korean
export { isCodePointKorean } from './ko/korean';
export { koreanTransforms } from './ko/korean-transforms';
export { disassembleHangul, reassembleHangul } from './ko/korean-text-processors';

// Chinese
export { isStringPartiallyChinese, isCodePointChinese, normalizePinyin } from './zh/chinese';

// Arabic
export { arabicTransforms } from './ar/arabic-transforms';
export {
    removeArabicScriptDiacritics,
    removeTatweel,
    normalizeUnicode as normalizeArabicUnicode,
    addHamzaTop,
    addHamzaBottom,
    convertAlifMaqsuraToYaa,
    convertHaToTaMarbuta,
} from './ar/arabic-text-preprocessors';

// German
export { germanTransforms } from './de/german-transforms';
export { eszettPreprocessor } from './de/german-text-preprocessors';

// English
export { englishTransforms } from './en/english-transforms';

// Esperanto
export { esperantoTransforms } from './eo/esperanto-transforms';

// Spanish
export { spanishTransforms } from './es/spanish-transforms';

// French
export { frenchTransforms } from './fr/french-transforms';
export { apostropheVariants } from './fr/french-text-preprocessors';

// Modern Greek
export { removeDoubleAcuteAccents } from './el/modern-greek-processors';

// Ancient Greek
export { ancientGreekTransforms } from './grc/ancient-greek-transforms';
export { convertLatinToGreek, latinToGreek } from './grc/ancient-greek-processors';

// Irish
export { irishTransforms } from './ga/irish-transforms';

// Georgian
export { georgianTransforms } from './ka/georgian-transforms';

// Latin
export { latinTransforms } from './la/latin-transforms';
export { processDiphtongs } from './la/latin-text-preprocessors';

// Russian
export { removeRussianDiacritics, yoToE } from './ru/russian-text-preprocessors';

// Old Irish
export { oldIrishTransforms } from './sga/old-irish-transforms';

// Serbo-Croatian
export { removeSerboCroatianAccentMarks } from './sh/serbo-croatian-text-preprocessors';

// Albanian
export { albanianTransforms } from './sq/albanian-transforms';

// Tagalog
export { tagalogTransforms } from './tl/tagalog-transforms';

// Vietnamese
export { normalizeDiacritics as normalizeVietnameseDiacritics } from './vi/viet-text-preprocessors';

// Yiddish
export { yiddishTransforms } from './yi/yiddish-transforms';
export { combineYiddishLigatures, removeYiddishDiacritics } from './yi/yiddish-text-preprocessors';
export { convertFinalLetters, convertYiddishLigatures } from './yi/yiddish-text-postprocessors';

// Assyrian Neo-Aramaic
export { removeSyriacScriptDiacritics } from './aii/assyrian-neo-aramaic-text-preprocessors';
