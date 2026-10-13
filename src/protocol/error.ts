/** Устойчивые высокоуровневые категории для программной обработки ошибок. */
export type WsHcmErrorKind = "auth" | "permission" | "soap-fault" | "http" | "protocol" | "cleanup";

/**
 * Нормализованная ошибка API или транспорта с ограниченной, очищенной диагностикой.
 * Сбой операции и сбой очистки: ошибка операции остаётся, очистка прикладывается в `cleanupError`.
 */
export class WsHcmApiError extends Error {
  /** Устойчивая машиночитаемая категория. */
  readonly kind: WsHcmErrorKind;
  /** Имя операции или действия в протоколе, если известно. */
  readonly operation?: string;
  /** Статус HTTP, если он был. */
  readonly status?: number;
  /** Ограниченная структурированная диагностика; никогда не полное тело ответа. */
  readonly details?: Readonly<Record<string, unknown>>;
  /** Явное локальное доказательство проверки до отправки; без него исход записи неопределённый. */
  readonly requestSent?: boolean;
  /** Сбои очистки, приложенные без замены этой основной ошибки. */
  cleanupError?: unknown;

  constructor(
    kind: WsHcmErrorKind,
    message: string,
    options: {
      operation?: string;
      status?: number;
      details?: Readonly<Record<string, unknown>>;
      requestSent?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WsHcmApiError";
    this.kind = kind;
    if (options.operation !== undefined) this.operation = options.operation;
    if (options.status !== undefined) this.status = options.status;
    if (options.details !== undefined) this.details = options.details;
    if (options.requestSent !== undefined) this.requestSent = options.requestSent;
  }
}

/**
 * Отказ по аргументу вызывающего: не тот тип, лишнее или неверно записанное значение. Наследует
 * TypeError: так его ловят скрипты. TypeError движка и Node этим классом не является — это сбой кода.
 */
export class ArgumentError extends TypeError {}

/** Отказ сервера со статусом отличается от потерянного или не наблюдавшегося ответа HTTP.
 * Идти только по ограниченным ссылкам ошибок; один локальный TypeError — не свидетельство сети. */
export function isTransportFailure(error: unknown): boolean {
  const pending = [error];
  const seen = new Set<unknown>();
  for (let index = 0; index < pending.length && index < 64; index++) {
    const current = pending[index];
    if (seen.has(current)) continue;
    seen.add(current);
    if (current instanceof WsHcmApiError && current.kind === "http" && current.status === undefined)
      return true;
    if (!(current instanceof Error)) continue;
    if (current.cause !== undefined) pending.push(current.cause);
    if (current instanceof WsHcmApiError && current.cleanupError !== undefined)
      pending.push(current.cleanupError);
    if (current instanceof AggregateError && Array.isArray(current.errors))
      pending.push(...current.errors.slice(0, 16));
  }
  return false;
}

/** Сохраняет и собирает сбои очистки, не заменяя основную ошибку операции. */
export function attachCleanupError(operationError: unknown, cleanupError: unknown): void {
  if (!(operationError instanceof Error) || !Object.isExtensible(operationError)) return;
  const target = operationError as Error & { cleanupError?: unknown };
  const previous = target.cleanupError;
  const value =
    previous === undefined
      ? cleanupError
      : new AggregateError(
          previous instanceof AggregateError
            ? [...previous.errors, cleanupError]
            : [previous, cleanupError],
          "Несколько ошибок при очистке",
        );
  Object.defineProperty(target, "cleanupError", {
    configurable: true,
    enumerable: false,
    writable: true,
    value,
  });
}
