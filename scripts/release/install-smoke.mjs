/*
 * Packs every public package and installs the tarballs into fresh projects, one per target, then
 * imports the entry points and runs a lookup. Catches missing files, broken exports and dependency
 * pins that the workspace links hide.
 *  - Node ESM: import valid-dictionary1 into SQLite and look up a term.
 *  - Web: a Vite production build of a page using the storage and the element.
 *  - React Native: bundle the entry for the react-native condition; no Node builtins may leak in.
 *    The on-device run is the manual Expo harness (packages/react-native/harness).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicPackages, root } from './packages.mjs';

const work = mkdtempSync(join(tmpdir(), 'yomitan-core-smoke-'));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });

const tarballs = new Map();
for (const { manifest } of publicPackages()) {
    const output = execFileSync('npm', ['pack', '-w', manifest.name, '--pack-destination', work, '--json'], {
        cwd: root,
        encoding: 'utf8',
    });
    tarballs.set(manifest.name, join(work, JSON.parse(output)[0].filename));
}

function project(name, dependencies, files) {
    const dir = join(work, name);
    mkdirSync(dir);
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
            name: `smoke-${name}`,
            private: true,
            type: 'module',
            allowScripts: { 'better-sqlite3': true },
        }),
    );
    for (const [file, content] of Object.entries(files)) {
        writeFileSync(join(dir, file), content);
    }
    run('npm', ['install', '--no-audit', '--no-fund', ...dependencies], dir);
    return dir;
}

const fixture = join(root, 'packages/contract-tests/fixtures/upstream/dictionaries/valid-dictionary1');

if (tarballs.has('@yomitan-core/node')) {
    const dir = project('node', [tarballs.get('yomitan-core'), tarballs.get('@yomitan-core/node')], {
        'smoke.js': `
import { createYomitan } from 'yomitan-core';
import { createDirectoryArchiveReader, createNodeStorage } from '@yomitan-core/node';
const client = await createYomitan({
    storage: createNodeStorage(':memory:'),
    archiveReaders: { directory: createDirectoryArchiveReader },
});
await client.dictionaries.import({ source: { directory: ${JSON.stringify(fixture)} } });
const { entries } = await client.lookup.terms('打ち込む');
const html = await client.render.html(entries);
if (entries.length === 0 || !html.includes('class="entry"')) throw new Error('node smoke: no entries');
await client.dispose();
console.log('node smoke: ok');
`,
    });
    run('node', ['smoke.js'], dir);
}

if (tarballs.has('@yomitan-core/web')) {
    const dir = project('web', [tarballs.get('yomitan-core'), tarballs.get('@yomitan-core/web'), 'vite@^7.3.6'], {
        'index.html':
            '<!doctype html><yomitan-entries></yomitan-entries><script type="module" src="./main.js"></script>',
        'main.js': `
import { createYomitan } from 'yomitan-core';
import { createIndexedDbStorage, defineYomitanEntries } from '@yomitan-core/web';
defineYomitanEntries();
const client = await createYomitan({ storage: createIndexedDbStorage({ name: 'smoke' }) });
document.querySelector('yomitan-entries').client = client;
`,
    });
    run('npx', ['vite', 'build'], dir);
    console.log('web smoke: ok');
}

if (tarballs.has('@yomitan-core/react-native')) {
    const dir = project(
        'react-native',
        [tarballs.get('yomitan-core'), tarballs.get('@yomitan-core/react-native'), 'esbuild@0.25.12'],
        {
            'entry.js': `
import { createYomitan } from 'yomitan-core';
import { createReactNativeStorage } from '@yomitan-core/react-native';
globalThis.smoke = { createYomitan, createReactNativeStorage };
`,
        },
    );
    run(
        'npx',
        [
            'esbuild',
            'entry.js',
            '--bundle',
            '--platform=neutral',
            '--main-fields=react-native,module,main',
            '--conditions=react-native',
            '--external:@op-engineering/op-sqlite',
            '--external:react-native',
            '--outfile=bundle.js',
        ],
        dir,
    );
    console.log('react-native smoke: ok');
}
