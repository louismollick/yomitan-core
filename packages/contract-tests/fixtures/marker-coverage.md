# Anki marker coverage

Every marker `anki.markers()` returns, and the test that proves its output matches Yomitan.

| Markers | Proven by |
| --- | --- |
| All standard term markers (`audio`, `clipboard-*`, `cloze-*`, `conjugation`, `dictionary*`, `document-title`, `expression`, `frequencies`, `frequency-*`, `furigana*`, `glossary*`, `part-of-speech`, `phonetic-transcriptions`, `reading`, `screenshot`, `search-query`, `popup-selection-text`, `sentence*`, `tags`, `url*`) and the Japanese-only ones (`cloze-body-kana`, `pitch-accents`, `pitch-accent-graphs`, `pitch-accent-graphs-jj`, `pitch-accent-positions`, `pitch-accent-categories`) | Upstream golden `anki-note-builder-test-results.json`: every standard marker is a field in upstream's test card format, rendered with a sentence context (`packages/core/test/anki-parity.test.ts`) |
| All standard kanji markers | Same golden, kanji cases |
| Dynamic `single-glossary-<dictionary>` | Client contract "builds notes from the profile card format" (content check); the template is upstream's `getDynamicTemplates` output |
| Dynamic `single-frequency-number-<dictionary>` | Listed by `anki.markers()` (client contract); template is upstream's `getDynamicTemplates` output |
| App-defined markers (`extraMarkers`, e.g. mokuro-reader's `{series}`, `{volume}`) | Client contract "builds notes from the profile card format" (fields, deck name, tags) |
| Media markers with no media supplied (`audio`, `screenshot`, `clipboard-image`, `clipboard-text`, dictionary images in `{glossary}`) | Upstream golden renders them empty without media; media injection is roadmap #1–2 |
