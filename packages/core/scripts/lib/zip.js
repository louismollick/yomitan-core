// What upstream's dictionary-importer.js imports from lib/zip.js. yomitan-core replaces the
// importer's archive access (src/import/importer.ts), so the importer only needs these names:
// `configure` is called once, and `TextWriter`/`BlobWriter` are instantiated only to say which form
// of a file it wants. Real zip reading lives in lib/zip-full.js, loaded on demand, because zip.js
// touches TransformStream at module load, which React Native does not have.

export function configure() {}

export class TextWriter {}

export class BlobWriter {}

function unsupported() {
    throw new Error('Use a yomitan-core ArchiveReader to read dictionary archives');
}

export class Uint8ArrayReader {
    constructor() {
        unsupported();
    }
}

export class ZipReader {
    constructor() {
        unsupported();
    }
}
