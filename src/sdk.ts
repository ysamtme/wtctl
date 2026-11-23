import { HcmRuntime } from "./runtime.js";
import type { RuntimePort } from "./runtime-port.js";
import type { ResultExportData, ResultExportInput } from "./results.js";
import type { CheckData } from "./self-check.js";
import { HcmError } from "./errors.js";
import type { AgentCancelData, AgentRunData, AgentStatusData, ScriptData } from "./scripts.js";
import type { OperationData } from "./operations.js";
import type {
  CreatedObjectData,
  PatchPreviewData,
  PatchedObjectData,
  DeletedObjectData,
} from "./objects.js";
import type { ServerInfoInput, ServerInfoData } from "./server-info.js";
import type { FileExistsInput, FileExistsData, FileReadInput, FileReadData } from "./files.js";
import type { FileWriteInput, FileWriteData, FileDeleteInput, FileDeleteData } from "./files.js";
import type { FileListInput, FileListData, FileSaveInput, FileSaveData } from "./files.js";
import type { SchemaInput, SchemaResult, SchemaTypesInput, SchemaTypesResult } from "./schema.js";
import type {
  ConnectionConfig,
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
import type {
  AgentStatusInput,
  BatchData,
  BatchInput,
  CancelAgentInput,
  ClearedUploadChunksData,
  ClearUploadChunksInput,
  CreateInput,
  DeleteOptions,
  GetManyData,
  GetManyInput,
  GetOptions,
  HcmData,
  HcmResult,
  ObjectData,
  ObjectTarget,
  PatchOptions,
  QueryData,
  QueryInput,
  ResultPage,
  ResultReadInput,
  RpcAsyncData,
  RpcInput,
  RpcValueData,
  RunAgentInput,
  StatusData,
  UploadChunkInput,
  UploadedChunkData,
  UploadedFileData,
  UploadFileInput,
} from "./sdk-types.js";

export type {
  AgentStatusInput,
  BatchData,
  BatchInput,
  BatchStep,
  CancelAgentInput,
  ClearedUploadChunksData,
  ClearUploadChunksInput,
  CreateInput,
  DeleteOptions,
  FilterCondition,
  FilterValue,
  GetManyData,
  GetManyInput,
  GetOptions,
  HcmData,
  HcmResult,
  ObjectData,
  ObjectTarget,
  PatchOperation,
  PatchOptions,
  QueryData,
  QueryInput,
  QueryOptions,
  ResultMeta,
  ResultPage,
  ResultReadInput,
  RpcArgument,
  RpcAsyncData,
  RpcInput,
  RpcTypedArgument,
  RpcValueData,
  RpcXmlArgument,
  RunAgentInput,
  StatusData,
  StoredResultData,
  UploadChunkInput,
  UploadedChunkData,
  UploadedFileData,
  UploadFileInput,
} from "./sdk-types.js";

/**
 * Готовый runtime для клиента: CLI и тесты отдают свой, не открывая вторую сессию.
 * @internal
 */
export interface HcmSdkRuntime extends Pick<
  RuntimePort,
  "listOperations" | "describe" | "call" | "close"
> {}

/**
 * Ошибка, которую бросает unwrap при ok:false: code, message, hint, details и mutationOutcome
 * взяты из error ответа.
 */
export class HcmOperationError extends HcmError {
  /** Ответ целиком, с частичными данными. В JSON ошибки не попадает. */
  declare readonly result: OperationResult;
  /** Ошибка закрытия подключения, если и оно не удалось; её же возвращает getCleanupError. */
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
  /** error ответа, как его вернула операция. */
  override toJSON(): OperationError {
    return this.operationError ?? super.toJSON();
  }
}

/**
 * Ответ больше outputLimitBytes и сохранён локально; unwrap бросает эту ошибку, чтобы начало данных
 * нельзя было принять за все данные. Код RESULT_STORED.
 */
export class HcmStoredResultError extends HcmOperationError {
  /** ID сохранённого результата: его читают readResult и exportResult. */
  readonly resultId: string;
  constructor(result: OperationResult, resultId: string) {
    super(result, {
      code: "RESULT_STORED",
      message: "Результат сохранён локально; в data.preview только начало данных.",
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

/**
 * Операция в withHcmClient или use выполнена, но подключение не закрылось. Код CLEANUP_FAILED.
 * Результат операции — в value; повторять её не нужно.
 */
export class HcmCleanupError<T = unknown> extends HcmError {
  /** Что вернула функция, переданная в withHcmClient или use. */
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

async function readStoredQueryPage<T>(
  client: HcmClient,
  result: HcmResult<QueryData<T>>,
  resultId: string,
): Promise<QueryData<T>> {
  let offset: number | undefined = 0;
  let text = "";
  while (offset !== undefined) {
    const chunk = await client.readResult({ resultId, offset, limit: 65536, format: "json" });
    if (!chunk.ok) throw new HcmStoredResultError(result, resultId);
    const data =
      chunk.data && typeof chunk.data === "object"
        ? (chunk.data as { text?: unknown; format?: unknown; nextOffset?: unknown })
        : undefined;
    if (data?.format !== "json" || typeof data.text !== "string")
      throw new HcmStoredResultError(result, resultId);
    text += data.text;
    if (data.nextOffset === undefined) {
      offset = undefined;
    } else if (Number.isSafeInteger(data.nextOffset) && (data.nextOffset as number) > offset) {
      offset = data.nextOffset as number;
    } else {
      throw new HcmStoredResultError(result, resultId);
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HcmStoredResultError(result, resultId);
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { items?: unknown }).items)
  )
    throw new HcmStoredResultError(result, resultId);
  return parsed as QueryData<T>;
}
/**
 * data ответа. Бросает HcmOperationError при ok:false и HcmStoredResultError, если ответ сохранён
 * локально (meta.truncated).
 */
export function unwrap<T>(result: HcmResult<T>): T;
/** data ответа любой операции; бросает так же, как для HcmResult. */
export function unwrap<T = unknown>(result: OperationResult): T;
export function unwrap<T = unknown>(result: OperationResult): T {
  if (!result.ok) throw new HcmOperationError(result);
  if (result.meta.truncated === true) {
    const resultId = storedResultId(result);
    if (resultId) throw new HcmStoredResultError(result, resultId);
    throw new HcmOperationError(result, {
      code: "RESULT_TRUNCATED",
      message: "Полный результат отсутствует в ответе.",
      hint: "Проверить meta и настройку outputLimitBytes; в data.preview только начало данных.",
      retryable: false,
    });
  }
  return result.data as T;
}

/** Вызов основной операции: тип данных берётся у её обработчика, объявленный тип метода должен ему подходить. */
function callOperation<Id extends keyof OperationData>(
  client: HcmClient,
  id: Id,
  args: HcmData = {},
): Promise<HcmResult<OperationData[Id]>> {
  return client.call<OperationData[Id]>(id, args);
}

/**
 * Клиент сервера по одному подключению. Каждый метод — операция клиента: ответ, права и исходы
 * записи те же, что у call, CLI и MCP-сервера. Методы не бросают при отказе сервера: ответ
 * приходит с ok:false, data достаёт unwrap. Подключение закрывает close или сам withHcmClient.
 */
export class HcmClient {
  /** @internal */
  readonly runtime: HcmSdkRuntime;
  /** Клиент по подключению из loadConfig; сессия на сервере открывается при первом вызове. */
  constructor(config: ConnectionConfig);
  /** @internal */
  constructor(runtime: HcmSdkRuntime);
  constructor(connection: ConnectionConfig | HcmSdkRuntime) {
    this.runtime = "call" in connection ? connection : new HcmRuntime(connection);
  }
  /** Операции клиента, по странице: поиск по словам, теме, группе, эффекту. Сервер не вызывается. */
  listOperations(filter?: OperationFilter): OperationPage {
    return this.runtime.listOperations(filter);
  }
  /** Описание операции по ID со схемой аргументов; неизвестный ID — HcmError UNKNOWN_OPERATION. */
  describe(id: string): OperationDefinition {
    return this.runtime.describe(id);
  }
  /**
   * Любая операция по ID: call("native.lds.loadDoc", {url}). Аргументы — как в describe(id).
   * Тип data задаёт параметр T; клиент его не проверяет.
   */
  call<T = unknown>(id: string, args: HcmData = {}): Promise<HcmResult<T>> {
    return this.runtime.call(id, args) as Promise<HcmResult<T>>;
  }
  // Методы с параметром-типом и методы на низкоуровневые операции зовут this.call: тип ответа
  // здесь утверждается, обработчик общий и не знает типа вызывающего.
  /** Несколько объектов за один вызов, до 100; у непрочитанного объекта в его элементе стоит error. */
  getMany<T extends object = HcmData>(input: GetManyInput): Promise<HcmResult<GetManyData<T>>> {
    return this.call("objects.get", { ...input });
  }
  /** Связь с сервером: версия сервера, база данных (database), userId и права подключения. Ничего не меняет. */
  status(): Promise<HcmResult<StatusData>> {
    return callOperation(this, "runtime.status");
  }
  /**
   * Проверка подключения по шагам: вход, версия, запрос, документ, схема, библиотеки, логи, портал;
   * при праве execute — ещё код на сервере. Запись не проверяется.
   */
  check(): Promise<HcmResult<CheckData>> {
    return callOperation(this, "runtime.check");
  }
  /** Сведения о сервере, которые он отдаёт админке при запуске: версия, ОС, база, папки. */
  serverInfo(input: ServerInfoInput = {}): Promise<HcmResult<ServerInfoData>> {
    return callOperation(this, "server.info", { ...input });
  }
  /** Есть ли файл или папка по адресу x-local://…; о содержимом и правах ответ ничего не говорит. */
  fileExists(input: FileExistsInput): Promise<HcmResult<FileExistsData>> {
    return callOperation(this, "files.exists", { ...input });
  }
  /** Сохраняет файл сервера на этот компьютер байт в байт, любого размера. */
  readFile(input: FileSaveInput): Promise<HcmResult<FileSaveData>>;
  /** Файл по адресу сервера: text, если это текст в UTF-8, иначе base64. */
  readFile(input: FileReadInput): Promise<HcmResult<FileReadData>>;
  /** Аргумент, собранный заранее как FileReadInput или FileSaveInput: ответ — FileReadData или FileSaveData. */
  readFile(input: FileReadInput | FileSaveInput): Promise<HcmResult<FileReadData | FileSaveData>>;
  readFile(input: FileReadInput | FileSaveInput): Promise<HcmResult<FileReadData | FileSaveData>> {
    return callOperation(this, "files.read", { ...input });
  }
  /** Один уровень папки сервера: файлы с размером и вложенные папки. Нужно право execute. */
  listFiles(input: FileListInput): Promise<HcmResult<FileListData>> {
    return callOperation(this, "files.list", { ...input });
  }
  /**
   * Записывает файл по адресу x-local://… целиком из text, base64 или файла на диске (file) и сверяет
   * записанное; папки сервер создаёт сам. Нужно право write, в папку кода (wt, wtv, custom…) — ещё
   * execute.
   */
  writeFile(input: FileWriteInput): Promise<HcmResult<FileWriteData>> {
    return callOperation(this, "files.write", { ...input });
  }
  /** Удаляет файл по адресу x-local://…. Нужно право write, в папке кода — ещё execute. */
  deleteFile(input: FileDeleteInput): Promise<HcmResult<FileDeleteData>> {
    return callOperation(this, "files.delete", { ...input });
  }
  /**
   * Одна страница поиска: в каталоге по условиям или запросом XQuery (ему нужно право execute).
   * Дальше — startPosition: nextStartPosition; все страницы сразу перебирает queryRows.
   */
  query<T = HcmData>(input: QueryInput): Promise<HcmResult<QueryData<T>>> {
    return this.call("runtime.query", { ...input });
  }
  /**
   * Строки каталога или запроса XQuery со всех страниц по порядку; страницы листает сам.
   * Аргументы те же, что у query. Страницу, которая не поместилась в outputLimitBytes и
   * сохранилась локально, дочитывает через readResult. Неполная страница (incomplete) —
   * ошибка QUERY_INCOMPLETE после её строк.
   */
  async *queryRows<T = HcmData>(input: QueryInput): AsyncGenerator<T, void, undefined> {
    let args: QueryInput = input;
    for (;;) {
      const result = await this.query<T>(args);
      const storedId = result.ok && result.meta.truncated ? storedResultId(result) : undefined;
      const page = storedId ? await readStoredQueryPage<T>(this, result, storedId) : unwrap(result);
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
  /** Документ объекта по id или url; fields — только эти поля верхнего уровня. */
  get<T extends object = HcmData>(
    input: ObjectTarget & GetOptions,
  ): Promise<HcmResult<ObjectData<T>>> {
    return this.call("objects.get", { ...input });
  }
  /**
   * Создаёт объект; ID выдаёт сервер, после записи объект перечитывается и сверяется. Нужно право
   * write. Обработчики, которые админка выполняет при создании, не запускаются.
   */
  create(input: CreateInput<object>): Promise<HcmResult<CreatedObjectData>> {
    return callOperation(this, "objects.create", { ...input });
  }
  /**
   * Меняет поля объекта, остальное содержимое документа сохраняется. Нужно право write.
   * С preview:true или правкой без изменений ничего не записывает: ответ — PatchPreviewData.
   */
  patch(
    input: ObjectTarget & PatchOptions,
  ): Promise<HcmResult<PatchedObjectData | PatchPreviewData>> {
    return callOperation(this, "objects.patch", { ...input });
  }
  /** Удаляет документ объекта безвозвратно; нужны permanent:true и право write. */
  delete(input: ObjectTarget & DeleteOptions): Promise<HcmResult<DeletedObjectData>> {
    return callOperation(this, "objects.delete", { ...input });
  }
  /** Поля типа объекта по странице: свои, унаследованные, настраиваемые и поля каталога. */
  schema(input: SchemaInput): Promise<HcmResult<SchemaResult>> {
    return callOperation(this, "schema.get", { ...input });
  }
  /** Типы объектов сервера: тип, каталог, заголовок, число настраиваемых полей. */
  types(input: SchemaTypesInput = {}): Promise<HcmResult<SchemaTypesResult>> {
    return callOperation(this, "schema.types", { ...input });
  }
  /** Запускает функцию библиотеки сервера фоновой задачей; в ответе TrackingID. Нужно право execute. */
  rpc(
    input: RpcInput & {
      /** Запустить фоновой задачей. */
      readonly async: true;
    },
  ): Promise<HcmResult<RpcAsyncData>>;
  /** Вызывает функцию библиотеки сервера синхронно; типизированное значение приходит в data.value (нетипизированный XML — сырым ответом сервера). Нужно право execute; функция может менять данные. */
  rpc<T = unknown>(
    input: RpcInput & {
      /** Выполнить синхронно (по умолчанию false). */
      readonly async?: false;
    },
  ): Promise<HcmResult<RpcValueData<T>>>;
  /** Вызывает функцию библиотеки сервера синхронно или фоновой задачей по полю async. Нужно право execute. */
  rpc<T = unknown>(input: RpcInput): Promise<HcmResult<RpcValueData<T> | RpcAsyncData>>;
  rpc<T = unknown>(input: RpcInput): Promise<HcmResult<RpcValueData<T> | RpcAsyncData>> {
    return this.call("rpc.call", { ...input });
  }
  /** Функции библиотек сервера по странице: имя и параметры. Сами функции не вызываются. */
  listRpc(input: RpcCatalogFilter = {}): Promise<HcmResult<RpcCatalogPage>> {
    return callOperation(this, "rpc.list", { ...input });
  }
  /** Параметры функции «библиотека.функция», с source:true — и её код. Функция не вызывается. */
  describeRpc(
    targetId: string,
    options: RpcDescribeOptions = {},
  ): Promise<HcmResult<RpcTargetDescription>> {
    return callOperation(this, "rpc.describe", { targetId, ...options });
  }
  /**
   * Выполняет код SP-XML Script на сервере; нужно право execute, отката нет. Код присваивает
   * массив переменной RESULT, params доступен в коде как PARAMS. Код и params можно передать
   * и одним объектом {code, params}.
   */
  execute<T = unknown>(
    code:
      | string
      | {
          /** Код SP-XML Script. */
          code: string;
          /** Параметры: в коде переменная PARAMS. */
          params?: object;
        },
    params?: object,
  ): Promise<HcmResult<ScriptData<T>>> {
    return this.call(
      "execute.script",
      typeof code === "string" ? { code, ...(params ? { params } : {}) } : { ...code },
    );
  }
  /**
   * Запускает агента сервера в отдельном потоке и по умолчанию ждёт завершения (до waitTimeoutMs,
   * по умолчанию 120000 мс); нужно право execute. С wait:false возвращает threadId сразу (для
   * агентов на C# threadId может отсутствовать). При истечении waitTimeoutMs возвращает
   * AGENT_WAIT_TIMEOUT (mutationOutcome: confirmed), при сбое опроса — AGENT_STATUS_FAILED
   * (confirmed). Ошибки кода агента сервера — только в логе xhttp.
   */
  runAgent(input: RunAgentInput): Promise<HcmResult<AgentRunData>> {
    return callOperation(this, "agents.run", { ...input });
  }
  /**
   * Список текущих и недавно завершённых запусков агентов сервера; фильтруется по id, threadId,
   * status и limit. С threadId и wait:true ждёт завершения запуска (при таймауте —
   * AGENT_WAIT_TIMEOUT). Право execute не требуется.
   */
  agentStatus(input: AgentStatusInput = {}): Promise<HcmResult<AgentStatusData>> {
    return callOperation(this, "agents.status", { ...input });
  }
  /**
   * Останавливает выполняющегося агента сервера по threadId (roleUID определяется автоматически,
   * если не задан; при отсутствии работающего потока — AGENT_NOT_RUNNING с not_sent). Нужно право
   * write; уже сделанные изменения не откатываются.
   */
  cancelAgent(input: CancelAgentInput): Promise<HcmResult<AgentCancelData>> {
    return callOperation(this, "agents.cancel", { ...input });
  }
  /**
   * Несколько операций одним вызовом; права проверяются для каждого шага. Не транзакция:
   * выполненные шаги не откатываются.
   */
  batch(input: BatchInput): Promise<HcmResult<BatchData>> {
    return callOperation(this, "runtime.batch", { ...input });
  }
  /** Страница сохранённого результата: список — по элементам, текст — по символам. */
  readResult<T = unknown>(input: ResultReadInput): Promise<HcmResult<ResultPage<T>>> {
    return this.call("results.read", { ...input });
  }
  /** Записывает сохранённый результат целиком в файл на этом компьютере. */
  exportResult(input: ResultExportInput): Promise<HcmResult<ResultExportData>> {
    return callOperation(this, "results.export", { ...input });
  }
  /** Загружает файл в папку загрузок сервера так же, как админка; нужно право write. */
  uploadFile(input: UploadFileInput): Promise<HcmResult<UploadedFileData>> {
    return this.call("web.pages.uploadFile", { ...input });
  }
  /**
   * Отправляет одну часть загрузки по частям; последняя часть собирает файл. Нужно право write.
   * Перед последней частью загруженное проверить чтением; после ошибки на последней части не повторять.
   */
  uploadChunk(input: UploadChunkInput): Promise<HcmResult<UploadedChunkData>> {
    return this.call("web.pages.uploadChunk", { ...input });
  }
  /** Просит сервер удалить части загрузки fileId; нужно право write. Удаление ответ не подтверждает. */
  clearUploadChunks(input: ClearUploadChunksInput): Promise<HcmResult<ClearedUploadChunksData>> {
    return this.call("web.pages.clearUploadChunks", { ...input });
  }
  /** Проверка WebSocket сервера: одно сообщение $hbt и ожидание $ok. */
  heartbeat(input: WebSocketHeartbeatInput = {}): Promise<HcmResult<WebSocketHeartbeatData>> {
    return this.call("web.websocket.heartbeat", { ...input });
  }
  /** Логи сервера, сначала свежие. */
  listLogs(input: LogListInput = {}): Promise<HcmResult<LogFiles>> {
    return callOperation(this, "logs.list", { ...input });
  }
  /** Текст лога: конец файла или весь файл. */
  readLog(input: LogReadInput): Promise<HcmResult<LogText>> {
    return callOperation(this, "logs.read", { ...input });
  }
  /** События лога по тексту, уровню или потоку; многострочное событие приходит целиком. */
  searchLogs(input: LogSearchInput): Promise<HcmResult<LogMatches>> {
    return callOperation(this, "logs.search", { ...input });
  }
  /** Новые события лога с прошлого вызова: cursor из прошлого ответа. */
  followLog(input: LogFollowInput): Promise<HcmResult<LogNews>> {
    return callOperation(this, "logs.follow", { ...input });
  }
  /** Закрывает сессию на сервере. После close методы отвечают ошибкой RUNTIME_CLOSED. */
  close(): Promise<void> {
    return this.runtime.close();
  }
  /**
   * Вызывает action с этим клиентом и закрывает подключение ровно один раз — и после успеха,
   * и после ошибки. Как withHcmClient, но для уже созданного клиента.
   */
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
/**
 * Ошибка закрытия подключения, если withHcmClient или use не смогли закрыть его после ошибки
 * операции; иначе undefined. Пойманная ошибка при этом — ошибка операции.
 */
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
/**
 * Создаёт клиент по подключению, вызывает action и закрывает подключение — и после успеха, и после
 * ошибки. Возвращает то, что вернул action. Права — те, что заданы в подключении.
 */
export async function withHcmClient<T>(
  config: ConnectionConfig,
  action: (client: HcmClient) => Promise<T>,
): Promise<T> {
  return new HcmClient(config).use(action);
}
