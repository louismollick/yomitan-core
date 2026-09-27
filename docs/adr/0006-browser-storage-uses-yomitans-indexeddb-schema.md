# Browser storage uses Yomitan's IndexedDB schema

In the browser, dictionaries live in IndexedDB using Yomitan's own database schema. We did not unify all targets on SQLite-wasm.

## Why not SQLite-wasm

A single SQLite implementation for every target would mean shipping about 1 MB of wasm, requiring a worker for OPFS, and dealing with OPFS quirks across browsers.

## Why Yomitan's schema

It keeps the browser storage adapter close to Yomitan's observable data. It also makes importing a Yomitan database export cheap later on.

## How the adapters stay consistent

The IndexedDB and SQL adapters are held to identical behaviour by shared contract tests, not by sharing code.
