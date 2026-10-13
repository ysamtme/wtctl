import type { WebSocketFactory } from "./protocol/types.js";
/** Публичные контракты операций, общие для SDK, CLI, MCP и адаптеров native. */
export type OperationEffect = "read" | "write" | "execute" | "unknown";
export type NativeProfile = "native" | "web" | "anonymous";
export type JsonSchema = Readonly<Record<string, unknown>>;
/** Настройки транспорта. Учётные данные никогда не входят в результаты операций. */
export interface NativeConfig {
    readonly baseUrl: string;
    readonly username?: string;
    readonly password?: string;
    readonly timeoutMs: number;
    readonly maxResponseBytes: number;
    readonly fetch?: typeof globalThis.fetch;
    /** Доверенный коннектор сокета в процессе; с собственным fetch обязателен для WebSocket. */
    readonly webSocketFactory?: WebSocketFactory;
}
/** Именованное подключение и локальные права runtime. Установка на сервер не требуется. */
export interface ConnectionConfig extends NativeConfig {
    readonly name: string;
    readonly outputLimitBytes: number;
    readonly runtimeDir: string;
    readonly permissions: {
        readonly write: boolean;
        readonly execute: boolean;
    };
    /** Сколько сервер держит лог нечитаемым после записи в него; по умолчанию 5500 мс. */
    readonly logBusyMs?: number;
}
/** Статическое описание одной операции. Доступность решает подключённый сервер в момент вызова. */
export interface OperationDefinition {
    readonly id: string;
    readonly group: string;
    readonly title: string;
    readonly description: string;
    readonly effect: OperationEffect;
    readonly status: string;
    readonly inputSchema: JsonSchema;
    readonly profile?: NativeProfile;
    readonly method?: string;
}
export interface NativeOperation extends OperationDefinition {
    readonly profile: NativeProfile;
    readonly method: string;
}
/** Неопределённая запись требует проверки, а не автоматического повтора. */
export type MutationOutcome = "not_sent" | "confirmed" | "indeterminate";
export interface OperationError {
    readonly code: string;
    readonly message: string;
    readonly hint?: string;
    readonly retryable?: boolean;
    readonly mutationOutcome?: MutationOutcome;
    readonly details?: Readonly<Record<string, unknown>>;
}
export interface OperationResult {
    readonly ok: boolean;
    readonly data?: unknown;
    readonly error?: OperationError;
    readonly meta: {
        readonly operationId: string;
        readonly connection: string;
        readonly durationMs: number;
        readonly truncated?: boolean;
        readonly resultId?: string;
        readonly resultBytes?: number;
        readonly [key: string]: unknown;
    };
}
export interface OperationFilter {
    readonly query?: string;
    readonly topic?: string;
    readonly group?: string;
    readonly effect?: OperationEffect;
    readonly status?: string;
    readonly cursor?: number;
    readonly limit?: number;
}
export interface OperationPage {
    readonly operations: readonly OperationDefinition[];
    readonly total: number;
    readonly nextCursor?: number;
}
export interface BinaryResult {
    readonly kind: "binary";
    readonly bytes: Uint8Array;
    readonly contentType: string;
}
