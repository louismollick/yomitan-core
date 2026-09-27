# Yomitan Core

A headless library that gives apps Yomitan's dictionary behaviour: importing Yomitan-format dictionaries, looking up text, and presenting results, audio and Anki cards the way Yomitan does. It runs in browsers, Node and React Native.

## Language

### Product

**Yomitan**:
The upstream browser extension. It is the reference for how the library should look and behave from the outside.
_Avoid_: upstream (except when talking about its source code), the extension

**Parity**:
Presentation and behaviour that someone outside the library, a user or a consuming app, sees as equivalent to Yomitan under the same dictionaries and options. Internals are free to differ.
_Avoid_: compatibility, fidelity, port accuracy

**Consumer**:
An app that embeds the library, such as mokuro-reader, lapis or substreamer.
_Avoid_: client, host app, user

**Target**:
A runtime the library supports: browser, Node or React Native.
_Avoid_: platform, environment

### Dictionaries

**Dictionary**:
An installed Yomitan-format dictionary, identified by its title.
_Avoid_: dict, database

**Dictionary archive**:
The Yomitan-format `.zip` file from which a dictionary is installed.
_Avoid_: dictionary file, zip

**Import**:
Installing a dictionary from a dictionary archive. A dictionary is invisible to lookups until its import completes.
_Avoid_: install, load

**Recommended dictionary**:
A dictionary that Yomitan suggests for a language, together with the location of its archive.

### Options

**Profile**:
One complete set of options, shaped like a Yomitan profile. It covers which dictionaries are used and in what order, as well as lookup, display, audio and Anki options.
_Avoid_: settings, config, preferences

### Lookup

**Lookup**:
Finding the dictionary entries that match a piece of text.
_Avoid_: search, query, translate

**Term entry**:
The result of a term lookup: one or more headwords with their definitions, tags, frequencies and pronunciations.
_Avoid_: result, definition, dictionary entry (ambiguous with kanji entry)

**Kanji entry**:
The result of a kanji lookup for a single character.

**Headword**:
A term and reading pair that a term entry is about.
_Avoid_: expression, word

**Inflection rule chain**:
The sequence of deinflection rules that turned the looked-up text into a headword's dictionary form.
_Avoid_: reasons, deinflection trace

**Scan**:
Finding the longest term that starts at a given position in a text, the way Yomitan does when you hover or tap a character.
_Avoid_: termAt, hit-test

**Parse**:
Splitting a whole text into consecutive terms, as Yomitan's "parse text" feature does.
_Avoid_: tokenize, scanLine, segment

**Sentence**:
The span of text around a scanned position, bounded by Yomitan's sentence-parsing rules. It feeds Anki fields such as `{sentence}` and `{cloze-*}`.

### Presentation

**Entry view**:
A description of how an entry is presented (layout, headwords with furigana, tags, frequencies, pitch accents, glossary content) that doesn't depend on any target.
_Avoid_: view model, render tree, HTML

**Renderer**:
Something that turns entry views into UI for one target: DOM, HTML string or React Native.
_Avoid_: display generator, template

**Entry action**:
Something a user can do from a displayed entry, as in Yomitan's popup: play audio, add to Anki, view the existing note, drill into a kanji, or collapse a dictionary's definitions.
_Avoid_: button, event

**Popup**:
The consumer-owned container that shows entries. The library renders what goes inside it, but does not place it or keep its navigation history.
_Avoid_: drawer, panel (as library terms)

### Anki

**Card format**:
A named recipe for turning an entry into an Anki note: deck, note type, field templates and duplicate behaviour.
_Avoid_: note template, card type

**Marker**:
A named placeholder such as `{glossary}` or `{sentence}` that a field template expands.
_Avoid_: tag, variable

### Audio

**Audio source**:
A configured provider of term pronunciations (for example JapanesePod101, Jisho or a custom URL), tried in order until one yields valid audio.
_Avoid_: audio provider, audio URL
