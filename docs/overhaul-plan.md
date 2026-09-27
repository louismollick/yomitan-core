# Overhaul plan: yomitan-core 2.0

This plan rewrites yomitan-core into a headless Yomitan with **parity**: from the outside it looks and behaves like Yomitan. It covers three **targets**: browser (IndexedDB), Node (SQLite) and React Native (SQLite). It keeps mokuro-reader's current features working throughout.

- Terms follow [CONTEXT.md](../CONTEXT.md).
- Decisions are recorded in [docs/adr](./adr) and are not re-argued here.
- Functionality deferred past this overhaul is in [roadmap.md](./roadmap.md).

## 1. Verdict on the current code and PR #3

**Recommendation: an overhaul, done as a clean-break rewrite (ADR-0007).** Close PR #3 without merging. Its direction (a platform-free core plus platform packages) is right, but it packages before it builds seams:

- The four facade packages are 1–3 line re-exports.
- Core still hard-depends on Dexie, better-sqlite3, postcss and linkedom.
- The React Native facade crashes on the first lookup, because `util/debug.ts` reads `window.location.search` and React Native has a `window` but no `location`.

The existing port has also drifted from Yomitan in ways users can see. Nothing catches this because no upstream golden test runs:

| Area | Drift |
| --- | --- |
| Languages | Only Japanese deinflection is wired. The other languages' transforms are present but never registered, and several languages are missing entirely. |
| Import | Dictionaries that declare `minimumYomitanVersion` can't be imported through the v2 client (`'0.0.0'` vs upstream's `'0.0.0.0'`). |
| Anki: pitch accent | The `{pitch-accent-*}` markers render empty, because the `pronunciation` helper is not registered. |
| Anki: cloze | `{cloze-body-kana}` is wrong for inflected words. |
| Anki: glossary markup | Glossary HTML is not escaped (upstream fixed this in #2394). |
| Anki: single-glossary markers | `{single-glossary-<dict>}` markers were dropped. |
| Images | Stored as 0×0 and never loaded. |
| Scan, parse, termAt | `scanLine` drops every line after the first. Parse gives dictionary-form readings instead of furigana for the inflected surface text. `termAt` finds the token covering the offset, instead of scanning from it. The `removeNonJapaneseCharacters` default is flipped. |
| Frequency | Frequency ranking and the "Average" frequency group use different semantics from upstream. |
| Search performance | SQLite prefix/suffix search does a full table scan. Suffix search returns nothing unless the importer opted in. |
| Baseline | The code is a mix of upstream versions older than the one `UPSTREAM.md` claims. |

Fixing these one by one in the current port costs more than re-porting from a pinned upstream commit with golden tests in place.

**What we keep, as behaviour rather than code:**
- Staged imports that stay invisible until they commit.
- Cancellation.
- UTF-16 ranges on lookup results.
- Array-ordered dictionary settings.
- The practice of running one set of test cases over every storage adapter.
- The SQLite adapter's SQL, as a starting point.

## 2. Goals and non-goals

**Goals:**

1. **Parity (ADR-0001).** Same dictionaries and profile in, same observable output out:
   - entries, ordering, inflection rule chains, frequencies, pitch accents, tags;
   - parse output with furigana;
   - sentences;
   - Anki field values;
   - entry markup.

   Upstream's golden fixtures, together with goldens we generate by running upstream code, both pinned to `67db60d`, enforce this.
2. **One interface** for all three targets. It is serializable (ADR-0005), and runs in-process or in a worker.
3. **Real seams**, each with at least two adapters:
   - storage: IndexedDB and SQL;
   - SQL driver: better-sqlite3 and op-sqlite;
   - dictionary archive reader: zip bytes and an unpacked directory;
   - Anki transport: AnkiConnect and a test fake;
   - renderer: HTML string and DOM element.
4. **Good developer experience.** A consumer should render a Yomitan popup with a single custom element and three event listeners, and should persist a single profile object.
5. **mokuro-reader keeps every feature it has today**, and gains working dictionary images, sentence/cloze fields, and dictionary ordering that actually sticks.

**Non-goals for this overhaul** (see [roadmap.md](./roadmap.md)):
- Audio download and validation.
- Anki media injection.
- The DOM text scanner.
- The React Native renderer.
- AnkiDroid.
- MeCab.
- Multiple profiles and conditional switching (ADR-0002).
- Migrating old stored data (ADR-0007).
- Changes to lapis. It stays on the published `yomitan-core@1.7.0`, and 1.x stays installable.

## 3. Target architecture

### 3.1 Packages

| Package | Contents | Runtime dependencies |
| --- | --- | --- |
| `yomitan-core` | Engine: import, lookup (terms, kanji, scan, parse, sentence), languages, profile, SQL storage over `SqlDriver`, entry views, HTML renderer, display controller, Anki (note building, template rendering, AnkiConnect transport), audio source URL resolution | Pure JS only. Must run on Hermes. No DOM, no Node built-ins, no native modules. |
| `@yomitan-core/web` | IndexedDB storage (Yomitan's schema, ADR-0006), `<yomitan-entries>` custom element, CSS/icons/font assets, web-worker host | `yomitan-core` |
| `@yomitan-core/node` | better-sqlite3 `SqlDriver`, file-path archive source, database compaction | `yomitan-core`, `better-sqlite3` (peer) |
| `@yomitan-core/react-native` | op-sqlite `SqlDriver`, archive reader over an unpacked directory | `yomitan-core`, `@op-engineering/op-sqlite` (peer) |
| `@yomitan-core/contract-tests` (private) | Behavioural suites: `runStorageContract(makeStorage)`, `runClientContract(makeClient)`, the parity (golden) suite | dev only |

**Build and release rules:**
- All packages release in lockstep and are published as GPL-3.0-or-later.
- Every package is ESM-only with `sideEffects: false`. No current consumer uses `require()`: lapis stays on 1.x, and it loads the library with dynamic `import()` anyway.
- Core has no optional or native dependencies.

### 3.2 The client interface (indicative)

This shows the shape; exact names get settled in milestone 1. There are two kinds of input:

- **Construction dependencies** (`storage`, `fetch`, `htmlParser`, `archiveReaders`, `imageInfoReader`) are handed to `createYomitan` wherever the engine runs. They never cross a transport, and no call accepts a function or class instance.
- **Calls** are plain structured-cloneable data in and out (ADR-0005). The two exceptions, progress callbacks and `AbortSignal`, are adapted by the transport (see Worker host in §3.3).

```ts
const yomitan = await createYomitan({
  storage,              // StorageAdapter: IndexedDB, or SQL over a driver
  fetch?,               // injected for URL imports, update checks, audio, AnkiConnect
  htmlParser?,          // injected for audio sources that scrape HTML
  archiveReaders?,      // e.g. { directory: nativeUnzipDirectoryReader } (React Native), { path: fsReader } (Node)
  imageInfoReader?,     // defaults to the header parser; web supplies the browser decoder
  profile?,             // initial profile; defaults to Yomitan's defaults
});

yomitan.profile.get() / set(profile) / defaults() / migrate(unknownJson) / importYomitanSettings(json, { profileIndex })
yomitan.profile.syncDictionaries()   // add newly installed dictionaries and drop removed ones, keeping order, as Yomitan's settings do

yomitan.dictionaries.list() / import({ source, signal, onProgress }) / delete(title, { onProgress })
    // source: bytes | Blob | { url } | { path } | { directory }, all plain data
    // { path } and { directory } are resolved by the matching construction-time archive reader.
    // Over a worker, bytes are transferred and URLs are fetched inside the worker.
yomitan.dictionaries.checkUpdates() / update(title, { signal, onProgress })   // keeps the dictionary's profile settings
yomitan.dictionaries.recommended(language) / getMedia(title, path)

yomitan.lookup.terms(text, { mode?, primaryReading? })   // Yomitan's findTerms with profile-derived options; per-call details as in Yomitan's termsFind
yomitan.lookup.kanji(text)
yomitan.lookup.scan(text, offset)       // Yomitan's TextScanner semantics: entries, matched range, sentence
yomitan.lookup.parse(text)              // Yomitan's scanning parser: segments with UTF-16 ranges and furigana
yomitan.lookup.sentence(text, offset)

yomitan.render.views(entries)           // EntryView[]
yomitan.render.html(entries, { styles: 'inline' | 'external', media: 'placeholder' | 'data-uri' | 'anki' | { urlTemplate } })
    // urlTemplate: a string such as 'app://media/{dictionary}/{path}', with URL-encoded substitution

yomitan.anki.markers(type) / buildNote(entry, cardFormatIndex, { context, extraMarkers }) / renderFields(...)
    // extraMarkers: consumer-defined values, such as mokuro-reader's {series} and {volume}, resolved alongside Yomitan's markers
yomitan.audio.sources(term, reading)    // URL resolution only; fetch and validation are on the roadmap

yomitan.dispose()
```

**Why `profile.set` holds state.** The profile is held by the client, not passed on every call. Anki field templates alone are around 50 KB, and a worker transport shouldn't copy that on every lookup. The consumer persists `profile.get()` wherever it likes (ADR-0002).

**What a profile is.** It is the Yomitan profile `options` subset with the same key paths and defaults:

| Group | Keys |
| --- | --- |
| `general` | `language`, `resultOutputMode`, `maxResults`, `mainDictionary`, `sortFrequencyDictionary(Order)`, `glossaryLayoutMode`, `compactTags`, `termDisplayMode`, `frequencyDisplayMode`, `averageFrequency`, `showPitchAccent*`, … |
| `scanning` | `length`, `alphanumeric`, `matchTypePrefix`, `scanResolution` |
| Whole groups | `translation`, `dictionaries[]`, `parsing`, `sentenceParsing`, `audio`, `anki` (including `cardFormats`) |

Excluded: `popupWindow`, `inputs`, `clipboard`, `accessibility`, scan inputs and popup positioning, and profile conditions.

**How the profile is typed and migrated:**
- The types are generated from upstream `ext/data/schemas/options-schema.json` restricted to that subset.
- The profile carries upstream's options `version`.
- Migration re-uses upstream's `options-util.js` update chain, which also upgrades default Anki field templates. Upstream fetches the template patches (`ext/data/templates/anki-field-templates-upgrade-v*.handlebars`) and the options schema at runtime with `fetchText`/`fetchJson`. We bundle them as modules instead, so migration works offline and on every target. So importing a Yomitan settings export means: run the upstream update chain, take the chosen profile, then project it onto the subset.

### 3.3 Modules and seams

Each row is a module; the interface column says what a caller needs to know.

| Module | Interface | Behind the seam | Adapters |
| --- | --- | --- | --- |
| **Lookup engine** | The `lookup` namespace | Re-ported upstream translator, language transformer, text processors (array variants, #2312), and scanning parser. The profile → `FindTermsOptions` mapping is re-ported from upstream `backend.js` (`_getTranslatorFindTermsOptions`, text-replacement compilation, merge-mode main dictionary, `maxResults`). The parse cache and the translator's tag cache are invalidated on import and delete. | none (in-process) |
| **Storage** | Yomitan's dictionary query interface: `findTermsBulk`, `findTermsExactBulk`, `findTermsBySequenceBulk`, `findTermMetaBulk`, `findKanjiBulk`, `findKanjiMetaBulk`, `findTagMetaBulk`, `getDictionaryInfo`, `getMedia`, plus `getCounts`, `deleteDictionary`, `beginImport() → ImportSession { add(kind, rows), commit(), abort() }` | The rules shared by every adapter live in core, above the seam: row → entry mapping, match-type rules, staged visibility | IndexedDB (web), SQL (core) |
| **SQL storage** | `SqlDriver { exec, run, all, transaction }` | Schema, versioned migrations, and range queries for prefix/suffix search (`>= ? AND < ?` on forward and reverse columns; no `LIKE`). Import batching uses savepoints driven by the SQL storage itself, never by a driver's implicit batch transaction. Batch semantics differ between drivers: op-sqlite 17.1's JS `executeBatch` wraps `BEGIN`/`COMMIT` via `executeSync`, while its native batch runs in autocommit. substreamer's `db/client.ts` documents that a JS-thread `BEGIN` hard-fails on Android while a pool transaction is open. So `SqlDriver.transaction` is implemented per driver, and the op-sqlite driver pins `^17.1`. A metadata table records the schema version and the engine version that wrote the file, so prebuilt databases are portable (ADR-0004). | better-sqlite3 (node), op-sqlite (react-native), in-memory driver (tests) |
| **Import** | `dictionaries.import({ source })` where `source` is plain data: bytes, `Blob`, `{ url }`, `{ path }` or `{ directory }`. The last two are resolved by `ArchiveReader`s registered at construction. | Upstream importer logic, precompiled schema validators (no `new Function`), a single validate-and-convert pass per bank, and image dimensions through an `ImageInfoReader` seam. Upstream decodes each image with `Image()` and **fails the import** if decoding fails, so image handling is its own adapter: <br>• **Default adapter (every target):** a format-aware parser. &nbsp;&nbsp;– PNG IHDR; GIF logical screen; JPEG SOFn marker scan; WebP VP8/VP8L/VP8X; BMP. &nbsp;&nbsp;– SVG `width`/`height` in absolute units, otherwise `viewBox`. &nbsp;&nbsp;– Hard limits on scanned bytes. &nbsp;&nbsp;– An unparseable raster image fails the import, as upstream does. &nbsp;&nbsp;– An SVG with no intrinsic size records 0×0, a listed deviation from Chromium's `naturalWidth`. <br>• **Browser-decoder adapter (web):** decodes with `Image()`, for exact parity. <br>• **Parity check:** both adapters are compared on an image corpus (upstream's test dictionary plus real Jitendex and 三省堂 images).<br><br>**Version check.** The `minimumYomitanVersion` check compares against the **Yomitan release version of the parity pin**, recorded in `PROVENANCE.md`, not against yomitan-core's own version. Dictionaries declare Yomitan versions such as `24.1.1.0`, so comparing them with `2.0.0` would reject valid dictionaries. | Zip reader over bytes/Blob (zip.js, no workers); directory reader (React Native native unzip, Node fs) |
| **Import coordination** | Implicit. At most one import **or** delete runs per database at a time; others wait or fail with `busy`. Staged rows are recovered on open. | Each write session row records `{ id, kind: import \| delete, ownerToken, startedAt, heartbeatAt }`. There are two liveness mechanisms, one per storage kind:<br>• **Browser (IndexedDB):** imports **and deletes** hold the Web Lock `yomitan-write:<db>` (`navigator.locks`) for the session's lifetime. Recovery may delete a session's staged rows only if `navigator.locks.request(name, { ifAvailable: true })` succeeds. The lock is released automatically when a tab crashes or closes, while a suspended tab still holds it, so its import is never touched.<br>• **SQL (Node, React Native):** there are no cross-process locks. The owner renews `heartbeatAt` every 10 s in its own short write between import batches (inside a batch transaction the write would be invisible to other connections), and recovery deletes only sessions whose heartbeat is older than 2 minutes. <br>• **Stale owners.** Claiming a session is atomic: an `INSERT` that fails if any live session exists. Every batch write, heartbeat and commit first runs `UPDATE sessions … WHERE id = ? AND ownerToken = ?` inside the same transaction, and aborts with `session-lost` if no row matches. Recovery deletes the session row in the same transaction as its staged rows. So an owner that resumes after being recovered (for example a suspended React Native process) can't write or commit. <br>• lapis-style multi-process use gets correct recovery; concurrent writers fail fast with `busy`.<br>• **Tests:** &nbsp;&nbsp;– a two-tab Playwright test: tab B opens and tries a delete while tab A imports, then tab A is killed; &nbsp;&nbsp;– a two-process SQL test covering a crashed owner, and a **stale owner that resumes after recovery** and must fail with `session-lost`. | IndexedDB, SQL |
| **Profile** | The `profile` namespace | Defaults, validation, upstream migrations, Yomitan settings import, dictionary sync | none |
| **Entry views** | `render.views(entries) → EntryView[]` | Everything upstream `DisplayGenerator` works out before touching the DOM: headword furigana segments, match flags, grouped tags, frequency groups including the harmonic "Average" (upstream `dictionary-data-util` semantics), pitch positions and graph geometry, inflection rule chains, normalized structured content, and per-dictionary style IDs | none |
| **HTML renderer** | `render.html(entries, options) → { html, css }` | Two outputs built on one shared **structured-content serializer** (a port of `structured-content-generator.js` that emits strings, with escaping): <br>• `render.html` wraps it in **upstream's popup markup** from `templates-display.html` (`.entry`, `.definition-list`, …) with the display CSS. <br>• The Anki glossary helpers wrap it in **upstream's Anki markup** from the Anki field templates (`.yomitan-glossary`, `<ol>`/`<li data-dictionary>`) with Anki's inline or compact styles. <br>The two outputs differ in markup, exactly as they do in Yomitan. Each has its own golden gate: presentation snapshots for the popup, Anki goldens for fields. <br>**Media.** Images are emitted with upstream's structure and `data-path`/`data-dictionary` attributes. Their `src` depends on the `media` option: <br>• `placeholder` (no `src`): the DOM element resolves images asynchronously; <br>• `data-uri`: an async variant that inlines the bytes, for WebViews and Node; <br>• `'anki'`: the engine computes Yomitan's hashed Anki media file names, used once media injection lands; <br>• `{ urlTemplate }`: a serializable consumer mapping such as `app://media/{dictionary}/{path}`. <br>Presentation snapshots compare markup with `src` stripped. Image rendering itself is checked separately in Playwright.<br>**Styles.** Dictionary `styles.css` is scoped with one mechanism, used for both display and Anki. In inline-style mode it applies `structured-content-style.json` the way upstream `CssStyleApplier` does. | none |
| **Anki** | The `anki` namespace, plus an `AnkiTransport` | Upstream note-data creator, template renderer and helpers (including `pronunciation`), dynamic markers (`single-glossary-*`), and card formats. Upstream's CSP-safe Handlebars build (`compileAST`) is vendored. Glossary helpers use the shared structured-content serializer with Anki's own wrappers, so Anki output is the same on every target, with no DOM or linkedom involved. Prepared templates are cached per profile version. | AnkiConnect over injected `fetch` (with API key on `multi` actions, #2421, and batched duplicate queries, #2479); an in-memory fake for tests; **consumer-supplied transports**. The `AnkiTransport` interface declares capabilities (`canAddNotesWithErrorDetail`, `guiBrowse`, `updateNoteFields`), so the display controller can degrade the way Yomitan does when an action is missing. This is required for AnkiConnect Android, which mokuro-reader supports. |
| **Display controller** | `createDisplayController(yomitan, { anki: transport })` → per-entry action state plus `perform(action)` | Yomitan's entry actions (ADR-0008): add note with Yomitan's duplicate check and duplicate behaviour (new, overwrite, prevent), view note, kanji drill-down request, collapse/expand. `play-audio` is part of ADR-0008 but ships after 2.0 as roadmap P0 #1; until then the default renderer hides the audio button (ADR-0008, amended). | none (it drives the Anki transport) |
| **DOM renderer** | `<yomitan-entries>` element: `entries`, `controller` properties; events `kanji-click`, `link-click`, `action`; CSS variables and `::part()` | A shadow root holding the HTML renderer's output, upstream CSS as real `.css` assets (icons and stroke-order font included), and theme attributes from the profile. Images load through `getMedia` into object URLs, which are revoked when entries are replaced or the element disconnects. Clicks are delegated and turned into events or controller actions. | — (web only) |
| **Worker host** | `exposeYomitan(worker, yomitan)` / `connectYomitan(worker) → Yomitan` | Message protocol: <br>• Every call carries a request ID. <br>• Progress arrives as ordered `progress` messages before the terminal `result` or `error`. <br>• An `AbortSignal` becomes a `cancel` message, acknowledged by an `AbortError` result. <br>• Errors cross as `{ name, message, code, details }` and are rebuilt as typed errors on the caller's side. <br>• Archive and media bytes are transferred (`Transferable`), not copied. <br>• `dispose()` rejects in-flight calls. <br>• The worker constructs its own storage and `fetch`; the page never sends dependencies. <br>• The client contract tests (including import, cancel and error cases) run over this protocol. | web worker (web). React Native threads are on the roadmap. |

**Why the DOM renderer sits on the HTML renderer.** It's thin because it is a host for the HTML renderer's output, not a second implementation. The browser, Node and WebViews share one popup-markup path, and Anki fields share the structured-content serializer underneath it. That also removes linkedom, postcss and the 17 host `data-*` attributes consumers set by hand today.

## 4. Parity harness

The parity suite lives in `contract-tests`. It runs against **every** storage adapter (SQL with better-sqlite3, IndexedDB with fake-indexeddb) and against the worker transport.

**Fixture sources.** Fixtures are copied from upstream `67db60d` under `contract-tests/fixtures/upstream/`, with a `PROVENANCE.md` recording the commit.

| Upstream fixture | Asserts |
| --- | --- |
| `test/data/translator-test-inputs.json` + `translator-test-results.json` (47 `findTerms` + 3 `findKanji` cases) | The lookup engine's translator. See the note on seams below. |
| `translator-test-results-note-data1.json` | Anki note data |
| `anki-note-builder-test-results.json` | Exact rendered field values for the translator fixture entries, per result mode. This proves output parity for those entries, not that every marker is covered; see the marker coverage table below. |
| `test/data/dictionaries/valid-dictionary1`, `invalid-dictionary1–6` | Import success and failure |
| `database-test-cases.json` | Storage query semantics |
| `test/language/*.test.js` (24 suites), `language-transformer-cycles.test.js` | Deinflection and text processors per language |
| `japanese-util.test.js` | Kana, furigana and mora utilities |
| `options-util.test.js` | Profile migration and settings import |
| `anki-template-renderer.test.js`, `handlebars.test.js` | Template helpers |
| `test/data/html/document-util.html` `scan` cases whose text sits in a single text node | `lookup.sentence`. Cases that span several elements are left for the DOM text scanner (roadmap #3). |

**Which seam the translator fixtures run at.**
- Upstream phrases the translator fixtures as translator options (`optionsPresets`: `enabledDictionaryMap`, `removeNonJapaneseCharacters`, `textReplacements`, `searchResolution`, and a per-call `primaryReading`), not as profiles. They therefore run against the lookup engine's **internal** translator seam, in the lookup engine's own tests.
- The public interface is covered separately by **profile-mapping goldens**. A dev script feeds a set of profiles through upstream's `Backend._getTranslatorFindTermsOptions` / `_getTranslatorFindKanjiOptions` (copied verbatim, at the pin) and records the resulting options. Our profile → options mapping must produce identical options.
- **Public-path cases.** Every fixture case whose preset can be phrased as a profile, plus per-call `{ primaryReading }`, also runs through the public `lookup.terms` / `lookup.kanji`. Its output is compared with the same upstream results, in-process and over the worker. Cases that can't be phrased that way are listed in `deviations.md` with the reason.
- Together, these three tests cover `lookup.terms` end to end without pretending that every fixture can be phrased as a profile.

**Goldens we have to generate ourselves.** Upstream ships no fixture for the scanning parser or for scan-from-offset. A dev script generates them by running upstream code at the pin against `valid-dictionary1` plus a larger Japanese sample dictionary:
- upstream's `Translator` inside a verbatim copy of `Backend._textParseScanning`, for `lookup.parse`;
- `TextScanner`'s `scanning.length`-substring lookup, for `lookup.scan`.

The generated goldens are committed next to the copied fixtures, and the script is re-run whenever the pin moves.

**Presentation parity.**
- A dev script runs upstream's `DisplayGenerator` at the pinned commit, over the translator fixture entries, and records HTML snapshots.
- It uses jsdom with `HtmlTemplateCollection` loaded from `templates-display.html` and a stub content manager. Upstream's own `test/fixtures/translator-test.js` already sets up jsdom this way for Anki rendering.
- The HTML renderer must match the snapshots after normalization: whitespace, attribute order, and the entity escaping that DOM serialization produces.
- The Anki goldens were also produced by serializing jsdom output. So the HTML serializer has to match DOM serialization exactly, which is a deliberate constraint on how it escapes text and attributes.
- This turns "looks like Yomitan" into a test instead of a judgement call.

**Anki marker coverage.** The upstream Anki fixture only renders the markers its test field set uses. Every marker returned by `anki.markers()` therefore gets its own row in `contract-tests/fixtures/marker-coverage.md`, recording:
- which fixture proves it: upstream golden, generated golden, or a hand-written case;
- or that it is deferred, with the roadmap item that will cover it.

| Group | Proven by |
| --- | --- |
| Glossary family, including dynamic `single-glossary-<dict>` and brief / no-dictionary variants | Upstream goldens plus generated goldens for dynamic markers (the dev script renders with upstream's `AnkiTemplateRenderer` at the pin) |
| `sentence`, `sentence-furigana`, `cloze-prefix` / `body` / `body-kana` / `suffix` | Generated goldens with a sentence context |
| `pitch-accents`, `pitch-accent-graphs`, `pitch-accent-positions`, `pitch-accent-categories`, `phonetic-transcriptions` | Generated goldens (these were silently empty before) |
| `frequencies`, `frequency-harmonic-rank` / `occurrence`, `frequency-average-*` | Upstream goldens |
| `audio`, `screenshot`, `clipboard-image`, `clipboard-text`, dictionary media | **Deferred** to roadmap #1–2. They render empty exactly as upstream does when no media is supplied, and a test asserts that. |

**Upstream updates.** The pin moves only for user-facing changes (ADR-0001). Moving it means re-copying the fixtures, regenerating the snapshots, and porting whatever the new expected output requires.

**Cases where we intentionally differ from upstream fixtures:**
- **Imports are atomic.** We roll back on any row error, where upstream keeps going. This is recorded as an expected-difference entry with a reason.
- **Upstream Firefox/Chrome-specific branches** are skipped.

Every deviation lives in `contract-tests/fixtures/deviations.md`. An unlisted mismatch fails CI.

## 5. Milestones

Each milestone ends with `npm run verify` green, including the parity suite for everything in scope so far. Anki and HTML (milestone 2) come before the browser (milestone 3). mokuro-reader's add-to-Anki button needs note building and the HTML renderer before the browser milestone can pass mokuro-reader's checks.

### Milestone 0: groundwork (S)

- Merge this document, `CONTEXT.md` and the ADRs to `main` in a small docs PR.
- Close PR #3 with a link to this plan.
- Create the `rewrite` branch from `main` with the new workspace layout (§3.1) and empty packages.
- CI setup, all running on every PR:
  - Node 20 and 22;
  - Playwright (Chromium, WebKit) for `web`;
  - a Hermes smoke job.
- **Hermes runner spike (timeboxed to 1 day).** Pick how CI executes a bundle in Hermes:
  1. First choice: a pinned Hermes CLI binary matching React Native 0.86's Hermes, built once and cached, or taken from Hermes release artifacts where one exists.
  2. Fallback: a minimal Expo app run headless on an Android emulator in CI (for example with Maestro), invoking the smoke script.

  Record the choice in an ADR.
- **Old prerelease pins.** The `2.0.0-pr.3.*` prereleases stay on npm; npm only allows unpublishing within 72 hours. The `codex/yomitan-core-v2-prerelease` branches are superseded:
  - **mokuro-reader:** its non-library UI work on that branch (token ranges, lifecycle guard) can be reused, but the library integration is redone against 2.0 in milestone 3. The §6 checklist uses that branch's feature set as the baseline.
  - **lapis:** stays on `main` at exactly 1.7.0.

  Consumers pin **exact** prerelease versions, so semver ordering between old and new prereleases doesn't matter. `latest` isn't touched until 2.0.0.

### Milestone 1: engine and parity harness (L, in four slices)

Each slice is its own PR, with its own fixtures green and a stated pass count in the PR description. The fixture harness comes before the bulk re-port, so every ported file lands with a test that already runs.

**1a. Harness first (S)**
- `contract-tests` skeleton, the fixture copy with `PROVENANCE.md`, and the deviation list.
- A minimal re-port of the translator plus the Japanese language only, running the **45 Japanese** translator fixture cases at the internal translator seam. The other 5 (3 English, 1 Korean, 1 Latin) join in 1b.
- SQL storage with the better-sqlite3 driver and the in-memory driver.
- Exit: 45/45 Japanese translator cases pass, and `runStorageContract` runs against both drivers.

**1b. Languages (M)**
- All 60 language descriptors, with text processors using array variants (#2312).
- Exit: all 24 upstream language suites plus `language-transformer-cycles` pass, and all 50/50 translator cases pass. Pass count per language in the PR description.

**1c. Import and storage (M)**
- Importer and precompiled validators.
- `ArchiveSource` with the zip reader and directory reader.
- `ImageInfoReader` with the header parser.
- Import sessions with heartbeats, recovery, and the busy check.
- Update check and update.
- Exit:
  - `valid-dictionary1` / `invalid-dictionary1–6` and `database-test-cases.json` pass on SQL.
  - An `EXPLAIN QUERY PLAN` test proves prefix and suffix queries use an index.
  - The two-process recovery test passes.

**1d. Client, profile and lookup semantics (M)**
- `createYomitan` with the `profile`, `dictionaries` and `lookup` namespaces.
- `options-util` migration with bundled template patches.
- Yomitan settings import.
- Profile → options mapping.
- Scan, parse and sentence.
- `recommended()`.
- Audio source URL resolution.
- Exit:
  - `options-util.test.js`, the profile-mapping goldens, the public-path translator cases, and the generated parse/scan goldens pass.
  - The single-text-node `document-util` sentence cases pass.
  - `runClientContract` passes in-process.
  - The Hermes smoke test (import `valid-dictionary1`, then `terms`, `parse`, `scan` on the in-memory driver) passes.

### Milestone 2: Anki and HTML (M)

- **Snapshot-generator spike first (S).** Run upstream `DisplayGenerator` at the pin (jsdom, or Playwright as fallback) over the translator fixture entries, for term and kanji entries. Record what normalization is needed. Renderer work doesn't start until snapshots exist.
- Entry views and the HTML renderer, including the media modes.
- Anki: note data, the template renderer with vendored Handlebars and all helpers, markers (including dynamic `single-glossary-*`) and `extraMarkers`, card formats, the AnkiConnect transport with capabilities, and prepared-template caching.
- The display controller: add note, the duplicate check with capability fallback, duplicate behaviours, view note, collapse, and kanji requests. It's tested with the fake transport in both a full-capability and an AnkiConnect-Android capability profile.
- Hostile-content fixtures:
  - a glossary containing `<script>` and attribute-breaking quotes;
  - `javascript:` and `data:` hrefs injected into a prebuilt database;
  - dictionary CSS that uses `url()` and tries to escape the `[data-dictionary]` scope.

  The expected output is recorded for both HTML and Anki.

**Exit criteria:**
- The Anki fixtures (`anki-note-builder`, note-data, template-renderer) are green.
- Every row of the marker coverage table is proven or explicitly deferred.
- Presentation snapshots match.
- The hostile-content tests pass.
- The Hermes smoke test also builds a note.

### Milestone 3: browser, then migrate mokuro-reader (L)

- IndexedDB storage using upstream's schema and database wrapper (no Dexie), with Web Lock import coordination and a browser-decoder `ImageInfoReader`.
- It must pass the storage contract tests on fake-indexeddb **and** on real Chromium and WebKit through Playwright, including the two-tab import test.
- `<yomitan-entries>`, the CSS/icon/font assets, theme handling, media loading, and object-URL lifetime.
- The worker host. The client contract tests, including import, cancel and error cases, pass over the worker protocol.
- Migrate mokuro-reader on a prerelease pin (checklist in §6), including its one-time settings conversion.

**Exit criteria:**
- Every item in the mokuro-reader checklist is verified in the running app, including an upgrade from a previously configured install.
- The parity suite passes on IndexedDB.

### Milestone 4: React Native storage and streaming import (M)

- op-sqlite `SqlDriver`, pinned to `^17.1`. One connection per database file, with transactions driven by the SQL storage's own savepoints (see SQL storage in §3.3).
- A directory archive reader for archives unpacked by native code, so dictionary banks are read one at a time and the archive is never held in JS memory.
- The contract tests run in CI against a better-sqlite3-backed double that enforces op-sqlite's rules, so iteration stays fast.
- **Real-device gate.** A minimal headless Expo harness app (storage only, no UI) runs on an Android emulator in CI. If the milestone 0 spike picked the emulator route, it reuses that setup. The harness runs:
  - the storage contract tests;
  - an import of `valid-dictionary1` with a forced rollback, followed by a successful re-import and lookup on the device;
  - opening a database built by Node, and comparing lookup results with Node's.

  iOS runs the same harness manually before the release. The device *renderer* test app stays on the roadmap (#4).

**Exit criteria:** the emulator harness passes on the real op-sqlite module, and the Hermes smoke test passes.

### Milestone 5: release (S)

- **Publishing workflow.** Today the workflow versions and publishes only `yomitan-core`, with `pr.*` and `branch.*` prerelease IDs.
  - Extend it to publish all four public packages in dependency order: core first, then `web`, `node`, `react-native`. Each is pinned to the exact same version.
  - Keep the `pr.*` / `branch.*` prerelease flow; consumers pin exact prerelease versions during milestones 3 and 4.
  - Add an `rc` dist-tag only for final release candidates.
  - `latest` stays on 1.7.0 until 2.0.0 ships.
  - lapis pins exactly `1.7.0` on its `main`, so it can never resolve to 2.x.
- **Install smoke tests.** Before publishing, pack each package and install it in a fresh project for its target: Vite for web, Node ESM, and the Expo harness for React Native. Import the entry points and run one lookup.
- **Release.** Publish `2.0.0` once mokuro-reader has run on the release candidate in production. Then start the [roadmap](./roadmap.md) P0 items, audio first.

## 6. mokuro-reader migration checklist

Today's features must keep working (survey of `~/code/mokuro-reader`, branch `codex/yomitan-core-v2-prerelease`):

| Today | After | Check |
| --- | --- | --- |
| Import from ArrayBuffer with progress; list sorted by import date; delete by title | `dictionaries.import/list/delete` | Import JMdict-size archive with progress; delete while drawer closed |
| Recommended dictionaries list (own copy) + GitHub proxy route | `dictionaries.recommended('ja')` filtered to its four; import from URL through its proxy via injected `fetch` | Same four offered; download works |
| Enabled/order in localStorage (order currently lost on every open) | `profile.dictionaries[]` persisted as part of the profile; `profile.syncDictionaries()` | Reorder survives reload |
| Kanji-capable dictionary filtering by counts | Profile + `lookup.kanji` ignores non-kanji dictionaries (Yomitan behaviour) | Kanji lookups unchanged |
| `scanLine` tokens with UTF-16 ranges → underlined buttons | `lookup.parse(textBox)` segments with ranges and furigana | Same tokens on sample pages; multi-line text boxes no longer truncated |
| `termAt` on token click | `lookup.scan(text, token.start)` (returns sentence too) | Clicking a token shows the same entries |
| Search selection | `lookup.terms(selection)` | Unchanged |
| Kanji drill-down via `.headword-kanji-link` + back stack | `kanji-click` event → `lookup.kanji` → consumer back stack | Drill-down and back work |
| Renderer with `prepareHost`, forced dark theme | `<yomitan-entries>` with profile theme | Light/dark both render; no host-page CSS leakage |
| **Add to Anki**: overlaid button, own duplicate precheck, deck/model/field mapping, `syncAnkiWeb` after add | Display controller add action with Yomitan duplicate check; card format in `profile.anki.cardFormats`; mokuro keeps its own sync-after-add, triggered by the controller's `note-added` event | Add, duplicate state, and "view note" work against real AnkiConnect; cards contain `{sentence}` / cloze from the text box |
| AnkiConnect URL setting, error toasts, **Android mode** (AnkiConnect Android, `androidModeOverride`) | mokuro passes its own `AnkiTransport`, a wrapper over its `ankiConnect()` client, with capabilities set per mode | Add works on desktop and on Android; the duplicate check falls back when `canAddNotesWithErrorDetail` is missing; "view note" is hidden when `guiBrowse` is missing |
| `popupDuplicateBehavior` setting (declared but ignored today) | Card format `duplicateBehavior` (`new` / `overwrite` / `prevent`) | The setting now takes effect |
| Persisted popup Anki settings (`popupDeckName`, `popupModelName`, `popupFieldMappings`, `tags`, and the skipped-field list) edited in `AnkiConnectSettings.svelte` | A **one-time conversion in mokuro** into `profile.anki.cardFormats[0]` (deck, model, fields, tags) and `profile.anki` duplicate options. mokuro's settings screen then edits the profile. | Upgrading a configured install keeps deck, model, field mappings and tags. There's a mokuro unit test for the conversion. |
| `{series}` / `{volume}` in deck name, tags and fields, resolved from volume metadata | `buildNote(..., { extraMarkers: { series, volume } })`. Extra markers resolve in fields, deck name and tags; Yomitan's own markers take precedence on a name clash. | A card added from a volume lands in the resolved deck, with resolved tags. |
| Dictionary enabled flags in localStorage (`preferences.ts`) | The one-time conversion copies enabled flags into `profile.dictionaries[]`. Order starts at install order, since the saved order was already being lost. | Previously disabled dictionaries stay disabled after the upgrade. |
| Field-marker dropdown | `anki.markers('term')` | Same markers plus dynamic ones |
| Lifecycle generation guard, HMR dispose | `createYomitan` / `dispose()` | HMR reload does not leak or double-open |
| — (new) dictionary images | Media via `getMedia` | Jitendex/三省堂-style images display |

Mokuro's own features stay in mokuro: the drawer, the navigation stack, the Japanese-only selection check, the separate panel-crop Anki flow, and its debug tooling. The Yomitan-specific debug logging can be deleted.

## 7. Testing strategy

**The interface is the test surface.** Tests call `createYomitan` or the storage contract tests. The one exception is upstream-fixture suites whose fixtures are phrased at an internal seam: the translator, language transforms and template helpers (see §4).

| Layer | How |
| --- | --- |
| Parity | Upstream fixtures + presentation snapshots on every storage adapter |
| Storage adapters | `runStorageContract` on SQL (better-sqlite3, op-sqlite-shaped double, in-memory) and IndexedDB (fake-indexeddb, real browsers) |
| Client | `runClientContract` in-process and over the worker transport |
| Hermes | Bundle-and-run smoke in CI |
| DOM renderer | Playwright component tests: events, theming, media, shadow-root isolation |
| Performance guard | A benchmark on a JMdict-size import and 1k lookups per adapter, reported on every PR. Shared CI runners are too noisy to gate on. The hard gate is at each milestone's exit: no more than 25% slower than the previous milestone, measured on the same machine. |

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Re-port is large (about 25k lines, mostly language data) | Mechanical JS → TS, with tests from day one. Language data files are copied with JSDoc types instead of hand-rewritten. |
| Upstream `DisplayGenerator` may be hard to run for snapshots. It loads `/templates-display.html` through `HtmlTemplateCollection` in `prepare()`, and no upstream test snapshots its output. | The snapshot generator is its own spike at the start of milestone 2, and a prerequisite for the renderer work. If jsdom can't run it, fall back to Playwright against a built upstream search page. |
| Hermes gaps: `TextDecoder`, `Intl.DisplayNames`, `AbortSignal.throwIfAborted`, `AggregateError` | The Hermes smoke test catches these. Core avoids them or feature-detects: lazy `Intl.DisplayNames` with a fallback, and no `TextDecoder` on the React Native path (the directory reader returns strings). |
| zip.js on Hermes | Not used on React Native: native unzip plus the directory reader. |
| IndexedDB performance vs upstream | Port upstream's bulk-transaction query pattern directly, and benchmark it. |
| The Handlebars vendored build drifts | Pin to upstream's build. Test with upstream `handlebars.test.js`. |
| Profile subset misses a key a renderer needs | The type is generated from the schema. Presentation snapshots fail if an option isn't honoured. |
| mokuro-reader regressions | Checklist-driven migration on RC pins before `2.0.0` ships. |
| **Dictionary content is untrusted: glossary text, structured-content links, `styles.css`** | The serializer escapes all text and attributes, and the Anki glossary gets the same treatment (#2394). Links follow upstream's rule: only `http(s)` links and internal `?query` lookups, the latter emitted as `link-click` events. Upstream enforces that rule only through the import schema's `href` pattern. We check it again in the serializer, because prebuilt databases (ADR-0004) skip import validation. Dictionary CSS stays inside the shadow root under a `[data-dictionary]` scope. It can still load remote `url()` resources, exactly as it can in Yomitan; this is an accepted parity trade-off, documented for consumers with strict CSPs. |

## 9. Decisions this plan relies on

| ADR | Decision |
| --- | --- |
| 0001 | Observable parity; internals free; port user-facing upstream changes only |
| 0002 | Yomitan profile options are the settings model; one profile, consumer persists |
| 0003 | Entry views plus per-target renderers |
| 0004 | Shared SQL storage and schema for Node and React Native |
| 0005 | Serializable engine interface |
| 0006 | Browser storage uses Yomitan's IndexedDB schema |
| 0007 | Clean-break rewrite |
| 0008 | Library owns entry actions; consumers own the popup |
