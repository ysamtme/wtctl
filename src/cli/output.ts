import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { MutationOutcome, OperationResult } from "../contracts.js";
import { HcmError } from "../errors.js";
import { errorInFrontendTerms } from "../frontend-names.js";
import { CliInputError, optional, stringOption, type CliArguments } from "./arguments.js";
import { formatCsvRow, formatTsvRow } from "./format/csv.js";
import { tabularStreamSpec } from "./format/human.js";
import {
  createStyler,
  formatBytes,
  formatHumanError,
  formatOperationOutput,
  resolveColor,
  resolveOutputMode,
  type FormattedOutput,
  type OutputMode,
  type ResolvedOutputFormat,
} from "./format/index.js";
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

export async function safeDiagnostic(
  io: CliIo,
  value: OperationResult,
  mode: "human" | "json" = "json",
): Promise<void> {
  try {
    const text =
      mode === "human"
        ? formatHumanError(value, createStyler(resolveColor(io, "stderr")))
        : serializeResult(value, io.pretty === true);
    await io.writeError(text);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function outputDeliveryReceipt(result: OperationResult, savedOutput?: string): OperationResult {
  const returned = isRecord(result.data) ? result.data : {};
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

async function deliverJsonOutput(
  result: OperationResult,
  value: OperationResult,
  io: CliIo,
  savedOutput?: string,
): Promise<boolean> {
  try {
    await io.writeOut(serializeResult(value, io.pretty === true));
    return true;
  } catch {
    await safeDiagnostic(io, outputDeliveryReceipt(result, savedOutput), "json");
    return false;
  }
}

async function emitJson(
  result: OperationResult,
  args: CliArguments,
  io: CliIo,
  runtime?: RuntimePort,
): Promise<number> {
  const output = stringOption(args, "output");
  if (output) {
    let bytes: number | undefined;
    try {
      if (result.meta.truncated && result.meta.resultId) {
        if (!runtime?.results) throw new Error("Сохранённые результаты недоступны");
        const input = { resultId: result.meta.resultId, path: output, overwrite: true };
        bytes = (await runtime.results.export(input, result)).bytes;
      } else await io.writeFile(output, serializeResult(result, true));
    } catch {
      const exportFailure = failure(
        "cli.output_failed",
        "Результат команды получен, но сохранить локальный файл не удалось.",
        "Клиент пытается вывести исходные data/meta в stdout; нужно проверить, что вывод получен. Серверную операцию из-за ошибки сохранения файла не повторять.",
      );
      await safeDiagnostic(io, exportFailure, "json");
      const failedExport = frontendFailure(result, exportFailure, "outputFailed");
      await deliverJsonOutput(failedExport, failedExport, io);
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
    if (!(await deliverJsonOutput(result, receipt, io, output))) return 1;
  } else if (!(await deliverJsonOutput(result, result, io))) return 1;
  // Код 3: скрипт должен заметить, что в stdout только начало ответа; с --output файл полный.
  return !result.ok ? 1 : result.meta.truncated && !output ? 3 : 0;
}

async function writeFormattedStdout(
  formatted: FormattedOutput,
  result: OperationResult,
  io: CliIo,
): Promise<boolean> {
  try {
    if (formatted.kind === "binary") {
      if (io.writeBinaryOut) await io.writeBinaryOut(formatted.bytes);
      else await io.writeOut(Buffer.from(formatted.bytes).toString("latin1"));
    } else {
      await io.writeOut(formatted.text);
      if (formatted.stderrNote) {
        try {
          await io.writeError(formatted.stderrNote);
        } catch {
          /* Побочная пометка в stderr не отменяет выданный результат. */
        }
      }
    }
    return true;
  } catch {
    await safeDiagnostic(io, outputDeliveryReceipt(result), "human");
    return false;
  }
}

async function writeFormattedFile(
  path: string,
  formatted: FormattedOutput,
  io: CliIo,
): Promise<number> {
  if (formatted.kind === "binary") {
    if (io.writeBinaryFile) await io.writeBinaryFile(path, formatted.bytes);
    else await io.writeFile(path, Buffer.from(formatted.bytes).toString("latin1"));
    return formatted.bytes.length;
  }
  await io.writeFile(path, formatted.text);
  return Buffer.byteLength(formatted.text, "utf8");
}

function hasFailureReport(
  result: OperationResult,
  format: Exclude<ResolvedOutputFormat, "json">,
): boolean {
  if (!isRecord(result.data)) return false;
  if (
    result.meta.operationId === "runtime.check" &&
    Array.isArray(result.data.checks) &&
    format !== "raw"
  ) {
    return true;
  }
  if (
    (format === "human" || format === "table" || format === "jsonl") &&
    result.meta.operationId === "runtime.batch" &&
    Array.isArray(result.data.results)
  ) {
    return true;
  }
  return false;
}

export async function reportSaved(
  output: string,
  bytes: number,
  result: OperationResult,
  args: CliArguments,
  io: CliIo,
  extra?: string,
): Promise<boolean> {
  if (args.options.quiet === true) return true;
  const toStderr = io.stdoutIsTTY === true || io.stderrIsTTY === true;
  const styler = createStyler(resolveColor(io, toStderr ? "stderr" : "stdout"));
  const data = isRecord(result.data) ? result.data : undefined;
  const extras = [
    extra,
    typeof data?.id === "string" ? `id=${data.id}` : undefined,
    typeof data?.mutationOutcome === "string" ? `исход: ${data.mutationOutcome}` : undefined,
  ].filter(Boolean);
  const suffix = extras.length
    ? ` (${formatBytes(bytes)}, ${extras.join(", ")})`
    : ` (${formatBytes(bytes)})`;
  const message = `${styler.green("✓")} Сохранено: ${output}${suffix}\n`;
  try {
    if (toStderr) await io.writeError(message);
    else await io.writeOut(message);
    return true;
  } catch {
    if (!toStderr) await safeDiagnostic(io, outputDeliveryReceipt(result, output), "human");
    return toStderr;
  }
}

const OPERATION_LIST_KEYS: Readonly<Record<string, string>> = {
  "runtime.query": "items",
  "files.list": "items",
  "objects.get": "items",
  "results.read": "items",
  "schema.types": "types",
  "schema.get": "fields",
  "logs.list": "files",
  "logs.search": "events",
  "logs.follow": "events",
  "rpc.list": "targets",
  "cli.config.list": "connections",
  "runtime.check": "checks",
  "runtime.batch": "results",
  "execute.script": "result",
  "web.spxml.getBackgroundTasksByName": "Task",
};

const STREAM_CSV_FLUSH_CHARS = 64 * 1024;

async function writeStreamedLines(
  output: string,
  io: CliIo,
  produce: (appendLine: (line: string) => Promise<void>) => Promise<void>,
): Promise<number> {
  if (io.openTextWriter) {
    const writer = await io.openTextWriter(output);
    let buffer = "";
    const flush = async (): Promise<void> => {
      if (!buffer) return;
      const chunk = buffer;
      buffer = "";
      await writer.write(chunk);
    };
    try {
      await produce(async (line) => {
        buffer += `${line}\n`;
        if (buffer.length >= STREAM_CSV_FLUSH_CHARS) await flush();
      });
      await flush();
      return await writer.commit();
    } catch (error) {
      await writer.abort().catch(() => undefined);
      throw error;
    }
  }
  const chunks: string[] = [];
  await produce(async (line) => {
    chunks.push(`${line}\n`);
  });
  const text = chunks.join("");
  await io.writeFile(output, text);
  return Buffer.byteLength(text, "utf8");
}

async function exportTruncatedTabular(
  op: string,
  resultId: string,
  output: string,
  format: "csv" | "tsv",
  runtime: RuntimePort,
  io: CliIo,
  requestedFields?: readonly string[],
): Promise<{ readonly bytes: number } | undefined> {
  if (!runtime.results?.openListItems) return undefined;
  const spec = tabularStreamSpec(op, requestedFields);
  const listKey = OPERATION_LIST_KEYS[op];
  if (!spec || !listKey) return undefined;

  const formatRow = format === "csv" ? formatCsvRow : formatTsvRow;
  const openItems = runtime.results.openListItems.bind(runtime.results);

  if (spec.kind === "fixed") {
    const bytes = await writeStreamedLines(output, io, async (appendLine) => {
      await appendLine(formatRow(spec.headers));
      for await (const item of openItems(resultId, listKey)) {
        await appendLine(formatRow(spec.mapRow(item)));
      }
    });
    return { bytes };
  }

  let headers = spec.headers;
  let scalarMode = false;
  let errorHeader: string | undefined;
  if (!headers) {
    if (spec.objectDataMode) {
      const seenFields = new Set<string>();
      const fieldKeys: string[] = [];
      let hasError = false;
      for await (const item of openItems(resultId, listKey)) {
        if (!isRecord(item)) continue;
        if (isRecord(item.error)) hasError = true;
        for (const source of [item.data, item.fromCatalog]) {
          if (!isRecord(source)) continue;
          for (const key of Object.keys(source)) {
            if (!seenFields.has(key)) {
              seenFields.add(key);
              fieldKeys.push(key);
            }
          }
        }
      }
      const extraFields = fieldKeys.filter((key) => key !== "id" && key !== "type");
      if (hasError) {
        errorHeader = "error";
        while (seenFields.has(errorHeader)) errorHeader = `_${errorHeader}`;
      }
      headers = ["id", "type", ...extraFields, ...(errorHeader === undefined ? [] : [errorHeader])];
    } else {
      const seen = new Set<string>();
      let hasItems = false;
      for await (const item of openItems(resultId, listKey)) {
        hasItems = true;
        if (!isRecord(item)) {
          scalarMode = true;
          break;
        }
        for (const key of Object.keys(item)) seen.add(key);
      }
      headers = scalarMode ? ["value"] : hasItems ? [...seen] : [];
    }
  }

  const finalHeaders = headers;
  const finalErrorHeader = errorHeader;
  const bytes = await writeStreamedLines(output, io, async (appendLine) => {
    if (finalHeaders.length === 0) return;
    await appendLine(formatRow(finalHeaders));
    for await (const item of openItems(resultId, listKey)) {
      if (scalarMode) {
        await appendLine(formatRow([item]));
      } else if (spec.objectDataMode) {
        if (!isRecord(item)) {
          await appendLine(formatRow(finalHeaders.map(() => "")));
          continue;
        }
        const docData = isRecord(item.data) ? item.data : {};
        const catalogData = isRecord(item.fromCatalog) ? item.fromCatalog : {};
        const err = isRecord(item.error)
          ? `${String(item.error.code ?? "")}: ${String(item.error.message ?? "")}`
          : "";
        const row = finalHeaders.map((header) => {
          if (header === "id") return item.id ?? (Object.hasOwn(docData, "id") ? docData.id : "");
          if (header === "type")
            return item.type ?? (Object.hasOwn(docData, "type") ? docData.type : "");
          if (finalErrorHeader !== undefined && header === finalErrorHeader) return err;
          if (Object.hasOwn(docData, header)) return docData[header];
          if (Object.hasOwn(catalogData, header)) return catalogData[header];
          return "";
        });
        await appendLine(formatRow(row));
      } else {
        const record = isRecord(item) ? item : {};
        const row = finalHeaders.map((key) => (Object.hasOwn(record, key) ? record[key] : ""));
        await appendLine(formatRow(row));
      }
    }
  });
  return { bytes };
}

async function exportTruncatedFormatted(
  result: OperationResult,
  output: string,
  format: Exclude<ResolvedOutputFormat, "json">,
  runtime: RuntimePort,
  io: CliIo,
  quiet: boolean,
  requestedFields?: readonly string[],
  requestArgs?: Readonly<Record<string, unknown>>,
): Promise<{ readonly bytes: number; readonly stderrNote?: string }> {
  if (!runtime.results) throw new Error("Сохранённые результаты недоступны");
  const resultId = result.meta.resultId!;
  const op = result.meta.operationId;
  // Потоковые ветки O(1) по памяти для больших файлов, логов, JSONL, CSV и TSV любого размера.
  if (format === "jsonl") {
    if (runtime.results.exportJsonlAny) {
      return await runtime.results.exportJsonlAny(resultId, output, true, OPERATION_LIST_KEYS[op]);
    }
    await mkdir(dirname(resolve(output)), { recursive: true });
    return {
      bytes: (
        await runtime.results.export({ resultId, path: output, format: "jsonl", overwrite: true })
      ).bytes,
    };
  }
  if (format === "csv" || format === "tsv") {
    const streamed = await exportTruncatedTabular(
      op,
      resultId,
      output,
      format,
      runtime,
      io,
      requestedFields,
    );
    if (streamed) return streamed;
  }
  if (format === "raw" && (op === "files.read" || op === "logs.read")) {
    await mkdir(dirname(resolve(output)), { recursive: true });
    try {
      const exported = await runtime.results.export({
        resultId,
        path: output,
        format: "text",
        overwrite: true,
      });
      const preview =
        isRecord(result.data) && isRecord(result.data.preview) ? result.data.preview : undefined;
      const tailNote =
        op === "logs.read" && !quiet && preview?.tailOnly === true
          ? `Показан конец файла ${String(preview.file ?? "")} (${typeof preview.sizeBytes === "number" ? `${preview.sizeBytes} Б` : "не весь"}); весь файл: --full.\n`
          : undefined;
      return { bytes: exported.bytes, ...(tailNote === undefined ? {} : { stderrNote: tailNote }) };
    } catch (error) {
      if (op === "files.read" && runtime.results.exportBinary) {
        return await runtime.results.exportBinary(resultId, output, true);
      }
      throw error;
    }
  }
  if (runtime.results.loadData) {
    const fullData = await runtime.results.loadData(resultId);
    const { truncated: _, ...meta } = result.meta;
    const fullResult: OperationResult = { ...result, data: fullData, meta };
    const formatted = formatOperationOutput(fullResult, format, {
      color: false,
      quiet,
      ...(requestedFields === undefined ? {} : { requestedFields }),
      ...(requestArgs === undefined ? {} : { requestArgs }),
    });
    const bytes = await writeFormattedFile(output, formatted, io);
    return {
      bytes,
      ...(formatted.kind === "text" && formatted.stderrNote !== undefined
        ? { stderrNote: formatted.stderrNote }
        : {}),
    };
  }
  throw new Error("Чтение полного результата для форматирования недоступно");
}

async function writeNote(io: CliIo, note: string | undefined): Promise<void> {
  if (!note) return;
  try {
    await io.writeError(note);
  } catch {
    /* Побочная пометка в stderr не отменяет выданный результат. */
  }
}

async function emitFormatted(
  result: OperationResult,
  args: CliArguments,
  io: CliIo,
  format: Exclude<ResolvedOutputFormat, "json">,
  runtime?: RuntimePort,
  requestedFields?: readonly string[],
  requestArgs?: Readonly<Record<string, unknown>>,
): Promise<number> {
  const output = stringOption(args, "output");
  const quiet = args.options.quiet === true;
  const connectionArg = stringOption(args, "connection");
  const fieldOpts = {
    ...(requestedFields === undefined ? {} : { requestedFields }),
    ...(requestArgs === undefined ? {} : { requestArgs }),
    ...(connectionArg === undefined ? {} : { connectionArg }),
  };

  if (!result.ok) {
    const report = hasFailureReport(result, format);
    const cleanupOnly = result.meta.cleanupFailed === true && result.data !== undefined;
    const truncatedBatchToFile =
      output !== undefined &&
      result.meta.operationId === "runtime.batch" &&
      result.meta.truncated === true &&
      result.meta.resultId !== undefined &&
      runtime?.results !== undefined;
    if (!report && !cleanupOnly && !truncatedBatchToFile) {
      await safeDiagnostic(io, result, "human");
      return 1;
    }
    if (
      output &&
      (cleanupOnly || truncatedBatchToFile) &&
      result.meta.truncated &&
      result.meta.resultId &&
      runtime?.results
    ) {
      try {
        const exported = await exportTruncatedFormatted(
          result,
          output,
          format,
          runtime,
          io,
          quiet,
          requestedFields,
          requestArgs,
        );
        await reportSaved(output, exported.bytes, result, args, io);
        await writeNote(io, exported.stderrNote);
      } catch {
        await safeDiagnostic(
          io,
          failure(
            "cli.output_failed",
            "Результат команды получен, но сохранить локальный файл не удалось.",
            "Серверную операцию из-за ошибки сохранения файла не повторять; результат сохранён локально под resultId.",
          ),
          "human",
        );
      }
      if (truncatedBatchToFile) await safeDiagnostic(io, result, "human");
      return 1;
    }
    const formatted = formatOperationOutput(result, format, {
      ...(!output && io.columns !== undefined ? { columns: io.columns } : {}),
      color: output ? false : resolveColor(io, "stdout"),
      quiet,
      ...fieldOpts,
    });
    if (output) {
      try {
        const bytes = await writeFormattedFile(output, formatted, io);
        await reportSaved(output, bytes, result, args, io);
        if (formatted.kind === "text") await writeNote(io, formatted.stderrNote);
      } catch {
        await safeDiagnostic(
          io,
          failure(
            "cli.output_failed",
            "Результат команды получен, но сохранить локальный файл не удалось.",
            "Серверную операцию из-за ошибки сохранения файла не повторять.",
          ),
          "human",
        );
      }
    } else {
      await writeFormattedStdout(formatted, result, io);
    }
    if (
      result.meta.operationId === "runtime.batch" ||
      result.meta.operationId === "runtime.check"
    ) {
      await safeDiagnostic(io, result, "human");
    }
    return 1;
  }

  if (result.meta.truncated) {
    if (output && result.meta.resultId && runtime?.results) {
      try {
        const exported = await exportTruncatedFormatted(
          result,
          output,
          format,
          runtime,
          io,
          quiet,
          requestedFields,
          requestArgs,
        );
        if (!(await reportSaved(output, exported.bytes, result, args, io))) return 1;
        await writeNote(io, exported.stderrNote);
        return 0;
      } catch (error) {
        if (error instanceof CliInputError) throw error;
        const exportFailure = failure(
          "cli.output_failed",
          "Результат команды получен, но сохранить локальный файл не удалось.",
          "Серверную операцию из-за ошибки сохранения файла не повторять; результат сохранён локально под resultId.",
        );
        await safeDiagnostic(io, exportFailure, "human");
        const notice = formatOperationOutput(result, "human", {
          color: resolveColor(io, "stderr"),
          quiet,
        });
        if (notice.kind === "text") await writeNote(io, notice.text);
        return 1;
      }
    }
    const notice = formatOperationOutput(result, "human", {
      ...(io.columns === undefined ? {} : { columns: io.columns }),
      color: resolveColor(io, format === "human" || format === "table" ? "stdout" : "stderr"),
      quiet,
    });
    if (format === "human" || format === "table") {
      if (!(await writeFormattedStdout(notice, result, io))) return 1;
    } else if (notice.kind === "text") {
      await writeNote(io, notice.text);
    }
    return 3;
  }

  if (output) {
    const formatted = formatOperationOutput(result, format, { color: false, quiet, ...fieldOpts });
    let bytes: number;
    try {
      bytes = await writeFormattedFile(output, formatted, io);
    } catch {
      const exportFailure = failure(
        "cli.output_failed",
        "Результат команды получен, но сохранить локальный файл не удалось.",
        "Клиент пытается вывести результат в stdout; серверную операцию из-за ошибки сохранения файла не повторять.",
      );
      await safeDiagnostic(io, exportFailure, "human");
      await writeFormattedStdout(formatted, result, io);
      return 1;
    }
    if (!(await reportSaved(output, bytes, result, args, io))) return 1;
    if (formatted.kind === "text") await writeNote(io, formatted.stderrNote);
    return 0;
  }

  const formatted = formatOperationOutput(result, format, {
    ...(io.columns === undefined ? {} : { columns: io.columns }),
    color: resolveColor(io, "stdout"),
    quiet,
    ...fieldOpts,
  });
  if (!(await writeFormattedStdout(formatted, result, io))) return 1;
  return 0;
}

export async function emit(
  result: OperationResult,
  args: CliArguments,
  io: CliIo,
  runtime?: RuntimePort,
  resolvedMode?: OutputMode,
  requestedFields?: readonly string[],
  requestArgs?: Readonly<Record<string, unknown>>,
): Promise<number> {
  result = errorInFrontendTerms(result, "cli");
  const mode = resolvedMode ?? resolveOutputMode(args, io);
  if (mode.format === "json") return emitJson(result, args, io, runtime);
  return emitFormatted(result, args, io, mode.format, runtime, requestedFields, requestArgs);
}

/** Справка и гайд читаются, а не разбираются: текст уходит как есть в stdout или в --output. */
export async function emitText(text: string, args: CliArguments, io: CliIo): Promise<number> {
  const output = stringOption(args, "output");
  if (output) await io.writeFile(output, text);
  else await io.writeOut(text);
  return 0;
}

const MAX_STORED_JSON_CHARS = 8 * 1024 * 1024;

/** Извлекает resultId сохранённого результата из meta или data ответа. */
export function storedResultId(result: OperationResult): string | undefined {
  if (typeof result.meta.resultId === "string") return result.meta.resultId;
  if (isRecord(result.data) && typeof result.data.resultId === "string")
    return result.data.resultId;
  return undefined;
}

/** Читает сохранённый JSON-ответ (до 8 МиБ) через папку результатов runtime или results.read. */
export async function readStoredJson(
  runtime: RuntimePort,
  result: OperationResult,
  maxChars = MAX_STORED_JSON_CHARS,
): Promise<unknown> {
  const resultId = storedResultId(result);
  if (!resultId) {
    throw new HcmError(
      "RESULT_TRUNCATED",
      "Ответ обрезан, а resultId для дочитывания отсутствует.",
    );
  }
  if (runtime.results?.loadData) {
    return await runtime.results.loadData(resultId);
  }
  const parts: string[] = [];
  let totalChars = 0;
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const chunk = await runtime.call("results.read", {
      resultId,
      offset,
      limit: 65536,
      format: "json",
    });
    if (!chunk.ok) {
      throw new HcmError(
        "RESULT_STORED",
        "Не удалось дочитать сохранённый результат.",
        `Прочитать сохранённый результат: wtctl result read ${resultId}.`,
        { resultId },
      );
    }
    const data = isRecord(chunk.data) ? chunk.data : undefined;
    if (data?.format !== "json" || typeof data.text !== "string") {
      throw new HcmError(
        "RESULT_STORED",
        "Не удалось дочитать сохранённый результат в формате JSON.",
        `Прочитать сохранённый результат: wtctl result read ${resultId}.`,
        { resultId },
      );
    }
    totalChars += data.text.length;
    if (totalChars > maxChars) {
      throw new HcmError(
        "RESULT_TOO_LARGE_FOR_FORMAT",
        "Сохранённый результат больше 8 МиБ и не читается в памяти целиком.",
        `Сохранить потоково: wtctl result export ${resultId} --to ФАЙЛ --format jsonl (или json/text).`,
        { resultId },
      );
    }
    parts.push(data.text);
    if (data.nextOffset === undefined) {
      offset = undefined;
    } else if (
      typeof data.nextOffset === "number" &&
      Number.isSafeInteger(data.nextOffset) &&
      data.nextOffset > offset
    ) {
      offset = data.nextOffset;
    } else {
      throw new HcmError(
        "RESULT_STORED",
        "Чтение сохранённого результата не продвигается.",
        `Прочитать сохранённый результат: wtctl result read ${resultId}.`,
        { resultId },
      );
    }
  }
  try {
    return JSON.parse(parts.join(""));
  } catch {
    throw new HcmError(
      "RESULT_STORED",
      "Сохранённый результат содержит повреждённый JSON.",
      `Прочитать сохранённый результат: wtctl result read ${resultId}.`,
      { resultId },
    );
  }
}
