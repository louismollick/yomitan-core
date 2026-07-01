import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';

import type * as DictionaryData from '../../src/types/dictionary-data';

export const TERM_DICTIONARY_TITLE = 'Consumer Terms';
export const STYLED_TERM_DICTIONARY_TITLE = 'Styled Terms';
export const META_DICTIONARY_TITLE = 'Consumer Meta';
export const KANJI_DICTIONARY_TITLE = 'Consumer Kanji';
export const ALT_KANJI_DICTIONARY_TITLE = 'Consumer Kanji Alt';

type ArchiveInput = {
    index: DictionaryData.Index;
    termBank?: DictionaryData.TermV3Array;
    termMetaBank?: DictionaryData.TermMetaArray;
    kanjiBank?: DictionaryData.KanjiV3Array;
    kanjiMetaBank?: DictionaryData.KanjiMetaArray;
    tagBank?: DictionaryData.TagArray;
    styles?: string;
    files?: Record<string, Uint8Array>;
};

type FixtureSet = {
    consumerTerms: ArrayBuffer;
    styledTerms: ArrayBuffer;
    consumerMeta: ArrayBuffer;
    consumerKanji: ArrayBuffer;
    consumerKanjiAlt: ArrayBuffer;
    missingIndex: ArrayBuffer;
    partialFailure: ArrayBuffer;
    chunkedImport: ArrayBuffer;
};

const TINY_PNG_BYTES = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49,
    0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92, 0xef,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

let fixturesPromise: Promise<FixtureSet> | null = null;

export async function getConsumerE2eFixtures(): Promise<FixtureSet> {
    fixturesPromise ??= createFixtures();
    return await fixturesPromise;
}

async function createFixtures(): Promise<FixtureSet> {
    const consumerTerms = await createArchive({
        index: {
            title: TERM_DICTIONARY_TITLE,
            revision: '1',
            format: 3,
            sequenced: true,
            sourceLanguage: 'ja',
            targetLanguage: 'en',
        },
        termBank: [
            ['食べる', 'たべる', 'v1', 'v1', 10, ['to eat'], 1, 'common'],
            ['猫', 'ねこ', 'n', 'n', 5, ['cat'], 2, 'common'],
            [
                '見る',
                'みる',
                'v1',
                'v1',
                8,
                [
                    { type: 'text', text: 'to see' },
                    {
                        type: 'image',
                        path: 'images/sample.png',
                        width: 12,
                        height: 8,
                        title: 'sample title',
                        alt: 'sample image',
                        description: 'sample description',
                    },
                    {
                        type: 'structured-content',
                        content: [
                            {
                                tag: 'div',
                                content: [
                                    'vision ',
                                    { tag: 'ruby', content: ['異形', { tag: 'rt', content: 'いぎょう' }] },
                                    {
                                        tag: 'img',
                                        path: 'images/sample.png',
                                        width: 12,
                                        height: 8,
                                        title: 'sample title',
                                        alt: 'sample image',
                                        description: 'sample description',
                                        background: true,
                                        collapsible: true,
                                    },
                                ],
                            },
                        ],
                    },
                ],
                3,
                'common',
            ],
        ],
        tagBank: [
            ['v1', 'partOfSpeech', 0, 'Ichidan verb', 0],
            ['n', 'partOfSpeech', 0, 'noun', 0],
            ['common', 'frequency', 0, 'common word', 1],
        ],
        styles: '.gloss-sc-div{color:#123456}.term-glossary-list{border:1px solid #333;}',
        files: {
            'images/sample.png': TINY_PNG_BYTES,
        },
    });

    const styledTerms = await createArchive({
        index: {
            title: STYLED_TERM_DICTIONARY_TITLE,
            revision: '1',
            format: 3,
            sequenced: true,
            sourceLanguage: 'ja',
            targetLanguage: 'en',
        },
        termBank: [
            ['食べる', 'たべる', 'v1', 'v1', 7, ['consume nourishment'], 1, 'common'],
            ['学校', 'がっこう', 'n', 'n', 3, ['school'], 2, ''],
        ],
        tagBank: [
            ['v1', 'partOfSpeech', 0, 'Ichidan verb', 0],
            ['n', 'partOfSpeech', 0, 'noun', 0],
            ['common', 'frequency', 0, 'common word', 1],
        ],
        styles: '.gloss-item{background:#eef}.tag{border:1px solid #666;}',
    });

    const consumerMeta = await createArchive({
        index: {
            title: META_DICTIONARY_TITLE,
            revision: '1',
            format: 3,
            sequenced: false,
            sourceLanguage: 'ja',
            targetLanguage: 'en',
            frequencyMode: 'rank-based',
        },
        termMetaBank: [
            ['食べる', 'freq', { value: 42, displayValue: '42' }],
            ['食べる', 'pitch', { reading: 'たべる', pitches: [{ position: 2, tags: ['pitch-accent'] }] }],
            ['食べる', 'ipa', { reading: 'たべる', transcriptions: [{ ipa: 'tabeɾɯ', tags: ['ipa-source'] }] }],
            ['見る', 'freq', { reading: 'みる', frequency: { value: 7, displayValue: '7' } }],
        ],
        tagBank: [
            ['pitch-accent', 'pronunciation', 0, 'pitch accent', 0],
            ['ipa-source', 'pronunciation', 1, 'ipa source', 0],
        ],
    });

    const consumerKanji = await createArchive({
        index: {
            title: KANJI_DICTIONARY_TITLE,
            revision: '1',
            format: 3,
            sequenced: false,
            sourceLanguage: 'ja',
            targetLanguage: 'en',
        },
        kanjiBank: [
            ['食', 'ショク', 'た.べる', 'joyo', ['eat', 'food'], { grade: '2', strokes: '9' }],
            ['猫', 'ビョウ', 'ねこ', 'joyo', ['cat'], { grade: '8', strokes: '11' }],
        ],
        kanjiMetaBank: [['食', 'freq', 100]],
        tagBank: [
            ['joyo', 'class', 0, 'Joyo', 0],
            ['grade', 'misc', 0, 'Grade', 0],
            ['strokes', 'misc', 1, 'Strokes', 0],
        ],
    });

    const consumerKanjiAlt = await createArchive({
        index: {
            title: ALT_KANJI_DICTIONARY_TITLE,
            revision: '1',
            format: 3,
            sequenced: false,
            sourceLanguage: 'ja',
            targetLanguage: 'en',
        },
        kanjiBank: [['食', 'ジキ', 'く.う', 'joyo', ['meal'], { grade: '2' }]],
        tagBank: [
            ['joyo', 'class', 0, 'Joyo', 0],
            ['grade', 'misc', 0, 'Grade', 0],
        ],
    });

    const missingIndex = await createArchive(
        {
            index: {
                title: 'ignored',
                revision: '1',
                format: 3,
            },
            termBank: [['食べる', 'たべる', 'v1', 'v1', 1, ['to eat'], 1, '']],
        },
        { omitIndex: true },
    );

    const partialFailure = await createArchive({
        index: {
            title: 'Broken Consumer Meta',
            revision: '1',
            format: 3,
        },
        termBank: [
            [
                '壊れる',
                'こわれる',
                'v1',
                'v1',
                1,
                [
                    'to break',
                    {
                        type: 'image',
                        path: 'images/missing.png',
                        width: 12,
                        height: 8,
                        title: 'missing asset',
                        alt: 'missing asset',
                        description: 'missing asset',
                    },
                ],
                1,
                '',
            ],
        ],
    });

    const chunkedTerms: DictionaryData.TermV3Array = [];
    for (let i = 0; i < 1001; i += 1) {
        chunkedTerms.push([`単語${i}`, `たんご${i}`, 'n', 'n', i, [`term ${i}`], i, '']);
    }
    const chunkedImport = await createArchive({
        index: {
            title: 'Chunked Terms',
            revision: '1',
            format: 3,
        },
        termBank: chunkedTerms,
        tagBank: [['n', 'partOfSpeech', 0, 'noun', 0]],
    });

    return {
        consumerTerms,
        styledTerms,
        consumerMeta,
        consumerKanji,
        consumerKanjiAlt,
        missingIndex,
        partialFailure,
        chunkedImport,
    };
}

async function createArchive(input: ArchiveInput, options?: { omitIndex?: boolean }): Promise<ArrayBuffer> {
    const writer = new Uint8ArrayWriter();
    const zipWriter = new ZipWriter(writer, { useWebWorkers: false });

    if (!options?.omitIndex) {
        await zipWriter.add('index.json', new TextReader(JSON.stringify(input.index)));
    }
    if (input.termBank) {
        await zipWriter.add('term_bank_1.json', new TextReader(JSON.stringify(input.termBank)));
    }
    if (input.termMetaBank) {
        await zipWriter.add('term_meta_bank_1.json', new TextReader(JSON.stringify(input.termMetaBank)));
    }
    if (input.kanjiBank) {
        await zipWriter.add('kanji_bank_1.json', new TextReader(JSON.stringify(input.kanjiBank)));
    }
    if (input.kanjiMetaBank) {
        await zipWriter.add('kanji_meta_bank_1.json', new TextReader(JSON.stringify(input.kanjiMetaBank)));
    }
    if (input.tagBank) {
        await zipWriter.add('tag_bank_1.json', new TextReader(JSON.stringify(input.tagBank)));
    }
    if (typeof input.styles === 'string') {
        await zipWriter.add('styles.css', new TextReader(input.styles));
    }
    for (const [name, data] of Object.entries(input.files ?? {})) {
        await zipWriter.add(name, new Uint8ArrayReader(data));
    }

    const archive = await zipWriter.close();
    return archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength);
}
