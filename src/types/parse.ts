import type { TermSource } from './dictionary';

export type ParseTextHeadword = {
    term: string;
    reading: string;
    sources: TermSource[];
};

export type ParseTextSegment = {
    text: string;
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
