import { WsHcmApiError } from "./native/index.js";
import { ArgumentError } from "./protocol/error.js";
import { WebSocketHeartbeatError } from "./protocol/websocket.js";
import { HcmError } from "./errors.js";
import { operationSpec } from "./operations.js";
import { platformFailure } from "./platform-errors.js";
import type { ResultStore } from "./results.js";
import type { Verdict } from "./write-outcome.js";
import type { OperationCall } from "./operation.js";
import type { ConnectionConfig, OperationError, OperationResult } from "./contracts.js";

/** Что пакет успел сделать к моменту сбоя. */
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
/**
 * С чего начинается сохранённый ответ: первые символы длинного текста и столько первых элементов
 * списков, сколько помещается в budget байт. undefined — от непустого списка не поместилось ничего
 * или неполным вышел список, у которого есть строка об элементе.
 */
function beginning(data: unknown, budget: number, summarised: object = {}): unknown {
  const whole = data === null || typeof data !== "object" || Array.isArray(data);
  const entries = whole ? [["", data] as const] : Object.entries(data);
  const shown = entries.map(([, value]) =>
    Array.isArray(value) ? [] : typeof value === "string" ? value.slice(0, 1000) : value,
  );
  const preview = () =>
    whole ? shown[0] : Object.fromEntries(entries.map(([key], index) => [key, shown[index]]));
  let used = Buffer.byteLength(JSON.stringify(preview()) ?? "null");
  for (const [index, [key, value]] of entries.entries()) {
    if (!Array.isArray(value)) continue;
    const items = shown[index] as unknown[];
    for (const item of value) {
      const bytes = Buffer.byteLength(JSON.stringify(item) ?? "null") + (items.length ? 1 : 0);
      if (used + bytes > budget) break;
      used += bytes;
      items.push(item);
    }
    if (
      value.length &&
      (!items.length || (Object.hasOwn(summarised, key) && items.length < value.length))
    )
      return undefined;
  }
  return preview();
}

/** Собирает ответ операции из того, что она вернула или выбросила, в лимитах подключения. */
export class ReplyPacker {
  constructor(
    private readonly config: ConnectionConfig,
    private readonly results: Pick<ResultStore, "put">,
  ) {}
  /** Место под payload одного ответа; остаток лимита вывода оставлен другим его полям. */
  get pageBytes(): number {
    return Math.floor(this.config.outputLimitBytes * 0.6);
  }
  /** Что вернула операция; ответ сверх лимита сохраняется целиком и заменяется своим началом. */
  async success(
    id: string,
    start: number,
    value: unknown,
    bound: boolean,
  ): Promise<OperationResult> {
    const rules = operationSpec(id)?.reply;
    const data = jsonSafe(value);
    const serialised = JSON.stringify(data);
    const outcome = (stored: boolean) => {
      const error = rules?.failed?.(data, stored);
      return error ? { ok: false, error } : { ok: true };
    };
    if (
      bound &&
      Buffer.byteLength(serialised ?? "null") > this.config.outputLimitBytes &&
      rules?.store !== "never"
    ) {
      const stored = await this.results.put(data);
      const budget = this.config.outputLimitBytes / 2;
      const fitted = beginning(data, budget, rules?.preview);
      // Не поместились ни элементы списка, ни строки: остаются счётчики, позиции и размеры списков.
      const preview =
        fitted !== undefined && Buffer.byteLength(JSON.stringify(fitted)) <= budget
          ? fitted
          : {
              kind: "stored-result",
              ...(data !== null && typeof data === "object" && !Array.isArray(data)
                ? Object.fromEntries(
                    Object.entries(data)
                      .slice(0, 40)
                      .map(([key, value]) => [
                        key,
                        Array.isArray(value)
                          ? rules?.preview && Object.hasOwn(rules.preview, key)
                            ? value.map(rules.preview[key]!)
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
      const { list } = stored;
      const shown =
        list === undefined || preview !== fitted
          ? undefined
          : (fitted as Record<string, unknown>)[list];
      const reads =
        list === undefined
          ? "его частями"
          : `список ${list} по элементам${Array.isArray(shown) ? ` (в preview первые ${shown.length} из ${(data as Record<string, unknown[]>)[list]!.length})` : ""}`;
      return {
        ...outcome(true),
        data: {
          preview,
          resultId: stored.resultId,
          hint: `Ответ не поместился и сохранён целиком: results.read читает ${reads}, results.export сохраняет в файл.`,
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
    // Текст лога или файла сохраняется, даже если помещается: results.export пишет его в файл.
    const kept =
      bound && (typeof rules?.store === "function" ? rules.store(data) : rules?.store === "always")
        ? await this.results.put(data).catch(() => undefined)
        : undefined;
    return {
      ...outcome(false),
      data,
      meta: {
        operationId: id,
        connection: this.config.name,
        durationMs: Math.round(performance.now() - start),
        ...(kept ? { resultId: kept.resultId } : {}),
      },
    };
  }
  /** Что операция выбросила: формулировка по классу ошибки, без секретов, в пределах лимита. */
  failure(
    id: string,
    start: number,
    error: unknown,
    verdict: Verdict,
    extra: { afterSend?: OperationCall["afterSend"]; batchRecovery?: BatchRecovery } = {},
  ): OperationResult {
    const failure = this.pack(id, start, error, verdict, extra.afterSend);
    if (!extra.batchRecovery) return failure;
    return { ...failure, data: this.batchRecoveryData(extra.batchRecovery) };
  }
  /** Сбой локального хранилища не стирает выполненные шаги и не помечает ушедший пакет not_sent. */
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
      // Длинные URL проверяемы по исходному вводу пакета; сокращённый URL не выдумывается.
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
    afterSend: OperationCall["afterSend"],
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
      safe = safe
        .replace(/\b[A-Za-z]:[\\/][^\r\n<>"']*/g, "[server-path]")
        .replace(/(?:SessionID|Authorization|Cookie)\s*[:=]\s*[^\s,;]+/gi, "[redacted]");
      return safe.length > limit ? `${safe.slice(0, limit - 1)}…` : safe;
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
                ...platformFailure(error, this.config.baseUrl, operationSpec(id)?.usualCause),
                retryable: false,
                ...(error.status === undefined ? {} : { details: { status: error.status } }),
              }
            : error instanceof ArgumentError
              ? {
                  code: "INVALID_ARGUMENT",
                  message: error.message,
                  hint: "Аргументы операции описывает api.describe.",
                  retryable: false,
                }
              : {
                  code: "INTERNAL_ERROR",
                  message: "Операция не выполнена: внутренняя ошибка клиента.",
                  hint: "Это дефект клиента: подбирать аргументы не нужно.",
                  retryable: false,
                };
    if (refusedAfterSend)
      normal.hint =
        `${normal.hint ?? ""} До этого отказа запрос на запись уже ушёл: после восстановления входа проверить, прошла ли запись, прежде чем повторять.`.trim();
    if (afterSend && mutationOutcome === "indeterminate") {
      normal.hint = [afterSend.hint, normal.message, normal.hint].filter(Boolean).join(" ");
      normal.message = afterSend.message;
    }
    const trim = (value: unknown, depth = 0, limit = 256): unknown => {
      if (typeof value === "string") return redact(value, limit);
      if (depth > 3) return "[details omitted]";
      if (Array.isArray(value)) return value.slice(0, 12).map((item) => trim(item, depth + 1));
      if (value !== null && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value)
            .slice(0, 12)
            // Вызывающий правит код по сообщению сервера: его лимит длины больше остальных.
            .map(([key, item]) => [
              key.slice(0, 128),
              trim(item, depth + 1, key === "scriptError" ? 2048 : 256),
            ]),
        );
      return value;
    };
    // Точные ID ставятся поверх маскирования: пароль может законно совпасть с цифрой или
    // префиксом UUID.
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
      // Прямые вызывающие SDK могут передать метку длиннее, чем позволяют границы
      // подключения. Метка опускается целиком раньше, чем жертвуют полезной диагностикой или
      // точными сведениями для восстановления и чтения; короткая обычная метка сохраняется.
      return Buffer.byteLength(JSON.stringify(omitted)) < bytes ? omitted : value;
    };
    const result: OperationResult = omitOversizedConnection({
      ok: false,
      error: {
        ...normal,
        // Отказ платформы формулируется здесь из фиксированного текста и настроенного адреса;
        // пароль, случайно ставший частью слова, не должен вырезать в нём дыры.
        ...(error instanceof WsHcmApiError
          ? {}
          : {
              message: redact(normal.message),
              // Подсказка бывает длиннее сообщения: она называет имена, из которых выбирать.
              ...(normal.hint === undefined ? {} : { hint: redact(normal.hint, 1000) }),
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
      // Специальный конструктор сохраняет только ограниченные наблюдения протокола.
      // Общие подробности со стороны сервера и причины закрытия в эту сводку не попадают.
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
