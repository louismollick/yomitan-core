# Node and React Native share one SQL storage schema

Node (better-sqlite3) and React Native (op-sqlite and similar) use a single SQL storage implementation over a small driver interface. It has one versioned schema, so a dictionary database built with Node can be shipped to a phone and opened as-is. Mobile devices can therefore either import dictionary archives themselves or download a prebuilt database.

The browser keeps its own IndexedDB storage. All storage adapters must pass the same behavioural contract tests.
