/** Предел ожидания завершения агента сервера по умолчанию (мс). */
export declare const DEFAULT_AGENT_WAIT_TIMEOUT_MS = 120000;
/** Минимальный предел ожидания завершения агента сервера (мс). */
export declare const MIN_AGENT_WAIT_TIMEOUT_MS = 1000;
/** Максимальный предел ожидания завершения агента сервера (мс). */
export declare const MAX_AGENT_WAIT_TIMEOUT_MS = 3600000;
/** Количество записей `agents.status` по умолчанию. */
export declare const DEFAULT_AGENT_STATUS_LIMIT = 20;
/** Максимальное количество записей `agents.status`. */
export declare const MAX_AGENT_STATUS_LIMIT = 200;
/** Ответ execute. */
export interface ScriptData<T = unknown> {
    /**
     * Массив RESULT из кода; числа и логические значения приходят строками. Дату нужно приводить к
     * строке в самом коде (StrDate, StrXmlDate): на части версий сервера она в ответ не попадает.
     */
    readonly result: readonly T[];
    /** Описания столбцов, если сервер их вернул. */
    readonly columns?: readonly unknown[];
    /** Дополнительные данные коллекции, если сервер их вернул. */
    readonly data?: Readonly<Record<string, unknown>>;
    /** Имя несохранённой коллекции, несшей код; оно попадает в строки лога сервера. */
    readonly executionId: string;
}
/** Состояние запуска агента сервера в ответе runAgent. */
export type AgentRunStatus = "running" | "finished" | "cancelled" | "unknown";
/** Состояние записи в списке запусков агентов сервера. */
export type AgentListStatus = "running" | "finished" | "cancelled";
/** Одна запись о запуске агента сервера из списка запусков. */
export interface AgentRunRecord {
    /** ID агента сервера (server_agent) в десятичной записи. */
    readonly id: string;
    /** Код агента сервера. */
    readonly code: string;
    /** Название агента сервера. */
    readonly name: string;
    /** Состояние запуска: выполняется, завершён или отменён. */
    readonly status: AgentListStatus;
    /** ID потока запуска (строка, 64-битное целое без потери точности). */
    readonly threadId: string;
    /** Идентификатор роли сервера, на которой выполняется или выполнялся агент (на одиночном сервере 2025.2 — пустая строка). */
    readonly roleUID?: string;
    /** Местное время сервера при запуске. */
    readonly startedAt: string;
    /** Местное время сервера при завершении или отмене (отсутствует у выполняющегося агента). */
    readonly finishedAt?: string;
}
/** Ответ runAgent. */
export interface AgentRunData {
    /** false: агент не запущен (уже выполняется при allowConcurrent:false или отклонён сервером). */
    readonly started: boolean;
    /** Состояние запуска: running, finished, cancelled или unknown. */
    readonly status?: AgentRunStatus;
    /** ID потока запуска (или уже выполняющегося экземпляра, если запуск отклонён из-за дубля). */
    readonly threadId?: string;
    /** Идентификатор роли сервера, на которой выполняется или выполнялся агент. */
    readonly roleUID?: string;
    /** Местное время сервера при запуске: строки агента в логах лежат после него. */
    readonly startedAt: string;
    /** Местное время сервера после завершения или отмены (отсутствует при wait:false). */
    readonly finishedAt?: string;
    /** В каком логе искать строки агента и как проверить или остановить запуск. */
    readonly hint: string;
}
/** Ответ agentStatus. */
export interface AgentStatusData {
    /** Запуски агентов сервера, подошедшие под фильтр (сначала выполняющиеся, затем свежие завершённые). */
    readonly runs: readonly AgentRunRecord[];
    /** Сколько запусков подошло под фильтр (до ограничения limit). */
    readonly total: number;
}
/** Ответ cancelAgent. */
export interface AgentCancelData {
    /** Запрос на отмену передан в очередь роли сервера. */
    readonly cancelled: true;
    /** ID потока агента сервера. */
    readonly threadId: string;
    /** Идентификатор роли сервера, в очередь которой отправлена отмена. */
    readonly roleUID: string;
    /** Исход записи: запрос на отмену подтверждён сервером. */
    readonly mutationOutcome: "confirmed";
    /** Что делать дальше: уже сделанные изменения не откатываются. */
    readonly hint: string;
}
