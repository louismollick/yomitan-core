# yomitan-core

Core dictionary lookup, language processing, and rendering engine extracted from the [Yomitan](https://github.com/louismollick/yomitan) browser extension. Use it in Node.js, Electron, or any JavaScript environment with IndexedDB.

## Installation

```bash
npm install yomitan-core
```

### Optional dependencies

| Package | Purpose |
|---------|---------|
| `linkedom` | Server-side DOM for the rendering module |
| `hangul-js` | Korean Hangul disassembly/reassembly |
| `kanji-processor` | Kanji decomposition |
| `@resvg/resvg-wasm` | SVG rasterization for pitch accent images |

## Quick start

```typescript
import YomitanCore from 'yomitan-core';

const core = new YomitanCore();
await core.initialize();

// Import a dictionary from a .zip ArrayBuffer
const archive = await fetch('/jmdict.zip').then((r) => r.arrayBuffer());
const result = await core.importDictionary(archive, {
    onProgress: (progress) => console.log(progress),
});
console.log(`Imported "${result.result.title}" with ${result.result.termCount} terms`);

// Look up a term
const { entries, originalTextLength } = await core.findTerms('食べる', {
    enabledDictionaryMap: new Map([['JMdict', { index: 0, priority: 0 }]]),
});

console.log(entries[0].headwords); // [{term: '食べる', reading: 'たべる', ...}]

// Clean up
await core.dispose();
```

## API

### `YomitanCore`

The main orchestrator. Manages the database, translator, and language processing subsystems.

```typescript
const core = new YomitanCore({
    databaseName: 'my-dict',  // IndexedDB name (default: 'dict')
    initLanguage: true,        // auto-init language transformers (default: true)
});

await core.initialize();
```

#### Dictionary management

```typescript
// Import a dictionary zip
await core.importDictionary(archive: ArrayBuffer, options?)

// List installed dictionaries
await core.getDictionaryInfo(): Promise<Summary[]>

// Delete a dictionary by title
await core.deleteDictionary(name: string, onProgress?)

// Check for dictionary updates (fetches remote index URLs)
await core.checkForUpdates(names?: string[]): Promise<DictionaryUpdateInfo[]>
```

#### Term lookup

```typescript
// Look up terms with deinflection, grouping, and sorting
await core.findTerms(text, {
    mode: 'group',       // 'group' | 'merge' | 'split' | 'simple'
    language: 'ja',
    enabledDictionaryMap: new Map([['JMdict', { index: 0, priority: 0 }]]),
    options: {
        matchType: 'exact',  // 'exact' | 'prefix' | 'suffix'
        deinflect: true,
        sortFrequencyDictionary: 'JPDB',
        sortFrequencyDictionaryOrder: 'descending',
    },
})

// Look up kanji
await core.findKanji(text, {
    enabledDictionaryMap: new Map([['KANJIDIC', { index: 0, priority: 0 }]]),
})
```

#### Sentence parsing

Sliding-window longest-match parser that splits text into segments with furigana.

```typescript
const lines = await core.parseText('日本語を勉強する', {
    enabledDictionaryMap: new Map([['JMdict', { index: 0, priority: 0 }]]),
});
// Returns ParsedLine[] with segments, readings, and furigana
```

#### Furigana generation

```typescript
const segments = await core.generateFurigana('食べる', 'たべる');
// [{ text: '食', reading: 'た' }, { text: 'べる', reading: '' }]
```

#### Batch lookup

Look up multiple texts efficiently with shared caches and optional concurrency control.

```typescript
const results = await core.batchLookup(
    ['食べる', '飲む', '走る'],
    {
        enabledDictionaryMap: new Map([['JMdict', { index: 0, priority: 0 }]]),
        concurrency: 4,
    },
);
// Returns Map<string, TermLookupResult>
```

#### Frequency ranking

```typescript
const ranking = await core.getFrequencyRanking('食べる', ['JPDB', 'Innocent Corpus']);
// { frequencies: [...], harmonicMean: 1234 }
```

#### Audio URLs

Generate audio source URLs for a term/reading pair across multiple providers (JapanesePod101, Jisho, Lingua Libre, Wiktionary, custom JSON).

```typescript
const urls = await core.getAudioUrls('食べる', 'たべる', [
    { type: 'jpod101', url: '', voice: '' },
]);
```

#### Factory methods

```typescript
// AnkiConnect client
const anki = await core.createAnkiClient({ server: 'http://127.0.0.1:8765' });

// Rendering classes (requires DOM — use linkedom or jsdom in Node.js)
const { DisplayGenerator, StructuredContentGenerator, PronunciationGenerator } =
    await core.createRenderer();

// Standalone audio URL generator
const audioGen = await core.createAudioUrlGenerator();
```

#### Accessor properties

```typescript
core.isReady       // boolean — whether initialize() has been called
core.database      // DictionaryDB — direct access to the Dexie database
core.language      // { summaries, textProcessors, transformer, isTextLookupWorthy }
```

## Tree-shakeable submodule imports

Each submodule is a separate entry point. Import only what you need to minimize bundle size.

```typescript
// Database layer (Dexie-based IndexedDB)
import { DictionaryDB, YomitanDatabase } from 'yomitan-core/database';

// Dictionary import and update checking
import { DictionaryImporterClass, DictionaryUpdateChecker } from 'yomitan-core/import';

// Translator, sentence parsing, batch processing, frequency ranking
import { Translator, SentenceParser, BatchProcessor, FrequencyRanker } from 'yomitan-core/lookup';

// 48 languages: transforms, text processors, CJK utils, furigana, Japanese, Korean, Chinese, ...
import {
    LanguageTransformer,
    MultiLanguageTransformer,
    distributeFurigana,
    getLanguageSummaries,
    convertKatakanaToHiragana,
    japaneseTransforms,
    koreanTransforms,
} from 'yomitan-core/language';

// AnkiConnect client, note builder, template renderer
import { AnkiConnect, AnkiNoteBuilder, AnkiTemplateRenderer } from 'yomitan-core/anki';

// HTML display rendering (requires DOM)
import {
    DisplayGenerator,
    StructuredContentGenerator,
    PronunciationGenerator,
    HtmlTemplateCollection,
} from 'yomitan-core/render';

// Audio URL generation
import { AudioUrlGenerator } from 'yomitan-core/audio';
```

## Using individual classes directly

For more control, use the classes directly instead of the `YomitanCore` wrapper.

### Database + Translator

```typescript
import { DictionaryDB } from 'yomitan-core/database';
import { Translator } from 'yomitan-core/lookup';

const db = new DictionaryDB('my-dict');
await db.open();

const translator = new Translator(db);
// translator.prepare() loads language transformers internally

const { dictionaryEntries, originalTextLength } = await translator.findTerms(
    'group',
    '食べたい',
    {
        matchType: 'exact',
        deinflect: true,
        primaryReading: '',
        mainDictionary: '',
        sortFrequencyDictionary: null,
        sortFrequencyDictionaryOrder: 'descending',
        removeNonJapaneseCharacters: false,
        textReplacements: [null],
        enabledDictionaryMap: new Map([['JMdict', { index: 0, priority: 0 }]]),
        excludeDictionaryDefinitions: null,
        searchResolution: 'letter',
        language: 'ja',
    },
);

db.close();
```

### Dictionary import

```typescript
import { DictionaryDB } from 'yomitan-core/database';
import { DictionaryImporterClass } from 'yomitan-core/import';

const db = new DictionaryDB('my-dict');
await db.open();

const importer = new DictionaryImporterClass(
    undefined, // MediaLoader (undefined = NoOpMediaLoader)
    (progress) => console.log(`${progress.index}/${progress.count}`),
);

const archive = await fs.readFile('./jmdict.zip');
const result = await importer.importDictionary(db, archive.buffer, {
    prefixWildcardsSupported: true,
    yomitanVersion: '0.1.0',
});

console.log(result.result.title, result.result.termCount);
db.close();
```

### Language transforms

```typescript
import { LanguageTransformer, japaneseTransforms } from 'yomitan-core/language';

const transformer = new LanguageTransformer();
transformer.addDescriptor(japaneseTransforms);

const deinflections = transformer.transform('食べたい');
for (const result of deinflections) {
    console.log(result.text, result.trace);
}
```

### Furigana

```typescript
import { distributeFurigana } from 'yomitan-core/language';

const segments = distributeFurigana('食べる', 'たべる');
// [{ text: '食', reading: 'た' }, { text: 'べる', reading: '' }]
```

### AnkiConnect

```typescript
import { AnkiConnect } from 'yomitan-core/anki';

const anki = new AnkiConnect({ server: 'http://127.0.0.1:8765' });
const decks = await anki.getDeckNames();
const models = await anki.getModelNames();
const fields = await anki.getModelFieldNames('Basic');
```

### Server-side rendering with linkedom

```typescript
import { parseHTML } from 'linkedom';
import {
    DisplayGenerator,
    DISPLAY_TEMPLATES,
    DISPLAY_CSS,
    NoOpContentManager,
    applyExtensionDisplayDefaults,
} from 'yomitan-core/render';

const { document } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
applyExtensionDisplayDefaults(document.documentElement);

const style = document.createElement('style');
style.textContent = DISPLAY_CSS; // Includes display + structured content + pronunciation styles
document.head.appendChild(style);

const generator = new DisplayGenerator(document, new NoOpContentManager(), DISPLAY_TEMPLATES);

// Render a term entry to DOM nodes
const node = generator.createTermEntry(dictionaryEntry, dictionaryInfo);
// Dictionary-specific styles.css from imported dictionaries are injected automatically per entry.
console.log(node.outerHTML);
```

## Development

### Prerequisites

- Node.js >= 18
- npm

### Setup

```bash
git clone https://github.com/louismollick/yomitan-core.git
cd yomitan-core
npm install
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build ESM + CJS + .d.ts with tsdown |
| `npm run dev` | Watch mode build |
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run lint` | Biome lint + format check |
| `npm run lint:fix` | Auto-fix lint and formatting issues |
| `npm run format` | Format all files with Biome |
| `npm run test` | Run tests with vitest |
| `npm run test:watch` | Watch mode tests |

### Automated versioning and releases

This repo uses semantic-release on pushes to `main`/`master` to:

- determine the next version from commit messages
- update `package.json` and `package-lock.json`
- update `CHANGELOG.md`
- publish to npm
- create a GitHub release and tag

This workflow uses npm trusted publishing via OIDC (no `NPM_TOKEN` secret).
Configure a trusted publisher for this GitHub repository in npm settings.

Requirements:

- GitHub Actions workflow permission `id-token: write`
- Node.js `22.14.0+` in the release job (npm CLI `11.5.1+`)

Use Conventional Commits so version bumps are calculated correctly:

- `fix: ...` -> patch release (`x.y.Z`)
- `feat: ...` -> minor release (`x.Y.0`)
- `feat!: ...` or a commit body with `BREAKING CHANGE:` -> major release (`X.0.0`)

### Testing locally from another project

There are two ways to test yomitan-core from another npm project on your machine.

#### Option A: `npm link` (recommended)

```bash
# In the yomitan-core directory, build and create a global link
cd /path/to/yomitan-core
npm run build
npm link

# In your consuming project, link to it
cd /path/to/my-app
npm link yomitan-core
```

You can now import from `yomitan-core` as if it were installed from the registry. Any time you rebuild yomitan-core, the changes are immediately available.

To unlink:

```bash
cd /path/to/my-app
npm unlink yomitan-core

cd /path/to/yomitan-core
npm unlink
```

#### Option B: `file:` dependency

In your consuming project's `package.json`:

```json
{
    "dependencies": {
        "yomitan-core": "file:../yomitan-core"
    }
}
```

Then run `npm install`. This creates a symlink to the local package. You need to rebuild yomitan-core and re-run `npm install` in your project when the yomitan-core package structure changes.

#### Option C: `npm pack`

This simulates a real npm install most closely:

```bash
# In yomitan-core
cd /path/to/yomitan-core
npm run build
npm pack
# Creates yomitan-core-0.1.0.tgz

# In your consuming project
cd /path/to/my-app
npm install /path/to/yomitan-core/yomitan-core-0.1.0.tgz
```

#### Verifying the link works

Create a test file in your consuming project:

```typescript
import YomitanCore from 'yomitan-core';

const core = new YomitanCore();
await core.initialize();

const info = await core.getDictionaryInfo();
console.log('Installed dictionaries:', info);

await core.dispose();
```

Run it with a runtime that supports IndexedDB (browser, Electron) or with `fake-indexeddb` for Node.js:

```typescript
// At the top of your Node.js entry point, before any yomitan-core imports
import 'fake-indexeddb/auto';
```

### Project structure

```
yomitan-core/
  src/
    index.ts              # YomitanCore class + barrel exports
    types/                # TypeScript type definitions
    util/                 # Shared utilities (errors, string, regex, JSON, etc.)
    database/             # Dexie-based IndexedDB dictionary storage
    import/               # Dictionary .zip import + schema validation + update checking
    lookup/               # Translator, sentence parser, batch processor, frequency ranker
    language/             # 48 languages: transforms, text processors, CJK, furigana
      ja/                 # Japanese-specific (transforms, kana, wanakana, furigana)
      ko/                 # Korean (Hangul processing, transforms)
      zh/                 # Chinese (pinyin, character detection)
      ar/                 # Arabic
      de/ en/ es/ fr/ ... # Other languages
    anki/                 # AnkiConnect client, note builder, template renderer
    audio/                # Audio URL generation (JapanesePod101, Jisho, Wiktionary, etc.)
    render/               # HTML display generation (term/kanji entries, structured content, pitch accent)
  dist/                   # Build output (ESM, CJS, .d.ts, sourcemaps)
```

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).
