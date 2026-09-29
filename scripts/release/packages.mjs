/*
 * The public packages, in publish order: yomitan-core first, since the others pin it exactly.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const ORDER = ['yomitan-core', '@yomitan-core/web', '@yomitan-core/node', '@yomitan-core/react-native'];

export function publicPackages() {
    const { workspaces } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return workspaces
        .map((dir) => ({
            dir: join(root, dir),
            manifest: JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')),
        }))
        .filter(({ manifest }) => manifest.private !== true)
        .sort((a, b) => rank(a.manifest.name) - rank(b.manifest.name));
}

function rank(name) {
    const index = ORDER.indexOf(name);
    return index === -1 ? ORDER.length : index;
}
