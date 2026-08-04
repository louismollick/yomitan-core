import type { TermImage } from './dictionary-data';

export type VerticalAlign = 'baseline' | 'sub' | 'super' | 'text-top' | 'text-bottom' | 'middle' | 'top' | 'bottom';
export type TextDecorationLine = 'underline' | 'overline' | 'line-through';
export type TextDecorationLineOrNone = 'none' | TextDecorationLine;
export type TextDecorationStyle = 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';
export type FontStyle = 'normal' | 'italic';
export type FontWeight = 'normal' | 'bold';
export type WordBreak = 'normal' | 'break-all' | 'keep-all';
export type TextAlign = 'start' | 'end' | 'left' | 'right' | 'center' | 'justify' | 'justify-all' | 'match-parent';
export type SizeUnits = 'px' | 'em';
export type ImageRendering = 'auto' | 'pixelated' | 'crisp-edges';
export type ImageAppearance = 'auto' | 'monochrome';

export type Image = TermImage & {
    verticalAlign: VerticalAlign;
    border: string;
    borderRadius: string;
    sizeUnits: SizeUnits;
};

export type Data = {
    [key: string]: string;
};

export type StructuredContentStyle = {
    fontStyle?: FontStyle;
    fontWeight?: FontWeight;
    fontSize?: string;
    color?: string;
    background?: string;
    backgroundColor?: string;
    textDecorationLine?: TextDecorationLineOrNone | TextDecorationLine[];
    textDecorationStyle?: TextDecorationStyle;
    textDecorationColor?: string;
    borderColor?: string;
    borderStyle?: string;
    borderRadius?: string;
    borderWidth?: string;
    clipPath?: string;
    verticalAlign?: VerticalAlign;
    textAlign?: TextAlign;
    textEmphasis?: string;
    textShadow?: string;
    margin?: string;
    marginTop?: number | string;
    marginLeft?: number | string;
    marginRight?: number | string;
    marginBottom?: number | string;
    padding?: string;
    paddingTop?: string;
    paddingLeft?: string;
    paddingRight?: string;
    paddingBottom?: string;
    wordBreak?: WordBreak;
    whiteSpace?: string;
    cursor?: string;
    listStyleType?: string;
};

export type LineBreak = {
    tag: 'br';
    data?: Data;
    content?: undefined;
    lang?: undefined;
};

export type UnstyledElement = {
    tag: 'ruby' | 'rt' | 'rp' | 'table' | 'thead' | 'tbody' | 'tfoot' | 'tr';
    content?: Content;
    data?: Data;
    lang?: string;
};

export type TableElement = {
    tag: 'td' | 'th';
    content?: Content;
    data?: Data;
    colSpan?: number;
    rowSpan?: number;
    style?: StructuredContentStyle;
    lang?: string;
};

export type StyledElement = {
    tag: 'span' | 'div' | 'ol' | 'ul' | 'li' | 'details' | 'summary';
    content?: Content;
    data?: Data;
    style?: StructuredContentStyle;
    title?: string;
    open?: boolean;
    lang?: string;
};

export type ImageElementBase = {
    data?: Data;
    path: string;
    width?: number;
    height?: number;
    preferredWidth?: number;
    preferredHeight?: number;
    title?: string;
    alt?: string;
    description?: string;
    pixelated?: boolean;
    imageRendering?: ImageRendering;
    appearance?: ImageAppearance;
    background?: boolean;
    collapsed?: boolean;
    collapsible?: boolean;
};

export type ImageElement = ImageElementBase & {
    tag: 'img';
    content?: undefined;
    verticalAlign?: VerticalAlign;
    border?: string;
    borderRadius?: string;
    sizeUnits?: SizeUnits;
};

export type LinkElement = {
    tag: 'a';
    content?: Content;
    href: string;
    lang?: string;
};

export type Element = LineBreak | UnstyledElement | TableElement | StyledElement | ImageElement | LinkElement;

export type Content = string | Element | Content[];
