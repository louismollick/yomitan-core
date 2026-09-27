# The library owns entry actions; consumers own the popup

A headless **display controller** in the library implements Yomitan's entry actions and their states. Renderers wire their buttons to it. The actions are:

- play audio, with fallback through audio sources;
- add to Anki, with can-add, duplicate and view-note states and overwrite;
- kanji drill-down;
- collapsible dictionaries.

Consumers own the popup container, where it is placed, and navigation history between lookups.

## Default DOM renderer

The default DOM renderer is a custom element with a shadow root. It contains Yomitan's markup and CSS, and reports user intent through typed events rather than class names.

## Why

Consumers kept reimplementing Yomitan behaviour and getting it slightly wrong or leaving it unfinished: duplicate prechecks, dead audio buttons, overlaid Anki buttons. The library also cannot know how a given app wants to place or stack popups.

## Amendment (2026-09-26): audio ships after 2.0

The play-audio action stays part of this decision. However, audio download, validation and fallback are delivered as the first fast follow after 2.0 (roadmap P0 #1), not in the 2.0 release. Until then, the default renderer hides the audio button rather than showing a button that does nothing.
