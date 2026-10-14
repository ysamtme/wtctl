/** Устойчивые высокоуровневые категории для программной обработки ошибок. */
export type WsHcmErrorKind = "auth" | "permission" | "soap-fault" | "http" | "protocol" | "cleanup";
/**
 * Нормализованная ошибка API или транспорта с ограниченной, очищенной диагностикой.
 * Сбой операции и сбой очистки: ошибка операции остаётся, очистка прикладывается в `cleanupError`.
 */
export declare class WsHcmApiError extends Error {
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
    constructor(kind: WsHcmErrorKind, message: string, options?: {
        operation?: string;
        status?: number;
        details?: Readonly<Record<string, unknown>>;
        requestSent?: boolean;
        cause?: unknown;
    });
}
/**
 * Отказ по аргументу вызывающего: не тот тип, лишнее или неверно записанное значение. Наследует
 * TypeError: так его ловят скрипты. TypeError движка и Node этим классом не является — это сбой кода.
 */
export declare class ArgumentError extends TypeError {
}
/** Отказ сервера со статусом отличается от потерянного или не наблюдавшегося ответа HTTP.
 * Идти только по ограниченным ссылкам ошибок; один локальный TypeError — не свидетельство сети. */
export declare function isTransportFailure(error: unknown): boolean;
/** Сохраняет и собирает сбои очистки, не заменяя основную ошибку операции. */
export declare function attachCleanupError(operationError: unknown, cleanupError: unknown): void;
