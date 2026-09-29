import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    runClientContract,
    runImportContract,
    runStorageContract,
    runTranslatorParity,
    upstreamFixturesDir,
} from '../../contract-tests/src/index';
import { createDirectoryArchiveReader, createNodeStorage } from '../src/index';

function createFileStorage() {
    return createNodeStorage(join(mkdtempSync(join(tmpdir(), 'yomitan-node-')), 'dictionaries.sqlite'));
}

runStorageContract('sqlite file', createFileStorage);
runStorageContract('sqlite :memory:', () => createNodeStorage(':memory:'));
runTranslatorParity('sqlite', createFileStorage);
runImportContract('sqlite', createFileStorage, {
    directory: () => createDirectoryArchiveReader(join(upstreamFixturesDir, 'dictionaries', 'valid-dictionary1')),
});
runClientContract('sqlite', createFileStorage);
