# Releasing

Four packages are published together, at one version: `yomitan-core`, `@yomitan-core/web`, `@yomitan-core/node` and `@yomitan-core/react-native`. The three adapters pin `yomitan-core` to that exact version. They are published in that order by `scripts/release/publish.mjs`.

## What CI publishes

| Trigger | Version | dist-tag |
| --- | --- | --- |
| Push to any branch with an open PR | `x.y.z-pr.<number>.<run>.<attempt>` | `pr-<number>` |
| Push to any other branch | `x.y.z-branch.<slug>.<run>.<attempt>` | `branch-<slug>` |
| **Run workflow** on a branch with "release candidate" checked | `x.y.z-rc.<run number>` | `rc` |
| Push to `main` | semantic-release's next version | `latest` |

Every publish first runs `scripts/release/install-smoke.mjs`. It packs each package and installs the tarballs into fresh projects:
- a Node ESM lookup;
- a Vite production build for the web;
- a React Native bundle.

Consumers pin exact prerelease versions (for example `2.0.0-pr.8.123.1`), never a dist-tag.

## One-time setup for a new package

npm trusted publishing (OIDC, no token) only works for a package that already exists. For each new `@yomitan-core/*` package:
1. Publish it once by hand as a prerelease, for example `npm publish -w @yomitan-core/web --tag next` after `node scripts/release/set-version.mjs 2.0.0-next.0`. This needs your npm account, which must own the `@yomitan-core` scope.
2. On npmjs.com, add the trusted publisher: GitHub repository `louismollick/yomitan-core`, workflow `publish-npm.yml`.

Until then, CI publishes the packages that exist and skips the others with a warning.

## Shipping 2.0.0

`latest` stays on 1.7.0 until mokuro-reader has run on a release candidate in production. Then merge `next` into `main`: the `feat!` commits make semantic-release publish `2.0.0` for all four packages.
