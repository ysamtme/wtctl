import type { MutationOutcome, OperationError } from "./contracts.js";

/** Actionable, serialisable error; never includes a request body or credentials. */
export class HcmError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly details?: Readonly<Record<string, unknown>>,
    readonly mutationOutcome?: MutationOutcome,
  ) {
    super(message);
    this.name = "HcmError";
  }
  toJSON(): OperationError {
    return {
      code: this.code,
      message: this.message,
      retryable: false,
      ...(this.hint === undefined ? {} : { hint: this.hint }),
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.mutationOutcome === undefined ? {} : { mutationOutcome: this.mutationOutcome }),
    };
  }
}

export function inputObject(value: unknown, label = "args"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new HcmError(
      "INVALID_ARGUMENT",
      `${label}: нужен объект.`,
      "Нужно передать объект JSON.",
    );
  return value as Record<string, unknown>;
}
export function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new HcmError(
      "INVALID_ARGUMENT",
      `${path}: нужна непустая строка.`,
      "Аргументы операции описывает api.describe.",
      { path },
    );
  return value;
}
export function boundedInteger(
  value: unknown,
  fallback: number,
  max: number,
  path: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new HcmError(
      "INVALID_ARGUMENT",
      `${path}: нужно целое число от 0 до ${max}.`,
      undefined,
      { path },
    );
  return value;
}
