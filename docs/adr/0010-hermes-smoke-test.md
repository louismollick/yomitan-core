# Hermes compatibility is tested with a Metro-equivalent pipeline

CI proves that core runs on React Native's JavaScript engine without a device:

1. esbuild bundles an entry that exercises the engine;
2. **React Native 0.86's own `hermesc`** (npm `hermes-compiler`) must compile the bundle after `@react-native/babel-preset` with the `hermes-stable` profile, which is what Metro emits for Hermes apps;
3. the **Hermes CLI** (installed with `jsvu`) runs the bundle after the preset's default transform, and must reproduce upstream's golden results.

A prelude adds only globals React Native itself provides (`console`, `queueMicrotask`, `performance`, and `Intl.Collator`, which React Native's Hermes has but the CLI build lacks). Missing platform APIs such as `TextDecoder` or `structuredClone` therefore still fail the test.

## Why

No Android SDK is available in development, and emulator jobs are slow and flaky in CI. The standalone Hermes CLI is older than React Native 0.86's Hermes and lacks classes and async generators. Running it on the fully transformed bundle checks runtime behaviour, and 0.86's `hermesc` separately checks the syntax a real app would ship.

## Limits

This does not exercise native modules (op-sqlite, native unzip). Milestone 4 adds a device harness for those.
