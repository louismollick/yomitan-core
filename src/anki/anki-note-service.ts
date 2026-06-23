import type { DictionaryEntry } from '../types/dictionary';
import type { Summary } from '../types/dictionary-importer';
import type { AnkiDuplicateScope } from '../types/settings';
import { AnkiNoteBuilder } from './anki-note-builder';
import type {
    AnkiCardFormat,
    Context,
    CreateNoteResult,
    GlossaryLayoutMode,
    ResultOutputMode,
} from './anki-note-builder';
import { AnkiTemplateRenderer } from './anki-template-renderer';
import type { HandlebarsInstance } from './anki-template-renderer';
import type { DictionaryMarkerSource } from './anki-template-util';
import { getDynamicTemplates } from './anki-template-util';
import { DEFAULT_ANKI_FIELD_TEMPLATES } from './default-anki-field-templates';

export type BuildAnkiNoteFromDictionaryEntryInput = {
    dictionaryEntry: DictionaryEntry;
    cardFormat: AnkiCardFormat;
    context: Context;
    tags?: string[];
    template?: string;
    duplicateScope?: AnkiDuplicateScope;
    duplicateScopeCheckAllModels?: boolean;
    resultOutputMode?: ResultOutputMode;
    glossaryLayoutMode?: GlossaryLayoutMode;
    compactTags?: boolean;
    dictionaryStylesMap?: Map<string, string>;
};

export type BuildAnkiNoteFromTermResult =
    | {
          status: 'ok';
          fields: Record<string, string>;
          errors: string[];
      }
    | {
          status: 'no-entry';
          errors: string[];
      };

function normalizeHandlebarsInstance(candidate: any): HandlebarsInstance {
    const handlebars = candidate?.default?.default ?? candidate?.default ?? candidate;
    if (!handlebars || typeof handlebars.registerHelper !== 'function') {
        throw new Error('Invalid Handlebars instance');
    }

    const wrapped = Object.create(handlebars) as HandlebarsInstance;
    wrapped.compileAST = (template: string) =>
        typeof handlebars.compile === 'function' ? handlebars.compile(template) : handlebars.compileAST(template);
    return wrapped;
}

async function resolveDefaultHandlebars(): Promise<HandlebarsInstance> {
    try {
        return normalizeHandlebarsInstance(await import('yomitan-handlebars'));
    } catch {
        return normalizeHandlebarsInstance(await import('handlebars'));
    }
}

export async function createDefaultAnkiTemplateRenderer(
    handlebars?: HandlebarsInstance,
): Promise<AnkiTemplateRenderer> {
    const handlebarsInstance = handlebars ?? (await resolveDefaultHandlebars());
    const renderer = new AnkiTemplateRenderer(handlebarsInstance);
    await renderer.prepare();
    return renderer;
}

export function getDefaultAnkiFieldTemplates(dynamicTemplates = ''): string {
    const template = DEFAULT_ANKI_FIELD_TEMPLATES.trim();
    const trimmedDynamicTemplates = dynamicTemplates.trim();
    if (trimmedDynamicTemplates.length === 0) {
        return template;
    }

    const markerSnippet = '{{~> (lookup . "marker") ~}}';
    const markerIndex = template.lastIndexOf(markerSnippet);
    if (markerIndex < 0) {
        return `${template}\n${trimmedDynamicTemplates}`;
    }

    const before = template.slice(0, markerIndex).trimEnd();
    const after = template.slice(markerIndex);
    return `${before}\n\n${trimmedDynamicTemplates}\n\n${after}`;
}

export async function buildAnkiNoteFromDictionaryEntry(
    input: BuildAnkiNoteFromDictionaryEntryInput,
    handlebars?: HandlebarsInstance,
): Promise<CreateNoteResult> {
    const renderer = await createDefaultAnkiTemplateRenderer(handlebars);
    const templateRenderer = renderer.templateRenderer;
    const builder = new AnkiNoteBuilder({
        getModifiedData: async (data, type) => templateRenderer.getModifiedData(data as any, type),
        renderMulti: async (items) => templateRenderer.renderMulti(items),
    });

    return await builder.createNote({
        dictionaryEntry: input.dictionaryEntry,
        cardFormat: input.cardFormat,
        context: input.context,
        tags: input.tags ?? [],
        template: input.template ?? getDefaultAnkiFieldTemplates(),
        duplicateScope: input.duplicateScope ?? 'collection',
        duplicateScopeCheckAllModels: input.duplicateScopeCheckAllModels ?? false,
        resultOutputMode: input.resultOutputMode ?? 'split',
        glossaryLayoutMode: input.glossaryLayoutMode ?? 'default',
        compactTags: input.compactTags ?? false,
        dictionaryStylesMap: input.dictionaryStylesMap ?? new Map(),
    });
}

export async function buildAnkiNoteFromTerm(
    input: Omit<BuildAnkiNoteFromDictionaryEntryInput, 'dictionaryEntry' | 'template'> & {
        entries: DictionaryEntry[];
        dictionaries?: DictionaryMarkerSource[];
        dictionaryInfo?: Summary[];
        additionalTemplates?: string;
        template?: string;
    },
    handlebars?: HandlebarsInstance,
): Promise<BuildAnkiNoteFromTermResult> {
    const dictionaryEntry = input.entries[0];
    if (!dictionaryEntry) {
        return { status: 'no-entry', errors: [] };
    }

    const dynamicTemplates =
        input.dictionaries && input.dictionaryInfo ? getDynamicTemplates(input.dictionaries, input.dictionaryInfo) : '';
    const combinedTemplates = `${dynamicTemplates}\n${input.additionalTemplates ?? ''}`.trim();
    const result = await buildAnkiNoteFromDictionaryEntry(
        {
            ...input,
            dictionaryEntry,
            template: input.template ?? getDefaultAnkiFieldTemplates(combinedTemplates),
        },
        handlebars,
    );

    return {
        status: 'ok',
        fields: result.note.fields,
        errors: result.errors.map((error) => error.message),
    };
}
