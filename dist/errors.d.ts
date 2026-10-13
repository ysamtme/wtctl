import type { MutationOutcome, OperationError } from "./contracts.js";
/** Actionable, serialisable error; never includes a request body or credentials. */
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
/** The text of an XML node that is a string or has #text; the answer of the server lacks it otherwise. */
export declare function scalar(value: unknown, label: string): string;
