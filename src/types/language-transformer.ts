export type LanguageTransformDescriptor<TCondition extends string = string> = {
    language: string;
    conditions: ConditionMapObject<TCondition>;
    transforms: TransformMapObject<TCondition>;
};

export type ConditionMapObject<TCondition extends string> = {
    [type in TCondition]: Condition;
};

export type TransformMapObject<TCondition> = {
    [name: string]: Transform<TCondition>;
};

export type ConditionMapEntry = [type: string, condition: Condition];

export type ConditionMapEntries = ConditionMapEntry[];

export type Condition = {
    name: string;
    isDictionaryForm: boolean;
    i18n?: RuleI18n[];
    subConditions?: string[];
};

export type RuleI18n = {
    language: string;
    name: string;
};

export type Transform<TCondition> = {
    name: string;
    description?: string;
    i18n?: TransformI18n[];
    rules: Rule<TCondition>[];
};

export type TransformI18n = {
    language: string;
    name: string;
    description?: string;
};

export type DeinflectFunction = (inflectedWord: string) => string;

export type Rule<TCondition = string> = {
    type: 'suffix' | 'prefix' | 'wholeWord' | 'other';
    isInflected: RegExp;
    deinflect: DeinflectFunction;
    conditionsIn: TCondition[];
    conditionsOut: TCondition[];
};

export type SuffixRule<TCondition = string> = {
    type: 'suffix';
    isInflected: RegExp;
    deinflected: string;
    deinflect: DeinflectFunction;
    conditionsIn: TCondition[];
    conditionsOut: TCondition[];
};
