# Yomitan Core

One npm-workspaces codebase for Yomitan Core v2 migration.

| Workspace | Responsibility |
| --- | --- |
| `yomitan-core` | Existing engine/client plus retained v1 platform code pending extraction |
| `@yomitan-core/web` | Private browser compatibility facade |
| `@yomitan-core/node` | Private Node.js SQLite compatibility facade |
| `@yomitan-core/react-native` | Private side-effect-free React Native facade |
| `@yomitan-core/web-renderer` | Private browser renderer compatibility facade |
| `@yomitan-core/conformance` | Cross-package contract tests |

These workspaces establish package and test boundaries; they do not claim platform extraction is complete. Platform packages remain private until core no longer depends on Dexie, SQLite, Zip.js, DOM rendering, or platform HTTP implementations.

```bash
npm install
npm run verify
```
