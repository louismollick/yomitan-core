// Vendored from Yomitan by scripts/sync-upstream.mjs. Do not edit; see PROVENANCE.md.
// @ts-nocheck
function configure() {
}
var TextWriter = class {
};
var BlobWriter = class {
};
function unsupported() {
  throw new Error("Use a yomitan-core ArchiveReader to read dictionary archives");
}
var Uint8ArrayReader = class {
  constructor() {
    unsupported();
  }
};
var ZipReader = class {
  constructor() {
    unsupported();
  }
};
export {
  BlobWriter,
  TextWriter,
  Uint8ArrayReader,
  ZipReader,
  configure
};
