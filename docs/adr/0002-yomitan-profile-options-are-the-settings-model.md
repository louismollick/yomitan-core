# Yomitan profile options are the settings model

The library owns a single options model: a **profile**. It uses the subset of Yomitan's profile options schema that a headless library can honour, with the same key paths and defaults. Consumers persist that one serializable object. Every lookup, rendering, audio and Anki operation reads from it, instead of each consumer inventing per-call option bags and its own dictionary enabled/order state.

We chose Yomitan's shape over a bespoke one for three reasons: parity (ADR-0001) is defined relative to Yomitan's options, a user's exported Yomitan settings can be imported directly, and Yomitan's defaults come for free.

## Scope

The library works with **one profile at a time**. Consumers persist that profile themselves. The library supplies defaults, validation, schema-version migration, and import of a chosen profile from a Yomitan settings export.

Managing multiple profiles and Yomitan's conditional profile switching (based on URL or modifier keys) are deliberately out of scope. They are extension-shaped. A consumer that needs several profiles can keep several profile objects.

## Amendment (2026-09-28): the full upstream shape is kept

The profile stores Yomitan's complete profile `options` object, not a projected subset. Groups the library does not act on (popup window, hotkeys, clipboard, accessibility) are carried along untouched. Upstream's migrations and schema validation then apply unchanged, and a Yomitan settings export round-trips without loss. The groups yomitan-core honours are still the ones listed in the overhaul plan §3.2.
