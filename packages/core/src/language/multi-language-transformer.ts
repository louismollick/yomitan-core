import type * as Dictionary from '../types/dictionary';
import { LanguageTransformer } from './language-transformer';
import type { TransformedText } from './language-transformer';
import { getAllLanguageTransformDescriptors } from './languages';

export class MultiLanguageTransformer {
    private _languageTransformers: Map<string, LanguageTransformer>;

    constructor() {
        this._languageTransformers = new Map();
    }

    prepare(): void {
        const languagesWithTransforms = getAllLanguageTransformDescriptors();
        for (const { languageTransforms: descriptor } of languagesWithTransforms) {
            const languageTransformer = new LanguageTransformer();
            languageTransformer.addDescriptor(descriptor);
            this._languageTransformers.set(descriptor.language, languageTransformer);
        }
    }

    getConditionFlagsFromPartsOfSpeech(language: string, partsOfSpeech: string[]): number {
        const languageTransformer = this._languageTransformers.get(language);
        return typeof languageTransformer !== 'undefined'
            ? languageTransformer.getConditionFlagsFromPartsOfSpeech(partsOfSpeech)
            : 0;
    }

    getConditionFlagsFromConditionTypes(language: string, conditionTypes: string[]): number {
        const languageTransformer = this._languageTransformers.get(language);
        return typeof languageTransformer !== 'undefined'
            ? languageTransformer.getConditionFlagsFromConditionTypes(conditionTypes)
            : 0;
    }

    getConditionFlagsFromConditionType(language: string, conditionType: string): number {
        const languageTransformer = this._languageTransformers.get(language);
        return typeof languageTransformer !== 'undefined'
            ? languageTransformer.getConditionFlagsFromConditionType(conditionType)
            : 0;
    }

    transform(language: string, sourceText: string): TransformedText[] {
        const languageTransformer = this._languageTransformers.get(language);
        if (typeof languageTransformer === 'undefined') {
            return [LanguageTransformer.createTransformedText(sourceText, 0, [])];
        }
        return languageTransformer.transform(sourceText);
    }

    getUserFacingInflectionRules(language: string, inflectionRules: string[]): Dictionary.InflectionRuleChain {
        const languageTransformer = this._languageTransformers.get(language);
        if (typeof languageTransformer === 'undefined') {
            return inflectionRules.map((rule) => ({ name: rule }));
        }
        return languageTransformer.getUserFacingInflectionRules(inflectionRules);
    }
}
