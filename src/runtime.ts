import { operations, operationDefinition } from "./operations.js";
import { listHcmOperations, describeHcmOperation } from "./catalog.js";
import { randomUUID } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { NativeGateway, getEffectiveNativeEffect, WsHcmApiError } from "./native/index.js";
import { loginFailed } from "./native/gateway.js";
import { validate, prepare } from "./native/validation.js";
import { findXmlNode, buildXml, escapeXml, type XmlObject } from "./protocol/xml.js";
import {
  resolvePhysicalDocumentLocation,
  parsePhysicalDocumentId,
} from "./protocol/physical-documents.js";
import { WebSocketHeartbeatError } from "./protocol/websocket.js";
import { HcmError, inputObject, requiredString, boundedInteger } from "./errors.js";
import { logFiles, logMatches, logNews, logText } from "./log-output.js";
import { XmlDocument, patchSegments } from "./documents.js";
import { SchemaReader, withRepeated, type SchemaInput, type SchemaTypesInput } from "./schema.js";
import {
  catalogQuery,
  cleanXmlValue,
  identifier,
  looksLikeDate,
  looksLikeDecimalId,
  projectFields,
  orderFields,
  queryPage,
  rowTag,
  withoutFalseOffset,
  xqueryNames,
} from "./query.js";
import { ResultStore } from "./results.js";
import { isServerDate, verifyFields, verifyRemovals } from "./verification.js";
import { LogReader, type LogReadInput, type LogSearchInput, type LogFollowInput } from "./logs.js";
import { RpcCatalog } from "./rpc-catalog.js";
import { agentRun, agentRunResult, prepareScript, rpcValue, scriptResult } from "./scripts.js";
import { parseServerInfo, type ServerInfoData, type ServerInfoProfile } from "./server-info.js";
import { checkServer, type CheckData } from "./self-check.js";
import { platformFailure } from "./platform-errors.js";
import {
  FILE_EXISTS_TARGET,
  FILE_EXISTS_URL_MAX_LENGTH,
  assertFileDeletable,
  codeDelete,
  codeDeleteRefusal,
  codeList,
  codeWrite,
  fileContent,
  fileExistsUrl,
  fileFolders,
  fileList,
  fileRemains,
  fileRoute,
  fileTarget,
  fileWriteContent,
  parseFileExists,
} from "./files.js";
import type {
  BinaryResult,
  ConnectionConfig,
  OperationDefinition,
  OperationEffect,
  OperationFilter,
  OperationPage,
  OperationResult,
} from "./contracts.js";
import type { NativeOperation } from "./contracts.js";

interface BatchRecovery {
  completed: number;
  requested: number;
  sentMutationSteps: number;
  receipts: Record<string, unknown>[];
}
interface ExecutionState {
  sent: boolean;
  effect: OperationEffect;
  mutationId?: string;
  objectId?: string;
  url?: string;
  executionId?: string;
  /** The operation whose usual HTTP 500 cause the failure hint states, when not the called one. */
  refusal?: string;
  batchRecovery?: BatchRecovery;
}
function scalar(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value)
    return String((value as Record<string, unknown>)["#text"]);
  throw new HcmError("PLATFORM_RESPONSE", `В ответе сервера нет ${label}.`);
}
function isBinary(value: unknown): value is BinaryResult {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "binary" &&
    "bytes" in value &&
    value.bytes instanceof Uint8Array
  );
}
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array)
    return { base64: Buffer.from(value).toString("base64"), bytes: value.length };
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  return value;
}
function hasStructure(data: Record<string, unknown>): boolean {
  return Object.values(data).some((value) => value !== null && typeof value === "object");
}
/** What a stored answer starts with: the first rows of a list, the first characters of a long text. */
function beginning(data: unknown): unknown {
  const cut = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.slice(0, 3)
      : typeof value === "string"
        ? value.slice(0, 1000)
        : value;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return cut(data);
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, cut(value)]));
}
/** One line for a step of a stored batch answer: which step it is and how much it returned. */
function stepSummary(step: unknown): unknown {
  const { as, ok, data, error } = step as {
    as?: string;
    ok?: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string };
  };
  return {
    ...(as === undefined ? {} : { as }),
    ok,
    ...(error?.code ? { code: error.code } : {}),
    ...(typeof data?.total === "number" ? { total: data.total } : {}),
    ...(Array.isArray(data?.items) ? { rows: data.items.length } : {}),
    ...(data?.incomplete ? { incomplete: true } : {}),
  };
}
/** A raw protocol answer carries XML formatting: indentation between elements and the namespace attribute. */
function withoutXmlFormatting(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutXmlFormatting);
  if (!value || typeof value !== "object" || value instanceof Uint8Array) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, child]) =>
          key !== "@_xmlns" &&
          !(key === "#text" && typeof child === "string" && child.trim() === ""),
      )
      .map(([key, child]) => [
        key,
        // A line break and the indentation of the closing tag are formatting of an empty element.
        typeof child === "string" && /^\s*\n[ \t]+$/.test(child) ? "" : withoutXmlFormatting(child),
      ]),
  );
}

/** One runtime owns sessions, serialization, local policy and artifacts for every frontend. */
/**
 * A raw answer in the form a caller can use. The server names an uploaded file by its path inside
 * the uploads folder, breaks base64 into lines and gives the result of a background task as typed
 * XML; a caller needs the address of the file, the base64 as one piece and the value as plain JSON.
 */
function plainAnswer(id: string, answer: unknown): unknown {
  if (answer === null || typeof answer !== "object" || Array.isArray(answer)) return answer;
  const data = answer as Record<string, unknown>;
  if (id === "web.pages.uploadFile" && typeof data.Url === "string" && data.Url) {
    const url = `x-local://share/uploaded_files/${data.Url}`;
    const { Url: _, ...rest } = data;
    return { ...rest, url, folderUrl: url.slice(0, url.lastIndexOf("/")) };
  }
  if (id === "web.spxml.getAsyncMethodStatus" && data.ResultData !== undefined)
    try {
      const decoded = rpcValue(data);
      if (decoded !== data) {
        const { ResultData: _typed, ...state } = data;
        return { ...state, ...(decoded as Record<string, unknown>) };
      }
    } catch {
      // A result that has no plain form stays as the server gave it.
    }
  return answer;
}
/** A typing slip: one letter changed, added, dropped or swapped with its neighbour. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) (endA--, endB--);
  const restA = a.slice(start, endA);
  const restB = b.slice(start, endB);
  return (
    Math.max(restA.length, restB.length) <= 1 ||
    (restA.length === 2 && restB.length === 2 && restA === restB[1]! + restB[0]!)
  );
}
/** What to write and the paths to remove, as the one list of operations a document takes. */
function patchInput(patch: unknown, remove: unknown, resave = false): unknown {
  if (remove === undefined) {
    if (patch === undefined) {
      if (resave) return [];
      throw new HcmError("INVALID_ARGUMENT", "Нужно указать patch, remove или оба.");
    }
    return patch;
  }
  if (!Array.isArray(remove) || remove.some((path) => typeof path !== "string"))
    throw new HcmError("INVALID_ARGUMENT", "remove: нужен список путей.");
  const set = Array.isArray(patch)
    ? patch
    : Object.entries(inputObject(patch ?? {}, "patch")).map(([path, value]) => ({
        op: "set",
        path,
        value,
      }));
  return [...set, ...remove.map((path: string) => ({ op: "remove", path }))];
}
export class HcmRuntime {
  readonly gateway: NativeGateway;
  readonly results: ResultStore;
  readonly logs: LogReader;
  private readonly schemaReader: SchemaReader;
  private readonly rpcCatalog: RpcCatalog;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private appInfo: { expires: number; value: Promise<unknown> } | undefined;
  /** Room for the payload of one reply; the rest of the output limit is left to its other fields. */
  private get pageBytes(): number {
    return Math.floor(this.config.outputLimitBytes * 0.6);
  }
  constructor(readonly config: ConnectionConfig) {
    this.results = new ResultStore(config);
    this.gateway = new NativeGateway(config);
    this.logs = new LogReader(this.gateway, config);
    this.rpcCatalog = new RpcCatalog(
      () => this.applicationInfo(),
      (url) => this.gateway.call("native.lds.loadUrl", { url }),
    );
    this.schemaReader = new SchemaReader(
      () => this.applicationInfo(),
      async (url) =>
        requiredString(await this.gateway.call("native.spxml2.getForm", { url }), "ответ с формой"),
      async (url) => (await this.load({ url })).document.snapshot().data,
    );
  }
  listOperations(filter: OperationFilter = {}): OperationPage {
    return listHcmOperations(filter);
  }
  describe(id: string): OperationDefinition {
    return describeHcmOperation(id);
  }
  /** Resolve conditional side effects for the actual arguments; frontends must use this before routing. */
  getOperationEffect(id: string, args: Record<string, unknown> = {}): OperationEffect {
    return this.effect(this.describe(id), args);
  }
  call(id: string, args: Record<string, unknown> = {}): Promise<OperationResult> {
    const start = performance.now();
    if (this.closed)
      return Promise.resolve(
        this.failure(id, start, new HcmError("RUNTIME_CLOSED", "Подключение уже закрыто.")),
      );
    let snapshot: Record<string, unknown>;
    try {
      snapshot = inputObject(structuredClone(args));
    } catch {
      return Promise.resolve(
        this.failure(
          id,
          start,
          new HcmError(
            "INVALID_ARGUMENT",
            "Аргументы операции — не объект, или в них есть значение, которое нельзя скопировать.",
            "Нужно передать значения, совместимые с JSON; двоичные данные — как {base64: …}, XML — как {xml: …}.",
          ),
          { sent: false, effect: operationDefinition(id)?.effect ?? "unknown" },
        ),
      );
    }
    const run = this.queue.then(() => this.perform(id, snapshot, start));
    this.queue = run.catch(() => undefined);
    return run;
  }
  private effect(operation: OperationDefinition, args: Record<string, unknown>): OperationEffect {
    if (operation.id === "runtime.query") {
      const deferredArguments = Object.keys(args).length === 1 && typeof args.$ref === "string";
      return deferredArguments || args.query !== undefined ? "execute" : "read";
    }
    if (operation.id === "objects.patch" && args.preview === true) return "read";
    if (operation.id === "runtime.batch") {
      const steps = args.steps;
      if (!Array.isArray(steps)) return "unknown";
      const effects = steps.map((raw) => {
        const step = inputObject(raw, "step");
        const id = requiredString(step.id, "step.id");
        if (id === "runtime.batch")
          throw new HcmError("NESTED_BATCH", "Пакет внутри пакета не поддерживается.");
        return this.effect(
          this.describe(id),
          step.args === undefined ? {} : inputObject(step.args),
        );
      });
      if (effects.includes("unknown") || (effects.includes("write") && effects.includes("execute")))
        return "unknown";
      return effects.includes("execute") ? "execute" : effects.includes("write") ? "write" : "read";
    }
    return operation.profile === undefined
      ? operation.effect
      : getEffectiveNativeEffect(operation as NativeOperation, args);
  }
  private authorize(effect: OperationEffect): void {
    if ((effect === "write" || effect === "unknown") && !this.config.permissions.write)
      throw new HcmError(
        "WRITE_DISABLED",
        "Подключение не разрешает запись.",
        "Нужно право write: его включает владелец подключения в настройках подключения (permissions.write).",
        undefined,
        "not_sent",
      );
    if ((effect === "execute" || effect === "unknown") && !this.config.permissions.execute)
      throw new HcmError(
        "EXECUTE_DISABLED",
        "Подключение не разрешает выполнять код, функции и запросы XQuery на сервере.",
        "Нужно право execute: его включает владелец подключения в настройках подключения (permissions.execute).",
        undefined,
        "not_sent",
      );
  }
  private async perform(
    id: string,
    args: Record<string, unknown>,
    start: number,
    boundOutput = true,
    state: ExecutionState = { sent: false, effect: "read" },
  ): Promise<OperationResult> {
    try {
      const operation = this.describe(id);
      state.effect = operation.effect;
      validate(args, operation.inputSchema);
      state.effect = this.effect(operation, args);
      this.authorize(state.effect);
      if (operation.profile !== undefined) prepare(args, operation.inputSchema);
      const data = jsonSafe(await this.dispatch(id, args, state));
      const serialised = JSON.stringify(data);
      const failedBatch =
        id === "runtime.batch" &&
        data !== null &&
        typeof data === "object" &&
        "ok" in data &&
        data.ok === false;
      const failedCheck = id === "runtime.check" && (data as CheckData).summary.failed > 0;
      // The steps that failed are named in the error: the answers of a long batch are stored.
      const batch = data as unknown as {
        results: OperationResult[];
        completed: number;
        requested: number;
      };
      const failedSteps = failedBatch
        ? batch.results.flatMap((result, index) =>
            result.ok
              ? []
              : [{ index, id: result.meta.operationId, code: result.error?.code ?? "UNKNOWN" }],
          )
        : [];
      const outcome =
        failedBatch || failedCheck
          ? {
              ok: false,
              error: {
                code: failedCheck ? "CHECK_FAILED" : "BATCH_FAILED",
                message: failedCheck
                  ? `Проверка подключения не пройдена: ${(data as CheckData).checks
                      .filter((check) => check.result === "failed")
                      .map((check) => check.name)
                      .join(", ")}.`
                  : `Отказало шагов пакета: ${failedSteps.length} из ${batch.requested}${batch.requested > batch.completed ? `; после отказа не запускались: ${batch.requested - batch.completed}` : ""}. До повтора нужно посмотреть исход каждого шага.`,
                hint: failedCheck
                  ? ((data as CheckData).checks.find((check) => check.result === "failed")
                      ?.reason ?? "Причины — в data.checks.")
                  : "Номера и коды отказавших шагов — в error.details.failed, ответы шагов — в data.results.",
                retryable: false,
                ...(failedBatch
                  ? {
                      details: {
                        failed: failedSteps.slice(0, 20),
                        ...(failedSteps.length > 20 ? { failedTotal: failedSteps.length } : {}),
                      },
                    }
                  : {}),
              },
            }
          : { ok: true };
      if (
        boundOutput &&
        Buffer.byteLength(serialised ?? "null") > this.config.outputLimitBytes &&
        id !== "results.read" &&
        id !== "runtime.check"
      ) {
        const stored = await this.results.put(data);
        let preview = beginning(data);
        // Rows too long for a preview are dropped; counters and positions next to them stay.
        if (Buffer.byteLength(JSON.stringify(preview)) > this.config.outputLimitBytes / 2)
          preview = {
            kind: "stored-result",
            ...(data !== null && typeof data === "object" && !Array.isArray(data)
              ? Object.fromEntries(
                  Object.entries(data)
                    .slice(0, 40)
                    .map(([key, value]) => [
                      key,
                      Array.isArray(value)
                        ? id === "runtime.batch" && key === "results"
                          ? value.map(stepSummary)
                          : `[список: ${value.length}]`
                        : value !== null && typeof value === "object"
                          ? "{структура}"
                          : typeof value === "string" && value.length > 120
                            ? `${value.slice(0, 120)}…`
                            : value,
                    ]),
                )
              : {}),
          };
        return {
          ...outcome,
          ...(failedBatch && "error" in outcome
            ? {
                error: {
                  ...outcome.error,
                  hint: "Номера и коды отказавших шагов — в error.details.failed; ответы шагов сохранены, их читает results.read.",
                },
              }
            : {}),
          data: {
            preview,
            resultId: stored.resultId,
            hint: `Ответ не поместился и сохранён целиком: results.read читает ${stored.list === undefined ? "его частями" : `список ${stored.list} по элементам`}, results.export сохраняет в файл.`,
          },
          meta: {
            operationId: id,
            connection: this.config.name,
            durationMs: Math.round(performance.now() - start),
            truncated: true,
            resultId: stored.resultId,
            resultBytes: stored.bytes,
          },
        };
      }
      // The text of a log or a file is kept even when it fits: results.export saves it to a file.
      const kept =
        boundOutput && (id === "logs.read" || id === "files.read")
          ? await this.results.put(data).catch(() => undefined)
          : undefined;
      return {
        ...outcome,
        data,
        meta: {
          operationId: id,
          connection: this.config.name,
          durationMs: Math.round(performance.now() - start),
          ...(kept ? { resultId: kept.resultId } : {}),
        },
      };
    } catch (error) {
      const failure = this.failure(id, start, error, state);
      if (!state.batchRecovery) return failure;
      return { ...failure, data: this.batchRecoveryData(state.batchRecovery) };
    }
  }
  /** Local storage failure cannot erase already executed steps or label a sent batch not_sent. */
  private batchRecoveryData(recovery: BatchRecovery): Record<string, unknown> {
    const data: Record<string, unknown> = {
      partial: true,
      receiptOnly: true,
      completed: recovery.completed,
      requested: recovery.requested,
      sentMutationSteps: recovery.sentMutationSteps,
      receipts: [],
      omittedReceipts: recovery.receipts.length,
    };
    const receipts = data.receipts as Record<string, unknown>[];
    const budget = Math.floor(this.config.outputLimitBytes / 3);
    for (const receipt of recovery.receipts) {
      const compact = { ...receipt };
      // Very long URLs remain inspectable through the original batch input; never invent a shortened URL.
      if (typeof compact.url === "string" && compact.url.length > 256) delete compact.url;
      receipts.push(compact);
      data.omittedReceipts = recovery.receipts.length - receipts.length;
      if (Buffer.byteLength(JSON.stringify(data)) > budget) {
        receipts.pop();
        data.omittedReceipts = recovery.receipts.length - receipts.length;
        break;
      }
    }
    return data;
  }
  private failure(
    id: string,
    start: number,
    error: unknown,
    state?: ExecutionState,
  ): OperationResult {
    const redact = (message: string, limit = 500): string => {
      let safe = message;
      for (const secret of [
        this.config.password,
        this.config.username && this.config.password
          ? Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")
          : undefined,
      ])
        if (secret) safe = safe.replaceAll(secret, "[redacted]");
      return safe
        .replace(/\b[A-Za-z]:[\\/][^\r\n<>"']*/g, "[server-path]")
        .replace(/(?:SessionID|Authorization|Cookie)\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
        .slice(0, limit);
    };
    const normal =
      error instanceof HcmError
        ? error.toJSON()
        : error instanceof WebSocketHeartbeatError
          ? {
              code: error.errorCode,
              message: "Служба WebSocket не ответила на проверку.",
              hint: error.hint,
              retryable: false,
            }
          : error instanceof WsHcmApiError
            ? {
                code: `PLATFORM_${error.kind.toUpperCase()}`,
                ...platformFailure(error, this.config.baseUrl, state?.refusal ?? id),
                retryable: false,
                ...(error.status === undefined ? {} : { details: { status: error.status } }),
              }
            : error instanceof TypeError
              ? {
                  code: "INVALID_ARGUMENT",
                  message: error.message,
                  hint: "Аргументы операции описывает api.describe.",
                  retryable: false,
                }
              : {
                  code: "INTERNAL_ERROR",
                  message: "Операция не выполнена: внутренняя ошибка клиента.",
                  hint: "Проверить аргументы по api.describe. Если ошибка повторяется при верных аргументах, это дефект клиента.",
                  retryable: false,
                };
    // The server writes a refused request or a failed script to its log.
    if (
      (error instanceof WsHcmApiError && error.status === 500) ||
      (error instanceof HcmError && error.code === "SCRIPT_FAILED")
    )
      this.logs.serverWroteLog();
    // HTTP 401 is the server turning the request away at the door: nothing was run.
    // The same holds when the session could not be opened at all.
    // So does the server's refusal to call a function that is closed to clients or does not exist.
    const turnedAway =
      (error instanceof WsHcmApiError && error.status === 401) ||
      loginFailed(error) ||
      (error instanceof HcmError &&
        (error.code === "RPC_SERVER_ONLY" || error.code === "UNKNOWN_RPC_TARGET"));
    const mutationOutcome =
      state && state.effect !== "read"
        ? state.sent && !turnedAway
          ? ("indeterminate" as const)
          : ("not_sent" as const)
        : undefined;
    const trim = (value: unknown, depth = 0, limit = 256): unknown => {
      if (typeof value === "string") {
        const text = redact(value, limit + 1);
        return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
      }
      if (depth > 3) return "[details omitted]";
      if (Array.isArray(value)) return value.slice(0, 12).map((item) => trim(item, depth + 1));
      if (value !== null && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value)
            .slice(0, 12)
            // The caller fixes the code by the server's message: it is kept longer than the rest.
            .map(([key, item]) => [
              key.slice(0, 128),
              trim(item, depth + 1, key === "scriptError" ? 2048 : 256),
            ]),
        );
      return value;
    };
    // Generated correlation IDs and bounded numeric object IDs are recovery
    // receipts, not server diagnostics. Secret substring redaction must not
    // change them; a password can legitimately match a UUID digit or prefix.
    const trustedIds = {
      ...(state?.mutationId !== undefined &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(state.mutationId)
        ? { mutationId: state.mutationId }
        : {}),
      ...(state?.objectId !== undefined &&
      /^(?:[0-9]{1,20}|0[xX][0-9a-fA-F]{1,16})$/.test(state.objectId) &&
      BigInt(state.objectId) <= 0xffffffffffffffffn
        ? { objectId: state.objectId }
        : {}),
      ...(state?.executionId !== undefined && /^hcm_inline_[a-f0-9]{32}$/.test(state.executionId)
        ? { executionId: state.executionId }
        : {}),
    };
    let details: Record<string, unknown> = {
      ...(trim({
        ...normal.details,
        ...(state?.mutationId === undefined ? {} : { mutationId: state.mutationId }),
        ...(state?.objectId === undefined ? {} : { objectId: state.objectId }),
        ...(state?.url === undefined ? {} : { url: state.url }),
        ...(state?.executionId === undefined ? {} : { executionId: state.executionId }),
      }) as Record<string, unknown>),
      ...trustedIds,
    };
    if (Buffer.byteLength(JSON.stringify(details)) > this.config.outputLimitBytes / 4)
      details = {
        omitted: true,
        ...trustedIds,
      };
    const omitOversizedConnection = (value: OperationResult): OperationResult => {
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if (bytes <= this.config.outputLimitBytes) return value;
      const omitted: OperationResult = {
        ...value,
        meta: { ...value.meta, connection: "[omitted]", connectionOmitted: true },
      };
      // Direct SDK callers may supply a label beyond the configured profile
      // bounds. Omit the entire label before sacrificing useful diagnostics or
      // exact recovery/read receipts; a short ordinary label is retained.
      return Buffer.byteLength(JSON.stringify(omitted)) < bytes ? omitted : value;
    };
    const result: OperationResult = omitOversizedConnection({
      ok: false,
      error: {
        ...normal,
        // A platform failure is worded here from fixed text and the configured address; a password
        // that happens to be part of a word must not cut holes in it.
        ...(error instanceof WsHcmApiError
          ? {}
          : {
              message: redact(normal.message),
              ...(normal.hint === undefined ? {} : { hint: redact(normal.hint) }),
            }),
        ...(mutationOutcome === undefined ? {} : { mutationOutcome }),
        ...(Object.keys(details).length ? { details } : {}),
      },
      meta: {
        operationId: typeof id === "string" && id.length <= 128 ? id : "[invalid-operation]",
        connection: this.config.name,
        durationMs: Math.round(performance.now() - start),
      },
    });
    if (error instanceof WebSocketHeartbeatError) {
      // The dedicated constructor retains only bounded protocol observations.
      // Generic upstream details and close reasons never enter this receipt.
      const contextual: OperationResult = omitOversizedConnection({
        ...result,
        error: {
          ...result.error!,
          details: { ...result.error?.details, heartbeatReceipt: error.receipt },
        },
      });
      if (Buffer.byteLength(JSON.stringify(contextual)) <= this.config.outputLimitBytes)
        return contextual;
      const receipt = error.receipt;
      return {
        ...contextual,
        error: {
          ...contextual.error!,
          hint: "Проверить ответ heartbeat; автоматический повтор не выполняется.",
          details: {
            heartbeatReceiptFieldsOmitted: true,
            heartbeatReceipt: {
              route: receipt.route,
              phase: receipt.phase,
              ...(receipt.httpStatus === undefined ? {} : { httpStatus: receipt.httpStatus }),
              handshakeValidated: receipt.handshakeValidated,
              heartbeatWritten: receipt.heartbeatWritten,
              heartbeatObserved: receipt.heartbeatObserved,
              closeRequested: receipt.closeRequested,
              peerCloseObserved: receipt.peerCloseObserved,
              peerEofObserved: receipt.peerEofObserved,
              closeWriteVerified: false,
              localSocketDisposed: receipt.localSocketDisposed,
              forcedLocalTermination: receipt.forcedLocalTermination,
            },
          },
        },
      };
    }
    return result;
  }
  /** One object by id or url, as objects.get answers. */
  private async readObject(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const loaded = await this.load(args);
    const snapshot = loaded.document.snapshot();
    const data = withoutFalseOffset(projectFields(snapshot.data, args.fields)) as Record<
      string,
      unknown
    >;
    const absent = Array.isArray(args.fields)
      ? (args.fields as string[]).filter((field) => !Object.hasOwn(data, field))
      : [];
    // The form tells a repeated element from a single one, and an empty field from a wrong name.
    const shape =
      absent.length || hasStructure(data)
        ? await this.schemaReader
            .documentShape(snapshot.type, snapshot.formUrl)
            .catch(() => undefined)
        : undefined;
    // A field the server computes for the catalog (fullname) is not kept in the document.
    const row = await this.catalogRow(snapshot.type, loaded.url, loaded.id, absent);
    const unknownFields = shape?.fields.size
      ? absent.filter((field) => !shape.fields.has(field) && !row.known.has(field))
      : [];
    // Asked for, known to the form or the catalog, and without a value: empty, not forgotten.
    const emptyFields = shape?.fields.size
      ? absent.filter(
          (field) => !unknownFields.includes(field) && !Object.hasOwn(row.values, field),
        )
      : [];
    return {
      ...(loaded.id === undefined ? {} : { id: loaded.id }),
      type: snapshot.type,
      url: loaded.url,
      data: shape ? withRepeated(data, shape.repeated) : data,
      ...(Object.keys(row.values).length ? { fromCatalog: row.values } : {}),
      ...(emptyFields.length ? { emptyFields } : {}),
      ...(unknownFields.length ? { unknownFields } : {}),
      fingerprint: snapshot.fingerprint,
      ...(snapshot.formUrl === undefined ? {} : { formUrl: snapshot.formUrl }),
    };
  }
  private async load(
    args: Record<string, unknown>,
  ): Promise<{ document: XmlDocument; url: string; id: string | undefined }> {
    const url =
      args.url === undefined
        ? resolvePhysicalDocumentLocation(requiredString(args.id, "id")).url
        : requiredString(args.url, "url");
    const response = await this.gateway.call("native.lds.loadDoc", {
      url,
      useBinaryResponse: true,
    });
    const source = isBinary(response)
      ? new TextDecoder("utf-8", { fatal: true }).decode(response.bytes)
      : buildXml(findXmlNode(response, "Data") as XmlObject);
    let document: XmlDocument;
    try {
      document = XmlDocument.parse(source);
    } catch (error) {
      if (args.url === undefined || !(error instanceof HcmError)) throw error;
      throw new HcmError(
        error.code,
        error.message,
        "Если по адресу не документ объекта: файл читает files.read, поля формы — schema.get с url.",
      );
    }
    const snapshot = document.snapshot();
    const documentId =
      typeof snapshot.data.id === "string" && snapshot.data.id !== ""
        ? snapshot.data.id
        : undefined;
    const requested =
      args.id === undefined
        ? undefined
        : resolvePhysicalDocumentLocation(requiredString(args.id, "id")).objectId;
    if (
      requested !== undefined &&
      documentId !== undefined &&
      BigInt(resolvePhysicalDocumentLocation(documentId).objectId) !== BigInt(requested)
    )
      throw new HcmError(
        "TARGET_MISMATCH",
        "ID в прочитанном документе не совпадает с запрошенным.",
        "Нужно передать id и url одного объекта или что-то одно. Запись не отправлена.",
        undefined,
        "not_sent",
      );
    if (args.type !== undefined && snapshot.type !== identifier(args.type, "type"))
      throw new HcmError(
        "TYPE_MISMATCH",
        `Тип объекта — ${snapshot.type}, а не ${String(args.type)}.`,
        undefined,
        { actualType: snapshot.type },
      );
    // Some stock types keep no <id> in the document: the ID is then the requested one or the storage address.
    return { document, url, id: documentId ?? requested ?? parsePhysicalDocumentId(url) };
  }
  private async journal(entry: Record<string, unknown>): Promise<void> {
    await mkdir(this.results.directory, { recursive: true });
    await appendFile(
      join(this.results.directory, "mutations.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
  private async serverInfo(profile: ServerInfoProfile): Promise<ServerInfoData> {
    return parseServerInfo(
      await this.gateway.call(`${profile}.rpc.call`, {
        target: "ms_tools.get_admin_init_server_data",
        args: [],
      }),
      profile,
    );
  }
  private async applicationInfo(): Promise<Record<string, unknown>> {
    if (!this.appInfo || this.appInfo.expires < Date.now()) {
      const value = this.gateway.call("native.spxml2.getAppInfo", { fastStart: true });
      this.appInfo = { expires: Date.now() + 30000, value };
      value.catch(() => {
        if (this.appInfo?.value === value) this.appInfo = undefined;
      });
    }
    return inputObject(await this.appInfo.value, "сведения о приложении");
  }
  private async resolveCatalog(type: string, documentUrl?: string): Promise<string | undefined> {
    const info = await this.applicationInfo();
    let dbName = typeof info.default_db_name === "string" ? info.default_db_name : undefined;
    if (documentUrl) {
      const url = new URL(documentUrl);
      if (url.protocol === "x-local:") dbName = url.hostname;
    }
    if (dbName === undefined || !Array.isArray(info.databases)) return undefined;
    const db = info.databases.find(
      (value) => value && typeof value === "object" && "id" in value && value.id === dbName,
    );
    if (!db || typeof db !== "object" || !("catalogs" in db) || !Array.isArray(db.catalogs))
      return undefined;
    const named = (value: unknown, objectType: string, id?: string): boolean =>
      !!value &&
      typeof value === "object" &&
      "object_type" in value &&
      value.object_type === objectType &&
      "id" in value &&
      typeof value.id === "string" &&
      (id === undefined || value.id === id);
    let matches = db.catalogs.filter((value: unknown) => named(value, type));
    // For some types (event) the server leaves the catalog without its object type.
    if (!matches.length)
      matches = db.catalogs.filter((value: unknown) => named(value, "", `${type}s`));
    return matches.length === 1 ? identifier(inputObject(matches[0]).id, "catalog") : undefined;
  }
  /**
   * Values of the named fields in the catalog row of an object. `known` holds the names that are
   * fields of the catalog, whether the row has a value for them or not.
   */
  private async catalogRow(
    type: string,
    url: string,
    id: string | undefined,
    names: readonly string[],
  ): Promise<{ values: Record<string, unknown>; known: Set<string> }> {
    const none = { values: {}, known: new Set<string>() };
    if (!names.length || id === undefined) return none;
    try {
      const catalog = await this.resolveCatalog(type, url);
      if (!catalog) return none;
      const shape = await this.schemaReader.catalogShape({ catalog });
      const known = new Set(names.filter((name) => shape?.fields.has(name)));
      if (!known.size) return none;
      const response = await this.gateway.call("native.lds.xQuery", {
        query: `for $elem in ${catalog} where $elem/id = ${resolvePhysicalDocumentLocation(id).objectId} return $elem`,
        maxCount: 1,
        expectToReadAll: false,
        keepCursor: false,
      });
      const [item] = queryPage(response, 0, 1, [...known], false).items;
      const values = Object.fromEntries(
        Object.entries(withoutFalseOffset(item ?? {}) as object).filter(([name]) =>
          known.has(name),
        ),
      );
      return { values, known };
    } catch {
      return none;
    }
  }
  private async catalogHasId(catalog: string, id: string): Promise<boolean> {
    const lexicalId = resolvePhysicalDocumentLocation(id).objectId;
    const response = await this.gateway.call("native.lds.xQuery", {
      query: `for $elem in ${catalog} where $elem/id = ${lexicalId} return $elem`,
      maxCount: 2,
      expectToReadAll: false,
      keepCursor: false,
    });
    const data = cleanXmlValue(findXmlNode(response, "Data"));
    return (
      data !== null &&
      typeof data === "object" &&
      Object.values(data).some((value) => (Array.isArray(value) ? value.length > 0 : value !== ""))
    );
  }
  /**
   * Date and integer fields of the catalog, read only when a condition holds a value written as a
   * date or as a decimal ID: such a value must reach a date field as date('…') and an integer field
   * as a number, and the form is the only place that tells them from strings.
   */
  private async typedFields(
    catalog: unknown,
    where: unknown,
  ): Promise<{ dates: ReadonlySet<string>; integers: ReadonlySet<string> }> {
    const none = { dates: new Set<string>(), integers: new Set<string>() };
    if (typeof catalog !== "string" || !where || typeof where !== "object") return none;
    const values = Object.values(where).flatMap((condition) =>
      condition && typeof condition === "object" ? Object.values(condition).flat() : [condition],
    );
    if (!values.some((value) => looksLikeDate(value) || looksLikeDecimalId(value))) return none;
    const shape = await this.schemaReader.catalogShape({ catalog }).catch(() => undefined);
    return { dates: shape?.dates ?? none.dates, integers: shape?.integers ?? none.integers };
  }
  /**
   * What the server would not keep is refused before the write: a field the type does not have is
   * dropped from the saved document, as is a value for a field the server computes, and a date the
   * server cannot read is stored as another value.
   */
  private async requireFields(
    type: string,
    formUrl: string | undefined,
    data: Record<string, unknown>,
    names: readonly string[],
  ): Promise<void> {
    const shape = await this.schemaReader.documentShape(type, formUrl).catch(() => undefined);
    if (!shape) return;
    const written = [...new Set(names)];
    const unknown =
      shape.fields.size && !shape.partial ? written.filter((name) => !shape.fields.has(name)) : [];
    if (unknown.length) {
      const near = [...shape.fields]
        .filter((field) =>
          unknown.some(
            (name) =>
              (name.length > 3 && field.includes(name)) ||
              (field.length > 3 && name.includes(field)) ||
              oneEditApart(field, name),
          ),
        )
        .slice(0, 5);
      throw new HcmError(
        "UNKNOWN_FIELD",
        `У типа ${type} нет поля: ${unknown.join(", ")}.`,
        `${near.length ? `Похожие: ${near.join(", ")}. ` : ""}Поля типа показывает schema.get.`,
        { fields: unknown },
      );
    }
    const computed = written.filter((name) => shape.computed?.has(name));
    if (computed.length)
      throw new HcmError(
        "INVALID_ARGUMENT",
        `${computed.join(", ")}: значение вычисляет сервер, записать его нельзя.`,
        "Менять нужно поля, из которых сервер его складывает. Вычисляемые поля в schema.get помечены computed:true.",
        { fields: computed },
      );
    const wrong = written.filter((name) => {
      const value = data[name];
      return shape.dates.has(name) && typeof value === "string" && value && !isServerDate(value);
    });
    if (wrong.length)
      throw new HcmError(
        "INVALID_ARGUMENT",
        `${wrong.join(", ")}: дата записана не так, как её читает сервер.`,
        'Писать нужно "2026-12-05" или "2026-12-05T09:30:00". Время — местное время сервера: смещение в значении сервер не учитывает.',
        { fields: wrong },
      );
  }
  private async dispatch(
    id: string,
    args: Record<string, unknown>,
    state: ExecutionState,
  ): Promise<unknown> {
    switch (id) {
      case "runtime.check":
        return checkServer(this.config, (operation, input) =>
          this.dispatch(operation, input, { sent: false, effect: "read" }),
        );
      case "files.exists": {
        const request = {
          target: FILE_EXISTS_TARGET,
          args: [{ valueType: "string", lexicalValue: fileExistsUrl(args.url) }],
        };
        prepare(request, this.describe("native.rpc.call").inputSchema);
        state.sent = true;
        return parseFileExists(await this.gateway.call("native.rpc.call", request));
      }
      case "files.read":
        return fileContent(
          await this.gateway.call("native.lds.loadUrl", { url: requiredString(args.url, "url") }),
          args.encoding,
        );
      case "files.list": {
        const folder = fileTarget(args.url, true).url;
        const search = args.search === undefined ? "" : requiredString(args.search, "search");
        const { request, executionId } = codeList(folder);
        const data = await this.runCode(request, executionId, state);
        if (data.result[0] === "none") state.sent = false;
        return fileList(data, folder, search);
      }
      case "files.write":
      case "files.delete": {
        const writing = id === "files.write";
        const target = fileTarget(args.url);
        if (!writing) assertFileDeletable(target.folder);
        const content = writing ? fileWriteContent(args) : undefined;
        const route = fileRoute(
          writing ? "write" : "delete",
          fileFolders(await this.applicationInfo().catch(() => undefined)),
          target.folder,
          this.config.permissions.execute,
        );
        // The usual cause of a refused write (an unlisted code folder) is named only where the server did not list folders.
        if (writing && route !== "unlisted") state.refusal = "files.write:listed";
        if (route === "code") {
          const { request, executionId } = content
            ? codeWrite(target.url, content)
            : codeDelete(target.url);
          const data = await this.runCode(request, executionId, state);
          if (content) return { bytes: Number(data.result[0]), mutationOutcome: "confirmed" };
          const refusal = codeDeleteRefusal(data);
          if (refusal) {
            state.sent = false;
            throw refusal;
          }
          if (data.result[0] === "remains") throw fileRemains();
          return { deleted: true, mutationOutcome: "confirmed" };
        }
        state.sent = true;
        if (content) {
          await this.gateway.call("native.lds.putUrl", {
            url: target.url,
            data: { base64: content.base64 },
          });
          return { bytes: content.bytes, mutationOutcome: "confirmed" };
        }
        await this.gateway.call("native.lds.deleteUrl", { url: target.url });
        // An address the existence check does not accept (over 256 characters) is not checked.
        const { url } = target;
        if (url.length <= FILE_EXISTS_URL_MAX_LENGTH)
          if (((await this.dispatch("files.exists", { url }, state)) as { exists: boolean }).exists)
            throw fileRemains();
        return { deleted: true, mutationOutcome: "confirmed" };
      }
      case "server.info": {
        const info = await this.serverInfo(args.profile === "web" ? "web" : "native");
        const folders =
          info.profile === "native"
            ? fileFolders(await this.applicationInfo().catch(() => undefined))
            : undefined;
        return folders ? { ...info, dataFolders: folders.data, codeFolders: folders.code } : info;
      }
      case "runtime.status": {
        const version = await this.gateway.call("native.rpc.call", {
          target: "tools.get_version",
          args: [{ valueType: "string", lexicalValue: "wtv" }],
        });
        // The server names the document of the signed-in user; without it the answer just lacks userId.
        const info = await this.applicationInfo().catch(() => undefined);
        const userId =
          typeof info?.auth_object_url === "string"
            ? parsePhysicalDocumentId(info.auth_object_url)
            : undefined;
        const database = (await this.serverInfo("native").catch(() => undefined))?.database;
        return {
          connection: this.config.name,
          baseUrl: this.config.baseUrl,
          version: scalar(findXmlNode(version, "Result"), "версии"),
          ...(database ? { database } : {}),
          ...(userId ? { userId } : {}),
          operationCount: operations.length,
          permissions: this.config.permissions,
        };
      }
      case "runtime.query": {
        if (args.query !== undefined && args.catalog !== undefined)
          throw new HcmError("QUERY_ARGUMENT", "Нужно указать query или catalog, но не оба.");
        if (args.query !== undefined && args.order !== undefined)
          throw new HcmError(
            "QUERY_ARGUMENT",
            "order работает с catalog.",
            "В тексте XQuery сортировку пишут сами: order by $e/поле.",
          );
        if (typeof args.catalog === "string" && /^[A-Za-z_]\w*\.[\w.]+$/.test(args.catalog))
          throw new HcmError(
            "UNKNOWN_CATALOG",
            `${args.catalog} — общий список сервера, а не каталог.`,
            `Его элементы читает запрос XQuery: for $e in ${args.catalog} return $e.`,
          );
        const typed =
          args.query === undefined ? await this.typedFields(args.catalog, args.where) : undefined;
        const query = typed
          ? catalogQuery(args.catalog, args.where, typed.dates, args.order, typed.integers)
          : requiredString(args.query, "query");
        if (args.query === undefined && args.order !== undefined) {
          // MS SQL refuses to sort by a field of several values, PostgreSQL sorts somehow.
          const shape = await this.schemaReader
            .catalogShape({ catalog: requiredString(args.catalog, "catalog") })
            .catch(() => undefined);
          const repeated = orderFields(args.order)
            .map((item) => item.field)
            .filter((field) => shape?.repeated.has(field));
          if (repeated.length)
            throw new HcmError(
              "INVALID_ARGUMENT",
              `order: поле хранит несколько значений, сортировать по нему нельзя: ${repeated.join(", ")}.`,
              "Нужно выбрать поле с одним значением: у такого в schema.get нет multiple:true.",
              { fields: repeated },
            );
        }
        const limit = boundedInteger(args.limit, 20, 1000, "limit");
        if (limit === 0)
          throw new HcmError("INVALID_ARGUMENT", "limit: нужно целое число от 1 до 1000.");
        const startPos = boundedInteger(args.startPosition, 0, 1000000, "startPosition");
        // A query only reads, except one that hands SQL text to the database.
        if (args.query !== undefined) {
          if (/^\s*sql\s*:/i.test(query)) state.sent = true;
          else state.effect = "read";
        }
        let response: unknown;
        try {
          response = await this.gateway.call("native.lds.xQuery", {
            query,
            startPos,
            maxCount: limit,
            expectToReadAll: false,
            keepCursor: false,
          });
        } catch (error) {
          const refused = error instanceof WsHcmApiError && error.kind === "soap-fault";
          let reason: HcmError | undefined;
          // The refusal is in the server log whatever name it gets here: a log read waits for it.
          if (refused) this.logs.serverWroteLog();
          if (refused)
            for (const [catalog, fields] of args.query === undefined
              ? [
                  [
                    requiredString(args.catalog, "catalog"),
                    [
                      ...Object.keys(inputObject(args.where ?? {}, "where")),
                      ...orderFields(args.order).map((item) => item.field),
                    ],
                  ] as const,
                ]
              : xqueryNames(query)) {
              reason = await this.schemaReader.explainQuery(catalog, fields).catch(() => undefined);
              if (reason) break;
            }
          throw reason ?? error;
        }
        const read = queryPage(response, startPos, limit, args.fields, args.query !== undefined);
        const page = { ...read, items: read.items.map(withoutFalseOffset) as typeof read.items };
        // An empty database table lets a wrong catalog name through: the answer is empty, not refused.
        if (!page.items.length && args.query === undefined) {
          const missing = await this.schemaReader
            .explainQuery(requiredString(args.catalog, "catalog"), [])
            .catch(() => undefined);
          if (missing) throw missing;
        }
        const requested = Array.isArray(args.fields) ? (args.fields as string[]) : [];
        // Asked for and present in no row: empty in these rows, or not a field of the catalog.
        // On an empty page of a catalog search every asked name is checked against the catalog.
        const absent = page.items.length
          ? requested.filter((field) => page.items.every((item) => !Object.hasOwn(item, field)))
          : args.query === undefined
            ? requested
            : [];
        const lacking = page.items.some((item) =>
          requested.some((field) => !Object.hasOwn(item, field)),
        );
        if (!absent.length && !lacking && !page.items.some(hasStructure)) return page;
        const shape = await this.schemaReader
          .catalogShape(
            args.query === undefined
              ? { catalog: requiredString(args.catalog, "catalog") }
              : { type: rowTag(response) ?? "" },
          )
          .catch(() => undefined);
        if (!shape) return page;
        const unknownFields = shape.fields.size
          ? absent.filter((field) => !shape.fields.has(field))
          : [];
        // The server leaves an empty field out of a row. A field asked by name comes back anyway,
        // empty: a row then has the same columns as the next one.
        // A field that holds a structure is left as the server gave it.
        const asked = requested.filter(
          (field) =>
            shape.fields.has(field) &&
            ![...shape.repeated].some((path) => path.startsWith(`${field}.`)),
        );
        return {
          ...page,
          items: page.items.map((item) => {
            const row = withRepeated(item, shape.repeated) as Record<string, unknown>;
            for (const field of asked)
              if (!Object.hasOwn(row, field)) row[field] = shape.repeated.has(field) ? [] : "";
            return row;
          }),
          ...(unknownFields.length
            ? {
                unknownFields,
                hint: [
                  page.hint,
                  "Полей из unknownFields нет в строке каталога. Поле документа читает objects.get.",
                ]
                  .filter(Boolean)
                  .join(" "),
              }
            : {}),
        };
      }
      case "objects.get": {
        if (args.ids === undefined) return this.readObject(args);
        // Several objects in one call: each is read as a single one, a missing one does not stop the rest.
        const ids = args.ids;
        if (args.id !== undefined || args.url !== undefined)
          throw new HcmError("INVALID_ARGUMENT", "ids: вместе с id или url не задаётся.");
        if (
          !Array.isArray(ids) ||
          ids.length < 1 ||
          ids.length > 100 ||
          ids.some((id) => typeof id !== "string")
        )
          throw new HcmError("INVALID_ARGUMENT", "ids: список от 1 до 100 ID, каждый строкой.");
        const items: unknown[] = [];
        let failed = 0;
        for (const id of ids as string[]) {
          try {
            items.push(await this.readObject({ type: args.type, fields: args.fields, id }));
          } catch (error) {
            const refusal = this.failure("objects.get", performance.now(), error).error!;
            // A server that does not answer or refuses the login is not about one object.
            if (/^PLATFORM_(?!SOAP-FAULT)/.test(refusal.code)) throw error;
            failed++;
            items.push({ id, error: { code: refusal.code, message: refusal.message } });
          }
        }
        return {
          items,
          total: items.length,
          ...(failed
            ? { failed, hint: "PLATFORM_SOAP-FAULT у элемента: обычно объекта с таким ID нет." }
            : {}),
        };
      }
      case "objects.create": {
        const type = identifier(args.type, "type");
        const data = inputObject(args.data, "data");
        if (data.id !== undefined)
          throw new HcmError(
            "IMMUTABLE_ID",
            "ID новому объекту выдаёт сервер: нужно убрать id из data.",
          );
        if (!Object.keys(data).length)
          throw new HcmError(
            "INVALID_ARGUMENT",
            "data: нет ни одного поля.",
            "Нужно передать поля нового объекта, например {name: '…'}; значения по умолчанию сервер подставит сам.",
          );
        XmlDocument.create(type, data).snapshot();
        if (args.formUrl === undefined) await this.schemaReader.requireType(type);
        const formUrl =
          args.formUrl === undefined
            ? `x-local://wtv/wtv_${type}.xmd`
            : requiredString(args.formUrl, "formUrl");
        const form = await this.schemaReader.documentForm(formUrl);
        if (!Array.isArray(form.roots) || !form.roots.includes(type))
          throw new HcmError("FORM_TYPE_MISMATCH", "В форме нет запрошенного типа объекта.");
        await this.requireFields(type, formUrl, data, Object.keys(data));
        const dbName = args.dbName === undefined ? "wt_data" : identifier(args.dbName, "dbName");
        const mutationId = randomUUID();
        state.mutationId = mutationId;
        await this.journal({ mutationId, operation: id, stage: "allocating", type });
        state.sent = true;
        const allocated = await this.gateway.call("native.lds.getNewObjectId", { dbName });
        const location = resolvePhysicalDocumentLocation(
          scalar(findXmlNode(allocated, "ObjectID"), "ObjectID"),
          dbName,
        );
        state.objectId = location.objectId;
        state.url = location.url;
        const snapshot = XmlDocument.create(
          type,
          { id: location.objectId, ...data },
          formUrl,
        ).snapshot();
        await this.journal({
          mutationId,
          operation: id,
          stage: "prepared",
          objectId: location.objectId,
        });
        state.sent = true;
        state.mutationId = mutationId;
        await this.gateway.call("native.lds.putDoc", {
          url: location.url,
          data: snapshot.xml,
          writeDocInfo: true,
          neverSaved: true,
        });
        const loaded = await this.load({ url: location.url, type });
        const result = loaded.document.snapshot();
        if (
          BigInt(requiredString(loaded.id, "ID при проверочном чтении")) !==
          BigInt(location.objectId)
        )
          throw new HcmError(
            "READ_BACK_MISMATCH",
            "При проверочном чтении ID созданного объекта не совпал с выданным.",
            undefined,
            { mutationId },
            "indeterminate",
          );
        verifyFields(snapshot.data, result.data, form.fields, Object.keys(data));
        await this.journal({
          mutationId,
          operation: id,
          stage: "verified",
          objectId: location.objectId,
        });
        return {
          id: location.objectId,
          url: location.url,
          type,
          fingerprint: result.fingerprint,
          mutationId,
          mutationOutcome: "confirmed",
        };
      }
      case "objects.patch": {
        const loaded = await this.load(args);
        const changes = loaded.document.patch(
          patchInput(args.patch, args.remove, args.resave === true),
        );
        if (
          args.expectedFingerprint !== undefined &&
          args.expectedFingerprint !== changes.before.fingerprint
        )
          throw new HcmError(
            "CONFLICT",
            "Объект изменился после чтения: его fingerprint не равен expectedFingerprint.",
            "Прочитать объект заново и составить изменение по его текущему состоянию.",
            undefined,
            "not_sent",
          );
        // Checked before the preview too: a preview must not promise what the write will refuse.
        await this.requireFields(
          changes.before.type,
          changes.before.formUrl,
          changes.after.data,
          changes.changes
            .filter((change) => inputObject(change).op === "set")
            .map((change) => patchSegments(String(inputObject(change).path))[0]![1]!),
        );
        const noop = changes.before.fingerprint === changes.after.fingerprint;
        // Nothing to change means nothing is sent, unless the caller asks to save the document as
        // it is: the server then fills in again the fields it computes when a document is saved.
        if (args.preview === true || (noop && args.resave !== true))
          return {
            preview: args.preview === true,
            noop: noop && args.resave !== true,
            changes: changes.changes,
            fingerprint: changes.before.fingerprint,
          };
        const current = await this.load(args);
        if (current.document.snapshot().fingerprint !== changes.before.fingerprint)
          throw new HcmError(
            "CONFLICT",
            "Объект изменился, пока готовилась запись.",
            undefined,
            undefined,
            "not_sent",
          );
        const form = await this.schemaReader.documentForm(
          changes.before.formUrl ?? `x-local://wtv/wtv_${changes.before.type}.xmd`,
        );
        const branches = changes.changes.map(
          (change) => patchSegments(String(inputObject(change).path))[0]![1]!,
        );
        const mutationId = randomUUID();
        await this.journal({
          mutationId,
          operation: id,
          stage: "prepared",
          fingerprint: changes.before.fingerprint,
        });
        state.sent = true;
        state.mutationId = mutationId;
        state.url = loaded.url;
        if (loaded.id !== undefined) state.objectId = loaded.id;
        await this.gateway.call("native.lds.putDoc", {
          url: loaded.url,
          data: changes.after.xml,
          writeDocInfo: true,
        });
        const verified = await this.load(args);
        const snapshot = verified.document.snapshot();
        verifyFields(changes.after.data, snapshot.data, form.fields, branches, changes.before.xml);
        verifyRemovals(changes.after.data, snapshot.data, changes.changes, form.fields);
        await this.journal({
          mutationId,
          operation: id,
          stage: "verified",
          fingerprint: snapshot.fingerprint,
        });
        // Fields outside the patch that differ after the save are the server's own work.
        const serverChanged = Object.keys({ ...changes.after.data, ...snapshot.data }).filter(
          (key) =>
            key !== "doc_info" &&
            !branches.includes(key) &&
            JSON.stringify(changes.after.data[key]) !== JSON.stringify(snapshot.data[key]),
        );
        return {
          ...(verified.id === undefined ? {} : { id: verified.id }),
          type: snapshot.type,
          url: loaded.url,
          fingerprint: snapshot.fingerprint,
          changes: changes.changes,
          ...(serverChanged.length ? { serverChanged: serverChanged.slice(0, 20) } : {}),
          mutationId,
          mutationOutcome: "confirmed",
        };
      }
      case "objects.delete": {
        if (args.permanent !== true)
          throw new HcmError(
            "DELETE_MODE_REQUIRED",
            "Объект удаляется безвозвратно: для этого нужен permanent:true.",
            "Корзины у этой операции нет.",
            undefined,
            "not_sent",
          );
        const loaded = await this.load(args);
        const snapshot = loaded.document.snapshot();
        const objectId = requiredString(loaded.id, "ID объекта");
        const catalog =
          args.catalog === undefined
            ? await this.resolveCatalog(snapshot.type, loaded.url)
            : identifier(args.catalog, "catalog");
        if (catalog !== undefined && !(await this.catalogHasId(catalog, objectId)))
          throw new HcmError(
            "CATALOG_MISMATCH",
            "Объекта нет в каталоге, по которому проверяется удаление.",
            "Нужно указать каталог, в котором объект есть. Запрос на удаление не отправлен.",
            undefined,
            "not_sent",
          );
        const mutationId = randomUUID();
        await this.journal({ mutationId, operation: id, stage: "prepared", objectId });
        state.sent = true;
        state.mutationId = mutationId;
        state.objectId = objectId;
        state.url = loaded.url;
        await this.gateway.call("native.lds.deleteDoc", { url: loaded.url, strictDelete: true });
        if (catalog !== undefined && (await this.catalogHasId(catalog, objectId)))
          throw new HcmError(
            "READ_BACK_MISMATCH",
            "После удаления объект всё ещё есть в каталоге.",
            "Перед повтором удаления прочитать объект. Причину сервер пишет в лог spxml_unibridge.",
            undefined,
            "indeterminate",
          );
        await this.journal({
          mutationId,
          operation: id,
          stage: catalog === undefined ? "acknowledged" : "verified-absence",
          objectId,
        });
        return {
          id: objectId,
          mutationId,
          mutationOutcome: "confirmed",
          verification: catalog === undefined ? "server acknowledgement" : "catalog absence",
          ...(catalog === undefined ? {} : { catalog }),
        };
      }
      case "schema.get":
        return this.schemaReader.get(args as SchemaInput);
      case "schema.types":
        return this.schemaReader.types(args as SchemaTypesInput);
      case "logs.list":
        return logFiles(await this.logs.list(args));
      case "logs.read": {
        // Without an explicit size the answer is the end of the file that fits one reply.
        const input = (args.tailBytes === undefined && args.full !== true
          ? { ...args, tailBytes: this.pageBytes }
          : args) as unknown as LogReadInput;
        return logText(await this.logs.read(input));
      }
      case "logs.search":
        return logMatches(
          await this.logs.search(args as unknown as LogSearchInput),
          this.pageBytes,
        );
      case "logs.follow":
        return logNews(
          await this.logs.follow(args as unknown as LogFollowInput),
          args.cursor === undefined,
          this.pageBytes,
        );
      case "results.read":
        return this.results.read(
          requiredString(args.resultId, "resultId"),
          args.offset,
          args.limit,
          args.format,
        );
      case "results.export":
        return this.results.export(args as unknown as import("./results.js").ResultExportInput);
      case "rpc.list":
        return this.rpcCatalog.list(args);
      case "rpc.describe":
        return this.rpcCatalog.describe(requiredString(args.targetId, "targetId"), args);
      case "rpc.call": {
        const target = `${identifier(args.library, "library")}.${identifier(args.method, "method")}`;
        const supplied = args.arguments ?? [];
        if (!Array.isArray(supplied))
          throw new HcmError("INVALID_ARGUMENT", "arguments: нужен массив.");
        const encoded = supplied.map((value) => {
          if (value !== null && typeof value === "object")
            return inputObject(value, "аргумент функции");
          if (value === null) return { valueType: "null", lexicalValue: "" };
          if (typeof value === "string") return { valueType: "string", lexicalValue: value };
          if (typeof value === "boolean")
            return { valueType: "bool", lexicalValue: value ? "1" : "0" };
          if (typeof value === "number" && Number.isSafeInteger(value))
            return { valueType: "integer", lexicalValue: String(value) };
          throw new HcmError(
            "INVALID_RPC_ARGUMENT",
            "Такой аргумент функции задаётся явно: {valueType, lexicalValue}. Так передают дробные и большие числа, даты, объекты и XML.",
          );
        });
        const operationId = args.async === true ? "web.spxml.callMethodAsync" : "native.rpc.call";
        const nativeArgs = { target, args: encoded };
        try {
          prepare(nativeArgs, this.describe(operationId).inputSchema);
        } catch (error) {
          // The caller wrote arguments[i]; the wire name of the list is not theirs to know.
          const index = error instanceof TypeError && /^args\.args\[(\d+)\]/.exec(error.message);
          if (!index) throw error;
          throw new HcmError(
            "INVALID_RPC_ARGUMENT",
            `arguments[${index[1]}]: объект должен быть вида {valueType, lexicalValue}.`,
            "Строки, целые числа, true, false и null передаются как есть. Остальное — явно: {valueType:'date', lexicalValue:'2026-10-01T00:00:00'}, {valueType:'integer', lexicalValue:'6148914691236517121'}, {valueType:'real', lexicalValue:'1.5'}.",
          );
        }
        for (const argument of encoded)
          if (typeof argument.lexicalValue === "string") escapeXml(argument.lexicalValue);
        state.sent = true;
        let response: unknown;
        try {
          response = await this.gateway.call(operationId, nativeArgs);
        } catch (error) {
          // The server gives no reason; a misspelt name or a function closed to clients is the usual one.
          if (error instanceof WsHcmApiError && error.status === 500) {
            this.logs.serverWroteLog();
            const reason = await this.rpcCatalog.refusal(target).catch(() => undefined);
            if (reason) throw reason;
          }
          throw error;
        }
        return args.async === true ? withoutXmlFormatting(response) : rpcValue(response);
      }
      case "execute.script":
      case "agents.run": {
        const agent = id === "agents.run" ? agentRun(args) : undefined;
        const { request, executionId } = agent
          ? prepareScript(agent.code, agent.params)
          : prepareScript(args.code, args.params);
        const data = await this.runCode(request, executionId, state);
        if (!agent) return data;
        // The agent has just written its lines: a log read that follows waits for the server.
        this.logs.serverWroteLog();
        return agentRunResult(data);
      }
      case "runtime.batch":
        return this.batch(args, state);
      default:
        state.sent = state.effect !== "read";
        try {
          return plainAnswer(id, withoutXmlFormatting(await this.gateway.call(id, args)));
        } catch (error) {
          if (error instanceof WsHcmApiError && error.requestSent === false) state.sent = false;
          throw error;
        }
    }
  }
  /** Code prepared by prepareScript, run on the server; the answer is checked for a caught error. */
  private async runCode(
    request: Record<string, unknown>,
    executionId: string,
    state: ExecutionState,
  ) {
    prepare(request, this.describe("web.rpc.call").inputSchema);
    state.executionId = executionId;
    state.sent = true;
    try {
      return scriptResult(await this.gateway.call("web.rpc.call", request), executionId);
    } catch (error) {
      // The server refused to read the code, so none of it ran.
      if (error instanceof HcmError && error.mutationOutcome === "not_sent") state.sent = false;
      throw error;
    }
  }
  private async batch(args: Record<string, unknown>, state: ExecutionState): Promise<unknown> {
    if (!Array.isArray(args.steps) || args.steps.length === 0 || args.steps.length > 100)
      throw new HcmError("INVALID_BATCH", "steps: в пакете должно быть от 1 до 100 шагов.");
    const labels = new Set<string>();
    for (const [index, raw] of args.steps.entries()) {
      const at = `steps[${index}]`;
      const step = inputObject(raw, at);
      const stepId = requiredString(step.id, `${at}.id`);
      if (stepId === "runtime.batch")
        throw new HcmError("NESTED_BATCH", "Пакет внутри пакета не поддерживается.");
      this.describe(stepId);
      if (step.args !== undefined) inputObject(step.args, `${at}.args`);
      if (step.as !== undefined) {
        const label = identifier(step.as, `${at}.as`);
        if (labels.has(label))
          throw new HcmError(
            "DUPLICATE_STEP",
            `${at}.as: имя ${label} уже дано другому шагу; имена шагов пакета не повторяются.`,
            undefined,
            { path: `${at}.as` },
            "not_sent",
          );
        labels.add(label);
      }
    }
    const named = new Map<string, OperationResult>();
    const results: OperationResult[] = [];
    const recovery: BatchRecovery = {
      completed: 0,
      requested: args.steps.length,
      sentMutationSteps: 0,
      receipts: [],
    };
    state.batchRecovery = recovery;
    const resolveRefs = (value: unknown, depth = 0): unknown => {
      if (depth > 32)
        throw new HcmError("REFERENCE_DEPTH", "Аргументы шага вложены глубже 32 уровней.");
      if (Array.isArray(value)) return value.map((item) => resolveRefs(item, depth + 1));
      if (value === null || typeof value !== "object") return value;
      const record = inputObject(value);
      if (Object.keys(record).length === 1 && typeof record.$ref === "string") {
        const [stepName, ...path] = record.$ref.split(".");
        let result: unknown = named.get(stepName!);
        for (const key of path) {
          if (
            ["__proto__", "constructor", "prototype"].includes(key) ||
            result === null ||
            typeof result !== "object" ||
            !Object.hasOwn(result, key)
          )
            throw new HcmError(
              "INVALID_REFERENCE",
              "Ссылка $ref не находит значение: такого шага раньше не было, или в его результате нет такого поля.",
            );
          result = (result as Record<string, unknown>)[key];
        }
        if (result === undefined)
          throw new HcmError(
            "INVALID_REFERENCE",
            "Ссылка $ref называет шаг, которого раньше в пакете не было.",
          );
        return result;
      }
      return Object.fromEntries(
        Object.entries(record).map(([key, item]) => [key, resolveRefs(item, depth + 1)]),
      );
    };
    for (const raw of args.steps) {
      const step = inputObject(raw, "step");
      const stepId = requiredString(step.id, "step.id");
      let result: OperationResult;
      const childState: ExecutionState = { sent: false, effect: "read" };
      try {
        const resolved =
          step.args === undefined ? {} : inputObject(resolveRefs(step.args), "step.args");
        result = await this.perform(stepId, resolved, performance.now(), false, childState);
      } catch (error) {
        result = this.failure(stepId, performance.now(), error);
      }
      if (childState.sent && childState.effect !== "read") {
        state.sent = true;
        recovery.sentMutationSteps++;
      }
      // A named step carries its name: answers are matched to steps without counting positions.
      results.push(
        typeof step.as === "string" ? ({ as: step.as, ...result } as OperationResult) : result,
      );
      recovery.completed = results.length;
      const returned =
        result.data !== null && typeof result.data === "object"
          ? (result.data as Record<string, unknown>)
          : undefined;
      recovery.receipts.push({
        index: results.length - 1,
        operationId: stepId,
        ok: result.ok,
        ...(result.error === undefined
          ? {}
          : {
              errorCode: result.error.code,
              ...(result.error.mutationOutcome === undefined
                ? {}
                : { mutationOutcome: result.error.mutationOutcome }),
            }),
        ...(returned?.mutationOutcome === "confirmed" ? { mutationOutcome: "confirmed" } : {}),
        ...(childState.mutationId === undefined ? {} : { mutationId: childState.mutationId }),
        ...(childState.objectId === undefined ? {} : { objectId: childState.objectId }),
        ...(childState.executionId === undefined ? {} : { executionId: childState.executionId }),
        ...(childState.url === undefined ? {} : { url: childState.url }),
      });
      if (step.as !== undefined) named.set(identifier(step.as, "step.as"), result);
      if (!result.ok && args.stopOnError !== false) break;
    }
    return {
      results,
      completed: results.length,
      requested: args.steps.length,
      atomic: false,
      ok: results.every((result) => result.ok),
    };
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    return (this.closePromise = this.queue.then(() => this.gateway.close()).then(() => undefined));
  }
}
