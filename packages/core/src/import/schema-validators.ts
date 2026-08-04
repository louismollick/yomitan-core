import Ajv from 'ajv';
import type { CompiledSchemaValidators } from '../types/dictionary-importer';

import dictionaryIndexSchema from './schemas/dictionary-index-schema.json';
import dictionaryKanjiBankV1Schema from './schemas/dictionary-kanji-bank-v1-schema.json';
import dictionaryKanjiBankV3Schema from './schemas/dictionary-kanji-bank-v3-schema.json';
import dictionaryKanjiMetaBankV3Schema from './schemas/dictionary-kanji-meta-bank-v3-schema.json';
import dictionaryTagBankV3Schema from './schemas/dictionary-tag-bank-v3-schema.json';
import dictionaryTermBankV1Schema from './schemas/dictionary-term-bank-v1-schema.json';
import dictionaryTermBankV3Schema from './schemas/dictionary-term-bank-v3-schema.json';
import dictionaryTermMetaBankV3Schema from './schemas/dictionary-term-meta-bank-v3-schema.json';

let _validators: CompiledSchemaValidators | null = null;

/**
 * Returns compiled AJV schema validators for all dictionary data bank types.
 * Validators are compiled once on first call and cached for subsequent calls.
 */
export function getSchemaValidators(): CompiledSchemaValidators {
    if (_validators !== null) {
        return _validators;
    }

    const ajv = new Ajv({
        allowUnionTypes: true,
    });

    _validators = {
        dictionaryIndex: ajv.compile(dictionaryIndexSchema),
        dictionaryTermBankV1: ajv.compile(dictionaryTermBankV1Schema),
        dictionaryTermBankV3: ajv.compile(dictionaryTermBankV3Schema),
        dictionaryTermMetaBankV3: ajv.compile(dictionaryTermMetaBankV3Schema),
        dictionaryKanjiBankV1: ajv.compile(dictionaryKanjiBankV1Schema),
        dictionaryKanjiBankV3: ajv.compile(dictionaryKanjiBankV3Schema),
        dictionaryKanjiMetaBankV3: ajv.compile(dictionaryKanjiMetaBankV3Schema),
        dictionaryTagBankV3: ajv.compile(dictionaryTagBankV3Schema),
    };

    return _validators;
}
