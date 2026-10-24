# Browser storage uses Yomitan's IndexedDB schema

In the browser, dictionaries live in IndexedDB using Yomitan's own database schema. We did not unify all targets on SQLite-wasm.

## Why not SQLite-wasm

A single SQLite implementation for every target would mean shipping about 1 MB of wasm, requiring a worker for OPFS, and dealing with OPFS quirks across browsers.

## Why Yomitan's schema

It keeps the browser storage adapter close to Yomitan's observable data. It also makes importing a Yomitan database export cheap later on.

## How the adapters stay consistent

The IndexedDB and SQL adapters are held to identical behaviour by shared contract tests, not by sharing code.

## Amendment (2026-10-23): the `kanjiTerms` store

The database version is 61: Yomitan's version 60 plus a `kanjiTerms` store (indices `dictionary`, `character`) that Yomitan doesn't have. It holds the kanji-term index, derived from a dictionary's term frequencies and deleted with the dictionary. Opening a version 60 database creates the missing store and leaves existing data untouched. A Yomitan database export can still be imported, since the extra store is derived data that is rebuilt on demand. Opening is rejected with "Close other tabs of this app to finish upgrading the dictionary database" if another tab's older connection blocks the upgrade, and every connection closes itself on `versionchange` so later upgrades are not blocked. The SQL schema (ADR-0004) gains the same table in schema version 2, migrated on open.
