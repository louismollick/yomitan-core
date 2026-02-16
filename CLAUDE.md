# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and development commands

```bash
npm run build          # Build ESM + CJS + .d.ts with tsdown (~2s)
npm run dev            # Watch mode build
npm run typecheck      # TypeScript strict checking (tsc --noEmit)
npm run lint           # Biome lint + format check
npm run lint:fix       # Auto-fix lint and formatting
npm run test           # Run vitest suite
npm run test:watch     # Watch mode tests
npx vitest run src/util/string-util.test.ts  # Run a single test file
```

Always run `npm run typecheck` after making changes — the project uses TypeScript strict mode.

## Architecture

This is the core engine extracted from the Yomitan browser extension into a standalone npm library. All browser extension APIs (`chrome.*`, `Worker`, `RequestBuilder`) have been replaced with standard equivalents (Dexie, fetch, constructor-injected DOM).

### Entry points

The library has 8 tree-shakeable entry points defined in `tsdown.config.ts`, each with its own barrel export in `src/<module>/index.ts`:

| Entry point | Path | Purpose |
|---|---|---|
| `yomitan-core` | `src/index.ts` | `YomitanCore` orchestrator class — high-level API wrapping all modules |
| `yomitan-core/database` | `src/database/` | Dexie-based IndexedDB storage (DictionaryDB, schema) |
| `yomitan-core/import` | `src/import/` | Dictionary .zip import, AJV schema validation, update checking |
| `yomitan-core/lookup` | `src/lookup/` | Translator (4 find modes), sentence parser, batch processor, frequency ranker |
| `yomitan-core/language` | `src/language/` | 48 languages: transforms, text processors, CJK utils, furigana |
| `yomitan-core/anki` | `src/anki/` | AnkiConnect client, note builder, Handlebars template renderer |
| `yomitan-core/render` | `src/render/` | HTML display generation (requires DOM injection) |
| `yomitan-core/audio` | `src/audio/` | Audio URL generation for multiple providers |

### Key data flow

1. **Import**: `DictionaryImporterClass` reads a .zip (via zip.js), validates JSON banks against AJV schemas in `src/import/schemas/`, and bulk-inserts into `DictionaryDB`
2. **Lookup**: `Translator` takes text → runs through `MultiLanguageTransformer` for deinflection → queries `DictionaryDB.findTermsBulk` → groups/merges/sorts results → resolves tags and frequencies
3. **Render**: `DisplayGenerator` takes dictionary entries → generates DOM nodes using injected `Document` and `HtmlTemplateCollection` templates

### Module dependency direction

```
index.ts (YomitanCore)
  ├── database/  (no internal deps, uses Dexie)
  ├── import/    (depends on database/, util/, types/)
  ├── language/  (self-contained, per-language subdirectories)
  ├── lookup/    (depends on database/, language/, util/)
  ├── anki/      (depends on language/, util/)
  ├── render/    (depends on language/, util/, needs injected DOM)
  └── audio/     (self-contained, needs injected DOM parser)
```

### Extension code replacements

| Extension pattern | Library replacement |
|---|---|
| `ExtensionError` | `YomitanError extends Error { data: unknown }` in `src/util/errors.ts` |
| `chrome.runtime.getURL()` for schemas/templates | Bundled as JSON imports or string constants |
| `DictionaryDatabaseWorker` / Web Workers | Removed — consumers manage own workers |
| `RequestBuilder.fetchAnonymous()` | Standard `fetch()` |
| Global `document`/`window` | Constructor-injected `Document` parameter |
| `safePerformance.mark/measure` | Removed |

### Type system

Types are in `src/types/` as proper TS exports (converted from Yomitan's `declare module` ambient types). The barrel `src/types/index.ts` re-exports most types but **excludes** `dictionary-data`, `dictionary-database`, and `dictionary-data-util` due to overlapping type names (Tag, KanjiMeta, TermMeta). Import those directly when needed.

### Language transforms

Each language lives in `src/language/<iso>/` with up to 3 files: `*-transforms.ts` (deinflection rules using `Rule<Condition>` generics), `*-text-preprocessors.ts`, and sometimes `*-text-postprocessors.ts`. The `Condition` type is always a string union derived from a local `conditions` object — it must be defined **before** the export that references it. Transform descriptors are registered in `src/language/language-descriptors.ts`.

## Code style

- **Formatter**: Biome — 4-space indent, single quotes, trailing commas, semicolons, 120 char line width
- **Lint rules intentionally disabled** (for ported Yomitan patterns): `noParameterAssign`, `noNonNullAssertion`, `noExplicitAny`, `noAssignInExpressions`, `noExcessiveCognitiveComplexity`, `noControlCharactersInRegex`
- Use `YomitanError` (not plain `Error`) when attaching structured data to errors
- DOM-dependent code must accept `Document` as a constructor/function parameter, never access globals
