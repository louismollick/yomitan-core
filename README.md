# yomitan-core

A headless [Yomitan](https://github.com/yomidevs/yomitan): import Yomitan-format dictionaries, look up text, and render entries and Anki notes the way Yomitan does, in browsers, Node and React Native.

> **Status:** 2.0 is being rebuilt on the `next` branch (see [docs/overhaul-plan.md](docs/overhaul-plan.md)). The published `1.x` line on npm is the previous implementation.

## Packages

| Package | Contents |
| --- | --- |
| [`yomitan-core`](packages/core) | The engine. Yomitan's own modules, vendored verbatim (ADR-0009), plus storage, profile and client layers. Pure JavaScript; runs on Hermes. |
| [`@yomitan-core/contract-tests`](packages/contract-tests) | Private. Suites every storage adapter and client must pass, and Yomitan's golden fixtures. |

## Segmenting text

`lookup.segment(text)` splits text into words by the cheapest path through every dictionary match, so a long match cannot swallow the next word the way `lookup.parse` (Yomitan's greedy scanner) can. Each token has `text`, `range`, furigana `segments`, `headwords` and the term `entries` for exactly its span, so a word view needs no second lookup.

```ts
const tokens = await client.lookup.segment(text);
const token = tokenAt(tokens, offset); // token whose UTF-16 range contains offset
```

Words are scored by `ln(frequency rank) + 6` (+1.5 if deinflected). An unmatched Japanese character costs 20 and any other unmatched character 6, so a mixed-script word like Tシャツ beats its parts; letters and digits are looked up when `scanning.alphanumeric` is on (Yomitan's default). Ranks come from the profile's sort frequency dictionary, else the first enabled dictionary with term frequencies. A dictionary that is missing, disabled, occurrence-based or without term frequencies is skipped. With no usable frequency dictionary, the path with the fewest words wins, ties going to the longer first word.

## Development

```bash
npm install
npm run verify           # build, typecheck, lint, test
npm run sync-upstream    # re-vendor Yomitan at the commit pinned in packages/core/upstream.config.json
```

The Hermes smoke test runs when a Hermes CLI is available (`npx jsvu --engines=hermes`, or set `HERMES_BIN`).

Terms are defined in [CONTEXT.md](CONTEXT.md); decisions in [docs/adr](docs/adr).

## License

GPL-3.0-or-later. Contains code from Yomitan; see [packages/core/src/upstream/PROVENANCE.md](packages/core/src/upstream/PROVENANCE.md).
