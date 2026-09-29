# Headless Expo device gate

The native op-sqlite gate is deferred. This machine has an iOS simulator through `xcrun simctl` but no Android SDK, so this milestone does not build an Expo app.

For the manual iOS gate, create a minimal Expo app that installs this package and op-sqlite 17.1. Unpack `valid-dictionary1` with native filesystem code, then run the storage contract, force an import failure after one bank, re-import successfully, and compare lookups against a database built with `@yomitan-core/node`. Log assertions and fail the app run on any mismatch. The same harness should run on an Android emulator in CI when an SDK is available.
