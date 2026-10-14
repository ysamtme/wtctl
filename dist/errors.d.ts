import type { MutationOutcome, OperationError } from "./contracts.js";
/**
 * Ошибка клиента: её бросает loadConfig, от неё наследуют остальные ошибки SDK. Тело запроса
 * и учётные данные в неё не попадают.
 */
export declare class HcmError extends Error {
    /** Код ошибки: INVALID_CONFIG, WRITE_DISABLED… Программа сравнивает его, а не текст. */
    readonly code: string;
    /** Что сделать дальше. */
    readonly hint?: string | undefined;
    /** Подробности: путь к неверному аргументу, ID, похожие имена. */
    readonly details?: Readonly<Record<string, unknown>> | undefined;
    /** Исход записи; только у операций записи и выполнения кода. */
    readonly mutationOutcome?: MutationOutcome | undefined;
    constructor(
    /** Код ошибки: INVALID_CONFIG, WRITE_DISABLED… Программа сравнивает его, а не текст. */
    code: string, message: string, 
    /** Что сделать дальше. */
    hint?: string | undefined, 
    /** Подробности: путь к неверному аргументу, ID, похожие имена. */
    details?: Readonly<Record<string, unknown>> | undefined, 
    /** Исход записи; только у операций записи и выполнения кода. */
    mutationOutcome?: MutationOutcome | undefined);
    /** Ошибка в виде error ответа. */
    toJSON(): OperationError;
}
export declare function inputObject(value: unknown, label?: string): Record<string, unknown>;
export declare function requiredString(value: unknown, path: string): string;
export declare function boundedInteger(value: unknown, fallback: number, max: number, path: string): number;
/** Текст XML-узла, являющегося строкой или имеющего #text; иначе в ответе сервера текста нет. */
export declare function scalar(value: unknown, label: string): string;
