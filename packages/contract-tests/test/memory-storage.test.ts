import { createMemoryStorage } from '../../core/src/storage/memory-storage';
import { runStorageContract, runTranslatorParity } from '../src/index';

runStorageContract('memory', createMemoryStorage);
runTranslatorParity('memory', createMemoryStorage);
