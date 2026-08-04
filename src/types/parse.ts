import type { TermSource } from './dictionary';

export type ParseTextHeadword = {
    term: string;
    reading: string;
    sources: TermSource[];
};

export type Utf16Range = { startUtf16: number; endUtf16: number };

export type ParseTextSegment = {
    text: string;
    range: Utf16Range;
    reading: string;
    headwords?: ParseTextHeadword[][];
};

export type ParseTextLine = ParseTextSegment[];

export type ParseTextResultItem = {
    id: string;
    source: 'scanning-parser' | 'mecab';
    dictionary: null | string;
    index: number;
    content: ParseTextLine[];
};
