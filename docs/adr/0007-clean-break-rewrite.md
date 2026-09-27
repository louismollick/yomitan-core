# Clean-break rewrite, no compatibility layers

The overhaul is a full rewrite with one interface. There are no v1 or v2 facades, no deprecated shims, and no migration of previously stored dictionary data. Consumers are adapted in step with the rewrite, and users re-import their dictionaries.

## Why

- The only consumers are the maintainer's own apps.
- The existing layering (v2 wrapping v1, re-export facades, IndexedDB-shaped storage) was the main source of friction.

## What is kept from the old code

Some pieces are kept as behaviour, not as code:

- staged imports that stay invisible until they complete;
- UTF-16 ranges in lookup results;
- array-based dictionary ordering;
- tests that run the same cases over every storage adapter.
