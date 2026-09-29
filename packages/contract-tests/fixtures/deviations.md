# Deviations from Yomitan

Intentional differences from upstream behaviour at the pinned commit. An unlisted difference is a bug.

| Area | Yomitan | yomitan-core | Why |
| --- | --- | --- | --- |
| Failed imports | Keeps rows written before the error; the dictionary shows as incomplete | Removes everything the import wrote | Atomic imports (overhaul plan §4) |
| Image sizes on import | Decoded with `Image()`; undecodable images fail the import | Read from file headers; an unreadable raster fails the import, an SVG without intrinsic size records 0×0, truncated image data is not detected | Works on every target without a decoder (plan §3.3) |
| TIFF images | Fail to load in Chromium | Imported with their header size | Header parsing |
| Profile | Multiple profiles, conditions | One profile; the full upstream options shape is kept | ADR-0002 |
| Audio | Downloads, validates, plays | Not yet provided | Roadmap P0 #1 |
| Anki media, `{sentence-furigana}` text parsing | Injected by the extension | Not yet provided; media markers render empty | Roadmap P0 #2 |
| Dictionary CSS sanitizing for Anki, outside browsers | `CSSStyleSheet` re-serialization | Rule splitting; `@import` dropped; whitespace not normalized | No CSSOM in Node/React Native |
| Anki glossary style scoping, outside browsers | Per-rule selectors (`addScopeToCssLegacy`) | CSS nesting (upstream's own fallback, as in its jsdom goldens) | No CSSOM in Node/React Native |
| Structured-content links | Allowed schemes enforced by the import schema only | Also enforced at render time (`http(s)` and internal links) | Prebuilt databases skip import validation |
| Popup kanji stroke-order font | Bundled | Not bundled by default (18 MB) | Size; web consumers can supply it |
| Translator fixtures phrased as options | n/a | Run at the internal translator seam; the public path is covered by profile-mapping goldens | Plan §4 |
| Dictionary CSS in the popup | Parsed by the CSSOM, then nested under `[data-dictionary]` | Reduced to balanced rules first (same splitter), so a stray `}` can't leave the scope | No CSSOM outside browsers; the string output must be safe on its own |
| `<` in dictionary CSS | Kept | Written as the CSS escape `\3c ` in popup and Anki `<style>` output | Keeps `</style>` from ending the style element |
