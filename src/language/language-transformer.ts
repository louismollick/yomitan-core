import type * as Dictionary from '../types/dictionary';
import type { ConditionMapEntries, LanguageTransformDescriptor } from '../types/language-transformer';
import { log } from '../util/log';

export type TraceFrame = {
    transform: string;
    ruleIndex: number;
    text: string;
};

export type Trace = TraceFrame[];

export type TransformedText = {
    text: string;
    conditions: number;
    trace: Trace;
};

type InternalRule = {
    type: string;
    isInflected: RegExp;
    deinflect: (inflectedWord: string) => string;
    conditionsIn: number;
    conditionsOut: number;
};

type InternalTransform = {
    id: string;
    name: string;
    description?: string;
    rules: InternalRule[];
    heuristic: RegExp;
};

export class LanguageTransformer {
    private _nextFlagIndex: number;
    private _transforms: InternalTransform[];
    private _conditionTypeToConditionFlagsMap: Map<string, number>;
    private _partOfSpeechToConditionFlagsMap: Map<string, number>;

    constructor() {
        this._nextFlagIndex = 0;
        this._transforms = [];
        this._conditionTypeToConditionFlagsMap = new Map();
        this._partOfSpeechToConditionFlagsMap = new Map();
    }

    clear(): void {
        this._nextFlagIndex = 0;
        this._transforms = [];
        this._conditionTypeToConditionFlagsMap.clear();
        this._partOfSpeechToConditionFlagsMap.clear();
    }

    addDescriptor(descriptor: LanguageTransformDescriptor): void {
        const { conditions, transforms } = descriptor;
        const conditionEntries: ConditionMapEntries = Object.entries(conditions);
        const { conditionFlagsMap, nextFlagIndex } = this._getConditionFlagsMap(conditionEntries, this._nextFlagIndex);

        const transforms2: InternalTransform[] = [];

        for (const [transformId, transform] of Object.entries(transforms)) {
            const { name, description, rules } = transform;
            const rules2: InternalRule[] = [];
            for (let j = 0, jj = rules.length; j < jj; ++j) {
                const { type, isInflected, deinflect, conditionsIn, conditionsOut } = rules[j];
                const conditionFlagsIn = this._getConditionFlagsStrict(conditionFlagsMap, conditionsIn);
                if (conditionFlagsIn === null) {
                    throw new Error(`Invalid conditionsIn for transform ${transformId}.rules[${j}]`);
                }
                const conditionFlagsOut = this._getConditionFlagsStrict(conditionFlagsMap, conditionsOut);
                if (conditionFlagsOut === null) {
                    throw new Error(`Invalid conditionsOut for transform ${transformId}.rules[${j}]`);
                }
                rules2.push({
                    type,
                    isInflected,
                    deinflect,
                    conditionsIn: conditionFlagsIn,
                    conditionsOut: conditionFlagsOut,
                });
            }
            const isInflectedTests = rules.map((rule) => rule.isInflected);
            const heuristic = new RegExp(isInflectedTests.map((regExp) => regExp.source).join('|'));
            transforms2.push({ id: transformId, name, description, rules: rules2, heuristic });
        }

        this._nextFlagIndex = nextFlagIndex;
        for (const transform of transforms2) {
            this._transforms.push(transform);
        }

        for (const [type, { isDictionaryForm }] of conditionEntries) {
            const flags = conditionFlagsMap.get(type);
            if (typeof flags === 'undefined') {
                continue;
            }
            this._conditionTypeToConditionFlagsMap.set(type, flags);
            if (isDictionaryForm) {
                this._partOfSpeechToConditionFlagsMap.set(type, flags);
            }
        }
    }

    getConditionFlagsFromPartsOfSpeech(partsOfSpeech: string[]): number {
        return this._getConditionFlags(this._partOfSpeechToConditionFlagsMap, partsOfSpeech);
    }

    getConditionFlagsFromConditionTypes(conditionTypes: string[]): number {
        return this._getConditionFlags(this._conditionTypeToConditionFlagsMap, conditionTypes);
    }

    getConditionFlagsFromConditionType(conditionType: string): number {
        return this._getConditionFlags(this._conditionTypeToConditionFlagsMap, [conditionType]);
    }

    transform(sourceText: string): TransformedText[] {
        const results = [LanguageTransformer.createTransformedText(sourceText, 0, [])];
        for (let i = 0; i < results.length; ++i) {
            const { text, conditions, trace } = results[i];
            for (const transform of this._transforms) {
                if (!transform.heuristic.test(text)) {
                    continue;
                }

                const { id, rules } = transform;
                for (let j = 0, jj = rules.length; j < jj; ++j) {
                    const rule = rules[j];
                    if (!LanguageTransformer.conditionsMatch(conditions, rule.conditionsIn)) {
                        continue;
                    }
                    const { isInflected, deinflect } = rule;
                    if (!isInflected.test(text)) {
                        continue;
                    }

                    const isCycle = trace.some(
                        (frame) => frame.transform === id && frame.ruleIndex === j && frame.text === text,
                    );
                    if (isCycle) {
                        log.warn(
                            new Error(
                                `Cycle detected in transform[${id}] rule[${j}] for text: ${text}\nTrace: ${JSON.stringify(trace)}`,
                            ),
                        );
                        continue;
                    }

                    results.push(
                        LanguageTransformer.createTransformedText(
                            deinflect(text),
                            rule.conditionsOut,
                            this._extendTrace(trace, { transform: id, ruleIndex: j, text }),
                        ),
                    );
                }
            }
        }
        return results;
    }

    getUserFacingInflectionRules(inflectionRules: string[]): Dictionary.InflectionRuleChain {
        return inflectionRules.map((rule) => {
            const fullRule = this._transforms.find((transform) => transform.id === rule);
            if (typeof fullRule === 'undefined') {
                return { name: rule };
            }
            const { name, description } = fullRule;
            return description ? { name, description } : { name };
        });
    }

    static createTransformedText(text: string, conditions: number, trace: Trace): TransformedText {
        return { text, conditions, trace };
    }

    static conditionsMatch(currentConditions: number, nextConditions: number): boolean {
        return currentConditions === 0 || (currentConditions & nextConditions) !== 0;
    }

    private _getConditionFlagsMap(
        conditions: ConditionMapEntries,
        nextFlagIndex: number,
    ): { conditionFlagsMap: Map<string, number>; nextFlagIndex: number } {
        const conditionFlagsMap = new Map<string, number>();
        let targets: ConditionMapEntries = conditions;
        while (targets.length > 0) {
            const nextTargets: ConditionMapEntries = [];
            for (const target of targets) {
                const [type, condition] = target;
                const { subConditions } = condition;
                let flags = 0;
                if (typeof subConditions === 'undefined') {
                    if (nextFlagIndex >= 32) {
                        throw new Error('Maximum number of conditions was exceeded');
                    }
                    flags = 1 << nextFlagIndex;
                    ++nextFlagIndex;
                } else {
                    const multiFlags = this._getConditionFlagsStrict(conditionFlagsMap, subConditions);
                    if (multiFlags === null) {
                        nextTargets.push(target);
                        continue;
                    }
                    flags = multiFlags;
                }
                conditionFlagsMap.set(type, flags);
            }
            if (nextTargets.length === targets.length) {
                throw new Error('Maximum number of conditions was exceeded');
            }
            targets = nextTargets;
        }
        return { conditionFlagsMap, nextFlagIndex };
    }

    private _getConditionFlagsStrict(conditionFlagsMap: Map<string, number>, conditionTypes: string[]): number | null {
        let flags = 0;
        for (const conditionType of conditionTypes) {
            const flags2 = conditionFlagsMap.get(conditionType);
            if (typeof flags2 === 'undefined') {
                return null;
            }
            flags |= flags2;
        }
        return flags;
    }

    private _getConditionFlags(conditionFlagsMap: Map<string, number>, conditionTypes: string[]): number {
        let flags = 0;
        for (const conditionType of conditionTypes) {
            let flags2 = conditionFlagsMap.get(conditionType);
            if (typeof flags2 === 'undefined') {
                flags2 = 0;
            }
            flags |= flags2;
        }
        return flags;
    }

    private _extendTrace(trace: Trace, newFrame: TraceFrame): Trace {
        const newTrace = [newFrame];
        for (const { transform, ruleIndex, text } of trace) {
            newTrace.push({ transform, ruleIndex, text });
        }
        return newTrace;
    }
}
