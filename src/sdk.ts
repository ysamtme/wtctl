import { HcmRuntime } from "./runtime.js";
import type { RuntimePort } from "./runtime-port.js";
import type { ResultExportInput } from "./results.js";
export type { ResultExportInput } from "./results.js";
import type { CheckData } from "./self-check.js";
export type { CheckData } from "./self-check.js";
import { HcmError } from "./errors.js";
import type { AgentRunData, ScriptData } from "./scripts.js";
import type { OperationData } from "./operations.js";
import type {
  CreatedObjectData,
  PatchPreviewData,
  PatchedObjectData,
  DeletedObjectData,
} from "./objects.js";
export type { PatchChange } from "./documents.js";
export type {
  CreatedObjectData,
  PatchPreviewData,
  PatchedObjectData,
  DeletedObjectData,
} from "./objects.js";
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
import type {
  ConnectionConfig,
  MutationOutcome,
  OperationDefinition,
  OperationError,
  OperationFilter,
  OperationPage,
  OperationResult,
} from "./contracts.js";
import type { LogListInput, LogReadInput, LogSearchInput, LogFollowInput } from "./logs.js";
import type { LogFiles, LogMatches, LogNews, LogText } from "./log-output.js";
import type {
  RpcCatalogFilter,
  RpcCatalogPage,
  RpcDescribeOptions,
  RpcTargetDescription,
} from "./rpc-catalog.js";
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
export type HcmResult<T = unknown> =
  | {
      readonly ok: true;
      readonly data: T;
      readonly meta: ResultMeta & { readonly truncated?: false };
      readonly error?: never;
    }
  | {
      readonly ok: true;
      readonly data: StoredResultData;
      readonly meta: ResultMeta & { readonly truncated: true; readonly resultId: string };
      readonly error?: never;
    }
  | {
      readonly ok: false;
      readonly data?: T | StoredResultData;
      readonly error: OperationError;
      readonly meta: ResultMeta;
    };

export type ObjectTarget =
  | { readonly url: string; readonly type?: string; readonly id?: string }
  | { readonly id: string; readonly type?: string; readonly url?: string };
export interface GetOptions {
  readonly fields?: readonly string[];
}
export interface CreateInput<T extends object = HcmData> {
  readonly type: string;
  readonly data: T;
  readonly dbName?: string;
  readonly formUrl?: string;
}
export type PatchOperation =
  | { readonly op: "set"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string };
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
export type QueryInput = QueryOptions &
  (
    | {
        readonly catalog: string;
        readonly where?: Record<string, FilterValue | FilterCondition>;
        /** Поля каталога для сортировки: "fullname", "hire_date desc". */
        readonly order?: string | readonly string[];
        readonly query?: never;
      }
    | { readonly query: string; readonly catalog?: never; readonly where?: never }
  );
export interface RpcTypedArgument {
  readonly valueType: string;
  readonly lexicalValue: string | { readonly xml: string };
}
export interface RpcXmlArgument {
  readonly lexicalValue: { readonly xml: string };
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
  readonly data: string | { readonly base64: string };
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
  readonly permissions: { readonly write: boolean; readonly execute: boolean };
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
export type ResultPage<T = unknown> =
  | {
      readonly items: T[];
      readonly total: number;
      readonly nextOffset?: number;
      readonly blockedItem?: { readonly index: number; readonly bytes: number };
      readonly hint?: string;
      /** Страница короче запрошенной: в один ответ больше не входит. */
      readonly cutBySize?: true;
      /** Поле сохранённого ответа, откуда взяты элементы; для голого списка отсутствует. */
      readonly list?: string;
    }
  | {
      readonly text: string;
      readonly totalChars: number;
      readonly nextOffset?: number;
      readonly format?: "text" | "json";
      readonly cutBySize?: true;
    };

/** Полная безопасная граница runtime: клиент берёт готовый runtime, не открывая вторую сессию. */
export interface HcmSdkRuntime extends Pick<
  RuntimePort,
  "listOperations" | "describe" | "call" | "close"
> {}

/** Ошибка операции с подсказкой сохраняет частичные результаты, не сериализуя их автоматически. */
export class HcmOperationError extends HcmError {
  declare readonly result: OperationResult;
  declare readonly cleanupError?: HcmError;
  private readonly operationError: OperationError | undefined;
  constructor(result: OperationResult, operationError: OperationError | undefined = result.error) {
    super(
      operationError?.code ?? "OPERATION_FAILED",
      operationError?.message ?? "Операция не выполнена.",
      operationError?.hint,
      operationError?.details,
      operationError?.mutationOutcome,
    );
    Object.defineProperty(this, "result", { value: result, enumerable: false });
    this.operationError = operationError;
  }
  override toJSON(): OperationError {
    return this.operationError ?? super.toJSON();
  }
}

/** Сохранённый предпросмотр нельзя принять за полный общий T. Страницы читаются явно. */
export class HcmStoredResultError extends HcmOperationError {
  readonly resultId: string;
  constructor(result: OperationResult, resultId: string) {
    super(result, {
      code: "RESULT_STORED",
      message: "Результат сохранён локально; preview не является полными данными.",
      hint:
        "Ответ больше outputLimitBytes. Прочитать частями — client.readResult({ resultId }), " +
        "сохранить в файл — client.exportResult({ resultId, path }). " +
        "Поднять предел — loadConfig({ settings: { outputLimitBytes } }).",
      retryable: false,
      details: { resultId },
    });
    this.resultId = resultId;
  }
}

/** Сбой очистки после успешного действия сохраняет его значение; повтор записи небезопасен. */
export class HcmCleanupError<T = unknown> extends HcmError {
  declare readonly value: T;
  constructor(value: T) {
    super(
      "CLEANUP_FAILED",
      "Операция завершилась, но закрыть подключение не удалось.",
      "Результат сохранён в error.value. Операцию из-за ошибки закрытия не повторять.",
      { operationSucceeded: true },
      undefined,
    );
    Object.defineProperty(this, "value", { value, enumerable: false });
  }
}

function storedResultId(result: OperationResult): string | undefined {
  if (typeof result.meta.resultId === "string") return result.meta.resultId;
  if (
    result.data &&
    typeof result.data === "object" &&
    "resultId" in result.data &&
    typeof result.data.resultId === "string"
  )
    return result.data.resultId;
  return undefined;
}
export function unwrap<T>(result: HcmResult<T>): T;
export function unwrap<T = unknown>(result: OperationResult): T;
export function unwrap<T = unknown>(result: OperationResult): T {
  if (!result.ok) throw new HcmOperationError(result);
  if (result.meta.truncated === true) {
    const resultId = storedResultId(result);
    if (resultId) throw new HcmStoredResultError(result, resultId);
    throw new HcmOperationError(result, {
      code: "RESULT_TRUNCATED",
      message: "Полный результат отсутствует в ответе.",
      hint: "Проверить meta и настройку outputLimitBytes; preview не является полными данными.",
      retryable: false,
    });
  }
  return result.data as T;
}

/** Вызов составной операции: тип данных берётся у её обработчика, объявленный тип метода должен ему подходить. */
function callOperation<Id extends keyof OperationData>(
  client: HcmClient,
  id: Id,
  args: HcmData = {},
): Promise<HcmResult<OperationData[Id]>> {
  return client.call<OperationData[Id]>(id, args);
}

/** Типизированные методы дают тот же ответ, права, доказательства и исходы, что и call(). */
export class HcmClient {
  readonly runtime: HcmSdkRuntime;
  constructor(connection: ConnectionConfig | HcmSdkRuntime) {
    this.runtime = "call" in connection ? connection : new HcmRuntime(connection);
  }
  static fromRuntime(runtime: HcmSdkRuntime): HcmClient {
    return new HcmClient(runtime);
  }
  listOperations(filter?: OperationFilter): OperationPage {
    return this.runtime.listOperations(filter);
  }
  describe(id: string): OperationDefinition {
    return this.runtime.describe(id);
  }
  call<T = unknown>(id: string, args: HcmData = {}): Promise<HcmResult<T>> {
    return this.runtime.call(id, args) as Promise<HcmResult<T>>;
  }
  // Методы с параметром-типом и методы на низкоуровневые операции зовут this.call: тип ответа
  // здесь утверждается, обработчик общий и не знает типа вызывающего.
  /** Несколько объектов за один вызов; у непрочитанного объекта в его элементе стоит error. */
  getMany<T extends object = HcmData>(input: {
    ids: readonly string[];
    type?: string;
    fields?: readonly string[];
  }): Promise<
    HcmResult<{
      items: (ObjectData<T> | { id: string; error: { code: string; message: string } })[];
      total: number;
      failed?: number;
    }>
  > {
    return this.call("objects.get", { ...input });
  }
  status(): Promise<HcmResult<StatusData>> {
    return callOperation(this, "runtime.status");
  }
  check(): Promise<HcmResult<CheckData>> {
    return callOperation(this, "runtime.check");
  }
  serverInfo(input: ServerInfoInput = {}): Promise<HcmResult<ServerInfoData>> {
    return callOperation(this, "server.info", { ...input });
  }
  fileExists(input: FileExistsInput): Promise<HcmResult<FileExistsData>> {
    return callOperation(this, "files.exists", { ...input });
  }
  readFile(input: FileReadInput): Promise<HcmResult<FileReadData>> {
    return callOperation(this, "files.read", { ...input });
  }
  listFiles(input: { url: string; search?: string }): Promise<HcmResult<FileListData>> {
    return callOperation(this, "files.list", { ...input });
  }
  writeFile(input: FileWriteInput): Promise<HcmResult<FileWriteData>> {
    return callOperation(this, "files.write", { ...input });
  }
  deleteFile(input: FileDeleteInput): Promise<HcmResult<FileDeleteData>> {
    return callOperation(this, "files.delete", { ...input });
  }
  query<T = HcmData>(input: QueryInput): Promise<HcmResult<QueryData<T>>> {
    return this.call("runtime.query", { ...input });
  }
  /**
   * Строки каталога или запроса XQuery со всех страниц по порядку; страницы листает сам.
   * Аргументы те же, что у query. Неполная страница (incomplete) — ошибка QUERY_INCOMPLETE
   * после её строк, большой ответ — HcmStoredResultError, как в unwrap.
   */
  async *queryRows<T = HcmData>(input: QueryInput): AsyncGenerator<T, void, undefined> {
    let args: QueryInput = input;
    for (;;) {
      const result = await this.query<T>(args);
      const page = unwrap(result);
      yield* page.items;
      if (page.incomplete)
        throw new HcmOperationError(result, {
          code: "QUERY_INCOMPLETE",
          message: "Страница запроса неполная: строки после неё не прочитаны.",
          ...(page.hint === undefined ? {} : { hint: page.hint }),
          retryable: false,
        });
      if (page.nextStartPosition === undefined) return;
      args = { ...input, startPosition: page.nextStartPosition };
    }
  }
  get<T extends object = HcmData>(
    input: ObjectTarget & GetOptions,
  ): Promise<HcmResult<ObjectData<T>>> {
    return this.call("objects.get", { ...input });
  }
  create(input: CreateInput<object>): Promise<HcmResult<CreatedObjectData>> {
    return callOperation(this, "objects.create", { ...input });
  }
  patch(
    input: ObjectTarget & PatchOptions,
  ): Promise<HcmResult<PatchedObjectData | PatchPreviewData>> {
    return callOperation(this, "objects.patch", { ...input });
  }
  delete(input: ObjectTarget & DeleteOptions): Promise<HcmResult<DeletedObjectData>> {
    return callOperation(this, "objects.delete", { ...input });
  }
  schema(input: SchemaInput): Promise<HcmResult<SchemaResult>> {
    return callOperation(this, "schema.get", { ...input });
  }
  types(input: SchemaTypesInput = {}): Promise<HcmResult<SchemaTypesResult>> {
    return callOperation(this, "schema.types", { ...input });
  }
  rpc<T = unknown>(input: RpcInput): Promise<HcmResult<T>> {
    return this.call("rpc.call", { ...input });
  }
  listRpc(input: RpcCatalogFilter = {}): Promise<HcmResult<RpcCatalogPage>> {
    return callOperation(this, "rpc.list", { ...input });
  }
  describeRpc(
    targetId: string,
    options: RpcDescribeOptions = {},
  ): Promise<HcmResult<RpcTargetDescription>> {
    return callOperation(this, "rpc.describe", { targetId, ...options });
  }
  /**
   * Код строкой или, как принимает инструмент hcm_script, в виде {code, params}.
   * Код читает params как готовую переменную PARAMS.
   */
  execute<T = unknown>(
    code: string | { code: string; params?: object },
    params?: object,
  ): Promise<HcmResult<ScriptData<T>>> {
    return this.call(
      "execute.script",
      typeof code === "string" ? { code, ...(params ? { params } : {}) } : { ...code },
    );
  }
  /** Запускает агента на сервере и ждёт конца его кода; ошибки кода — только в логе. */
  runAgent(input: {
    id: string;
    objectId?: string;
    objectIds?: string[];
  }): Promise<HcmResult<AgentRunData>> {
    return callOperation(this, "agents.run", { ...input });
  }
  batch(input: BatchInput): Promise<HcmResult<BatchData>> {
    return callOperation(this, "runtime.batch", { ...input });
  }
  readResult<T = unknown>(input: ResultReadInput): Promise<HcmResult<ResultPage<T>>> {
    return this.call("results.read", { ...input });
  }
  exportResult(
    input: ResultExportInput,
  ): Promise<HcmResult<Awaited<ReturnType<HcmRuntime["results"]["export"]>>>> {
    return callOperation(this, "results.export", { ...input });
  }
  uploadFile(input: UploadFileInput): Promise<HcmResult<UploadedFileData>> {
    return this.call("web.pages.uploadFile", { ...input });
  }
  uploadChunk(input: UploadChunkInput): Promise<HcmResult<UploadedChunkData>> {
    return this.call("web.pages.uploadChunk", { ...input });
  }
  clearUploadChunks(input: ClearUploadChunksInput): Promise<HcmResult<ClearedUploadChunksData>> {
    return this.call("web.pages.clearUploadChunks", { ...input });
  }
  heartbeat(input: WebSocketHeartbeatInput = {}): Promise<HcmResult<WebSocketHeartbeatData>> {
    return this.call("web.websocket.heartbeat", { ...input });
  }
  listLogs(input: LogListInput = {}): Promise<HcmResult<LogFiles>> {
    return callOperation(this, "logs.list", { ...input });
  }
  readLog(input: LogReadInput): Promise<HcmResult<LogText>> {
    return callOperation(this, "logs.read", { ...input });
  }
  searchLogs(input: LogSearchInput): Promise<HcmResult<LogMatches>> {
    return callOperation(this, "logs.search", { ...input });
  }
  followLog(input: LogFollowInput): Promise<HcmResult<LogNews>> {
    return callOperation(this, "logs.follow", { ...input });
  }
  close(): Promise<void> {
    return this.runtime.close();
  }
  /** Клиент владеет областью и закрывает её ровно один раз после обратного вызова, и при сбое. */
  use<T>(action: (client: HcmClient) => Promise<T>): Promise<T> {
    return scoped(this.runtime, () => action(this));
  }
}

function safeCleanupEvidence(): HcmError {
  return new HcmError(
    "CLEANUP_FAILED",
    "Не удалось закрыть подключение после ошибки операции.",
    "Основная ошибка сохранена; запись без проверки её исхода не повторять.",
  );
}
/** Разбирает сведения о вторичном сбое очистки, не приводя тип неизвестного пойманного значения. */
export function getCleanupError(error: unknown): HcmError | undefined {
  if (
    error !== null &&
    typeof error === "object" &&
    "cleanupError" in error &&
    error.cleanupError instanceof HcmError
  )
    return error.cleanupError;
  if (error instanceof AggregateError)
    return error.errors.find(
      (item: unknown) => item instanceof HcmError && item.code === "CLEANUP_FAILED",
    ) as HcmError | undefined;
  return undefined;
}
async function scoped<T>(
  runtime: Pick<HcmSdkRuntime, "close">,
  action: () => Promise<T>,
): Promise<T> {
  let value!: T;
  let failed = false;
  let primary: unknown;
  try {
    value = await action();
  } catch (error) {
    failed = true;
    primary = error;
  }
  try {
    await runtime.close();
  } catch {
    // Вызывающий может намеренно вернуть ответ с ошибкой вместо unwrap().
    // При последующем сбое очистки сохраняется этот первичный сбой операции.
    if (
      !failed &&
      value !== null &&
      typeof value === "object" &&
      "ok" in value &&
      value.ok === false &&
      "meta" in value &&
      "error" in value &&
      value.error !== null &&
      typeof value.error === "object" &&
      "code" in value.error &&
      typeof value.error.code === "string" &&
      "message" in value.error &&
      typeof value.error.message === "string"
    ) {
      failed = true;
      primary = new HcmOperationError(value as unknown as OperationResult);
    }
    if (!failed) throw new HcmCleanupError(value);
    const cleanupError = safeCleanupEvidence();
    if (
      primary !== null &&
      (typeof primary === "object" || typeof primary === "function") &&
      Object.isExtensible(primary)
    ) {
      try {
        Object.defineProperty(primary, "cleanupError", { value: cleanupError, enumerable: false });
      } catch {
        throw new AggregateError(
          [primary, cleanupError],
          "Операция не выполнена, и закрыть подключение не удалось.",
        );
      }
    } else
      throw new AggregateError(
        [primary, cleanupError],
        "Операция не выполнена, и закрыть подключение не удалось.",
      );
  }
  if (failed) throw primary;
  return value;
}
/** Открывает один общий runtime для типизированного скрипта. Фасад никогда не расширяет права. */
export async function withHcmClient<T>(
  config: ConnectionConfig,
  action: (client: HcmClient) => Promise<T>,
): Promise<T> {
  return new HcmClient(config).use(action);
}
/** Совместимая область сырого runtime: очистка и ошибки сохраняются полностью. */
export async function withHcm<T>(
  config: ConnectionConfig,
  action: (runtime: HcmRuntime) => Promise<T>,
): Promise<T> {
  const runtime = new HcmRuntime(config);
  return scoped(runtime, () => action(runtime));
}

// Базовый контракт записи остаётся доступным типизированным потребителям SDK.
export type { MutationOutcome };
export type {
  RpcCatalogFilter,
  RpcCatalogPage,
  RpcTargetDescription,
  RpcTargetCard,
  RpcDescribeOptions,
} from "./rpc-catalog.js";
