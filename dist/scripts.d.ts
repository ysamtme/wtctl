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
