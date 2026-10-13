import { WsHcmApiError } from "./native/index.js";
import { WebSocketHeartbeatError } from "./protocol/websocket.js";
import { HcmError } from "./errors.js";
import { platformFailure } from "./platform-errors.js";
import type { ResultStore } from "./results.js";
import type { CheckData } from "./self-check.js";
import type { Verdict } from "./write-outcome.js";
import type { ConnectionConfig, OperationError, OperationResult } from "./contracts.js";

/** What a batch had done by the time it failed. */
export interface BatchRecovery {
  completed: number;
  requested: number;
  sentMutationSteps: number;
  receipts: Record<string, unknown>[];
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

/** Makes the reply of an operation out of what it returned or threw, within the limits of the connection. */
export class ReplyPacker {
  constructor(
    private readonly config: ConnectionConfig,
    private readonly results: Pick<ResultStore, "put">,
  ) {}
  /** Room for the payload of one reply; the rest of the output limit is left to its other fields. */
  get pageBytes(): number {
    return Math.floor(this.config.outputLimitBytes * 0.6);
  }
  /** What the operation returned; an answer over the limit is stored whole and replaced by its beginning. */
  async success(
    id: string,
    start: number,
    value: unknown,
    bound: boolean,
  ): Promise<OperationResult> {
    const data = jsonSafe(value);
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
                ? ((data as CheckData).checks.find((check) => check.result === "failed")?.reason ??
                  "Причины — в data.checks.")
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
      bound &&
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
      bound && (id === "logs.read" || id === "files.read")
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
  }
  /** What the operation threw: worded by the class of the error, without secrets, within the limit. */
  failure(
    id: string,
    start: number,
    error: unknown,
    verdict: Verdict,
    extra: { refusal?: string; batchRecovery?: BatchRecovery } = {},
  ): OperationResult {
    const failure = this.pack(id, start, error, verdict, extra.refusal);
    if (!extra.batchRecovery) return failure;
    return { ...failure, data: this.batchRecoveryData(extra.batchRecovery) };
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
  private pack(
    id: string,
    start: number,
    error: unknown,
    verdict: Verdict,
    refusal: string | undefined,
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
    const { mutationOutcome, refusedAfterSend, ids, exactIds } = verdict;
    const { mutationOutcome: _own, ...normal }: OperationError =
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
                ...platformFailure(error, this.config.baseUrl, refusal ?? id),
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
    if (refusedAfterSend)
      normal.hint =
        `${normal.hint ?? ""} До этого отказа запрос на запись уже ушёл: после восстановления входа проверить, прошла ли запись, прежде чем повторять.`.trim();
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
    // Exact IDs go over the redaction: a password can legitimately match a UUID digit or prefix.
    let details: Record<string, unknown> = {
      ...(trim({
        ...normal.details,
        ...(ids.mutationId === undefined ? {} : { mutationId: ids.mutationId }),
        ...(ids.objectId === undefined ? {} : { objectId: ids.objectId }),
        ...(ids.url === undefined ? {} : { url: ids.url }),
        ...(ids.executionId === undefined ? {} : { executionId: ids.executionId }),
      }) as Record<string, unknown>),
      ...exactIds,
    };
    if (Buffer.byteLength(JSON.stringify(details)) > this.config.outputLimitBytes / 4)
      details = {
        omitted: true,
        ...exactIds,
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
}
