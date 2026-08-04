# Migrating to the v2 client

The v1 `YomitanCore` class and subpath exports remain available during the v2
migration. New integrations should use `createYomitan` and inject storage.

```ts
const yomitan = createYomitan({ storage });
await yomitan.initialize();
```

Key changes:

- Dictionary selections are arrays of `{ id, index, ...options }`, not public
  `Map` values. The client converts them internally.
- `lookup.scanLine` returns untrimmed source text plus UTF-16 ranges. Use those
  ranges for selection and follow-up lookup.
- `lookup.termAt` accepts an exact UTF-16 offset and returns the matched range.
- Imports are staged. A failed, cancelled, or interrupted new import is not
  listed or available to normal lookup, and startup removes staged rows.
- Call `dispose()` when an app-lifetime client is torn down.

The current v2 preview uses an `ArrayBuffer` import source. The platform archive
ports will replace this compatibility input before the final v2 release; do not
load mobile dictionary archives into JavaScript memory.
