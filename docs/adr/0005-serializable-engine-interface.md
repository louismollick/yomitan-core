# The engine interface is serializable

Everything crossing the engine's interface is plain structured-cloneable data:
- no class instances;
- no `Map`s;
- no `RegExp`s;
- no DOM nodes;
- no callbacks, except progress and abort, which are adapted at the transport.

This lets the engine run in a web worker or on a React Native background thread behind the same interface as in-process use. Choosing a thread becomes a hosting decision, not a design change.
