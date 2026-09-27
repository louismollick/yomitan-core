# yomitan-core

A headless [Yomitan](https://github.com/yomidevs/yomitan) engine: Yomitan's own dictionary importer, translator, languages, Anki note builder and display generators, vendored verbatim and runnable in browsers, Node and React Native (Hermes).

> **Status:** 2.0 is under construction on the `next` branch. See the [overhaul plan](https://github.com/louismollick/yomitan-core/blob/next/docs/overhaul-plan.md). The client API (`createYomitan`) lands in a later milestone; this package currently exposes storage and import building blocks.

```ts
import { createFilesArchiveReader, createMemoryStorage, importDictionaryArchive } from 'yomitan-core';

const storage = createMemoryStorage();
await storage.prepare();
const { result, errors } = await importDictionaryArchive(storage, createFilesArchiveReader(files));
```

Storage adapters:

- `createMemoryStorage()` (this package),
- `createSqlStorage(driver)` over any `SqlDriver` (this package; `@yomitan-core/node` supplies better-sqlite3),
- IndexedDB (`@yomitan-core/web`, planned).

## License

GPL-3.0-or-later. Contains code from Yomitan; see `src/upstream/PROVENANCE.md` in the repository.
