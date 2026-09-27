# Roadmap: Yomitan functionality not covered by the overhaul

This document lists Yomitan functionality that the library does **not** provide after the [overhaul](./overhaul-plan.md), ordered by priority. Terms follow [CONTEXT.md](../CONTEXT.md). Decisions come from [docs/adr](./adr).

Parity baseline: Yomitan upstream `67db60ddc2cbd7b5172d777c117e3201d7ddff0f` (2026-09-25).

## How to read this

Each item says what Yomitan does, who needs it, what it depends on, and a rough size. Sizes are S (days), M (a week or two) and L (several weeks).

| Priority | Meaning |
| --- | --- |
| **P0** | Fast follows. A current or near-term consumer is visibly missing it, or it is part of "behaves like Yomitan". Start right after the overhaul. |
| **P1** | Needed for broad parity or for the next consumer (substreamer, a Chrome-extension-style consumer). |
| **P2** | Valuable for parity, but no consumer is asking for it. |
| **P3** | Speculative, or only worth doing if a consumer appears. |

The last section lists what is deliberately out of scope, so it is not re-proposed.

---

## P0: fast follows

### 1. Audio download, validation and fallback (M)

**What Yomitan does.** It resolves each configured audio source in order, then:
- downloads the audio with an idle timeout;
- rejects JapanesePod101's "invalid audio" placeholder by content hash;
- falls back to the next source;
- honours `audio.enableDefaultAudioSources`.

This is in upstream `media/audio-downloader.js` and `display/display-audio.js`.

**Where the library stands after the overhaul.** Audio source URL resolution is re-ported, and `fetch` and the HTML parser are injected. There is no download, validation or fallback, and no `play-audio` entry action. The default renderer hides the audio button until this lands (ADR-0008 amendment). The `{audio}` marker renders empty, as Yomitan does when no audio is supplied.

**Scope.**
- `audio.fetch(term, reading)` walks the profile's audio sources and returns the first valid audio as bytes plus a MIME type, or a reason for each source that failed.
- A cache keyed by source, term and reading.
- The `play-audio` entry action and the audio-source menu in the display controller. Playback itself stays with the consumer, through an injected "play these bytes" hook with a default for web.
- The `{audio}` marker is filled from the same result.

**Who needs it.** mokuro-reader (its audio buttons are dead today) and substreamer (lyrics).

**Depends on.** The display controller, from the overhaul. The `{audio}` marker also needs Anki media injection (item 2), so build item 2's media interface first or together with this.

### 2. Anki media injection (M)

**What Yomitan does.** It attaches media to notes: term audio, a screenshot, a clipboard image, clipboard text, dictionary images referenced by the glossary, and pitch-accent graph images. Media files get content-hashed names (upstream #2370).

**Where the library stands after the overhaul.** Note fields are rendered with markers. Media markers (`{audio}`, `{screenshot}`, `{clipboard-image}`, dictionary images in `{glossary}`) render empty, or render references with no stored file.

**Scope.**
- A media interface on `anki.addNote`: the consumer supplies bytes for screenshot and clipboard image, and the library stores the files through the Anki transport (`storeMediaFile`).
- The library supplies audio (item 1) and dictionary media, taken from storage.
- Hashed file names, as Yomitan names them.
- `{glossary}` images reference the stored file names through the HTML renderer's `media: 'anki'` mode (Yomitan's hashed file names), which the overhaul already provides.

**Who needs it.** mokuro-reader. It could attach the manga panel crop as the screenshot, replacing its separate non-Yomitan Anki flow.

### 3. DOM text scanner for the web (L)

**What Yomitan does.** It scans live page text on hover or tap:
- finds the caret position under the pointer, including in vertical text and ruby (`caretRangeFromPoint`/`caretPositionFromPoint`);
- walks text across elements (`DOMTextScanner`);
- extracts the sentence from the DOM (`TextSourceGenerator.extractSentence`, `layoutAwareScan`);
- supports scan modifiers, delays and touch handling.

This is in upstream `language/text-scanner.js` and `dom/*`.

**Where the library stands after the overhaul.** Scan, parse and sentence work on plain strings only. Consumers hit-test their own UI and pass `(text, offset)`.

**Scope.** Put this in `@yomitan-core/web`: a DOM text source plus a scanner that turns pointer events into `lookup.scan` calls with the sentence from the DOM. Port upstream's `test/dom-text-scanner.test.js` and `document-util` HTML fixtures as the parity test.

**Who needs it.** Any Chrome-extension-style consumer, and mokuro-reader if it ever wants hover lookup over its OCR text layer.

### 4. React Native renderer (L)

**What Yomitan does.** Its popup presentation.

**Where the library stands after the overhaul.** React Native gets entry views as data, the op-sqlite storage driver, and a storage-only emulator harness in CI (milestone 4). It has no native components and no UI test app.

**Scope.**
- `@yomitan-core/react-native` components that render entry views with React Native primitives. Headwords with furigana, tags, frequencies, pitch-accent graphs, and structured content (tables, lists, ruby, images, links) mapped to native views.
- Actions wired to the display controller.
- Dictionary `styles.css` can't apply natively. Support the common structured-content style properties inline and ignore the rest; this is a known, documented parity gap.
- An on-device test app.

**Who needs it.** substreamer (a lyrics dictionary popup).

---

## P1

### 5. AnkiDroid transport (M)

Adding notes natively on Android through AnkiDroid's content-provider API, behind the same `AnkiTransport` interface.

This is **not** about the "AnkiConnect Android" app. That app speaks AnkiConnect over HTTP, and the overhaul already supports it through consumer-supplied transports with capability flags, which mokuro-reader relies on. The native transport is for React Native apps that can't count on AnkiConnect Android being installed.

AnkiMobile only supports URL-scheme card creation with no duplicate checking; handle it separately, as P3.

**Who needs it.** substreamer.

### 6. React Native background execution (M)

Hosting the engine off the JS thread: a worklets runtime, a JSI thread, or a headless JS context. The serializable client interface (ADR-0005) is the transport contract. It needs a spike to pick the mechanism for Expo 57 / React Native 0.86.

**Who needs it.** substreamer.

### 7. Consumer-supplied popup layouts (M)

Consumers provide their own layout over entry views, while the default stays Yomitan's markup.

**Scope.**
- Documented part-level overrides: headword, definitions, tags, frequencies, pitch.
- Alternatively, a full custom renderer built on the same entry view and display controller.

**Who needs it.** You raised this as a wish, and it's the "customize away from Yomitan defaults" half of ADR-0001.

### 8. Pluggable tokenizer and MeCab parsing (M)

Yomitan can parse text with MeCab (`comm/mecab.js`, `_textParseMecab`, and the `/tokenize` API from #2254) as well as with its scanning parser.

**Scope.** A tokenizer interface for `lookup.parse`, with the scanning parser as the default adapter. A consumer could plug in a MeCab/Sudachi/kuromoji adapter, or a server.

**Who needs it.** Nobody yet. Parsing quality for long texts (substreamer lyrics) is the likely trigger.

### 9. Search-query niceties (S)

Yomitan's search page offers:
- reading display modes for parsed text: hiragana, katakana, romaji, none (`parsing.readingMode`);
- `termSpacing`;
- romaji-to-kana conversion as you type (wanakana IME).

**Scope.** Renderer options for parse output and an input-conversion helper. The kana utilities already exist.

### 10. Yomitan database export and import (M)

Yomitan exports its whole dictionary database with Dexie's export format (`settings/backup-controller.js`). Because the browser storage uses Yomitan's schema (ADR-0006), a user could import that export and skip re-importing large dictionaries. Doing it on SQLite targets means converting rows.

### 11. Dictionary integrity check (S)

Compares stored row counts with each dictionary's declared counts, and flags or offers to repair broken installs (upstream `dictionary-controller.js`).

---

## P2

### 12. Recommended settings per language (S)

Yomitan applies per-language recommended options, such as text replacements and scanning length, when you pick a language (`ext/data/recommended-settings.json`). Expose them as a profile helper.

### 13. Clipboard monitor (S)

Yomitan polls the clipboard and looks up new text (`comm/clipboard-monitor.js`). The polling logic is platform-neutral, and the consumer would inject clipboard access.

### 14. expo-sqlite driver (S)

A second React Native SQL driver, for consumers that don't use op-sqlite. It must pass the same storage contract tests.

### 15. Browser storage on SQLite-wasm (M)

This was rejected for now (ADR-0006). It becomes worth revisiting if IndexedDB performance or the maintenance cost of keeping two storage adapters consistent becomes a problem. Prebuilt SQLite databases could then also be used in browsers.

### 16. Kiku companion precompute: a new Node consumer (M, lives outside this repo)

This replaces the lapis lookup tool. An Anki add-on runs Node with this library to precompute related words and Yomitan glossary HTML into media files, and a Kiku plugin (`KanjiInfoExtra` hook) displays them.

**Library needs.** The HTML-string renderer and `{single-glossary-<dict>}` parity, both delivered by the overhaul. This item only tracks the integration.

---

## P3: speculative

### 17. Live lookups inside Anki card webviews

Run the library inside a card (Kiku-style worker) against a prebuilt database shipped in media. It needs a storage adapter that works from media files in a webview; SQLite-wasm reading a file over HTTP range requests is the likely fit.

### 18. Yomitan-compatible local HTTP API

A Node server implementing Yomitan's local API (`comm/yomitan-api.js`), so tools that talk to Yomitan can talk to this library instead.

### 19. AnkiMobile support

Card creation through AnkiMobile's URL scheme, with no duplicate detection.

---

## Deliberately out of scope

Extension shell concerns, which consumers own:
- Tab and frame messaging, cross-frame popups, popup window positioning and sizing.
- Hotkeys, context menus, extension permissions, Local Network Access handling.
- Screenshot capture and clipboard *reading*. Consumers pass in bytes and text instead.
- Display history and search history. The consumer owns navigation (ADR-0008).
- Settings-page UI. The library supplies the model and the operations, not the screens.
- Offscreen documents and `drawMedia` canvas transfer.

Other exclusions:
- **Multiple profiles and conditional profile switching** (ADR-0002).
- **Migrating dictionaries stored by pre-2.0 versions of this library.** Users re-import (ADR-0007).
