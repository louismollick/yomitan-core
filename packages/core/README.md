# yomitan-core

A headless [Yomitan](https://github.com/yomidevs/yomitan) engine: Yomitan's own dictionary importer, translator, languages, Anki note builder and display generators, vendored verbatim and runnable in browsers, Node and React Native (Hermes).

> **Status:** 2.0 is under construction on the `next` branch. See the [overhaul plan](https://github.com/louismollick/yomitan-core/blob/next/docs/overhaul-plan.md).

## Anki notes with media

`anki.buildNote` renders a note from the profile's card format. `createDisplayController` adds it, and also stores the media its fields ask for when the Anki transport can `storeMediaFile` (`createAnkiConnectTransport` can):

```ts
const anki = createAnkiConnectTransport({ server, apiKey });
const controller = createDisplayController(yomitan, { anki });
const { noteId, warnings } = await controller.addNote(entry, cardFormatIndex, context, extraMarkers, {
    screenshot: { data: panelBlob, mediaType: 'image/webp' }, // for {screenshot}
});
```

| Marker | Comes from |
| --- | --- |
| `{screenshot}` | The `media.screenshot` bytes, sent to Anki as base64. |
| `{audio}` | The profile's `audio.sources`. Anki downloads the first working URL itself (`storeMediaFile` with `url`), so no audio passes through the device. Sources are resolved one at a time in profile order, so a slow later source never delays an earlier one. JapanesePod101's "no audio" clip is skipped by its MD5. |
| Images in `{glossary}` | The dictionary's media in storage, sent as base64. |

A file that can't be stored becomes a `warnings` entry and its marker renders empty; the note is still added. A term with no audio (every source empty or only placeholder clips) is not a warning, but audio that failed with errors is. File names are `yomitan_<type>_<timestamp>_<random>` so saves in the same millisecond never overwrite each other. Without `storeMediaFile`, or when `media` has no screenshot, `{screenshot}` renders empty. `{clipboard-image}`, `{clipboard-text}` and `{popup-selection-text}` are not supported.

`yomitan.audio.urls(term, reading)` returns the playable URLs for the profile's audio sources, in order: `{ url, source, name?, skipHash? }[]`. Sources that read a web page or API (Jisho, LanguagePod101, Wikimedia, `custom-json`) use the client's `fetch`, which needs CORS access in browsers; each is cut off after 5 seconds and contributes no URLs. `audio.sourceUrls(term, reading, index)` returns one source's URLs and whether more follow. Nothing is downloaded or validated, so a URL can still turn out to hold no audio.

Like Yomitan, duplicate detection checks the note built without media, so a media marker in the first field is not seen by it.

Outside the display controller, call `buildNote` for the note and its `requirements`, store files yourself, and call `buildNote` again with `storedMedia`.

## Host-rendered results

A consumer that draws its own entry UI can keep Yomitan's exact glossary formatting and add a Kanji View.

```ts
const { entries } = await yomitan.lookup.terms('入学式');

// One block per dictionary, in the entry's dictionary order: Yomitan's definition list for that
// dictionary (structured content, images, definition tags). `media` works as in `render.html`.
const blocks = await yomitan.render.glossaries(entries[0], { media: { urlTemplate: 'app://media/{dictionary}/{path}' } });
// [{ dictionary: 'Jitendex', dictionaryAlias: 'Jitendex', html: '<ol class="definition-list" ...>' }]

// Style blocks with `render.css()`, scoped under an element carrying `render.attributes()`.
// With `media: 'placeholder'`, `findGlossImages` and `setGlossImageSource` fill the images.

// The most frequent terms containing a kanji, anywhere in the term (入学式 for 学), best first.
const terms = await yomitan.lookup.termsContaining('学', { limit: 30, dictionary: 'Jiten' });
// [{ term: '学校', reading: 'がっこう', frequency: 666, displayValue: '666' }, ...]
```

`termsContaining` reads a per-dictionary index of each kanji's 50 most frequent terms. The index is built when a dictionary with term frequencies is imported (a scan of its term frequencies: 0.6 s for JPDB, 3 s for the full Jiten and BCCWJ on Node with SQLite), stored with the dictionary and deleted with it. A dictionary imported by an earlier version is indexed on the first call instead: one scan of its term frequencies, then stored. `dictionary` is a frequency dictionary's title; by default the profile's sort frequency dictionary, else the first enabled dictionary with term frequencies. Each term appears once, at its best frequency. Frequencies marked ㋕ in `displayValue` (JPDB and Jiten use it for words written in kana) are ignored, and 々 is not a kanji. For `rank-based` dictionaries (the default) `frequency` is the rank and lower is more frequent; for `occurrence-based` dictionaries it is the count and higher is more frequent. `reading` comes from the frequency data, else from the enabled term dictionaries.

## License

GPL-3.0-or-later. Contains code from Yomitan; see `src/upstream/PROVENANCE.md` in the repository.
