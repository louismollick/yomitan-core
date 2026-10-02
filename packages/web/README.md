# @yomitan-core/web

Browser adapters for `yomitan-core`.

```ts
import { createYomitan } from 'yomitan-core';
import {
    createBrowserImageInfoReader,
    createIndexedDbStorage,
    defineYomitanEntries,
    type YomitanEntriesElement,
} from '@yomitan-core/web';

const yomitan = await createYomitan({
    storage: createIndexedDbStorage({ name: 'dict' }),
    imageInfoReader: createBrowserImageInfoReader(),
});
await yomitan.dictionaries.import({ source: archiveBytes });

defineYomitanEntries();
const entries = document.querySelector('yomitan-entries') as YomitanEntriesElement;
entries.client = yomitan;
entries.entries = (await yomitan.lookup.terms('打ち込む')).entries;
```

`<yomitan-entries>` renders in a shadow root. Set its `controller` property to a
`createDisplayController(yomitan, { anki })` result to enable Anki buttons. Listen for
`kanji-click`, `link-click`, and `note-added` to handle app navigation and saves.

For a worker, construct the client and its storage inside the worker, then expose a
message endpoint. The page connects through the other end. A `Worker` or a
`MessageChannel` port works.

```ts
// worker
import { createYomitan } from 'yomitan-core';
import { createIndexedDbStorage, exposeYomitan } from '@yomitan-core/web';
exposeYomitan(self, await createYomitan({ storage: createIndexedDbStorage() }));

// page
import { connectYomitan } from '@yomitan-core/web';
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const yomitan = await connectYomitan(worker);
```
