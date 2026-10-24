# Entry views with per-target renderers

Presentation is split in two:

- a target-independent **entry view**, which is serializable data describing what to show;
- thin **renderers** per target: DOM (browser), HTML string (Node, Anki fields, WebViews) and, later, React Native native views.

Yomitan's look is the default renderer output. The design must leave room for consumer-supplied layouts.

## Why

React Native has no DOM. Node and Anki need HTML without a DOM. Today, view logic is fused with DOM writes and depends on about 140 `:root[data-*]` selectors from the extension stylesheet. That forced lapis to render through Anki templates and made mokuro-reader's popup integration painful.

## Considered options

- **Keep one DOM renderer and use linkedom on the server, WebView on mobile.** Rejected: it produces different output per target and cannot give native React Native UI.

## Amendment (2026-10-23): per-dictionary glossary HTML

Semantic entry views have no consumer yet (roadmap #4, #7). In the meantime, `render.glossaries(entry)` gives hosts that draw headwords, pitch, frequencies and actions themselves a partial path. It returns each dictionary's definitions as the HTML Yomitan's DisplayGenerator emits (structured content, images, definition tags), so glossary formatting stays Yomitan's. It is built from the same rendering as `render.html`, so it is not target-independent data like an entry view.
