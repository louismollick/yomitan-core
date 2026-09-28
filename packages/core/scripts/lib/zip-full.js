// zip.js without web workers, for yomitan-core's zip ArchiveReader. Loaded lazily.
import { configure } from '@zip.js/zip.js/lib/zip-no-worker-inflate.js';

configure({ useWebWorkers: false });

export {
    BlobReader,
    TextWriter,
    Uint8ArrayReader,
    Uint8ArrayWriter,
    ZipReader,
} from '@zip.js/zip.js/lib/zip-no-worker-inflate.js';
