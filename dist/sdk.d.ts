import type { ResultExportData, ResultExportInput } from "./results.js";
import type { CheckData } from "./self-check.js";
import { HcmError } from "./errors.js";
import type { AgentRunData, ScriptData } from "./scripts.js";
import type { CreatedObjectData, PatchPreviewData, PatchedObjectData, DeletedObjectData } from "./objects.js";
import type { ServerInfoInput, ServerInfoData, ServerDatabase } from "./server-info.js";
import type { FileExistsInput, FileExistsData, FileReadInput, FileReadData } from "./files.js";
import type { FileWriteInput, FileWriteData, FileDeleteInput, FileDeleteData } from "./files.js";
import type { FileListInput, FileListData, FileSaveInput, FileSaveData } from "./files.js";
import type { SchemaInput, SchemaResult, SchemaTypesInput, SchemaTypesResult } from "./schema.js";
import type { ConnectionConfig, OperationDefinition, OperationError, OperationFilter, OperationPage, OperationResult } from "./contracts.js";
import type { LogListInput, LogReadInput, LogSearchInput, LogFollowInput } from "./logs.js";
import type { LogFiles, LogMatches, LogNews, LogText } from "./log-output.js";
import type { RpcCatalogFilter, RpcCatalogPage, RpcDescribeOptions, RpcTargetDescription } from "./rpc-catalog.js";
import type { WebSocketHeartbeatInput, WebSocketHeartbeatData } from "./protocol/index.js";
/** Поля объекта или строки каталога: имя поля — значение. */
export type HcmData = Record<string, unknown>;
/** Сведения о вызове: операция, подключение, время, признак сохранённого ответа. */
export type ResultMeta = OperationResult["meta"];
/** data ответа, который больше outputLimitBytes и сохранён локально. */
export interface StoredResultData {
    /** Начало данных. Это не все данные. */
    readonly preview: unknown;
    /** ID сохранённого результата: его читают readResult и exportResult. */
    readonly resultId: string;
    /** Какие операции читают сохранённый ответ. */
    readonly hint?: string;
}
/**
 * Ответ метода. Три вида: данные целиком; ответ сохранён локально (meta.truncated, в data
 * только начало); ошибка (ok:false). unwrap отдаёт data только в первом случае.
 */
export type HcmResult<T = unknown> = {
    /** Операция выполнена. */
    readonly ok: true;
    /** Данные ответа целиком. */
    readonly data: T;
    /** Сведения о вызове. */
    readonly meta: ResultMeta & {
        /** Ответ целиком. */
        readonly truncated?: false;
    };
    readonly error?: never;
} | {
    /** Операция выполнена, но ответ сохранён локально. */
    readonly ok: true;
    /** Начало данных и ID сохранённого результата. */
    readonly data: StoredResultData;
    /** Сведения о вызове; truncated:true и resultId. */
    readonly meta: ResultMeta & {
        /** Ответ сохранён локально. */
        readonly truncated: true;
        /** ID сохранённого результата. */
        readonly resultId: string;
    };
    readonly error?: never;
} | {
    /** Операция не выполнена. */
    readonly ok: false;
    /** Частичные данные, если операция успела их получить. */
    readonly data?: T | StoredResultData;
    /** Код, текст и подсказка ошибки. */
    readonly error: OperationError;
    /** Сведения о вызове. */
    readonly meta: ResultMeta;
};
/** Какой объект: id или url документа; type — проверить тип объекта (иначе TYPE_MISMATCH). */
export type ObjectTarget = {
    /** Адрес документа: url из ответа get. */
    readonly url: string;
    /** Ожидаемый тип объекта. */
    readonly type?: string;
    /** ID объекта, строкой: 0x… или десятичная запись. */
    readonly id?: string;
} | {
    /** ID объекта, строкой: 0x… или десятичная запись. */
    readonly id: string;
    /** Ожидаемый тип объекта. */
    readonly type?: string;
    /** Адрес документа: url из ответа get. */
    readonly url?: string;
};
/** Что прочитать у объекта. */
export interface GetOptions {
    /** Поля верхнего уровня; без fields приходит весь документ. */
    readonly fields?: readonly string[];
}
/** Аргументы create. */
export interface CreateInput<T extends object = HcmData> {
    /** Тип объекта: collaborator, group… */
    readonly type: string;
    /** Поля нового объекта; id выдаёт сервер. */
    readonly data: T;
    /** База сервера для объекта; по умолчанию wt_data. */
    readonly dbName?: string;
    /** Адрес формы типа; по умолчанию x-local://wtv/wtv_<type>.xmd. */
    readonly formUrl?: string;
}
/** Одна операция правки: set записывает value по path, remove удаляет path. */
export type PatchOperation = {
    /** Записать значение. */
    readonly op: "set";
    /** Путь в документе: name, access.access_level. */
    readonly path: string;
    /** Записываемое значение. */
    readonly value: unknown;
} | {
    /** Удалить путь. */
    readonly op: "remove";
    /** Путь в документе. */
    readonly path: string;
};
/** Что изменить в объекте: patch, remove или resave. */
export interface PatchOptions {
    /** Что записать: {path: value} или список операций. */
    readonly patch?: HcmData | readonly PatchOperation[];
    /** Пути, которые удалить из документа. */
    readonly remove?: readonly string[];
    /** fingerprint из чтения: если объект с тех пор изменился, запись отклоняется с CONFLICT. */
    readonly expectedFingerprint?: string;
    /** Только показать изменения, ничего не записывая. */
    readonly preview?: boolean;
    /** Сохранить документ, даже если правка ничего не меняет: сервер заново заполняет вычисляемое. */
    readonly resave?: boolean;
}
/** Аргументы delete помимо объекта. */
export interface DeleteOptions {
    /** Обязателен: удаление безвозвратное, корзины нет. */
    readonly permanent: true;
    /** Каталог объекта: проверить, что объект был в нём и после удаления исчез. */
    readonly catalog?: string;
}
/** Значение в условии поиска. */
export type FilterValue = string | number | boolean | null;
/** Условие на поле каталога; несколько операторов соединяются через «и». */
export interface FilterCondition {
    /** Равно. */
    readonly eq?: FilterValue;
    /** Не равно. */
    readonly ne?: FilterValue;
    /** Больше. */
    readonly gt?: FilterValue;
    /** Больше или равно. */
    readonly gte?: FilterValue;
    /** Меньше. */
    readonly lt?: FilterValue;
    /** Меньше или равно. */
    readonly lte?: FilterValue;
    /** Содержит строку. */
    readonly contains?: FilterValue;
    /** Одно из значений списка, от 1 до 100. */
    readonly in?: FilterValue[];
}
/** Поля и страница поиска: общие для каталога и запроса XQuery. */
export interface QueryOptions {
    /** Поля строки, в этом порядке; без fields — все поля каталога. */
    readonly fields?: readonly string[];
    /** Строк на странице, 1–1000; по умолчанию 20. */
    readonly limit?: number;
    /** С какой строки читать: nextStartPosition прошлой страницы; до 1000000. */
    readonly startPosition?: number;
}
/**
 * Поиск в каталоге (catalog, where, order) или запрос XQuery целиком (query, нужно право execute).
 * Запрос XQuery возвращает элементы каталога и заканчивается на return $elem; отдельные значения
 * возвращает низкоуровневая операция native.lds.xQuery.
 */
export type QueryInput = QueryOptions & ({
    /** Каталог: collaborators, groups… */
    readonly catalog: string;
    /** Условия на поля каталога, через «и»: {is_dismiss: false, hire_date: {gte: "2026-01-01"}}. */
    readonly where?: Record<string, FilterValue | FilterCondition>;
    /** Поля каталога для сортировки: "fullname", "hire_date desc". */
    readonly order?: string | readonly string[];
    readonly query?: never;
} | {
    /** Запрос XQuery: for $elem in collaborators where … return $elem. */
    readonly query: string;
    readonly catalog?: never;
    readonly where?: never;
});
/** Аргумент функции с явным типом: дата, дробное или большое число, объект, XML. */
export interface RpcTypedArgument {
    /** Тип значения сервера: date, integer, real, string, bool… */
    readonly valueType: string;
    /** Значение в записи сервера: "2026-10-01T00:00:00", "6148914691236517121"; XML — {xml}. */
    readonly lexicalValue: string | {
        /** Текст XML. */
        readonly xml: string;
    };
}
/** Аргумент функции — XML. */
export interface RpcXmlArgument {
    /** XML значения. */
    readonly lexicalValue: {
        /** Текст XML. */
        readonly xml: string;
    };
    readonly valueType?: never;
}
/** Аргумент функции библиотеки: строка, целое, логическое значение и null — как есть. */
export type RpcArgument = string | boolean | number | null | RpcTypedArgument | RpcXmlArgument;
/** Аргументы rpc: функция библиотеки и её аргументы. */
export interface RpcInput {
    /** Библиотека: tools, ms_tools… */
    readonly library: string;
    /** Функция библиотеки. */
    readonly method: string;
    /** Аргументы по порядку параметров функции. */
    readonly arguments?: readonly RpcArgument[];
    /** Запустить фоновой задачей: в ответе TrackingID вместо значения. */
    readonly async?: boolean;
}
/** Шаг batch: операция и её аргументы. */
export interface BatchStep {
    /** ID операции шага. */
    readonly id: string;
    /** Аргументы операции; значение из прошлого шага — {$ref:'имя.data.items.0.id'}. */
    readonly args?: HcmData;
    /** Имя шага для ссылок из следующих шагов: латинские буквы, цифры и _, первой не цифра. */
    readonly as?: string;
}
/** Аргументы batch. */
export interface BatchInput {
    /** Шаги по порядку. */
    readonly steps: readonly BatchStep[];
    /** false — продолжать после сбоя шага; по умолчанию первый сбой останавливает остальные. */
    readonly stopOnError?: boolean;
}
/** Аргументы readResult. */
export interface ResultReadInput {
    /** ID сохранённого результата: meta.resultId ответа. */
    readonly resultId: string;
    /** С какого элемента списка или символа текста читать: nextOffset прошлой страницы. */
    readonly offset?: number;
    /** Элементов на странице (по умолчанию 100, до 1000) или символов (по умолчанию 12000). */
    readonly limit?: number;
    /**
     * auto — список по элементам, текст по символам (по умолчанию); json — любой результат
     * как текст JSON по частям; text — только сохранённый текст.
     */
    readonly format?: "auto" | "json" | "text";
}
/** Аргументы uploadFile. */
export interface UploadFileInput {
    /** Имя файла на сервере. */
    readonly filename: string;
    /** Содержимое: строка пишется в UTF-8, двоичные данные — {base64}. */
    readonly data: string | {
        /** Двоичные данные в base64. */
        readonly base64: string;
    };
    /** Тип содержимого (Content-Type); по умолчанию application/octet-stream. */
    readonly contentType?: string;
}
/** Ответ uploadFile. */
export interface UploadedFileData {
    /** Адрес файла: x-local://share/uploaded_files/<folder>/<name>. */
    readonly url: string;
    /** Папка, которую сервер создал для файла; остаётся после удаления файла. */
    readonly folderUrl: string;
}
/** Одна часть загрузки по частям. fileId у всех частей один, последнюю часть слать последней. */
export interface UploadChunkInput extends UploadFileInput {
    /** ID загрузки: 32 шестнадцатеричные цифры, выбирает вызывающий. */
    readonly fileId: string;
    /** Номер части с 0. */
    readonly index: number;
    /** Сколько частей всего. */
    readonly chunksTotal: number;
    /** Размер файла целиком в байтах. */
    readonly totalBytes: number;
    /** Смещение части в файле в байтах. */
    readonly offset: number;
}
/** Ответ сервера на часть. Url не подтверждает, что файл собран целиком: проверить чтением. */
export interface UploadedChunkData {
    /** 0 — сервер принял часть. */
    readonly error: 0;
    /** Адрес файла, который назвал сервер. */
    readonly Url: string;
}
/** Аргументы clearUploadChunks. */
export interface ClearUploadChunksInput {
    /** ID загрузки. */
    readonly fileId: string;
    /** Сколько частей удалить: номера от 0 до chunksTotal-1. */
    readonly chunksTotal: number;
}
/** Сервер принял запрос. Ошибки удаления он не сообщает, поэтому удаление не проверено. */
export interface ClearedUploadChunksData {
    /** Запрос принят. */
    readonly acknowledged: true;
    /** ID загрузки. */
    readonly fileId: string;
    /** Сколько частей запрошено удалить. */
    readonly chunksTotal: number;
    /** Всегда false: что части удалены, по ответу сервера не проверить. */
    readonly absenceVerified: false;
}
/** Ответ status. */
export interface StatusData {
    /** Имя подключения. */
    readonly connection: string;
    /** Адрес сервера. */
    readonly baseUrl: string;
    /** Версия сервера: 2025.2.1535. */
    readonly version: string;
    /** База за сервером, если сервер её описывает. */
    readonly database?: ServerDatabase;
    /** ID пользователя, под которым подключение вошло, если сервер его называет. */
    readonly userId?: string;
    /** Сколько операций у клиента. */
    readonly operationCount: number;
    /** Права подключения. */
    readonly permissions: {
        /** Право на запись. */
        readonly write: boolean;
        /** Право на выполнение кода на сервере. */
        readonly execute: boolean;
    };
}
/** Страница поиска: ответ query. */
export interface QueryData<T = HcmData> {
    /** Строки страницы; поля — в порядке fields. */
    readonly items: T[];
    /** Строки, подходящие запросу на сервере, если сервер сообщает согласованный счётчик. */
    readonly total?: number;
    /** Строки могут идти дальше: передать как startPosition. Смещения — не стабильный снимок. */
    readonly nextStartPosition?: number;
    /** Конец не установлен и смещение не растёт; hint говорит почему. */
    readonly incomplete?: true;
    /** Пояснение к странице: почему она неполная, как сузить запрос. */
    readonly hint?: string;
    /** Запрошенные поля, которых нет в каталоге. */
    readonly unknownFields?: string[];
}
/** Документ объекта: ответ get. */
export interface ObjectData<T extends object = HcmData> {
    /** ID объекта, 0x…. */
    readonly id?: string;
    /** Тип объекта. */
    readonly type: string;
    /** Адрес документа. */
    readonly url: string;
    /** Поля документа; повторяемый элемент — всегда список. */
    readonly data: T;
    /** Запрошенные поля, которые документ не хранит: сервер вычисляет их для строки каталога. */
    readonly fromCatalog?: HcmData;
    /** Поля, запрошенные по имени, для которых у объекта нет значения. */
    readonly emptyFields?: string[];
    /** Запрошенные поля, которых нет ни у типа, ни у его каталога. */
    readonly unknownFields?: string[];
    /** Отпечаток документа: expectedFingerprint для правки. */
    readonly fingerprint: string;
    /** Адрес формы типа. */
    readonly formUrl?: string;
}
/** Аргументы getMany. */
export interface GetManyInput {
    /** ID объектов, до 100. */
    readonly ids: readonly string[];
    /** Ожидаемый тип объектов. */
    readonly type?: string;
    /** Поля верхнего уровня; без fields — документы целиком. */
    readonly fields?: readonly string[];
}
/** Ответ getMany. */
export interface GetManyData<T extends object = HcmData> {
    /** Объекты в порядке ids; непрочитанный — {id, error}. */
    readonly items: (ObjectData<T> | {
        /** ID непрочитанного объекта. */
        readonly id: string;
        /** Почему объект не прочитан. */
        readonly error: {
            /** Код ошибки: NOT_FOUND, TYPE_MISMATCH… */
            readonly code: string;
            /** Что случилось. */
            readonly message: string;
        };
    })[];
    /** Сколько объектов запрошено. */
    readonly total: number;
    /** Сколько объектов не прочитано. */
    readonly failed?: number;
    /** Пояснение к непрочитанным. */
    readonly hint?: string;
}
/** Аргументы runAgent. */
export interface RunAgentInput {
    /** ID агента сервера (server_agent). */
    readonly id: string;
    /** ID объекта: в коде агента это OBJECT_ID. */
    readonly objectId?: string;
    /** ID нескольких объектов: в коде агента это OBJECTS_ID_STR, через «;». */
    readonly objectIds?: readonly string[];
}
/** Ответ batch. */
export interface BatchData {
    /** Ответы выполненных шагов по порядку. */
    readonly results: OperationResult[];
    /** Сколько шагов выполнено. */
    readonly completed: number;
    /** Сколько шагов запрошено. */
    readonly requested: number;
    /** Всегда false: это не транзакция, выполненные шаги не откатываются. */
    readonly atomic: false;
    /** Все шаги выполнены без ошибок. */
    readonly ok: boolean;
}
/** Страница сохранённого результата: элементы списка или кусок текста. */
export type ResultPage<T = unknown> = {
    /** Элементы страницы. */
    readonly items: T[];
    /** Сколько элементов в списке. */
    readonly total: number;
    /** offset следующей страницы; нет — страница последняя. */
    readonly nextOffset?: number;
    /** Элемент, который один больше предела ответа: его номер и размер. */
    readonly blockedItem?: {
        /** Номер элемента в списке. */
        readonly index: number;
        /** Размер элемента в байтах. */
        readonly bytes: number;
    };
    /** Как прочитать blockedItem. */
    readonly hint?: string;
    /** Страница короче запрошенной: в один ответ больше не входит. */
    readonly cutBySize?: true;
    /** Поле сохранённого ответа, откуда взяты элементы; для голого списка отсутствует. */
    readonly list?: string;
} | {
    /** Кусок текста. */
    readonly text: string;
    /** Сколько символов в тексте. */
    readonly totalChars: number;
    /** offset следующего куска; нет — кусок последний. */
    readonly nextOffset?: number;
    /** text — сохранённый текст, json — текст JSON сохранённого ответа. */
    readonly format?: "text" | "json";
    /** Кусок короче запрошенного: в один ответ больше не входит. */
    readonly cutBySize?: true;
};
/**
 * Ошибка, которую бросает unwrap при ok:false: code, message, hint, details и mutationOutcome
 * взяты из error ответа.
 */
export declare class HcmOperationError extends HcmError {
    /** Ответ целиком, с частичными данными. В JSON ошибки не попадает. */
    readonly result: OperationResult;
    /** Ошибка закрытия подключения, если и оно не удалось; её же возвращает getCleanupError. */
    readonly cleanupError?: HcmError;
    private readonly operationError;
    constructor(result: OperationResult, operationError?: OperationError | undefined);
    /** error ответа, как его вернула операция. */
    toJSON(): OperationError;
}
/**
 * Ответ больше outputLimitBytes и сохранён локально; unwrap бросает эту ошибку, чтобы начало данных
 * нельзя было принять за все данные. Код RESULT_STORED.
 */
export declare class HcmStoredResultError extends HcmOperationError {
    /** ID сохранённого результата: его читают readResult и exportResult. */
    readonly resultId: string;
    constructor(result: OperationResult, resultId: string);
}
/**
 * Операция в withHcmClient или use выполнена, но подключение не закрылось. Код CLEANUP_FAILED.
 * Результат операции — в value; повторять её не нужно.
 */
export declare class HcmCleanupError<T = unknown> extends HcmError {
    /** Что вернула функция, переданная в withHcmClient или use. */
    readonly value: T;
    constructor(value: T);
}
/**
 * data ответа. Бросает HcmOperationError при ok:false и HcmStoredResultError, если ответ сохранён
 * локально (meta.truncated).
 */
export declare function unwrap<T>(result: HcmResult<T>): T;
/** data ответа любой операции; бросает так же, как для HcmResult. */
export declare function unwrap<T = unknown>(result: OperationResult): T;
/**
 * Клиент сервера по одному подключению. Каждый метод — операция клиента: ответ, права и исходы
 * записи те же, что у call, CLI и MCP-сервера. Методы не бросают при отказе сервера: ответ
 * приходит с ok:false, data достаёт unwrap. Подключение закрывает close или сам withHcmClient.
 */
export declare class HcmClient {
    /** Клиент по подключению из loadConfig; сессия на сервере открывается при первом вызове. */
    constructor(config: ConnectionConfig);
    /** Операции клиента, по странице: поиск по словам, теме, группе, эффекту. Сервер не вызывается. */
    listOperations(filter?: OperationFilter): OperationPage;
    /** Описание операции по ID со схемой аргументов; неизвестный ID — HcmError UNKNOWN_OPERATION. */
    describe(id: string): OperationDefinition;
    /**
     * Любая операция по ID: call("native.lds.loadDoc", {url}). Аргументы — как в describe(id).
     * Тип data задаёт параметр T; клиент его не проверяет.
     */
    call<T = unknown>(id: string, args?: HcmData): Promise<HcmResult<T>>;
    /** Несколько объектов за один вызов, до 100; у непрочитанного объекта в его элементе стоит error. */
    getMany<T extends object = HcmData>(input: GetManyInput): Promise<HcmResult<GetManyData<T>>>;
    /** Связь с сервером: версия сервера и права подключения. Ничего не меняет. */
    status(): Promise<HcmResult<StatusData>>;
    /**
     * Проверка подключения по шагам: вход, версия, запрос, документ, схема, библиотеки, логи, портал;
     * при праве execute — ещё код на сервере. Запись не проверяется.
     */
    check(): Promise<HcmResult<CheckData>>;
    /** Сведения о сервере, которые он отдаёт админке при запуске: версия, ОС, база, папки. */
    serverInfo(input?: ServerInfoInput): Promise<HcmResult<ServerInfoData>>;
    /** Есть ли файл или папка по адресу x-local://…; о содержимом и правах ответ ничего не говорит. */
    fileExists(input: FileExistsInput): Promise<HcmResult<FileExistsData>>;
    /** Сохраняет файл сервера на этот компьютер байт в байт, любого размера. */
    readFile(input: FileSaveInput): Promise<HcmResult<FileSaveData>>;
    /** Файл по адресу сервера: text, если это текст в UTF-8, иначе base64. */
    readFile(input: FileReadInput): Promise<HcmResult<FileReadData>>;
    /** Аргумент, собранный заранее как FileReadInput или FileSaveInput: ответ — FileReadData или FileSaveData. */
    readFile(input: FileReadInput | FileSaveInput): Promise<HcmResult<FileReadData | FileSaveData>>;
    /** Один уровень папки сервера: файлы с размером и вложенные папки. Нужно право execute. */
    listFiles(input: FileListInput): Promise<HcmResult<FileListData>>;
    /**
     * Записывает файл по адресу x-local://… целиком из text, base64 или файла на диске (file) и сверяет
     * записанное; папки сервер создаёт сам. Нужно право write, в папку кода (wt, wtv, custom…) — ещё
     * execute.
     */
    writeFile(input: FileWriteInput): Promise<HcmResult<FileWriteData>>;
    /** Удаляет файл по адресу x-local://…. Нужно право write, в папке кода — ещё execute. */
    deleteFile(input: FileDeleteInput): Promise<HcmResult<FileDeleteData>>;
    /**
     * Одна страница поиска: в каталоге по условиям или запросом XQuery (ему нужно право execute).
     * Дальше — startPosition: nextStartPosition; все страницы сразу перебирает queryRows.
     */
    query<T = HcmData>(input: QueryInput): Promise<HcmResult<QueryData<T>>>;
    /**
     * Строки каталога или запроса XQuery со всех страниц по порядку; страницы листает сам.
     * Аргументы те же, что у query. Неполная страница (incomplete) — ошибка QUERY_INCOMPLETE
     * после её строк, большой ответ — HcmStoredResultError, как в unwrap.
     */
    queryRows<T = HcmData>(input: QueryInput): AsyncGenerator<T, void, undefined>;
    /** Документ объекта по id или url; fields — только эти поля верхнего уровня. */
    get<T extends object = HcmData>(input: ObjectTarget & GetOptions): Promise<HcmResult<ObjectData<T>>>;
    /**
     * Создаёт объект; ID выдаёт сервер, после записи объект перечитывается и сверяется. Нужно право
     * write. Обработчики, которые админка выполняет при создании, не запускаются.
     */
    create(input: CreateInput<object>): Promise<HcmResult<CreatedObjectData>>;
    /**
     * Меняет поля объекта, остальное содержимое документа сохраняется. Нужно право write.
     * С preview:true или правкой без изменений ничего не записывает: ответ — PatchPreviewData.
     */
    patch(input: ObjectTarget & PatchOptions): Promise<HcmResult<PatchedObjectData | PatchPreviewData>>;
    /** Удаляет документ объекта безвозвратно; нужны permanent:true и право write. */
    delete(input: ObjectTarget & DeleteOptions): Promise<HcmResult<DeletedObjectData>>;
    /** Поля типа объекта по странице: свои, унаследованные, настраиваемые и поля каталога. */
    schema(input: SchemaInput): Promise<HcmResult<SchemaResult>>;
    /** Типы объектов сервера: тип, каталог, заголовок, число настраиваемых полей. */
    types(input?: SchemaTypesInput): Promise<HcmResult<SchemaTypesResult>>;
    /** Вызывает функцию библиотеки сервера. Нужно право execute; функция может менять данные. */
    rpc<T = unknown>(input: RpcInput): Promise<HcmResult<T>>;
    /** Функции библиотек сервера по странице: имя и параметры. Сами функции не вызываются. */
    listRpc(input?: RpcCatalogFilter): Promise<HcmResult<RpcCatalogPage>>;
    /** Параметры функции «библиотека.функция», с source:true — и её код. Функция не вызывается. */
    describeRpc(targetId: string, options?: RpcDescribeOptions): Promise<HcmResult<RpcTargetDescription>>;
    /**
     * Выполняет код SP-XML Script на сервере; нужно право execute, отката нет. Код присваивает
     * массив переменной RESULT, params доступен в коде как PARAMS. Код и params можно передать
     * и одним объектом {code, params}.
     */
    execute<T = unknown>(code: string | {
        /** Код SP-XML Script. */
        code: string;
        /** Параметры: в коде переменная PARAMS. */
        params?: object;
    }, params?: object): Promise<HcmResult<ScriptData<T>>>;
    /**
     * Запускает агента сервера и ждёт конца его кода; нужно право execute. Ошибки кода агента —
     * только в логе xhttp между startedAt и finishedAt.
     */
    runAgent(input: RunAgentInput): Promise<HcmResult<AgentRunData>>;
    /**
     * Несколько операций одним вызовом; права проверяются для каждого шага. Не транзакция:
     * выполненные шаги не откатываются.
     */
    batch(input: BatchInput): Promise<HcmResult<BatchData>>;
    /** Страница сохранённого результата: список — по элементам, текст — по символам. */
    readResult<T = unknown>(input: ResultReadInput): Promise<HcmResult<ResultPage<T>>>;
    /** Записывает сохранённый результат целиком в файл на этом компьютере. */
    exportResult(input: ResultExportInput): Promise<HcmResult<ResultExportData>>;
    /** Загружает файл в папку загрузок сервера так же, как админка; нужно право write. */
    uploadFile(input: UploadFileInput): Promise<HcmResult<UploadedFileData>>;
    /**
     * Отправляет одну часть загрузки по частям; последняя часть собирает файл. Нужно право write.
     * Перед последней частью загруженное проверить чтением; после ошибки на последней части не повторять.
     */
    uploadChunk(input: UploadChunkInput): Promise<HcmResult<UploadedChunkData>>;
    /** Просит сервер удалить части загрузки fileId; нужно право write. Удаление ответ не подтверждает. */
    clearUploadChunks(input: ClearUploadChunksInput): Promise<HcmResult<ClearedUploadChunksData>>;
    /** Проверка WebSocket сервера: одно сообщение $hbt и ожидание $ok. */
    heartbeat(input?: WebSocketHeartbeatInput): Promise<HcmResult<WebSocketHeartbeatData>>;
    /** Логи сервера, сначала свежие. */
    listLogs(input?: LogListInput): Promise<HcmResult<LogFiles>>;
    /** Текст лога: конец файла или весь файл. */
    readLog(input: LogReadInput): Promise<HcmResult<LogText>>;
    /** События лога по тексту, уровню или потоку; многострочное событие приходит целиком. */
    searchLogs(input: LogSearchInput): Promise<HcmResult<LogMatches>>;
    /** Новые события лога с прошлого вызова: cursor из прошлого ответа. */
    followLog(input: LogFollowInput): Promise<HcmResult<LogNews>>;
    /** Закрывает сессию на сервере. После close методы отвечают ошибкой RUNTIME_CLOSED. */
    close(): Promise<void>;
    /**
     * Вызывает action с этим клиентом и закрывает подключение ровно один раз — и после успеха,
     * и после ошибки. Как withHcmClient, но для уже созданного клиента.
     */
    use<T>(action: (client: HcmClient) => Promise<T>): Promise<T>;
}
/**
 * Ошибка закрытия подключения, если withHcmClient или use не смогли закрыть его после ошибки
 * операции; иначе undefined. Пойманная ошибка при этом — ошибка операции.
 */
export declare function getCleanupError(error: unknown): HcmError | undefined;
/**
 * Создаёт клиент по подключению, вызывает action и закрывает подключение — и после успеха, и после
 * ошибки. Возвращает то, что вернул action. Права — те, что заданы в подключении.
 */
export declare function withHcmClient<T>(config: ConnectionConfig, action: (client: HcmClient) => Promise<T>): Promise<T>;
