# [2.0.0](https://github.com/louismollick/yomitan-core/compare/v1.7.0...v2.0.0) (2026-10-02)


* feat!: vendor Yomitan's engine and add parity harness (milestone 0 + 1a/1b) ([#5](https://github.com/louismollick/yomitan-core/issues/5)) ([b244dbe](https://github.com/louismollick/yomitan-core/commit/b244dbefd9b18022d2623e7571d56dc133ee87f5))


### Bug Fixes

* keep save buttons available when anki is unreachable ([#12](https://github.com/louismollick/yomitan-core/issues/12)) ([8d6efe5](https://github.com/louismollick/yomitan-core/commit/8d6efe5890393d875b3f6e87f0594a9295e0efe2))
* let the web package load without a dom ([#11](https://github.com/louismollick/yomitan-core/issues/11)) ([c7e8b63](https://github.com/louismollick/yomitan-core/commit/c7e8b6385a13a1a80623fff7137f2efebc4c873f))
* publish scoped adapters with public access ([7695936](https://github.com/louismollick/yomitan-core/commit/76959360b8dea79781c4aa5c7460d25fea5fb5b7))


### Features

* browser package with indexeddb storage, <yomitan-entries> and worker host (milestone 3) ([#8](https://github.com/louismollick/yomitan-core/issues/8)) ([1e273ce](https://github.com/louismollick/yomitan-core/commit/1e273cea9f4b6c0c713d8322c40eeb29e12f6589))
* popup html, anki notes and the display controller (milestone 2) ([#7](https://github.com/louismollick/yomitan-core/issues/7)) ([5aff517](https://github.com/louismollick/yomitan-core/commit/5aff5178575afdd642de091510d1aa22b09c97f8))
* react native storage on op-sqlite and a directory archive reader (milestone 4) ([#9](https://github.com/louismollick/yomitan-core/issues/9)) ([c7228ec](https://github.com/louismollick/yomitan-core/commit/c7228ece4be9169447ec690d36ee0a3b7390e420))
* sql storage, archive import, write sessions, and the yomitan client (milestone 1c/1d) ([#6](https://github.com/louismollick/yomitan-core/issues/6)) ([8d67258](https://github.com/louismollick/yomitan-core/commit/8d6725855dc3a6039054407d7b595e90f66fd423))


### BREAKING CHANGES

* the 1.x API is removed; 2.0 is a clean-break rewrite.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* fix: address review round 1 on the vendoring slice

- Make the upstream sync reproducible: overrides and lib entries are
  excluded from formatting, lib bundles no longer embed hoisting-dependent
  paths, and a failed first fetch no longer poisons the cache.
- Rewrite shorthand properties correctly and re-parse rewritten modules.
- Route upstream's direct fetch calls through the environment, so bundled
  style and schema assets load and network fetch is injectable.
- Match upstream Database semantics for close, not-ready errors, empty
  inputs and primary key order; strengthen the storage contract.
- Point semantic-release at packages/core; add a package README.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* ci: use npm 11 to match the lockfile

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

* fix: address review round 2 on the vendoring slice

- Serialize storage prepare/close; order equal index keys by primary key
  in memory storage, with contract tests that fail without the fixes.
- Upstream cache must be clean at the pinned commit; fail the sync if the
  precompiled validators still need require().
- Patch upstream type bugs that leaked into published declarations, and
  typecheck dist as a strict consumer (no DOM lib, no skipLibCheck).
- CI sync check also catches untracked generated files.
- Add location.href to the environment shim; README matches exports.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>

# [1.7.0](https://github.com/louismollick/yomitan-core/compare/v1.6.0...v1.7.0) (2026-07-01)


### Features

* sqlite adapter ([af19a68](https://github.com/louismollick/yomitan-core/commit/af19a684325e5865d11fe8d759d5e6fe36e9db04))

# [1.6.0](https://github.com/louismollick/yomitan-core/compare/v1.5.0...v1.6.0) (2026-07-01)


### Features

* trigger version ([d9c5b05](https://github.com/louismollick/yomitan-core/commit/d9c5b05427fe0731861d55279c2bf3fe7286484f))

# [1.5.0](https://github.com/louismollick/yomitan-core/compare/v1.4.0...v1.5.0) (2026-06-01)


### Features

* trigger version ([f8d4caa](https://github.com/louismollick/yomitan-core/commit/f8d4caacd37a7bfe226c159db21dc6e1e40eb0c5))

# [1.4.0](https://github.com/louismollick/yomitan-core/compare/v1.3.0...v1.4.0) (2026-02-23)


### Features

* remove slots in favor of rendering separate nodes per dict result ([c68bba9](https://github.com/louismollick/yomitan-core/commit/c68bba9bf2515a3ce582fa7cc8adf19752b7ba68))

# [1.3.0](https://github.com/louismollick/yomitan-core/compare/v1.2.0...v1.3.0) (2026-02-20)


### Features

* anki field and template rendering ([083b698](https://github.com/louismollick/yomitan-core/commit/083b6983ae067fb469afb9d1187b7466ad9796b3))

# [1.2.0](https://github.com/louismollick/yomitan-core/compare/v1.1.0...v1.2.0) (2026-02-18)


### Features

* add debug logs ([49ec951](https://github.com/louismollick/yomitan-core/commit/49ec951d616eac377a63d96b400e4f089fc1046b))

# [1.1.0](https://github.com/louismollick/yomitan-core/compare/v1.0.2...v1.1.0) (2026-02-17)


### Features

* add popup themes & improve parser types ([99f6703](https://github.com/louismollick/yomitan-core/commit/99f67033083e2524c94618769f5f0b3954550490))

## [1.0.2](https://github.com/louismollick/yomitan-core/compare/v1.0.1...v1.0.2) (2026-02-16)


### Bug Fixes

* use dictionary css styles ([152cbac](https://github.com/louismollick/yomitan-core/commit/152cbac456497903598029bfe3e069a907122b2d))

## [1.0.1](https://github.com/louismollick/yomitan-core/compare/v1.0.0...v1.0.1) (2026-02-16)


### Bug Fixes

* use deinflections properly ([4efed50](https://github.com/louismollick/yomitan-core/commit/4efed50e38f7c4ba023b89a4def2877d69791e49))

# 1.0.0 (2026-02-16)


### Features

* semantic versioning ([793e1c9](https://github.com/louismollick/yomitan-core/commit/793e1c9215a83372b3601b7c759dead6d6d51512))
