// Compiled against the built declarations with the strictest settings a consumer might use:
// skipLibCheck off and no DOM lib (Node and React Native projects).
import type { DictionaryStorage } from 'yomitan-core';
import * as core from 'yomitan-core';

export const storage: DictionaryStorage = core.createMemoryStorage();
