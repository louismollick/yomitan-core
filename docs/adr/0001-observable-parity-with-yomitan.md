# Observable parity with Yomitan; internals are free

The library's contract is **parity** with Yomitan as seen from outside. With the same dictionaries and options, a consumer should get the same entries, ordering, deinflections, presentation and behaviour (Anki card output, audio fallback, sentence extraction). It should be possible to build a Chrome extension on this library that looks and behaves very much like Yomitan. Internals may be restructured freely.

Yomitan's behaviour is the default, but consumers can customize away from it.

## Consequences

- We port an upstream Yomitan change only when it is **user-facing**. Upstream refactors are ignored, so the code does not have to mirror upstream's file layout.
- Parity is enforced by running Yomitan's own golden test fixtures (translator, Anki note builder, dictionary validation, language transforms, sentence extraction) against the library. Faithfulness is not judged by reading the code.
- Small pixel differences in presentation are acceptable. Differences in content, ordering or card output are not.
- Parity is judged per feature: a feature the library ships must match Yomitan. Features not yet shipped are **absent**, never shipped in a different form. In 2.0, audio fetching and Anki media are absent (roadmap P0). Their markers render empty, exactly as Yomitan does when no media is supplied.
