import { createMemoryStorage } from '../../core/src/storage/memory-storage';
import {
    runClientContract,
    runGeneratedGoldens,
    runImportContract,
    runStorageContract,
    runTranslatorParity,
} from '../src/index';

runStorageContract('memory', createMemoryStorage);
runTranslatorParity('memory', createMemoryStorage);
runImportContract('memory', createMemoryStorage);
runClientContract('memory', createMemoryStorage);
runGeneratedGoldens('memory', createMemoryStorage);
