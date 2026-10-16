/**
 * Что операция делает с сервером: read — читает, write — записывает, execute — выполняет код
 * на сервере. unknown — эффект зависит от аргументов (HTTP-запрос с любым методом): права
 * проверяются по самим аргументам.
 */
export type OperationEffect = "read" | "write" | "execute" | "unknown";
/** Профиль протокола, которым идёт низкоуровневая операция; anonymous — без входа. */
export type NativeProfile = "native" | "web" | "anonymous";
/** Схема JSON аргументов операции. */
export type JsonSchema = Readonly<Record<string, unknown>>;
/** Адрес сервера, учётная запись и пределы запросов. */
export interface NativeConfig {
    /** Адрес сервера: http://сервер:порт. */
    readonly baseUrl: string;
    /** Логин учётной записи. В ответы и ошибки не попадает. */
    readonly username?: string;
    /** Пароль учётной записи. В ответы и ошибки не попадает. */
    readonly password?: string;
    /** Предел времени одного запроса к серверу, мс; loadConfig ставит 30000. */
    readonly timeoutMs: number;
    /** Предел тела ответа сервера в байтах; loadConfig ставит 32 МБ. */
    readonly maxResponseBytes: number;
    /** Своя функция fetch вместо глобальной: прокси, запись запросов. */
    readonly fetch?: typeof globalThis.fetch;
}
/** Подключение, которое возвращает loadConfig: сервер, учётная запись, права и локальные пределы. */
export interface ConnectionConfig extends NativeConfig {
    /** Имя подключения; оно же в meta.connection ответов. */
    readonly name: string;
    /** Предел ответа в байтах: больший ответ сохраняется локально; loadConfig ставит 24 КБ, не больше 1 МБ. */
    readonly outputLimitBytes: number;
    /** Папка сохранённых результатов и журнала записей. */
    readonly runtimeDir: string;
    /** Права подключения. Чтение разрешено всегда. */
    readonly permissions: {
        /** Право на запись: создание, правку и удаление объектов и файлов. */
        readonly write: boolean;
        /** Право на выполнение кода на сервере. */
        readonly execute: boolean;
    };
    /** Предел сохранённых результатов подключения в байтах, приблизительный; 0 — без предела, по умолчанию 1 ГБ. */
    readonly resultsMaxBytes?: number;
    /** Сколько дней хранятся сохранённые результаты; 0 — без срока, по умолчанию 7. */
    readonly resultsMaxAgeDays?: number;
    /** Предел журнала записей mutations.jsonl в байтах; 0 — без предела, по умолчанию 10 МБ. */
    readonly journalMaxBytes?: number;
    /** Сколько сервер держит лог нечитаемым после записи в него; по умолчанию 5500 мс. */
    readonly logBusyMs?: number;
}
/** Описание операции. Доступна ли она, решает подключённый сервер в момент вызова. */
export interface OperationDefinition {
    /** ID операции: objects.get, native.lds.loadDoc. */
    readonly id: string;
    /** Группа операций: objects, lds, files… */
    readonly group: string;
    /** Короткое название. */
    readonly title: string;
    /** Что делает операция и чем ограничена. */
    readonly description: string;
    /** Что операция делает с сервером; по нему проверяются права. */
    readonly effect: OperationEffect;
    /** Схема JSON аргументов. */
    readonly inputSchema: JsonSchema;
    /** Профиль протокола; только у низкоуровневых операций. */
    readonly profile?: NativeProfile;
    /** Метод API сервера; только у низкоуровневых операций. */
    readonly method?: string;
}
/** Низкоуровневая операция: прямой вызов API сервера. */
export interface NativeOperation extends OperationDefinition {
    readonly profile: NativeProfile;
    readonly method: string;
}
/**
 * Исход записи: not_sent — запрос не ушёл на сервер, confirmed — запись подтверждена,
 * indeterminate — подтверждения нет: ответа не было, перечитанный объект не совпал с запросом
 * или перечитать его не удалось; прочитать объект, прежде чем повторять. При READ_BACK_MISMATCH
 * запись дошла, что не совпало — в details.
 */
export type MutationOutcome = "not_sent" | "confirmed" | "indeterminate";
/** Ошибка операции в ответе с ok:false. */
export interface OperationError {
    /** Код ошибки: WRITE_DISABLED, NOT_FOUND… Программа сравнивает его, а не текст. */
    readonly code: string;
    /** Что случилось. */
    readonly message: string;
    /** Что сделать дальше. */
    readonly hint?: string;
    /** Можно ли повторить вызов без изменений. */
    readonly retryable?: boolean;
    /** Исход записи; только у операций записи и выполнения кода. */
    readonly mutationOutcome?: MutationOutcome;
    /** Подробности: путь к неверному аргументу, ID, похожие имена. */
    readonly details?: Readonly<Record<string, unknown>>;
}
/** Ответ операции: {ok:true, data, meta} или {ok:false, error, meta}. */
export interface OperationResult {
    /** true — операция выполнена, false — ошибка в error. */
    readonly ok: boolean;
    /** Данные ответа; при meta.truncated — начало данных и resultId. */
    readonly data?: unknown;
    /** Ошибка при ok:false. */
    readonly error?: OperationError;
    /** Сведения о вызове. */
    readonly meta: {
        /** ID выполненной операции. */
        readonly operationId: string;
        /** Имя подключения. */
        readonly connection: string;
        /** Время вызова, мс. */
        readonly durationMs: number;
        /** Ответ больше outputLimitBytes и сохранён локально: в data только начало. */
        readonly truncated?: boolean;
        /** ID сохранённого результата: его читают readResult и exportResult. */
        readonly resultId?: string;
        /** Размер сохранённого ответа в байтах. */
        readonly resultBytes?: number;
        readonly [key: string]: unknown;
    };
}
/** Отбор операций для listOperations и listHcmOperations. */
export interface OperationFilter {
    /** Слова в ID, названии и описании; read, write, execute или unknown целиком — операции с этим эффектом. */
    readonly query?: string;
    /** Тема обзора: functions, tasks, agents, files, documents… Неизвестная тема — UNKNOWN_TOPIC. */
    readonly topic?: string;
    /** Группа операций: objects, lds, files… */
    readonly group?: string;
    /** Только операции с этим эффектом. */
    readonly effect?: OperationEffect;
    /** Сколько операций пропустить: nextCursor прошлой страницы. */
    readonly cursor?: number;
    /** Операций на странице, 1–1000; по умолчанию 30. */
    readonly limit?: number;
}
/** Страница списка операций. */
export interface OperationPage {
    /** Операции страницы. */
    readonly operations: readonly OperationDefinition[];
    /** Сколько операций подходит всего. */
    readonly total: number;
    /** cursor следующей страницы; нет — страница последняя. */
    readonly nextCursor?: number;
}
export interface BinaryResult {
    readonly kind: "binary";
    readonly bytes: Uint8Array;
    readonly contentType: string;
}
