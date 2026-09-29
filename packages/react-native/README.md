# @yomitan-core/react-native

SQLite storage and an unpacked dictionary reader for React Native. Install `yomitan-core`, `@op-engineering/op-sqlite` 17.1, and `react-native` alongside this package.

```ts
import { createReactNativeStorage, createDirectoryArchiveReader } from '@yomitan-core/react-native';
import { importDictionaryArchive } from 'yomitan-core';

const storage = createReactNativeStorage('dictionaries.sqlite', { location: sqliteDirectory });
await storage.prepare();

// Unzip the dictionary with native code first. list returns relative file paths recursively.
const reader = createDirectoryArchiveReader(unpackedDirectory, {
  list: async (dir) => listRelativeFiles(dir),
  readText: async (path) => readUtf8File(path),
  readBytes: async (path) => readBinaryFile(path),
});
const { errors } = await importDictionaryArchive(storage, reader);
await storage.close();
```

Pass a plain filesystem path for `location`, not a `file://` URI. Create its parent directory before opening. The reader calls `readText` or `readBytes` only when an entry is consumed.
