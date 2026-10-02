# yomitan-core

A headless [Yomitan](https://github.com/yomidevs/yomitan): import Yomitan-format dictionaries, look up text, and render entries and Anki notes the way Yomitan does, in browsers, Node and React Native.

> **Status:** 2.0 is being rebuilt on the `next` branch (see [docs/overhaul-plan.md](docs/overhaul-plan.md)). The published `1.x` line on npm is the previous implementation.

## Packages

| Package | Contents |
| --- | --- |
| [`yomitan-core`](packages/core) | The engine. Yomitan's own modules, vendored verbatim (ADR-0009), plus storage, profile and client layers. Pure JavaScript; runs on Hermes. |
| [`@yomitan-core/contract-tests`](packages/contract-tests) | Private. Suites every storage adapter and client must pass, and Yomitan's golden fixtures. |

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
