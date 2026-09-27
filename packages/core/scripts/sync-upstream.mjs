#!/usr/bin/env node
/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Vendors Yomitan's engine modules verbatim at the commit pinned in upstream.config.json.
 *
 *   1. Copies the transitive import closure of `roots` from ext/js.
 *   2. Replaces files that have an override in src/upstream-overrides/.
 *   3. Routes browser/extension globals (`domGlobals`) through src/platform/upstream-env.ts.
 *   4. Wraps text/JSON assets as JS modules and writes an asset index for fetchText/fetchJson.
 *   5. Bundles third-party libs (zip.js, Handlebars, hangul-js, kanji-processor) and precompiles
 *      the JSON schemas into standalone ajv validators, as upstream's dev/build-libs.js does.
 *   6. Copies types/ext and writes PROVENANCE.md.
 *
 * Usage: node scripts/sync-upstream.mjs [--upstream-dir <path>]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import acornGlobals from 'acorn-globals';
import * as acornWalk from 'acorn-walk';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import esbuild from 'esbuild';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(packageDir, 'upstream.config.json'), 'utf8'));
const outDir = path.join(packageDir, 'src', 'upstream');
const overridesDir = path.join(packageDir, 'src', 'upstream-overrides');
const envModulePath = path.join(packageDir, 'src', 'platform', 'upstream-env.js');

const HEADER = '// Vendored from Yomitan by scripts/sync-upstream.mjs. Do not edit; see PROVENANCE.md.\n';

function getUpstreamDir() {
    const flagIndex = process.argv.indexOf('--upstream-dir');
    const explicit = flagIndex >= 0 ? process.argv[flagIndex + 1] : process.env.YOMITAN_UPSTREAM_DIR;
    if (explicit) {
        return path.resolve(explicit);
    }
    const cacheDir = path.join(packageDir, '.upstream-cache', config.commit);
    const isComplete = () => {
        try {
            return (
                execFileSync('git', ['rev-parse', 'HEAD'], {
                    cwd: cacheDir,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore'],
                }).trim() === config.commit
            );
        } catch {
            return false;
        }
    };
    if (!isComplete()) {
        // A previous attempt may have failed half-way (for example on a network error): start over.
        fs.rmSync(cacheDir, { recursive: true, force: true });
        fs.mkdirSync(cacheDir, { recursive: true });
        execFileSync('git', ['init', '-q'], { cwd: cacheDir });
        execFileSync('git', ['remote', 'add', 'origin', config.repository], { cwd: cacheDir });
        execFileSync('git', ['fetch', '-q', '--depth', '1', 'origin', config.commit], {
            cwd: cacheDir,
            stdio: 'inherit',
        });
        execFileSync('git', ['checkout', '-q', 'FETCH_HEAD'], { cwd: cacheDir });
    }
    return cacheDir;
}

const upstreamDir = getUpstreamDir();
const actualCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstreamDir, encoding: 'utf8' }).trim();
if (actualCommit !== config.commit) {
    throw new Error(`Upstream checkout is at ${actualCommit}, expected pinned ${config.commit}`);
}

/** @param {string} p */
const toPosix = (p) => p.split(path.sep).join('/');

/**
 * @param {string} source
 * @returns {string[]}
 */
function getImportSpecifiers(source) {
    const specifiers = [];
    const pattern =
        /(?:^|\n)\s*(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) {
        specifiers.push(match[1] ?? match[2]);
    }
    return specifiers;
}

// 1. Import closure
const exclude = new Set(config.exclude);
const jsFiles = new Set();
const libImports = new Set();
const stack = [...config.roots];
while (stack.length > 0) {
    const file = stack.pop();
    if (jsFiles.has(file)) {
        continue;
    }
    if (exclude.has(file)) {
        throw new Error(`Excluded upstream file is imported by the closure: ${file}`);
    }
    const absolute = path.join(upstreamDir, file);
    if (file === 'assets.js') {
        // Generated asset index, imported by the fetch-utilities override.
        continue;
    }
    if (file.startsWith('ext/lib/')) {
        libImports.add(file);
        continue;
    }
    if (!fs.existsSync(absolute)) {
        throw new Error(`Missing upstream file: ${file}`);
    }
    jsFiles.add(file);
    const overridePath = path.join(overridesDir, file);
    const source = fs.readFileSync(fs.existsSync(overridePath) ? overridePath : absolute, 'utf8');
    for (const specifier of getImportSpecifiers(source)) {
        if (specifier.startsWith('.')) {
            stack.push(toPosix(path.normalize(path.join(path.dirname(file), specifier))));
        }
    }
}

// 2 + 3. Copy, override, route globals
fs.rmSync(outDir, { recursive: true, force: true });
const domGlobals = new Set(config.domGlobals);
const overridden = [];
const routed = {};
for (const file of [...jsFiles].sort()) {
    const target = path.join(outDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const overridePath = path.join(overridesDir, file);
    if (fs.existsSync(overridePath)) {
        overridden.push(file);
        fs.writeFileSync(target, HEADER + fs.readFileSync(overridePath, 'utf8'));
        continue;
    }
    let source = fs.readFileSync(path.join(upstreamDir, file), 'utf8');
    const parseOptions = { ecmaVersion: 'latest', sourceType: 'module' };
    const references = acornGlobals(source, parseOptions).filter(({ name }) => domGlobals.has(name));
    if (references.length > 0) {
        // `{document}` must become `{document: upstreamEnv.document}`, not `{upstreamEnv.document}`.
        const shorthandValues = new Set();
        acornWalk.simple(acorn.parse(source, parseOptions), {
            Property(node) {
                if (node.shorthand) {
                    shorthandValues.add(node.value.start);
                }
            },
        });
        const edits = [];
        for (const { name, nodes } of references) {
            (routed[file] ??= []).push(name);
            for (const node of nodes) {
                const replacement = `upstreamEnv.${name}`;
                edits.push({
                    start: node.start,
                    end: node.end,
                    text: shorthandValues.has(node.start) ? `${name}: ${replacement}` : replacement,
                });
            }
        }
        edits.sort((a, b) => b.start - a.start);
        for (const { start, end, text } of edits) {
            source = source.slice(0, start) + text + source.slice(end);
        }
        const envImport = toPosix(path.relative(path.dirname(target), envModulePath));
        source = `import {upstreamEnv} from '${envImport.startsWith('.') ? envImport : `./${envImport}`}';\n${source}`;
        acorn.parse(source, parseOptions); // The rewrite must still parse.
    }
    fs.writeFileSync(target, HEADER + source);
}

// 4. Assets
function expandGlob(pattern) {
    if (!pattern.includes('*')) {
        return [pattern];
    }
    const directory = path.dirname(pattern);
    const regex = new RegExp(`^${path.basename(pattern).replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
    return fs
        .readdirSync(path.join(upstreamDir, directory))
        .filter((name) => regex.test(name))
        .sort()
        .map((name) => `${directory}/${name}`);
}
const assetFiles = config.assets.flatMap(expandGlob);
const assetEntries = [];
for (const file of assetFiles) {
    const content = fs.readFileSync(path.join(upstreamDir, file), 'utf8');
    const moduleFile = `${file}.js`;
    const target = path.join(outDir, moduleFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const value = file.endsWith('.json') ? JSON.stringify(JSON.parse(content)) : JSON.stringify(content);
    fs.writeFileSync(target, `${HEADER}export default ${value};\n`);
    assetEntries.push([`/${file.replace(/^ext\//, '')}`, `./${moduleFile}`]);
}
fs.writeFileSync(
    path.join(outDir, 'assets.js'),
    `${HEADER}/** @type {Record<string, () => Promise<{default: unknown}>>} */\nexport const upstreamAssets = {\n${assetEntries
        .map(([url, module]) => `    ${JSON.stringify(url)}: () => import(${JSON.stringify(module)}),`)
        .join('\n')}\n};\n`,
);

// 5. Libs
const libDir = path.join(outDir, 'ext', 'lib');
fs.mkdirSync(libDir, { recursive: true });
const libEntries = {
    'ext/lib/zip.js': path.join(packageDir, 'scripts', 'lib', 'zip.js'),
    'ext/lib/handlebars.js': path.join(packageDir, 'scripts', 'lib', 'handlebars.js'),
    'ext/lib/hangul-js.js': path.join(packageDir, 'scripts', 'lib', 'hangul-js.js'),
    'ext/lib/kanji-processor.js': path.join(packageDir, 'scripts', 'lib', 'kanji-processor.js'),
    'ext/lib/parse5.js': path.join(packageDir, 'scripts', 'lib', 'parse5.js'),
    'ext/lib/linkedom.js': path.join(packageDir, 'scripts', 'lib', 'linkedom.js'),
};
for (const lib of libImports) {
    if (lib === 'ext/lib/validate-schemas.js' || lib === 'ext/lib/ucs2length.js') {
        continue;
    }
    if (!(lib in libEntries)) {
        throw new Error(`No bundling entry for upstream lib ${lib}`);
    }
}
// handlebars/lib/index.js requires `fs` only to register Node's require.extensions hook.
const emptyNodeBuiltins = {
    name: 'empty-node-builtins',
    setup(build) {
        build.onResolve({ filter: /^fs$/ }, () => ({ path: 'fs', namespace: 'empty' }));
        build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'export default {};', loader: 'js' }));
    },
};
/**
 * Bundles a lib reproducibly: esbuild's per-module path comments depend on where npm hoisted each
 * package, so they are dropped, and paths are resolved from this package.
 */
async function buildLib(entry, outfile, options = {}) {
    const result = await esbuild.build({
        plugins: [emptyNodeBuiltins],
        absWorkingDir: packageDir,
        entryPoints: [entry],
        bundle: true,
        minify: false,
        target: 'es2020',
        format: 'esm',
        platform: 'neutral',
        mainFields: ['module', 'main'],
        write: false,
        logLevel: 'warning',
        ...options,
    });
    const code = result.outputFiles[0].text
        .split('\n')
        .filter((line) => !/^\s*\/\/ (?:\.\.\/)*(?:node_modules|scripts)\//.test(line))
        .join('\n')
        // CommonJS wrapper keys embed module paths; make them independent of hoisting.
        .replace(/(?:\.\.\/)+node_modules\//g, 'node_modules/');
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    fs.writeFileSync(outfile, `${HEADER}// @ts-nocheck\n${code}`);
}

for (const [lib, entry] of Object.entries(libEntries)) {
    await buildLib(entry, path.join(outDir, lib));
}
const schemaFiles = config.rawFiles.flatMap(expandGlob);
const ajv = new Ajv({
    schemas: schemaFiles.map((file) => JSON.parse(fs.readFileSync(path.join(upstreamDir, file), 'utf8'))),
    code: { source: true, esm: true },
    allowUnionTypes: true,
});
const validators = standaloneCode(ajv).replaceAll('require("ajv/dist/runtime/ucs2length").default', 'ucs2length');
fs.writeFileSync(
    path.join(libDir, 'validate-schemas.js'),
    `${HEADER}// @ts-nocheck\nimport {ucs2length} from './ucs2length.js';\n${validators}`,
);
await buildLib(path.join(packageDir, 'scripts', 'lib', 'ucs2length.js'), path.join(libDir, 'ucs2length.js'));

// 5b. Upstream tests, copied verbatim next to the vendored ext/ so their relative imports resolve.
const testFiles = new Set();
const testStack = config.tests.flatMap(expandGlob);
while (testStack.length > 0) {
    const file = testStack.pop();
    if (testFiles.has(file)) {
        continue;
    }
    if (file.startsWith('ext/')) {
        if (!jsFiles.has(file) && !file.startsWith('ext/lib/')) {
            throw new Error(`Vendored test imports ${file}, which is not in the vendored closure`);
        }
        continue;
    }
    testFiles.add(file);
    const source = fs.readFileSync(path.join(upstreamDir, file), 'utf8');
    for (const specifier of getImportSpecifiers(source)) {
        if (specifier.startsWith('.')) {
            testStack.push(toPosix(path.normalize(path.join(path.dirname(file), specifier))));
        }
    }
}
for (const file of [...testFiles].sort()) {
    const target = path.join(outDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, HEADER + fs.readFileSync(path.join(upstreamDir, file), 'utf8'));
}
const fixturesTarget = path.resolve(packageDir, config.fixtures.target);
fs.rmSync(fixturesTarget, { recursive: true, force: true });
for (const fixture of config.fixtures.paths) {
    const target = path.join(fixturesTarget, fixture.replace(/^test\/data\//, ''));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(upstreamDir, fixture), target, { recursive: true });
}
fs.writeFileSync(
    path.join(fixturesTarget, 'PROVENANCE.md'),
    `# Upstream fixtures\n\nCopied verbatim from ${config.repository} at \`${config.commit}\` by \`packages/core/scripts/sync-upstream.mjs\`.\n\n${config.fixtures.paths.map((file) => `- \`${file}\``).join('\n')}\n`,
);

// Raw copies for vendored tests that read upstream files from disk.
for (const file of config.rawCopies.flatMap(expandGlob)) {
    const target = path.join(outDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(upstreamDir, file), target, { recursive: true });
}

// 6. Types and provenance
fs.cpSync(path.join(upstreamDir, 'types', 'ext'), path.join(outDir, 'types', 'ext'), { recursive: true });

const provenance = `# Upstream provenance

Generated by \`scripts/sync-upstream.mjs\`. Do not edit files under \`src/upstream/\` by hand.

- Repository: ${config.repository}
- Commit: \`${config.commit}\`
- Yomitan release version used for \`minimumYomitanVersion\` checks: \`${config.yomitanVersion}\`
- Vendored modules: ${jsFiles.size}
- Assets: ${assetFiles.length}

## Overrides (whole-file replacements from \`src/upstream-overrides/\`)

${overridden.map((file) => `- \`${file}\``).join('\n') || '- none'}

## Globals routed through \`src/platform/upstream-env.ts\`

${Object.entries(routed)
    .sort()
    .map(([file, names]) => `- \`${file}\`: ${[...new Set(names)].join(', ')}`)
    .join('\n')}

## Vendored upstream tests (run verbatim)

${[...testFiles]
    .sort()
    .map((file) => `- \`${file}\``)
    .join('\n')}

## Vendored modules

${[...jsFiles]
    .sort()
    .map((file) => `- \`${file}\``)
    .join('\n')}
`;
fs.writeFileSync(path.join(outDir, 'PROVENANCE.md'), provenance);
console.log(
    `Vendored ${jsFiles.size} modules, ${assetFiles.length} assets, ${Object.keys(libEntries).length + 2} libs.`,
);
