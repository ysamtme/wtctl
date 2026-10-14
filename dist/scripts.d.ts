/** Ответ execute. */
export interface ScriptData<T = unknown> {
    /** Массив RESULT из кода; числа, даты и логические значения — строками. */
    readonly result: readonly T[];
    /** Описания столбцов, если сервер их вернул. */
    readonly columns?: readonly unknown[];
    /** Дополнительные данные коллекции, если сервер их вернул. */
    readonly data?: Readonly<Record<string, unknown>>;
    /** Имя несохранённой коллекции, несшей код; оно попадает в строки лога сервера. */
    readonly executionId: string;
}
/** Существующий RPC Administrator получает несохранённый XmElem с приложенной штатной формой. */
export declare function prepareScript(value: unknown, params?: unknown): {
    request: Record<string, unknown>;
    executionId: string;
};
/** Ответ runAgent. */
export interface AgentRunData {
    /** false: сервер не запустил агента; причина — в логе `agent`. */
    readonly started: boolean;
    /** Местное время сервера перед запуском: строки агента в логах лежат после него. */
    readonly startedAt: string;
    /** Местное время сервера после конца кода агента. */
    readonly finishedAt: string;
    /** В каком логе искать строки и ошибки агента. */
    readonly hint: string;
}
/** Код и параметры запуска агента на месте. ID идут в код агента, поэтому проходят только ID. */
export declare function agentRun(args: Record<string, unknown>): {
    code: string;
    params: object;
};
export declare function agentRunResult(data: ScriptData): AgentRunData;
/** Сырые пробы могут идти тем же запросом, не меняя свой низкоуровневый контракт аргументов. */
export declare function scriptRequest(value: unknown, params?: unknown): Record<string, unknown>;
/** Успешного транспорта мало: коллекция может сообщить о пойманной ошибке скрипта. */
export declare function scriptResult(response: unknown, executionId: string): ScriptData;
