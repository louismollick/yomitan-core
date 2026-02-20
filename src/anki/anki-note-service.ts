import type { DictionaryEntry } from '../types/dictionary';
import type { AnkiDuplicateScope } from '../types/settings';
import { AnkiNoteBuilder } from './anki-note-builder';
import type {
    AnkiCardFormat,
    Context,
    CreateNoteResult,
    GlossaryLayoutMode,
    ResultOutputMode,
} from './anki-note-builder';
import { DEFAULT_ANKI_FIELD_TEMPLATES } from './default-anki-field-templates';
import { AnkiTemplateRenderer } from './anki-template-renderer';
import type { HandlebarsInstance } from './anki-template-renderer';

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

async function resolveDefaultHandlebars(): Promise<HandlebarsInstance> {
    try {
        const module = await import('yomitan-handlebars');
        return (module.default ?? module) as HandlebarsInstance;
    } catch {
        const module = await import('handlebars');
        return (module.default ?? module) as HandlebarsInstance;
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
