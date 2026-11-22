import type { MutationOutcome, OperationResult } from "../contracts.js";
import { errorInFrontendTerms } from "../frontend-names.js";
import { optional, stringOption, type CliArguments } from "./arguments.js";
import type { CliIo, RuntimePort } from "./types.js";

export function frontendResult(
  operationId: string,
  connection: string,
  data: unknown,
): OperationResult {
  return { ok: true, data, meta: { operationId, connection, durationMs: 0 } };
}

export function failure(code: string, message: string, hint?: string): OperationResult {
  return {
    ok: false,
    error: { code, message, ...(hint ? { hint } : {}) },
    meta: { operationId: "cli", connection: "unselected", durationMs: 0 },
  };
}

export function frontendFailure(
  result: OperationResult,
  diagnostic: OperationResult,
  flag: string,
): OperationResult {
  const error = result.error ?? {
    ...diagnostic.error!,
    retryable: false,
    details: { operationSucceeded: result.ok },
  };
  const meta = { ...result.meta, [flag]: true };
  return { ...result, ok: false, error, meta };
}

/** Одна строка для программ и агентов; с отступами — для человека в терминале или в файле. */
export function serializeResult(value: unknown, pretty = false): string {
  return `${JSON.stringify(value, (_key: string, item: unknown) => (typeof item === "bigint" ? item.toString(10) : item), pretty ? 2 : undefined)}\n`;
}

export async function safeDiagnostic(io: CliIo, value: OperationResult): Promise<void> {
  try {
    await io.writeError(serializeResult(value, io.pretty === true));
  } catch {
    /* Закрытая диагностика — не второй сбой. */
  }
}

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const OBJECT_ID_RE = /^(?:[0-9]{1,20}|0[xX][0-9a-fA-F]{1,16})$/;
const EXEC_ID_RE = /^hcm_inline_[a-f0-9]{32}$/;
const TRACKING_ID_RE = /^(?:\d+|0x[0-9a-f]+)$/i;
const OUTCOMES = new Set<MutationOutcome>(["not_sent", "confirmed", "indeterminate"]);

function boundedText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" &&
    value.length <= maximum &&
    Buffer.byteLength(JSON.stringify(value), "utf8") <= maximum
    ? value
    : undefined;
}

function firstString(values: readonly unknown[], pattern: RegExp): string | undefined {
  return values.find((v): v is string => typeof v === "string" && pattern.test(v));
}

function outputDeliveryReceipt(result: OperationResult, savedOutput?: string): OperationResult {
  const returned =
    result.data !== null && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : {};
  const details = result.error?.details;
  const pickOutcome = (v: unknown): MutationOutcome | undefined =>
    typeof v === "string" && OUTCOMES.has(v as MutationOutcome)
      ? (v as MutationOutcome)
      : undefined;
  const id = [returned.id, details?.objectId].find(
    (v): v is string =>
      typeof v === "string" && OBJECT_ID_RE.test(v) && BigInt(v) <= 0xffffffffffffffffn,
  );
  const resultId = firstString([result.meta.resultId, returned.resultId], UUID_RE);
  const mutationId = firstString([returned.mutationId, details?.mutationId], UUID_RE);
  const executionId = firstString([returned.executionId, details?.executionId], EXEC_ID_RE);
  const tracking = boundedText(returned.TrackingID, 128);
  const TrackingID = tracking !== undefined && TRACKING_ID_RE.test(tracking) ? tracking : undefined;
  const operationId = boundedText(result.meta.operationId, 128);
  const connection = boundedText(result.meta.connection, 256);
  const deliveryHint =
    "Серверную операцию из-за ошибки вывода не повторять; проверить известный ID, resultId или сохранённый файл.";
  const metaFlags = (["cleanupFailed", "outputFailed", "truncated"] as const).reduce<
    Record<string, true>
  >((acc, key) => (result.meta[key] === true ? { ...acc, [key]: true } : acc), {});
  return {
    ok: false,
    data: {
      receiptOnly: true,
      operationSucceeded:
        typeof details?.operationSucceeded === "boolean" ? details.operationSucceeded : result.ok,
      ...optional(
        "mutationOutcome",
        pickOutcome(result.error?.mutationOutcome) ?? pickOutcome(returned.mutationOutcome),
      ),
      ...optional("id", id),
      ...optional("mutationId", mutationId),
      ...optional("resultId", resultId),
      ...optional("executionId", executionId),
      ...optional("TrackingID", TrackingID),
      ...(savedOutput === undefined
        ? {}
        : {
            saved: true,
            ...(boundedText(savedOutput, 1024) === undefined
              ? { outputOmitted: true }
              : { output: savedOutput }),
          }),
      deliveryHint,
    },
    error: result.error
      ? {
          code: boundedText(result.error.code, 128) ?? "OPERATION_FAILED",
          message:
            boundedText(result.error.message, 512) ??
            "Основная операция вернула ошибку; подробности опущены.",
          ...optional("hint", boundedText(result.error.hint, 256)),
          retryable: result.error.retryable ?? false,
          ...optional("mutationOutcome", pickOutcome(result.error.mutationOutcome)),
        }
      : {
          code: "OUTPUT_WRITE_FAILED",
          message: "Операция завершена, но доставить результат в stdout не удалось.",
          hint: deliveryHint,
          retryable: false,
        },
    meta: {
      operationId: operationId ?? "[omitted]",
      connection: connection ?? "[omitted]",
      durationMs: Number.isFinite(result.meta.durationMs) ? result.meta.durationMs : 0,
      outputDeliveryFailed: true,
      ...(operationId === undefined ? { operationIdOmitted: true } : {}),
      ...(connection === undefined || result.meta.connectionOmitted === true
        ? { connectionOmitted: true }
        : {}),
      ...metaFlags,
      ...optional("resultId", resultId),
    },
  };
}

async function deliverOutput(
  result: OperationResult,
  value: OperationResult,
  io: CliIo,
  savedOutput?: string,
): Promise<boolean> {
  try {
    await io.writeOut(serializeResult(value, io.pretty === true));
    return true;
  } catch {
    await safeDiagnostic(io, outputDeliveryReceipt(result, savedOutput));
    return false;
  }
}

export async function emit(
  result: OperationResult,
  args: CliArguments,
  io: CliIo,
  runtime?: RuntimePort,
): Promise<number> {
  result = errorInFrontendTerms(result, "cli");
  const output = stringOption(args, "output");
  if (output) {
    let bytes: number | undefined;
    try {
      if (result.meta.truncated && result.meta.resultId) {
        if (!runtime?.results) throw new Error("Хранилище результатов недоступно");
        const input = { resultId: result.meta.resultId, path: output, overwrite: true };
        bytes = (await runtime.results.export(input, result)).bytes;
      } else await io.writeFile(output, serializeResult(result, true));
    } catch {
      const exportFailure = failure(
        "cli.output_failed",
        "Результат команды получен, но сохранить локальный файл не удалось.",
        "Клиент пытается вывести исходные data/meta в stdout; нужно проверить, что вывод получен. Серверную операцию из-за ошибки сохранения файла не повторять.",
      );
      await safeDiagnostic(io, exportFailure);
      const failedExport = frontendFailure(result, exportFailure, "outputFailed");
      await deliverOutput(failedExport, failedExport, io);
      return 1;
    }
    // Файл содержит весь ответ, поэтому сводка не называет его обрезанным; запись называет исход.
    const { truncated: _, ...meta } = result.meta;
    const done = result.data as Record<string, unknown> | null;
    const written =
      done !== null && typeof done === "object" && typeof done.mutationOutcome === "string"
        ? Object.fromEntries(
            ["id", "mutationOutcome", "verification"]
              .filter((key) => done[key] !== undefined)
              .map((key) => [key, done[key]]),
          )
        : {};
    const receipt = {
      ok: result.ok,
      data: { saved: true, output, ...optional("bytes", bytes), ...written },
      ...(result.error ? { error: result.error } : {}),
      meta,
    };
    if (!(await deliverOutput(result, receipt, io, output))) return 1;
  } else if (!(await deliverOutput(result, result, io))) return 1;
  // Код 3: скрипт должен заметить, что в stdout только начало ответа; с --output файл полный.
  return !result.ok ? 1 : result.meta.truncated && !output ? 3 : 0;
}

/** Справка и гайд читаются, а не разбираются: текст уходит как есть в stdout или в --output. */
export async function emitText(text: string, args: CliArguments, io: CliIo): Promise<number> {
  const output = stringOption(args, "output");
  if (output) await io.writeFile(output, text);
  else await io.writeOut(text);
  return 0;
}
