import { HcmRuntime } from "./runtime.js";
import type { ResultExportInput } from "./results.js";
export type { ResultExportInput } from "./results.js";
import type { CheckData } from "./self-check.js";
export type { CheckData } from "./self-check.js";
import { HcmError } from "./errors.js";
import type { AgentRunData, ScriptData } from "./scripts.js";
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
  /** Which operations read the stored answer. */
  readonly hint?: string;
}
/** A full value, a local reference, and a failed partial outcome are deliberately distinct. */
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
  /** What to write: {path: value} or a list of operations. */
  readonly patch?: HcmData | readonly PatchOperation[];
  /** Paths to remove from the document. */
  readonly remove?: readonly string[];
  readonly expectedFingerprint?: string;
  readonly preview?: boolean;
  /** Save the document even when the patch changes nothing: the server refills what it computes on save. */
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
/** Raw expressions must return homogeneous XML object rows; scalar/mixed sequences use LDS directly. */
export type QueryInput = QueryOptions &
  (
    | {
        readonly catalog: string;
        readonly where?: Record<string, FilterValue | FilterCondition>;
        /** Catalog fields to sort by: "fullname", "hire_date desc". */
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
  /** The address of the file: x-local://share/uploaded_files/<folder>/<name>. */
  readonly url: string;
  /** The folder the server made for the file; it stays after the file is deleted. */
  readonly folderUrl: string;
}
/** One stock upload_chunk request. Reuse fileId and send the final index last. */
export interface UploadChunkInput extends UploadFileInput {
  readonly fileId: string;
  readonly index: number;
  readonly chunksTotal: number;
  readonly totalBytes: number;
  readonly offset: number;
}
/** The advertised Url is an acknowledgement, not proof that a complete file exists. */
export interface UploadedChunkData {
  readonly error: 0;
  readonly Url: string;
}
export interface ClearUploadChunksInput {
  readonly fileId: string;
  readonly chunksTotal: number;
}
/** Stock clear_chunks suppresses delete errors; its empty response cannot verify absence. */
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
  /** Database behind the server, when the server describes it. */
  readonly database?: ServerDatabase;
  /** ID of the user the connection is signed in as, when the server names it. */
  readonly userId?: string;
  readonly operationCount: number;
  readonly permissions: { readonly write: boolean; readonly execute: boolean };
}
export interface QueryData<T = HcmData> {
  readonly items: T[];
  /** Rows matching the query on the server, when the server reports a consistent count. */
  readonly total?: number;
  /** More rows may follow: pass it as startPosition. Offsets are not a stable snapshot. */
  readonly nextStartPosition?: number;
  /** The end was not established and no offset advances; hint says why. */
  readonly incomplete?: true;
  readonly hint?: string;
  /** Requested fields that are not fields of the catalog. */
  readonly unknownFields?: string[];
}
export interface ObjectData<T extends object = HcmData> {
  readonly id?: string;
  readonly type: string;
  readonly url: string;
  readonly data: T;
  /** Requested fields the document does not keep: the server computes them for the catalog row. */
  readonly fromCatalog?: HcmData;
  /** Fields asked for by name that the object has no value for. */
  readonly emptyFields?: string[];
  /** Requested fields that neither the type nor its catalog has. */
  readonly unknownFields?: string[];
  readonly fingerprint: string;
  readonly formUrl?: string;
}
/** A write returns the receipt, not a copy of the document; read the object when its fields are needed. */
export interface CreatedObjectData {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly fingerprint: string;
  readonly mutationId: string;
  readonly mutationOutcome: "confirmed";
}
/** Scalar values are shown as they were and as written; a structure is named, not copied. */
export interface PatchChange {
  readonly op: "set" | "remove";
  readonly path: string;
  readonly before?: unknown;
  readonly after?: unknown;
}
/** Nothing was written: a preview was asked for, or the patch changes nothing (noop). */
export interface PatchPreviewData {
  readonly preview: boolean;
  readonly noop: boolean;
  readonly changes: PatchChange[];
  readonly fingerprint: string;
}
export interface PatchedObjectData {
  readonly id?: string;
  readonly type: string;
  readonly url: string;
  readonly fingerprint: string;
  readonly changes: PatchChange[];
  /** Top-level fields outside the patch that the server itself changed on the save. */
  readonly serverChanged?: string[];
  readonly mutationId: string;
  readonly mutationOutcome: "confirmed";
}
export interface DeletedObjectData {
  readonly id?: string;
  readonly mutationId: string;
  readonly mutationOutcome: "confirmed";
  readonly verification: string;
  readonly catalog?: string;
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
      /** The page is shorter than asked: one answer holds no more. */
      readonly cutBySize?: true;
      /** The member of the stored answer these items come from; absent for a bare list. */
      readonly list?: string;
    }
  | {
      readonly text: string;
      readonly totalChars: number;
      readonly nextOffset?: number;
      readonly format?: "text" | "json";
      readonly cutBySize?: true;
    };

/** The complete safe runtime boundary; a client can borrow an existing runtime without opening a second session. */
export interface HcmSdkRuntime {
  listOperations(filter?: OperationFilter): OperationPage;
  describe(id: string): OperationDefinition;
  call(id: string, args?: HcmData): Promise<OperationResult>;
  close(): Promise<void>;
}

/** An actionable operation error retains partial results without serialising them automatically. */
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

/** A stored preview cannot be mistaken for the complete generic T. Read its pages explicitly. */
export class HcmStoredResultError extends HcmOperationError {
  readonly resultId: string;
  constructor(result: OperationResult, resultId: string) {
    super(result, {
      code: "RESULT_STORED",
      message: "Результат сохранён локально; preview не является полными данными.",
      hint: "Читать resultId через readResult/results.read, при необходимости format:'json'.",
      retryable: false,
      details: { resultId },
    });
    this.resultId = resultId;
  }
}

/** Cleanup failure after a successful action retains its value; repeating a write is unsafe. */
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

/** Typed convenience methods retain the same result envelope, policy, evidence and outcomes as call(). */
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
  /** Several objects in one call; an object that was not read has error in its element. */
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
    return this.call("runtime.status");
  }
  check(): Promise<HcmResult<CheckData>> {
    return this.call("runtime.check");
  }
  serverInfo(input: ServerInfoInput = {}): Promise<HcmResult<ServerInfoData>> {
    return this.call("server.info", { ...input });
  }
  fileExists(input: FileExistsInput): Promise<HcmResult<FileExistsData>> {
    return this.call("files.exists", { ...input });
  }
  readFile(input: FileReadInput): Promise<HcmResult<FileReadData>> {
    return this.call("files.read", { ...input });
  }
  listFiles(input: { url: string; search?: string }): Promise<HcmResult<FileListData>> {
    return this.call("files.list", { ...input });
  }
  writeFile(input: FileWriteInput): Promise<HcmResult<FileWriteData>> {
    return this.call("files.write", { ...input });
  }
  deleteFile(input: FileDeleteInput): Promise<HcmResult<FileDeleteData>> {
    return this.call("files.delete", { ...input });
  }
  query<T = HcmData>(input: QueryInput): Promise<HcmResult<QueryData<T>>> {
    return this.call("runtime.query", { ...input });
  }
  get<T extends object = HcmData>(
    input: ObjectTarget & GetOptions,
  ): Promise<HcmResult<ObjectData<T>>> {
    return this.call("objects.get", { ...input });
  }
  create(input: CreateInput<object>): Promise<HcmResult<CreatedObjectData>> {
    return this.call("objects.create", { ...input });
  }
  patch(
    input: ObjectTarget & PatchOptions,
  ): Promise<HcmResult<PatchedObjectData | PatchPreviewData>> {
    return this.call("objects.patch", { ...input });
  }
  delete(input: ObjectTarget & DeleteOptions): Promise<HcmResult<DeletedObjectData>> {
    return this.call("objects.delete", { ...input });
  }
  schema(input: SchemaInput): Promise<HcmResult<SchemaResult>> {
    return this.call("schema.get", { ...input });
  }
  types(input: SchemaTypesInput = {}): Promise<HcmResult<SchemaTypesResult>> {
    return this.call("schema.types", { ...input });
  }
  rpc<T = unknown>(input: RpcInput): Promise<HcmResult<T>> {
    return this.call("rpc.call", { ...input });
  }
  listRpc(input: RpcCatalogFilter = {}): Promise<HcmResult<RpcCatalogPage>> {
    return this.call("rpc.list", { ...input });
  }
  describeRpc(
    targetId: string,
    options: RpcDescribeOptions = {},
  ): Promise<HcmResult<RpcTargetDescription>> {
    return this.call("rpc.describe", { targetId, ...options });
  }
  /**
   * The code as a string or, like the hcm_script tool takes it, as {code, params}.
   * The code reads params as the ready variable PARAMS.
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
  /** Runs a server agent and waits for the end of its code; errors of the code are in the log only. */
  runAgent(input: {
    id: string;
    objectId?: string;
    objectIds?: string[];
  }): Promise<HcmResult<AgentRunData>> {
    return this.call("agents.run", { ...input });
  }
  batch(input: BatchInput): Promise<HcmResult<BatchData>> {
    return this.call("runtime.batch", { ...input });
  }
  readResult<T = unknown>(input: ResultReadInput): Promise<HcmResult<ResultPage<T>>> {
    return this.call("results.read", { ...input });
  }
  exportResult(
    input: ResultExportInput,
  ): Promise<HcmResult<Awaited<ReturnType<HcmRuntime["results"]["export"]>>>> {
    return this.call("results.export", { ...input });
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
    return this.call("logs.list", { ...input });
  }
  readLog(input: LogReadInput): Promise<HcmResult<LogText>> {
    return this.call("logs.read", { ...input });
  }
  searchLogs(input: LogSearchInput): Promise<HcmResult<LogMatches>> {
    return this.call("logs.search", { ...input });
  }
  followLog(input: LogFollowInput): Promise<HcmResult<LogNews>> {
    return this.call("logs.follow", { ...input });
  }
  close(): Promise<void> {
    return this.runtime.close();
  }
  /** This client owns the scope and closes exactly once after the callback, including failure. */
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
/** Inspect secondary cleanup evidence without casting an unknown caught value. */
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
    // A caller may intentionally return a failed envelope instead of using unwrap().
    // Retain that primary operation failure when cleanup fails afterwards.
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
/** Open one shared runtime for a typed script. Permissions are never expanded by the facade. */
export async function withHcmClient<T>(
  config: ConnectionConfig,
  action: (client: HcmClient) => Promise<T>,
): Promise<T> {
  return new HcmClient(config).use(action);
}
/** Compatible raw-runtime scope with complete cleanup/error preservation. */
export async function withHcm<T>(
  config: ConnectionConfig,
  action: (runtime: HcmRuntime) => Promise<T>,
): Promise<T> {
  const runtime = new HcmRuntime(config);
  return scoped(runtime, () => action(runtime));
}

// Keep the underlying mutation contract available to typed SDK consumers.
export type { MutationOutcome };
export type {
  RpcCatalogFilter,
  RpcCatalogPage,
  RpcTargetDescription,
  RpcTargetCard,
  RpcDescribeOptions,
} from "./rpc-catalog.js";
