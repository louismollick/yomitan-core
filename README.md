# Yomitan Core

One npm-workspaces codebase for the portable Yomitan engine and its platform adapters.

| Workspace | Responsibility |
| --- | --- |
| `yomitan-core` | Engine and serializable client API |
| `@yomitan-core/web` | Browser compatibility adapter |
| `@yomitan-core/node` | Node.js SQLite compatibility adapter |
| `@yomitan-core/react-native` | Side-effect-free React Native entry point |
| `@yomitan-core/web-renderer` | Browser DOM renderer |
| `@yomitan-core/conformance` | Cross-package contract tests |

Platform packages remain private until their environment-specific implementations and conformance suites are complete.

```bash
npm install
npm run verify
```
