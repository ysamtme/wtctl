import type { MutationOutcome, OperationError } from "./contracts.js";

/**
 * Ошибка клиента: её бросает loadConfig, от неё наследуют остальные ошибки SDK. Тело запроса
 * и учётные данные в неё не попадают.
 */
export class HcmError extends Error {
  constructor(
    /** Код ошибки: INVALID_CONFIG, WRITE_DISABLED… Программа сравнивает его, а не текст. */
    readonly code: string,
    message: string,
    /** Что сделать дальше. */
    readonly hint?: string,
    /** Подробности: путь к неверному аргументу, ID, похожие имена. */
    readonly details?: Readonly<Record<string, unknown>>,
    /** Исход записи; только у операций записи и выполнения кода. */
    readonly mutationOutcome?: MutationOutcome,
  ) {
    super(message);
    this.name = new.target.name;
  }
  /** Ошибка в виде error ответа. */
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
/** Текст XML-узла, являющегося строкой или имеющего #text; иначе в ответе сервера текста нет. */
export function scalar(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value)
    return String((value as Record<string, unknown>)["#text"]);
  throw new HcmError("PLATFORM_RESPONSE", `В ответе сервера нет ${label}.`);
}
