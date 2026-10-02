import 'fake-indexeddb/auto';
import { createFilesArchiveReader } from 'yomitan-core';
import {
    readFixtureDictionaryFiles,
    runClientContract,
    runGeneratedGoldens,
    runImportContract,
    runRenderAnkiContract,
    runStorageContract,
    runTranslatorParity,
} from '../../contract-tests/src/index';
import { createIndexedDbStorage } from '../src/indexeddb-storage';
import { createMemoryLockManager } from '../src/web-lock-sessions';

const locks = createMemoryLockManager();
let sequence = 0;

function createStorage() {
    return createIndexedDbStorage({ name: `web-contract-${++sequence}`, locks });
}

runStorageContract('IndexedDB', createStorage);
runTranslatorParity('IndexedDB', createStorage);
runImportContract('IndexedDB', createStorage, {
    directory: () => createFilesArchiveReader(readFixtureDictionaryFiles('valid-dictionary1')),
});
runClientContract('IndexedDB', createStorage);
runGeneratedGoldens('IndexedDB', createStorage);
runRenderAnkiContract('IndexedDB', createStorage);
