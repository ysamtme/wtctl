import type { ResultExportData, ResultExportInput } from "./results.js";
import type { CheckData } from "./self-check.js";
import { HcmError } from "./errors.js";
import type { AgentRunData, ScriptData } from "./scripts.js";
import type { CreatedObjectData, PatchPreviewData, PatchedObjectData, DeletedObjectData } from "./objects.js";
import type { ServerInfoInput, ServerInfoData } from "./server-info.js";
import type { FileExistsInput, FileExistsData, FileReadInput, FileReadData } from "./files.js";
import type { FileWriteInput, FileWriteData, FileDeleteInput, FileDeleteData } from "./files.js";
import type { FileListInput, FileListData, FileSaveInput, FileSaveData } from "./files.js";
import type { SchemaInput, SchemaResult, SchemaTypesInput, SchemaTypesResult } from "./schema.js";
import type { ConnectionConfig, OperationDefinition, OperationError, OperationFilter, OperationPage, OperationResult } from "./contracts.js";
import type { LogListInput, LogReadInput, LogSearchInput, LogFollowInput } from "./logs.js";
import type { LogFiles, LogMatches, LogNews, LogText } from "./log-output.js";
import type { RpcCatalogFilter, RpcCatalogPage, RpcDescribeOptions, RpcTargetDescription } from "./rpc-catalog.js";
import type { WebSocketHeartbeatInput, WebSocketHeartbeatData } from "./protocol/index.js";
import type { BatchData, BatchInput, ClearedUploadChunksData, ClearUploadChunksInput, CreateInput, DeleteOptions, GetManyData, GetManyInput, GetOptions, HcmData, HcmResult, ObjectData, ObjectTarget, PatchOptions, QueryData, QueryInput, ResultPage, ResultReadInput, RpcAsyncData, RpcInput, RpcValueData, RunAgentInput, StatusData, UploadChunkInput, UploadedChunkData, UploadedFileData, UploadFileInput } from "./sdk-types.js";
export type { BatchData, BatchInput, BatchStep, ClearedUploadChunksData, ClearUploadChunksInput, CreateInput, DeleteOptions, FilterCondition, FilterValue, GetManyData, GetManyInput, GetOptions, HcmData, HcmResult, ObjectData, ObjectTarget, PatchOperation, PatchOptions, QueryData, QueryInput, QueryOptions, ResultMeta, ResultPage, ResultReadInput, RpcArgument, RpcAsyncData, RpcInput, RpcTypedArgument, RpcValueData, RpcXmlArgument, RunAgentInput, StatusData, StoredResultData, UploadChunkInput, UploadedChunkData, UploadedFileData, UploadFileInput, } from "./sdk-types.js";
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
    /** Связь с сервером: версия сервера, база данных (database), userId и права подключения. Ничего не меняет. */
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
     * Аргументы те же, что у query. Страницу, которая не поместилась в outputLimitBytes и
     * сохранилась локально, дочитывает через readResult. Неполная страница (incomplete) —
     * ошибка QUERY_INCOMPLETE после её строк.
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
    /** Запускает функцию библиотеки сервера фоновой задачей; в ответе TrackingID. Нужно право execute. */
    rpc(input: RpcInput & {
        /** Запустить фоновой задачей. */
        readonly async: true;
    }): Promise<HcmResult<RpcAsyncData>>;
    /** Вызывает функцию библиотеки сервера синхронно; типизированное значение приходит в data.value (нетипизированный XML — сырым ответом сервера). Нужно право execute; функция может менять данные. */
    rpc<T = unknown>(input: RpcInput & {
        /** Выполнить синхронно (по умолчанию false). */
        readonly async?: false;
    }): Promise<HcmResult<RpcValueData<T>>>;
    /** Вызывает функцию библиотеки сервера синхронно или фоновой задачей по полю async. Нужно право execute. */
    rpc<T = unknown>(input: RpcInput): Promise<HcmResult<RpcValueData<T> | RpcAsyncData>>;
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
