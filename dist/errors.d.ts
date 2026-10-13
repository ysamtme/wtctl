import type { MutationOutcome, OperationError } from "./contracts.js";
/** Ошибка с подсказкой, сериализуемая; тело запроса и учётные данные в неё никогда не попадают. */
export declare class HcmError extends Error {
    readonly code: string;
    readonly hint?: string | undefined;
    readonly details?: Readonly<Record<string, unknown>> | undefined;
    readonly mutationOutcome?: MutationOutcome | undefined;
    constructor(code: string, message: string, hint?: string | undefined, details?: Readonly<Record<string, unknown>> | undefined, mutationOutcome?: MutationOutcome | undefined);
    toJSON(): OperationError;
}
export declare function inputObject(value: unknown, label?: string): Record<string, unknown>;
export declare function requiredString(value: unknown, path: string): string;
export declare function boundedInteger(value: unknown, fallback: number, max: number, path: string): number;
/** Текст XML-узла, являющегося строкой или имеющего #text; иначе в ответе сервера текста нет. */
export declare function scalar(value: unknown, label: string): string;
