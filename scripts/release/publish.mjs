/*
 * Publishes the public packages in order under one dist-tag.
 * Usage: node scripts/release/publish.mjs --tag <dist-tag>
 *
 * npm trusted publishing can't create a package, so a scoped package that isn't on the registry yet
 * is skipped with a warning; publish it once by hand and add the trusted publisher, as for yomitan-core.
 */

import { execFileSync } from 'node:child_process';
import { publicPackages, root } from './packages.mjs';

const tagIndex = process.argv.indexOf('--tag');
const tag = tagIndex === -1 ? undefined : process.argv[tagIndex + 1];
if (tag === undefined) {
    console.error('Usage: publish.mjs --tag <dist-tag>');
    process.exit(1);
}

function existsOnRegistry(name) {
    try {
        execFileSync('npm', ['view', name, 'name'], { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

for (const { manifest } of publicPackages()) {
    if (manifest.name !== 'yomitan-core' && !existsOnRegistry(manifest.name)) {
        console.warn(
            `::warning::${manifest.name} is not on npm yet; publish it once by hand to enable trusted publishing`,
        );
        continue;
    }
    execFileSync('npm', ['publish', '-w', manifest.name, '--tag', tag], { cwd: root, stdio: 'inherit' });
}
