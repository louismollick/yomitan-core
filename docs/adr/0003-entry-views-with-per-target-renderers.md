# Entry views with per-target renderers

Presentation is split in two:

- a target-independent **entry view**, which is serializable data describing what to show;
- thin **renderers** per target: DOM (browser), HTML string (Node, Anki fields, WebViews) and, later, React Native native views.

Yomitan's look is the default renderer output. The design must leave room for consumer-supplied layouts.

## Why

React Native has no DOM. Node and Anki need HTML without a DOM. Today, view logic is fused with DOM writes and depends on about 140 `:root[data-*]` selectors from the extension stylesheet. That forced lapis to render through Anki templates and made mokuro-reader's popup integration painful.

## Considered options

- **Keep one DOM renderer and use linkedom on the server, WebView on mobile.** Rejected: it produces different output per target and cannot give native React Native UI.
