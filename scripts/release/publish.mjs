/*
 * Publishes the public packages in order under one dist-tag.
 * Usage: node scripts/release/publish.mjs --tag <dist-tag> [--allow-missing]
 *        node scripts/release/publish.mjs --check
 *
 * Publishing is idempotent: a version already on the registry is skipped, so a failed run can be
 * retried. npm trusted publishing can't create a package; with `--allow-missing` (prereleases), a
 * package that isn't on the registry yet is skipped with a warning. Releases require every package,
 * and `--check` verifies that before semantic-release commits anything.
 */

import { spawnSync } from 'node:child_process';
import { publicPackages, root } from './packages.mjs';

const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');
const tag = tagIndex === -1 ? undefined : args[tagIndex + 1];
const check = args.includes('--check');
const allowMissing = args.includes('--allow-missing');
if (tag === undefined && !check) {
    console.error('Usage: publish.mjs --tag <dist-tag> [--allow-missing] | --check');
    process.exit(1);
}

/** True if on the registry, false on a confirmed 404; any other failure throws. */
function onRegistry(spec) {
    const result = spawnSync('npm', ['view', spec, 'version', '--json'], { encoding: 'utf8' });
    if (result.status === 0) {
        return result.stdout.trim().length > 0;
    }
    if (/\bE404\b/.test(`${result.stdout}${result.stderr}`)) {
        return false;
    }
    throw new Error(`npm view ${spec} failed:\n${result.stderr}`);
}

const packages = publicPackages();
const missing = packages.filter(({ manifest }) => !onRegistry(manifest.name)).map(({ manifest }) => manifest.name);
if (check) {
    if (missing.length > 0) {
        console.error(`Not on npm yet (publish once by hand, see docs/releasing.md): ${missing.join(', ')}`);
        process.exit(1);
    }
    process.exit(0);
}
if (missing.length > 0 && !allowMissing) {
    console.error(`Refusing to publish a partial release; not on npm yet: ${missing.join(', ')}`);
    process.exit(1);
}

for (const { manifest } of packages) {
    if (missing.includes(manifest.name)) {
        console.warn(
            `::warning::${manifest.name} is not on npm yet; publish it once by hand to enable trusted publishing`,
        );
        continue;
    }
    if (onRegistry(`${manifest.name}@${manifest.version}`)) {
        console.log(`${manifest.name}@${manifest.version} is already published`);
        continue;
    }
    const result = spawnSync('npm', ['publish', '-w', manifest.name, '--tag', tag], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}
