import { HcmRuntime } from "./runtime.js";
import type { RuntimePort } from "./runtime-port.js";
import type { ResultExportInput } from "./results.js";
export type { ResultExportInput } from "./results.js";
import type { CheckData } from "./self-check.js";
export type { CheckData } from "./self-check.js";
import { HcmError } from "./errors.js";
import type { AgentRunData, ScriptData } from "./scripts.js";
import type { CreatedObjectData, PatchPreviewData, PatchedObjectData, DeletedObjectData } from "./objects.js";
export type { PatchChange } from "./documents.js";
export type { CreatedObjectData, PatchPreviewData, PatchedObjectData, DeletedObjectData, } from "./objects.js";
import type { ServerInfoInput, ServerInfoData, ServerDatabase } from "./server-info.js";
export type { ServerInfoInput, ServerInfoData } from "./server-info.js";
import type { FileExistsInput, FileExistsData, FileReadInput, FileReadData } from "./files.js";
import type { FileWriteInput, FileWriteData, FileDeleteInput, FileDeleteData } from "./files.js";
import type { FileListData } from "./files.js";
export type { FileExistsInput, FileExistsData, FileReadInput, FileReadData } from "./files.js";
export type { FileWriteInput, FileWriteData, FileDeleteInput, FileDeleteData } from "./files.js";
export type { FileListData } from "./files.js";
import type { SchemaInput, SchemaResult, SchemaTypesInput, SchemaTypesResult } from "./schema.js";
export type { SchemaInput, SchemaResult, SchemaTypesInput, SchemaTypesResult } from "./schema.js";
export type { SchemaField } from "./schema.js";
import type { ConnectionConfig, MutationOutcome, OperationDefinition, OperationError, OperationFilter, OperationPage, OperationResult } from "./contracts.js";
import type { LogListInput, LogReadInput, LogSearchInput, LogFollowInput } from "./logs.js";
import type { LogFiles, LogMatches, LogNews, LogText } from "./log-output.js";
import type { RpcCatalogFilter, RpcCatalogPage, RpcDescribeOptions, RpcTargetDescription } from "./rpc-catalog.js";
import type { WebSocketHeartbeatInput, WebSocketHeartbeatData } from "./protocol/index.js";
export type { WebSocketHeartbeatInput, WebSocketHeartbeatData } from "./protocol/index.js";
export type HcmData = Record<string, unknown>;
export type ResultMeta = OperationResult["meta"];
export interface StoredResultData {
    readonly preview: unknown;
    readonly resultId: string;
    /** Какие операции читают сохранённый ответ. */
    readonly hint?: string;
}
/** Полное значение, локальная ссылка и неудавшийся частичный исход намеренно различаются. */
export type HcmResult<T = unknown> = {
    readonly ok: true;
    readonly data: T;
    readonly meta: ResultMeta & {
        readonly truncated?: false;
    };
    readonly error?: never;
} | {
    readonly ok: true;
    readonly data: StoredResultData;
    readonly meta: ResultMeta & {
        readonly truncated: true;
        readonly resultId: string;
    };
    readonly error?: never;
} | {
    readonly ok: false;
    readonly data?: T | StoredResultData;
    readonly error: OperationError;
    readonly meta: ResultMeta;
};
export type ObjectTarget = {
    readonly url: string;
    readonly type?: string;
    readonly id?: string;
} | {
    readonly id: string;
    readonly type?: string;
    readonly url?: string;
};
export interface GetOptions {
    readonly fields?: readonly string[];
}
export interface CreateInput<T extends object = HcmData> {
    readonly type: string;
    readonly data: T;
    readonly dbName?: string;
    readonly formUrl?: string;
}
export type PatchOperation = {
    readonly op: "set";
    readonly path: string;
    readonly value: unknown;
} | {
    readonly op: "remove";
    readonly path: string;
};
export interface PatchOptions {
    /** Что записать: {path: value} или список операций. */
    readonly patch?: HcmData | readonly PatchOperation[];
    /** Пути, которые удалить из документа. */
    readonly remove?: readonly string[];
    readonly expectedFingerprint?: string;
    readonly preview?: boolean;
    /** Сохранить документ, даже если правка ничего не меняет: сервер заново заполняет вычисляемое. */
    readonly resave?: boolean;
}
export interface DeleteOptions {
    readonly permanent: true;
    readonly catalog?: string;
}
export type FilterValue = string | number | boolean | null;
export interface FilterCondition {
    readonly eq?: FilterValue;
    readonly ne?: FilterValue;
    readonly gt?: FilterValue;
    readonly gte?: FilterValue;
    readonly lt?: FilterValue;
    readonly lte?: FilterValue;
    readonly contains?: FilterValue;
    readonly in?: FilterValue[];
}
export interface QueryOptions {
    readonly fields?: readonly string[];
    readonly limit?: number;
    readonly startPosition?: number;
}
/**
 * Сырые выражения должны возвращать однородные строки XML-объектов; скаляры и смесь — прямо
 * через LDS.
 */
export type QueryInput = QueryOptions & ({
    readonly catalog: string;
    readonly where?: Record<string, FilterValue | FilterCondition>;
    /** Поля каталога для сортировки: "fullname", "hire_date desc". */
    readonly order?: string | readonly string[];
    readonly query?: never;
} | {
    readonly query: string;
    readonly catalog?: never;
    readonly where?: never;
});
export interface RpcTypedArgument {
    readonly valueType: string;
    readonly lexicalValue: string | {
        readonly xml: string;
    };
}
export interface RpcXmlArgument {
    readonly lexicalValue: {
        readonly xml: string;
    };
    readonly valueType?: never;
}
export type RpcArgument = string | boolean | number | null | RpcTypedArgument | RpcXmlArgument;
export interface RpcInput {
    readonly library: string;
    readonly method: string;
    readonly arguments?: readonly RpcArgument[];
    readonly async?: boolean;
}
export interface BatchStep {
    readonly id: string;
    readonly args?: HcmData;
    readonly as?: string;
}
export interface BatchInput {
    readonly steps: readonly BatchStep[];
    readonly stopOnError?: boolean;
}
export interface ResultReadInput {
    readonly resultId: string;
    readonly offset?: number;
    readonly limit?: number;
    readonly format?: "auto" | "json" | "text";
}
export interface UploadFileInput {
    readonly filename: string;
    readonly data: string | {
        readonly base64: string;
    };
    readonly contentType?: string;
}
export interface UploadedFileData {
    /** Адрес файла: x-local://share/uploaded_files/<folder>/<name>. */
    readonly url: string;
    /** Папка, которую сервер создал для файла; остаётся после удаления файла. */
    readonly folderUrl: string;
}
/** Один штатный запрос upload_chunk. fileId тот же, последний индекс слать последним. */
export interface UploadChunkInput extends UploadFileInput {
    readonly fileId: string;
    readonly index: number;
    readonly chunksTotal: number;
    readonly totalBytes: number;
    readonly offset: number;
}
/** Объявленный Url — подтверждение, а не доказательство существования полного файла. */
export interface UploadedChunkData {
    readonly error: 0;
    readonly Url: string;
}
export interface ClearUploadChunksInput {
    readonly fileId: string;
    readonly chunksTotal: number;
}
/** Штатный clear_chunks подавляет ошибки удаления; по пустому ответу отсутствие не проверить. */
export interface ClearedUploadChunksData {
    readonly acknowledged: true;
    readonly fileId: string;
    readonly chunksTotal: number;
    readonly absenceVerified: false;
}
export interface StatusData {
    readonly connection: string;
    readonly baseUrl: string;
    readonly version: string;
    /** База за сервером, если сервер её описывает. */
    readonly database?: ServerDatabase;
    /** ID пользователя, под которым подключение вошло, если сервер его называет. */
    readonly userId?: string;
    readonly operationCount: number;
    readonly permissions: {
        readonly write: boolean;
        readonly execute: boolean;
    };
}
export interface QueryData<T = HcmData> {
    readonly items: T[];
    /** Строки, подходящие запросу на сервере, если сервер сообщает согласованный счётчик. */
    readonly total?: number;
    /** Строки могут идти дальше: передать как startPosition. Смещения — не стабильный снимок. */
    readonly nextStartPosition?: number;
    /** Конец не установлен и смещение не растёт; hint говорит почему. */
    readonly incomplete?: true;
    readonly hint?: string;
    /** Запрошенные поля, которых нет в каталоге. */
    readonly unknownFields?: string[];
}
export interface ObjectData<T extends object = HcmData> {
    readonly id?: string;
    readonly type: string;
    readonly url: string;
    readonly data: T;
    /** Запрошенные поля, которые документ не хранит: сервер вычисляет их для строки каталога. */
    readonly fromCatalog?: HcmData;
    /** Поля, запрошенные по имени, для которых у объекта нет значения. */
    readonly emptyFields?: string[];
    /** Запрошенные поля, которых нет ни у типа, ни у его каталога. */
    readonly unknownFields?: string[];
    readonly fingerprint: string;
    readonly formUrl?: string;
}
export interface BatchData {
    readonly results: OperationResult[];
    readonly completed: number;
    readonly requested: number;
    readonly atomic: false;
    readonly ok: boolean;
}
export type ResultPage<T = unknown> = {
    readonly items: T[];
    readonly total: number;
    readonly nextOffset?: number;
    readonly blockedItem?: {
        readonly index: number;
        readonly bytes: number;
    };
    readonly hint?: string;
    /** Страница короче запрошенной: в один ответ больше не входит. */
    readonly cutBySize?: true;
    /** Поле сохранённого ответа, откуда взяты элементы; для голого списка отсутствует. */
    readonly list?: string;
} | {
    readonly text: string;
    readonly totalChars: number;
    readonly nextOffset?: number;
    readonly format?: "text" | "json";
    readonly cutBySize?: true;
};
/** Полная безопасная граница runtime: клиент берёт готовый runtime, не открывая вторую сессию. */
export interface HcmSdkRuntime extends Pick<RuntimePort, "listOperations" | "describe" | "call" | "close"> {
}
/** Ошибка операции с подсказкой сохраняет частичные результаты, не сериализуя их автоматически. */
export declare class HcmOperationError extends HcmError {
    readonly result: OperationResult;
    readonly cleanupError?: HcmError;
    private readonly operationError;
    constructor(result: OperationResult, operationError?: OperationError | undefined);
    toJSON(): OperationError;
}
/** Сохранённый предпросмотр нельзя принять за полный общий T. Страницы читаются явно. */
export declare class HcmStoredResultError extends HcmOperationError {
    readonly resultId: string;
    constructor(result: OperationResult, resultId: string);
}
/** Сбой очистки после успешного действия сохраняет его значение; повтор записи небезопасен. */
export declare class HcmCleanupError<T = unknown> extends HcmError {
    readonly value: T;
    constructor(value: T);
}
export declare function unwrap<T>(result: HcmResult<T>): T;
export declare function unwrap<T = unknown>(result: OperationResult): T;
/** Типизированные методы дают тот же ответ, права, доказательства и исходы, что и call(). */
export declare class HcmClient {
    readonly runtime: HcmSdkRuntime;
    constructor(connection: ConnectionConfig | HcmSdkRuntime);
    static fromRuntime(runtime: HcmSdkRuntime): HcmClient;
    listOperations(filter?: OperationFilter): OperationPage;
    describe(id: string): OperationDefinition;
    call<T = unknown>(id: string, args?: HcmData): Promise<HcmResult<T>>;
    /** Несколько объектов за один вызов; у непрочитанного объекта в его элементе стоит error. */
    getMany<T extends object = HcmData>(input: {
        ids: readonly string[];
        type?: string;
        fields?: readonly string[];
    }): Promise<HcmResult<{
        items: (ObjectData<T> | {
            id: string;
            error: {
                code: string;
                message: string;
            };
        })[];
        total: number;
        failed?: number;
    }>>;
    status(): Promise<HcmResult<StatusData>>;
    check(): Promise<HcmResult<CheckData>>;
    serverInfo(input?: ServerInfoInput): Promise<HcmResult<ServerInfoData>>;
    fileExists(input: FileExistsInput): Promise<HcmResult<FileExistsData>>;
    readFile(input: FileReadInput): Promise<HcmResult<FileReadData>>;
    listFiles(input: {
        url: string;
        search?: string;
    }): Promise<HcmResult<FileListData>>;
    writeFile(input: FileWriteInput): Promise<HcmResult<FileWriteData>>;
    deleteFile(input: FileDeleteInput): Promise<HcmResult<FileDeleteData>>;
    query<T = HcmData>(input: QueryInput): Promise<HcmResult<QueryData<T>>>;
    get<T extends object = HcmData>(input: ObjectTarget & GetOptions): Promise<HcmResult<ObjectData<T>>>;
    create(input: CreateInput<object>): Promise<HcmResult<CreatedObjectData>>;
    patch(input: ObjectTarget & PatchOptions): Promise<HcmResult<PatchedObjectData | PatchPreviewData>>;
    delete(input: ObjectTarget & DeleteOptions): Promise<HcmResult<DeletedObjectData>>;
    schema(input: SchemaInput): Promise<HcmResult<SchemaResult>>;
    types(input?: SchemaTypesInput): Promise<HcmResult<SchemaTypesResult>>;
    rpc<T = unknown>(input: RpcInput): Promise<HcmResult<T>>;
    listRpc(input?: RpcCatalogFilter): Promise<HcmResult<RpcCatalogPage>>;
    describeRpc(targetId: string, options?: RpcDescribeOptions): Promise<HcmResult<RpcTargetDescription>>;
    /**
     * Код строкой или, как принимает инструмент hcm_script, в виде {code, params}.
     * Код читает params как готовую переменную PARAMS.
     */
    execute<T = unknown>(code: string | {
        code: string;
        params?: object;
    }, params?: object): Promise<HcmResult<ScriptData<T>>>;
    /** Запускает агента на сервере и ждёт конца его кода; ошибки кода — только в логе. */
    runAgent(input: {
        id: string;
        objectId?: string;
        objectIds?: string[];
    }): Promise<HcmResult<AgentRunData>>;
    batch(input: BatchInput): Promise<HcmResult<BatchData>>;
    readResult<T = unknown>(input: ResultReadInput): Promise<HcmResult<ResultPage<T>>>;
    exportResult(input: ResultExportInput): Promise<HcmResult<Awaited<ReturnType<HcmRuntime["results"]["export"]>>>>;
    uploadFile(input: UploadFileInput): Promise<HcmResult<UploadedFileData>>;
    uploadChunk(input: UploadChunkInput): Promise<HcmResult<UploadedChunkData>>;
    clearUploadChunks(input: ClearUploadChunksInput): Promise<HcmResult<ClearedUploadChunksData>>;
    heartbeat(input?: WebSocketHeartbeatInput): Promise<HcmResult<WebSocketHeartbeatData>>;
    listLogs(input?: LogListInput): Promise<HcmResult<LogFiles>>;
    readLog(input: LogReadInput): Promise<HcmResult<LogText>>;
    searchLogs(input: LogSearchInput): Promise<HcmResult<LogMatches>>;
    followLog(input: LogFollowInput): Promise<HcmResult<LogNews>>;
    close(): Promise<void>;
    /** Клиент владеет областью и закрывает её ровно один раз после обратного вызова, и при сбое. */
    use<T>(action: (client: HcmClient) => Promise<T>): Promise<T>;
}
/** Разбирает сведения о вторичном сбое очистки, не приводя тип неизвестного пойманного значения. */
export declare function getCleanupError(error: unknown): HcmError | undefined;
/** Открывает один общий runtime для типизированного скрипта. Фасад никогда не расширяет права. */
export declare function withHcmClient<T>(config: ConnectionConfig, action: (client: HcmClient) => Promise<T>): Promise<T>;
/** Совместимая область сырого runtime: очистка и ошибки сохраняются полностью. */
export declare function withHcm<T>(config: ConnectionConfig, action: (runtime: HcmRuntime) => Promise<T>): Promise<T>;
export type { MutationOutcome };
export type { RpcCatalogFilter, RpcCatalogPage, RpcTargetDescription, RpcTargetCard, RpcDescribeOptions, } from "./rpc-catalog.js";
