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

## License

GPL-3.0-or-later. Contains code from Yomitan; see `src/upstream/PROVENANCE.md` in the repository.
