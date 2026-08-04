# Upstream provenance

This package contains TypeScript ports and adapted copies of code and data from
[Yomitan](https://github.com/yomidevs/yomitan), licensed under
GPL-3.0-or-later.

The extraction started from Yomitan commit
[`c0abb9e98a15aeb6b6f8f6e2d91fe5e54240b54a`](https://github.com/yomidevs/yomitan/commit/c0abb9e98a15aeb6b6f8f6e2d91fe5e54240b54a).
This was the upstream head immediately before the initial `yomitan-core`
commit. Subsequent local changes are tracked by this repository's Git history.

The snapshot applies to every ported/copied module under these paths:

- `src/anki/`
- `src/audio/`
- `src/database/dictionary-database.ts`
- `src/database/schema.ts`
- `src/import/`
- `src/language/`
- `src/lookup/`
- `src/render/`
- `src/types/`
- `src/util/`

Original copyright headers are retained on source files where present. New
platform adapters and public API facades are original work in this repository
unless their file header says otherwise.
