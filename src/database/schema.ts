import Dexie from 'dexie';
import type { ObjectStoreName } from '../types/dictionary-database';

export class YomitanDatabase extends Dexie {
    terms!: Dexie.Table;
    termMeta!: Dexie.Table;
    kanji!: Dexie.Table;
    kanjiMeta!: Dexie.Table;
    tagMeta!: Dexie.Table;
    dictionaries!: Dexie.Table;
    media!: Dexie.Table;

    constructor(name = 'dict') {
        super(name);

        this.version(20).stores({
            terms: '++id, dictionary, expression, reading',
            kanji: '++, dictionary, character',
            tagMeta: '++, dictionary',
            dictionaries: '++, title, version',
        });

        this.version(30).stores({
            terms: '++id, dictionary, expression, reading',
            kanji: '++, dictionary, character',
            tagMeta: '++, dictionary, name',
            dictionaries: '++, title, version',
            termMeta: '++, dictionary, expression',
            kanjiMeta: '++, dictionary, character',
        });

        this.version(40).stores({
            terms: '++id, dictionary, expression, reading, sequence',
            kanji: '++, dictionary, character',
            tagMeta: '++, dictionary, name',
            dictionaries: '++, title, version',
            termMeta: '++, dictionary, expression',
            kanjiMeta: '++, dictionary, character',
        });

        this.version(50).stores({
            terms: '++id, dictionary, expression, reading, sequence, expressionReverse, readingReverse',
            kanji: '++, dictionary, character',
            tagMeta: '++, dictionary, name',
            dictionaries: '++, title, version',
            termMeta: '++, dictionary, expression',
            kanjiMeta: '++, dictionary, character',
        });

        this.version(60).stores({
            terms: '++id, dictionary, expression, reading, sequence, expressionReverse, readingReverse',
            kanji: '++, dictionary, character',
            tagMeta: '++, dictionary, name',
            dictionaries: '++, title, version',
            termMeta: '++, dictionary, expression',
            kanjiMeta: '++, dictionary, character',
            media: '++id, dictionary, path',
        });
    }
}

export const OBJECT_STORE_NAMES: ObjectStoreName[] = [
    'dictionaries',
    'terms',
    'termMeta',
    'kanji',
    'kanjiMeta',
    'tagMeta',
    'media',
];
