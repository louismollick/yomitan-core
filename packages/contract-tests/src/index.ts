/*
 * Copyright (C) 2026  yomitan-core authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export { createDictionaryArchive, readUpstreamJson, upstreamFixturesDir } from './fixtures';
export { runStorageContract, testMediaLoader, type CreateStorage } from './storage-contract';
export { runTranslatorParity, TRANSLATOR_FIXTURE_DICTIONARY } from './translator-parity';
export {
    type ExtraArchiveReaders,
    readFixtureDictionaryFiles,
    runImportContract,
    VALID_DICTIONARY_IMAGE_SIZES,
} from './import-contract';
export { type CreateClientStorage, runClientContract } from './client-contract';
export { runGeneratedGoldens, toUpstreamParseResult } from './generated-goldens';
