/*
 * Sets every public package to one version and pins their dependencies on each other to it exactly.
 * Usage: node scripts/release/set-version.mjs <version>
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { publicPackages } from './packages.mjs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
    console.error('Usage: set-version.mjs <semver>');
    process.exit(1);
}
const packages = publicPackages();
const names = new Set(packages.map(({ manifest }) => manifest.name));
for (const { dir, manifest } of packages) {
    manifest.version = version;
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const name of Object.keys(manifest[field] ?? {})) {
            if (names.has(name)) {
                manifest[field][name] = version;
            }
        }
    }
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`${manifest.name}@${version}`);
}
