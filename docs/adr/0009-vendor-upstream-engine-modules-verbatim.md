# Vendor upstream engine modules verbatim

Yomitan's engine modules (translator, languages, importer, Anki note data and templates, display generators, options migration) are copied **unchanged** from the pinned upstream commit by `packages/core/scripts/sync-upstream.mjs`, instead of being hand-ported to TypeScript as the overhaul plan first proposed. Our own TypeScript sits around them.

Parity (ADR-0001) comes from running upstream's own code, and moving the pin is mechanical: re-run the sync, then fix whatever the fixtures report. The sync keeps the vendored modules working outside an extension in these ways:
- it swaps a few files for documented overrides (for example `fetch-utilities.js` loads bundled assets instead of `chrome.runtime.getURL`);
- it rewrites references to browser and extension globals (`document`, `Node`, `location`, `chrome`, …) to go through `src/platform/upstream-env.ts`;
- it bundles upstream's third-party libraries the way upstream's own `dev/build-libs.js` does;
- it copies upstream's unit tests next to the vendored code, so they run verbatim.

## Considered options

- **A hand port to TypeScript.** Rejected. It re-creates the drift that motivated the rewrite (the old port had silently wrong Anki markers and unregistered languages), and every upstream update becomes a manual port again.

## Consequences

- Vendored JavaScript is not type-checked (`checkJs: false`). Our TypeScript imports upstream's own `types/ext/*.d.ts` for the types that cross into our code.
- Upstream's display and Anki generators build DOM nodes. Outside a browser they run against a built-in string DOM through the global rerouting. The overhaul plan's "entry views → HTML serializer" becomes "upstream generators on a small DOM", which keeps markup identical to Yomitan's by construction.
- Storage adapters implement upstream's `DictionaryDatabase` interface, because the vendored translator and importer call it directly. Its query semantics are ported once in `IndexedDictionaryStorage`. Every adapter must pass upstream's `database.test.js` cases through the contract tests.
