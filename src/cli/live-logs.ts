import type { OperationResult } from "../contracts.js";
import { HcmError } from "../errors.js";
import { errorInFrontendTerms } from "../frontend-names.js";
import { logEntry, type LogEntry } from "../log-output.js";
import {
  buildLogFollowCursor,
  maxLogTailBytes,
  parseLogEvents,
  sliceEventsAfterCursorToken,
  type LogEvent,
} from "../logs.js";
import {
  CliInputError,
  integerOption,
  intervalOption,
  optional,
  stringOption,
  type CliArguments,
} from "./arguments.js";
import type { Invocation } from "./commands.js";
import { formatCsv, formatTsv } from "./format/csv.js";
import { compactJson, formatRawLogEvents, renderLogEvents } from "./format/human.js";
import {
  assertFormatSupported,
  createStyler,
  formatBytes,
  resolveColor,
  type OutputMode,
} from "./format/index.js";
import { abortableSleep } from "./node-io.js";
import { failure, frontendFailure, readStoredJson, reportSaved, safeDiagnostic } from "./output.js";
import type { ProgressIndicator } from "./progress.js";
import type { CliIo, RuntimePort } from "./types.js";

const DEFAULT_TAIL_LINES = 50;
const DEFAULT_INTERVAL_SEC = 2;
const INITIAL_FOLLOW_EVENTS = 10;
/** Предел автоматического расширения окна tail -n (исходный текст гарантированно умещается в 8 МиБ JSON). */
const MAX_TAIL_EXPAND_BYTES = 4 * 1024 * 1024;
/** Достаточно, чтобы дойти до 4 МиБ даже от минимального outputLimitBytes (512 Б × 4^7 > 4 МиБ). */
const MAX_TAIL_EXPAND_ATTEMPTS = 8;
const DEFAULT_FOLLOW_WINDOW_BYTES = 512 * 1024;
const CLOSE_GRACE_MS = 250;

export type LogExecutionPlan =
  | { readonly kind: "passthrough" }
  | { readonly kind: "single"; readonly resolveType: boolean }
  | {
      readonly kind: "tail";
      readonly file: string;
      readonly lines: number;
      readonly tailBytes?: number;
      readonly resolveType: boolean;
    }
  | {
      readonly kind: "stream";
      readonly mode: "tail" | "follow";
      readonly file: string;
      readonly lines?: number;
      readonly tailBytes?: number;
      readonly full?: boolean;
      readonly cursor?: string;
      readonly intervalSec: number;
      readonly intervalMs: number;
      readonly streamFormat: "human" | "jsonl" | "raw";
      readonly resolveType: boolean;
    };

/** Имя типа лога без пути и расширения (например xhttp, agent): не содержит ., /, \ и :. */
export function isLogTypeName(value: string): boolean {
  return value.length > 0 && !/[./\\:]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function quoteCliArg(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

/** Ключ события для запасного сопоставления, если тестовый runtime вернул нешестнадцатеричный fingerprint. */
function entryOverlapKey(entry: {
  readonly time?: unknown;
  readonly context?: unknown;
  readonly text?: unknown;
}): string {
  const time = typeof entry.time === "string" ? entry.time : "";
  const context = typeof entry.context === "string" ? entry.context : "";
  const text = typeof entry.text === "string" ? entry.text.replace(/\n+$/, "") : "";
  return `${time}\0${context}\0${text}`;
}

/** Проверяет, что непрерывная пачка событий needle присутствует внутри дочитанного окна haystack. */
function containsEventSlice(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return haystack.length > 0;
  if (needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    let match = true;
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/** Отбрасывает наибольший префикс followEvents, совпадающий с хвостом уже выведенных событий. */
function dedupeAfterTail<T>(
  followEvents: readonly T[],
  followKeys: readonly string[],
  tailKeys: readonly string[],
): readonly T[] {
  const maxOverlap = Math.min(tailKeys.length, followKeys.length);
  for (let len = maxOverlap; len > 0; len--) {
    let match = true;
    const tailStart = tailKeys.length - len;
    for (let i = 0; i < len; i++) {
      if (tailKeys[tailStart + i] !== followKeys[i]) {
        match = false;
        break;
      }
    }
    if (match) return followEvents.slice(len);
  }
  return followEvents;
}

/** Прерывает ожидание асинхронного вызова чтения при SIGINT/SIGTERM/AbortSignal без утечки rejection. */
async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<{ readonly aborted: true } | { readonly aborted: false; readonly value: T }> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return { aborted: true };
  }
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<{ readonly aborted: true }>((resolve) => {
    onAbort = () => resolve({ aborted: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const guarded = promise.then(
    (value) => ({ aborted: false as const, value }),
    (error) => {
      if (signal.aborted) return { aborted: true as const };
      throw error;
    },
  );
  try {
    return await Promise.race([guarded, abortPromise]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    promise.catch(() => undefined);
  }
}

/**
 * Определяет режим выполнения команды logs и проверяет несовместимые флаги и форматы
 * до загрузки настроек и обращения к серверу.
 */
export function planLogExecution(
  args: CliArguments,
  invocation: Invocation,
  outputMode: OutputMode,
  io: CliIo,
): LogExecutionPlan {
  const action = args.positionals[1];
  if (action === "list") {
    assertFormatSupported(invocation.operationId, outputMode.format, invocation.args);
    return { kind: "passthrough" };
  }

  const file = String(invocation.args.file ?? "");
  const resolveType = isLogTypeName(file);
  const output = stringOption(args, "output");

  if (action === "read" || action === "search") {
    assertFormatSupported(invocation.operationId, outputMode.format, invocation.args);
    return { kind: "single", resolveType };
  }

  if (action === "tail") {
    const lines = integerOption(args, "lines", 1, 10000);
    const follow = args.options.follow === true;
    const intervalSec = intervalOption(args, "interval", 0.5, 60);
    const tailBytes = integerOption(args, "tail-bytes", 1, Number.MAX_SAFE_INTEGER);

    if (follow) {
      if (output !== undefined) {
        throw new CliInputError("Потоковое слежение несовместимо с --output.");
      }
      if (
        outputMode.requested === "json" ||
        outputMode.format === "csv" ||
        outputMode.format === "tsv"
      ) {
        throw new CliInputError(
          `Потоковое слежение не поддерживает формат ${outputMode.format}.`,
          "Подходят обычный вывод в терминале, --format table, --format jsonl или --format raw.",
        );
      }
      const streamFormat =
        outputMode.format === "jsonl" ? "jsonl" : outputMode.format === "raw" ? "raw" : "human";
      const initialLines =
        lines !== undefined
          ? lines
          : tailBytes === undefined && streamFormat === "human"
            ? DEFAULT_TAIL_LINES
            : undefined;
      const effectiveInterval = intervalSec ?? DEFAULT_INTERVAL_SEC;
      return {
        kind: "stream",
        mode: "tail",
        file,
        ...(initialLines === undefined ? {} : { lines: initialLines }),
        ...(tailBytes === undefined ? {} : { tailBytes }),
        intervalSec: effectiveInterval,
        intervalMs: Math.round(effectiveInterval * 1000),
        streamFormat,
        resolveType,
      };
    }

    if (lines !== undefined) {
      return {
        kind: "tail",
        file,
        lines,
        ...(tailBytes === undefined ? {} : { tailBytes }),
        resolveType,
      };
    }
    if (
      tailBytes === undefined &&
      (outputMode.format === "human" || outputMode.format === "table")
    ) {
      return {
        kind: "tail",
        file,
        lines: DEFAULT_TAIL_LINES,
        resolveType,
      };
    }
    assertFormatSupported(
      invocation.operationId,
      outputMode.format,
      invocation.args,
      "wtctl logs tail",
    );
    return { kind: "single", resolveType };
  }

  // action === "follow"
  const once = args.options.once === true;
  const intervalSec = intervalOption(args, "interval", 0.5, 60);
  const cursor = stringOption(args, "cursor");
  const tailBytes = integerOption(args, "tail-bytes", 1, Number.MAX_SAFE_INTEGER);
  const full = args.options.full === true;

  if (once) {
    assertFormatSupported(invocation.operationId, outputMode.format, invocation.args);
    return { kind: "single", resolveType };
  }

  if (intervalSec !== undefined) {
    if (output !== undefined) {
      throw new CliInputError("Потоковое слежение несовместимо с --output.");
    }
    if (
      outputMode.format === "json" ||
      outputMode.format === "csv" ||
      outputMode.format === "tsv"
    ) {
      throw new CliInputError(
        `Потоковый режим logs follow не поддерживает формат ${outputMode.format}.`,
        "В терминале подходит вывод по умолчанию или --format table, при перенаправлении (в pipe) — --format jsonl, --format raw или --format table; для одного опроса — --once.",
      );
    }
    const streamFormat =
      outputMode.format === "jsonl" ? "jsonl" : outputMode.format === "raw" ? "raw" : "human";
    return {
      kind: "stream",
      mode: "follow",
      file,
      ...(cursor === undefined ? {} : { cursor }),
      ...(tailBytes === undefined ? {} : { tailBytes }),
      ...(full ? { full: true } : {}),
      intervalSec,
      intervalMs: Math.round(intervalSec * 1000),
      streamFormat,
      resolveType,
    };
  }

  if (outputMode.format === "human" || outputMode.format === "table") {
    if (output !== undefined) {
      throw new CliInputError(
        "Потоковое слежение несовместимо с --output.",
        "Для одного опроса с сохранением в файл нужен флаг --once.",
      );
    }
    return {
      kind: "stream",
      mode: "follow",
      file,
      ...(cursor === undefined ? {} : { cursor }),
      ...(tailBytes === undefined ? {} : { tailBytes }),
      ...(full ? { full: true } : {}),
      intervalSec: DEFAULT_INTERVAL_SEC,
      intervalMs: DEFAULT_INTERVAL_SEC * 1000,
      streamFormat: "human",
      resolveType,
    };
  }

  if (io.stdoutIsTTY === true && (outputMode.format === "csv" || outputMode.format === "tsv")) {
    throw new CliInputError(
      `Потоковый режим logs follow не поддерживает --format ${outputMode.format}.`,
      "Для одного опроса нужен --once, для потока — вывод без --format (или --format table), либо --format jsonl/--format raw с --interval.",
    );
  }

  assertFormatSupported(invocation.operationId, outputMode.format, invocation.args);
  return { kind: "single", resolveType };
}

/**
 * Находит самый свежий файл лога по имени типа через logs.list({ type, limit: 1 }).
 * В читаемом выводе без --quiet печатает выбранное имя файла в stderr.
 */
export async function resolveLogFile(
  file: string,
  runtime: RuntimePort,
  io: CliIo,
  outputMode: OutputMode,
  quiet: boolean,
  progress?: ProgressIndicator,
): Promise<
  | { readonly ok: true; readonly file: string }
  | { readonly ok: false; readonly result: OperationResult }
> {
  if (!isLogTypeName(file)) return { ok: true, file };

  const listed = await runtime.call("logs.list", { type: file, limit: 1 });
  if (!listed.ok) return { ok: false, result: listed };

  const files = isRecord(listed.data) && Array.isArray(listed.data.files) ? listed.data.files : [];
  const latest = files.length > 0 && isRecord(files[0]) ? files[0].name : undefined;
  if (typeof latest !== "string" || !latest) {
    throw new HcmError(
      "LOG_NOT_FOUND",
      `Файлы лога типа "${file}" не найдены.`,
      "Список доступных типов и файлов показывает wtctl logs list.",
    );
  }

  if (!quiet && (outputMode.format === "human" || outputMode.format === "table")) {
    await progress?.clear();
    const styler = createStyler(resolveColor(io, "stderr"));
    try {
      await io.writeError(`${styler.dim(`Файл лога: ${latest}`)}\n`);
    } catch {
      /* Ошибка пометки в stderr не прерывает чтение лога. */
    }
  }

  return { ok: true, file: latest };
}

function initialTailWindowBytes(
  lines: number,
  outputLimitBytes: number,
  maxWindowBytes: number,
): number {
  const safeMax = Math.max(512, Math.floor(outputLimitBytes * 0.55));
  return Math.min(maxWindowBytes, safeMax, Math.max(16 * 1024, lines * 1024));
}

async function extractReadPayload(
  runtime: RuntimePort,
  result: OperationResult,
  fallbackFile: string,
): Promise<{
  readonly resolvedFile: string;
  readonly sizeBytes: number;
  readonly tailOnly: boolean;
  readonly fingerprint: string;
  readonly allEvents: readonly LogEvent[];
}> {
  const raw = result.meta.truncated === true ? await readStoredJson(runtime, result) : result.data;
  const data = isRecord(raw) ? raw : {};
  const text = typeof data.text === "string" ? data.text : "";
  const resolvedFile = typeof data.file === "string" ? data.file : fallbackFile;
  const sizeBytes = typeof data.sizeBytes === "number" ? data.sizeBytes : 0;
  const tailOnly = data.tailOnly === true;
  const fingerprint = typeof data.fingerprint === "string" ? data.fingerprint : "";
  const allEvents = parseLogEvents(text, undefined, tailOnly);
  return { resolvedFile, sizeBytes, tailOnly, fingerprint, allEvents };
}

async function readTailEvents(
  runtime: RuntimePort,
  file: string,
  lines: number,
  explicitTailBytes: number | undefined,
  outputLimitBytes: number,
  maxResponseBytes: number,
): Promise<
  | { readonly ok: false; readonly result: OperationResult }
  | {
      readonly ok: true;
      readonly result: OperationResult;
      readonly file: string;
      readonly sizeBytes: number;
      readonly tailOnly: boolean;
      readonly fingerprint: string;
      readonly allEvents: readonly LogEvent[];
      readonly sliced: readonly LogEvent[];
      readonly entries: readonly LogEntry[];
      readonly shortByLimit: boolean;
      readonly windowLimitBytes: number;
    }
> {
  const maxWindowBytes = Math.min(MAX_TAIL_EXPAND_BYTES, maxLogTailBytes(maxResponseBytes));
  let currentWindow =
    explicitTailBytes ?? initialTailWindowBytes(lines, outputLimitBytes, maxWindowBytes);
  let res = await runtime.call("logs.read", { file, tailBytes: currentWindow });
  if (!res.ok) return { ok: false, result: res };

  let parsed = await extractReadPayload(runtime, res, file);

  // Если в первом окне событий меньше запрошенного, а файл больше окна,
  // расширяем окно вплоть до min(4 МиБ, maxLogTailBytes(maxResponseBytes)).
  for (let attempt = 0; attempt < MAX_TAIL_EXPAND_ATTEMPTS; attempt++) {
    if (
      explicitTailBytes !== undefined ||
      parsed.allEvents.length >= lines ||
      !parsed.tailOnly ||
      parsed.sizeBytes <= currentWindow ||
      currentWindow >= maxWindowBytes
    ) {
      break;
    }
    const estimated =
      parsed.allEvents.length > 0
        ? Math.ceil((currentWindow * lines * 1.25) / parsed.allEvents.length)
        : currentWindow * 4;
    const desired = Math.max(currentWindow * 4, estimated);
    const nextWindow =
      desired >= parsed.sizeBytes
        ? Math.min(maxWindowBytes, Math.max(desired, parsed.sizeBytes + 4096))
        : Math.min(maxWindowBytes, desired);
    if (nextWindow <= currentWindow) break;
    currentWindow = nextWindow;

    const expanded = await runtime.call("logs.read", { file, tailBytes: currentWindow });
    if (!expanded.ok) return { ok: false, result: expanded };
    res = expanded;
    parsed = await extractReadPayload(runtime, expanded, file);
  }

  const sliced = parsed.allEvents.slice(-lines);
  return {
    ok: true,
    result: res,
    file: parsed.resolvedFile,
    sizeBytes: parsed.sizeBytes,
    tailOnly: parsed.tailOnly,
    fingerprint: parsed.fingerprint,
    allEvents: parsed.allEvents,
    sliced,
    entries: sliced.map(logEntry),
    shortByLimit: parsed.tailOnly && sliced.length < lines,
    windowLimitBytes: explicitTailBytes ?? maxWindowBytes,
  };
}

/**
 * Выполняет logs tail с ограничением числа последних событий (-n N или 50 по умолчанию в TTY).
 * Возвращает OperationResult для стандартного emit при json/ошибке, либо готовый код выхода.
 */
export async function runLogTail(
  plan: Extract<LogExecutionPlan, { kind: "tail" }>,
  parsed: CliArguments,
  io: CliIo,
  runtime: RuntimePort,
  outputMode: OutputMode,
  outputLimitBytes: number,
  maxResponseBytes: number,
  progress: ProgressIndicator,
  closeRuntime: () => Promise<{ readonly failed: boolean; readonly diagnostic?: OperationResult }>,
): Promise<
  | { readonly handled: false; readonly result: OperationResult }
  | { readonly handled: true; readonly exitCode: number }
> {
  const quiet = parsed.options.quiet === true;
  const resolved = plan.resolveType
    ? await resolveLogFile(plan.file, runtime, io, outputMode, quiet, progress)
    : ({ ok: true, file: plan.file } as const);
  if (!resolved.ok) return { handled: false, result: resolved.result };

  const read = await readTailEvents(
    runtime,
    resolved.file,
    plan.lines,
    plan.tailBytes,
    outputLimitBytes,
    maxResponseBytes,
  );
  if (!read.ok) return { handled: false, result: read.result };

  const trimmed = read.allEvents.length > read.sliced.length;
  const slicedRawText = read.sliced.length
    ? `${read.sliced.map((event) => event.text).join("\n")}\n`
    : "";

  if (outputMode.format === "json") {
    const { truncated: _, resultId: __, ...cleanMeta } = read.result.meta;
    return {
      handled: false,
      result: {
        ...read.result,
        meta: cleanMeta,
        data: {
          file: read.file,
          text: slicedRawText,
          sizeBytes: read.sizeBytes,
          tailOnly: read.tailOnly || trimmed,
          fingerprint: read.fingerprint,
        },
      },
    };
  }

  await progress.stop();
  const closed = await closeRuntime();
  const baseResult =
    closed.failed && closed.diagnostic
      ? frontendFailure(read.result, closed.diagnostic, "cleanupFailed")
      : read.result;

  const output = stringOption(parsed, "output");
  const styler = createStyler(output ? false : resolveColor(io, "stdout"));
  const quotedFile = quoteCliArg(read.file);
  const limitReason =
    plan.tailBytes !== undefined
      ? `в пределах --tail-bytes ${formatBytes(plan.tailBytes)}`
      : `прочитано не больше ${formatBytes(read.windowLimitBytes)} с конца файла`;
  let text: string;
  let stderrNote: string | undefined;

  if (outputMode.format === "human" || outputMode.format === "table") {
    text = read.entries.length
      ? `${renderLogEvents(read.entries, styler).join("\n")}\n`
      : `${styler.dim("Файл пуст.")}\n`;
    if (!quiet && (read.tailOnly || trimmed)) {
      const stderrStyler = createStyler(resolveColor(io, "stderr"));
      const size = read.sizeBytes > 0 ? formatBytes(read.sizeBytes) : "";
      if (read.shortByLimit) {
        stderrNote = `${stderrStyler.yellow(`Показан конец файла ${read.file} (${read.entries.length} из запрошенных ${plan.lines} событий: ${limitReason}${size ? `, файл ${size}` : ""}); весь файл: wtctl logs read ${quotedFile} --full.`)}\n`;
      } else {
        const detail = trimmed
          ? `последние ${read.entries.length} событий${size ? `, ${size}` : ""}`
          : size;
        stderrNote = `${stderrStyler.dim(`Показан конец файла ${read.file}${detail ? ` (${detail})` : ""}; весь файл: wtctl logs read ${quotedFile} --full.`)}\n`;
      }
    }
  } else if (outputMode.format === "jsonl") {
    text = read.entries.length
      ? `${read.entries.map((entry) => compactJson(entry)).join("\n")}\n`
      : "";
    if (!quiet && read.shortByLimit) {
      stderrNote = `Показан конец файла ${read.file} (${read.entries.length} из запрошенных ${plan.lines} событий: ${limitReason}); весь файл: wtctl logs read ${quotedFile} --full.\n`;
    }
  } else if (outputMode.format === "csv" || outputMode.format === "tsv") {
    const headers = ["sequence", "time", "context", "level", "text"];
    const rows = read.entries.map((entry) => [
      entry.sequence,
      entry.time ?? "",
      entry.context ?? "",
      entry.level,
      entry.text,
    ]);
    text = outputMode.format === "csv" ? formatCsv(headers, rows) : formatTsv(headers, rows);
    if (!quiet && read.shortByLimit) {
      stderrNote = `Показан конец файла ${read.file} (${read.entries.length} из запрошенных ${plan.lines} событий: ${limitReason}); весь файл: wtctl logs read ${quotedFile} --full.\n`;
    }
  } else {
    // raw
    text = slicedRawText;
    if (!quiet && (read.tailOnly || trimmed)) {
      stderrNote = read.shortByLimit
        ? `Показан конец файла ${read.file} (${read.entries.length} из запрошенных ${plan.lines} событий: ${limitReason}); весь файл: wtctl logs read ${quotedFile} --full.\n`
        : `Показан конец файла ${read.file}${read.sizeBytes > 0 ? ` (${read.sizeBytes} Б)` : ""}; весь файл: wtctl logs read ${quotedFile} --full.\n`;
    }
  }

  if (output) {
    try {
      await io.writeFile(output, text);
      const bytes = Buffer.byteLength(text, "utf8");
      if (!(await reportSaved(output, bytes, baseResult, parsed, io))) {
        return { handled: true, exitCode: 1 };
      }
      if (stderrNote) {
        try {
          await io.writeError(stderrNote);
        } catch {
          /* Пометка в stderr не отменяет сохранённый файл. */
        }
      }
      return { handled: true, exitCode: closed.failed ? 1 : 0 };
    } catch {
      await safeDiagnostic(
        io,
        failure(
          "cli.output_failed",
          "Результат команды получен, но сохранить локальный файл не удалось.",
        ),
        "human",
      );
      return { handled: true, exitCode: 1 };
    }
  }

  try {
    await io.writeOut(text);
  } catch {
    return { handled: true, exitCode: 1 };
  }
  if (stderrNote) {
    try {
      await io.writeError(stderrNote);
    } catch {
      /* Пометка в stderr не отменяет выданный результат. */
    }
  }
  return { handled: true, exitCode: closed.failed ? 1 : 0 };
}

function formatStreamEvents(
  events: readonly unknown[],
  format: "human" | "jsonl" | "raw",
  io: CliIo,
): string {
  if (!events.length) return "";
  if (format === "jsonl") {
    return `${events.map((event) => compactJson(event)).join("\n")}\n`;
  }
  if (format === "raw") {
    return formatRawLogEvents(events);
  }
  const styler = createStyler(resolveColor(io, "stdout"));
  return `${renderLogEvents(events, styler).join("\n")}\n`;
}

/**
 * Потоковый цикл слежения за логом (logs follow в TTY / --format jsonl --interval, а также logs tail -f).
 * Пережидает LOG_READ_UNAVAILABLE с прежним cursor и чисто завершается с кодом 0 по SIGINT/SIGTERM/AbortSignal,
 * удерживая обработчики сигналов до завершения закрытия сессии.
 */
export async function runLogStream(
  plan: Extract<LogExecutionPlan, { kind: "stream" }>,
  parsed: CliArguments,
  io: CliIo,
  runtime: RuntimePort,
  outputMode: OutputMode,
  outputLimitBytes: number,
  maxResponseBytes: number,
  closeRuntime: () => Promise<{ readonly failed: boolean; readonly diagnostic?: OperationResult }>,
): Promise<number> {
  const quiet = parsed.options.quiet === true;
  const sleep = io.sleep ?? abortableSleep;
  const followWindowBytes = Math.min(
    plan.tailBytes ?? DEFAULT_FOLLOW_WINDOW_BYTES,
    maxLogTailBytes(maxResponseBytes),
  );
  const controller = new AbortController();
  let forceCloseSkip: (() => void) | undefined;
  let inFlightRequest = false;
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
    else forceCloseSkip?.();
  };

  if (io.signal?.aborted) abort();
  const onExternalAbort = () => abort();
  io.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const unbindInterrupt = io.onInterrupt?.(abort);

  const reportError = async (result: OperationResult): Promise<number> => {
    if (controller.signal.aborted) return 0;
    await safeDiagnostic(
      io,
      errorInFrontendTerms(result, "cli"),
      outputMode.humanErrors ? "human" : "json",
    );
    return 1;
  };

  const raceRequest = async <T>(
    promise: Promise<T>,
  ): Promise<{ readonly aborted: true } | { readonly aborted: false; readonly value: T }> => {
    inFlightRequest = true;
    const result = await raceWithAbort(promise, controller.signal);
    if (!result.aborted) inFlightRequest = false;
    return result;
  };

  let exitCode = 0;
  const runBody = async (): Promise<number> => {
    if (controller.signal.aborted) return 0;

    let file = plan.file;
    if (plan.resolveType) {
      const raced = await raceRequest(resolveLogFile(plan.file, runtime, io, outputMode, quiet));
      if (raced.aborted) return 0;
      if (!raced.value.ok) return await reportError(raced.value.result);
      file = raced.value.file;
    }

    let cursor = plan.cursor;
    let pendingTailKeys: string[] | undefined;
    let clipFirstFollowTo: number | undefined;
    let reportedUnavailable = false;
    let waitBeforeFirstPoll = false;
    let idlePolls = 0;

    const trySwitchToLatestFile = async (): Promise<boolean> => {
      if (!plan.resolveType) return false;
      const raced = await raceRequest(runtime.call("logs.list", { type: plan.file, limit: 1 }));
      if (raced.aborted || !raced.value.ok) return false;
      const files =
        isRecord(raced.value.data) && Array.isArray(raced.value.data.files)
          ? raced.value.data.files
          : [];
      const latest = files.length > 0 && isRecord(files[0]) ? files[0].name : undefined;
      if (typeof latest !== "string" || !latest || latest === file) return false;
      file = latest;
      cursor = undefined;
      pendingTailKeys = undefined;
      idlePolls = 0;
      reportedUnavailable = false;
      if (!quiet && (plan.streamFormat === "human" || io.stderrIsTTY === true)) {
        const styler = createStyler(resolveColor(io, "stderr"));
        await safeWriteStderr(io, `${styler.dim(`Файл лога: ${latest}`)}\n`);
      }
      // Читаем новый файл целиком в пределах окна через logs.read, чтобы не потерять первые события,
      // если к моменту переключения в нём уже больше 10 записей.
      const readArgs: Record<string, unknown> = {
        file: latest,
        ...(plan.full ? { full: true } : { tailBytes: followWindowBytes }),
      };
      const racedRead = await raceRequest(runtime.call("logs.read", readArgs));
      if (!racedRead.aborted && racedRead.value.ok) {
        try {
          const racedPayload = await raceRequest(
            extractReadPayload(runtime, racedRead.value, latest),
          );
          if (!racedPayload.aborted) {
            const readCursor = buildLogFollowCursor(
              racedPayload.value.resolvedFile,
              racedPayload.value.fingerprint,
              racedPayload.value.sizeBytes,
              racedPayload.value.allEvents,
            );
            if (readCursor !== undefined) {
              const entries = racedPayload.value.allEvents.map(logEntry);
              if (entries.length > 0) {
                const chunk = formatStreamEvents(entries, plan.streamFormat, io);
                if (chunk) await io.writeOut(chunk);
              }
              cursor = readCursor;
              waitBeforeFirstPoll = true;
            }
          }
        } catch {
          /* Если чтение не удалось — продолжим через обычный logs.follow с cursor=undefined. */
        }
      }
      return true;
    };

    // Шаг 1: для logs tail -f с хвостом > 10 событий или явным --tail-bytes без -n
    // читаем хвост через logs.read и строим cursor прямо из этого же снимка (без зазора и потерь).
    const needsReadTail =
      plan.mode === "tail" &&
      ((plan.lines !== undefined && plan.lines > INITIAL_FOLLOW_EVENTS) ||
        (plan.lines === undefined && plan.tailBytes !== undefined));

    if (needsReadTail) {
      const readLines = plan.lines ?? 10_000;
      const racedTail = await raceRequest(
        readTailEvents(
          runtime,
          file,
          readLines,
          plan.tailBytes,
          outputLimitBytes,
          maxResponseBytes,
        ),
      );
      if (racedTail.aborted) return 0;
      const tailRes = racedTail.value;
      if (!tailRes.ok) {
        const code = tailRes.result.error?.code;
        if (code !== "LOG_READ_UNAVAILABLE" && code !== "LOG_CHANGED") {
          return await reportError(tailRes.result);
        }
        // Если файл занят в самый первый момент — переходим к циклу с ожиданием и повтором.
        reportedUnavailable = await reportBusy(io, plan, quiet, reportedUnavailable);
        waitBeforeFirstPoll = true;
      } else {
        const chunk = formatStreamEvents(tailRes.entries, plan.streamFormat, io);
        if (chunk) await io.writeOut(chunk);
        const readCursor = buildLogFollowCursor(
          tailRes.file,
          tailRes.fingerprint,
          tailRes.sizeBytes,
          tailRes.allEvents,
        );
        if (readCursor !== undefined) {
          cursor = readCursor;
          waitBeforeFirstPoll = true;
        } else {
          // Запасной путь только для тестов с условным fingerprint.
          pendingTailKeys = tailRes.entries.slice(-INITIAL_FOLLOW_EVENTS).map(entryOverlapKey);
        }
      }
    } else if (plan.mode === "tail" && plan.lines !== undefined) {
      clipFirstFollowTo = plan.lines;
    }

    // Цикл опроса logs.follow в одной сессии.
    let firstPoll = true;
    while (!controller.signal.aborted) {
      if (!firstPoll || waitBeforeFirstPoll) {
        await sleep(plan.intervalMs, controller.signal);
        if (controller.signal.aborted) return 0;
      }
      firstPoll = false;
      waitBeforeFirstPoll = false;

      const prevCursor = cursor;
      const followArgs: Record<string, unknown> = {
        file,
        ...optional("cursor", cursor),
        ...optional("tailBytes", plan.tailBytes),
        ...(plan.full ? { full: true } : {}),
      };
      const raced = await raceRequest(runtime.call("logs.follow", followArgs));
      if (raced.aborted) return 0;
      const res = raced.value;

      if (!res.ok) {
        const code = res.error?.code;
        if (code === "LOG_READ_UNAVAILABLE" || code === "LOG_CHANGED") {
          reportedUnavailable = await reportBusy(io, plan, quiet, reportedUnavailable);
          continue;
        }
        if (code === "LOG_NOT_FOUND") {
          const switched = await trySwitchToLatestFile();
          if (controller.signal.aborted) return 0;
          if (switched) {
            firstPoll = true;
            continue;
          }
        }
        return await reportError(res);
      }

      reportedUnavailable = false;
      let payload: unknown = res.data;
      if (res.meta.truncated === true) {
        const racedStored = await raceRequest(readStoredJson(runtime, res));
        if (racedStored.aborted) return 0;
        payload = racedStored.value;
      }
      const data = isRecord(payload) ? payload : undefined;
      if (!data || typeof data.cursor !== "string") {
        return await reportError(
          failure(
            "LOG_RESPONSE_INVALID",
            "Ответ logs.follow не содержит курсора для продолжения слежения.",
          ),
        );
      }
      let nextCursor = data.cursor;
      let events: readonly unknown[] = Array.isArray(data.events) ? data.events : [];
      let omitted = typeof data.omitted === "number" ? data.omitted : 0;
      let gapPossible = data.gapPossible === true;
      let resetReason = typeof data.resetReason === "string" ? data.resetReason : undefined;

      // Если пачка новых событий превысила pageBytes и logs.follow обрезал начало (omitted > 0),
      // дочитываем окно через logs.read и вычисляем полный список событий с прежним cursor без потерь.
      // Принимаем результат только если файл не сменился/не урезался между вызовами.
      if (omitted > 0 && prevCursor !== undefined) {
        const readArgs: Record<string, unknown> = {
          file,
          ...(plan.full ? { full: true } : { tailBytes: followWindowBytes }),
        };
        const racedRecover = await raceRequest(runtime.call("logs.read", readArgs));
        if (racedRecover.aborted) return 0;
        if (racedRecover.value.ok) {
          try {
            const racedExtract = await raceRequest(
              extractReadPayload(runtime, racedRecover.value, file),
            );
            if (racedExtract.aborted) return 0;
            const diff = sliceEventsAfterCursorToken(
              prevCursor,
              racedExtract.value.resolvedFile,
              racedExtract.value.fingerprint,
              racedExtract.value.sizeBytes,
              racedExtract.value.allEvents,
            );
            if (diff && !diff.gapPossible && diff.events.length >= events.length) {
              const recoveredEntries = diff.events.map(logEntry);
              const followKeys = events.map((item) =>
                isRecord(item) ? entryOverlapKey(item) : "",
              );
              const recoveredKeys = recoveredEntries.map(entryOverlapKey);
              if (containsEventSlice(recoveredKeys, followKeys)) {
                events = recoveredEntries;
                nextCursor = diff.cursor;
                omitted = 0;
                gapPossible = false;
                resetReason = undefined;
              }
            }
          } catch {
            /* При сбое дочитывания выводим полученный фрагмент и предупреждаем об omitted в stderr. */
          }
        }
      }

      cursor = nextCursor;

      if (pendingTailKeys !== undefined) {
        const followKeys = events.map((item) => (isRecord(item) ? entryOverlapKey(item) : ""));
        events = dedupeAfterTail(events, followKeys, pendingTailKeys);
        pendingTailKeys = undefined;
      } else if (clipFirstFollowTo !== undefined) {
        events = events.slice(-clipFirstFollowTo);
        clipFirstFollowTo = undefined;
      }

      if (events.length > 0) {
        idlePolls = 0;
        const chunk = formatStreamEvents(events, plan.streamFormat, io);
        if (chunk) await io.writeOut(chunk);
      } else if (data.changed === false) {
        idlePolls++;
        if (plan.resolveType && (idlePolls === 1 || idlePolls % 5 === 0)) {
          const switched = await trySwitchToLatestFile();
          if (controller.signal.aborted) return 0;
          if (switched) {
            firstPoll = true;
            continue;
          }
        }
      }

      if (!quiet) {
        const stderrStyler = createStyler(resolveColor(io, "stderr"));
        if (omitted > 0) {
          await safeWriteStderr(
            io,
            `${stderrStyler.yellow(`Пропущено ранних событий: ${omitted}.`)}\n`,
          );
        }
        if (gapPossible) {
          const reason = resetReason ? ` (${resetReason})` : "";
          await safeWriteStderr(
            io,
            `${stderrStyler.yellow(`Возможен пропуск событий${reason}.`)}\n`,
          );
        }
      }
    }

    return 0;
  };

  try {
    exitCode = await runBody();
  } catch (error) {
    if (controller.signal.aborted) {
      exitCode = 0;
    } else if ((error as NodeJS.ErrnoException | undefined)?.code === "EPIPE") {
      exitCode = 0;
    } else if (error instanceof HcmError) {
      exitCode = await reportError({
        ...failure(error.code, error.message, error.hint),
        error: error.toJSON(),
      });
    } else {
      throw error;
    }
  } finally {
    // Сначала закрываем сессию подключения, удерживая обработчики SIGINT/SIGTERM.
    // Если сигнал прервал зависший сетевой опрос и runtime.close() ждёт его в очереди,
    // ограничиваем ожидание коротким таймаутом (с .unref), чтобы Ctrl+C не зависал.
    const closing = closeRuntime();
    let timedOutOnHungSocket = false;
    if (controller.signal.aborted && inFlightRequest) {
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      const grace = new Promise<"timed-out">((resolve) => {
        forceCloseSkip = () => resolve("timed-out");
        graceTimer = setTimeout(() => resolve("timed-out"), CLOSE_GRACE_MS);
        graceTimer.unref?.();
      });
      const settled = await Promise.race([
        closing.then((value) => ({ done: true as const, value })),
        grace.then(() => ({ done: false as const })),
      ]);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      forceCloseSkip = undefined;
      if (!settled.done) {
        timedOutOnHungSocket = true;
        closing.catch(() => undefined);
      } else if (exitCode === 0 && settled.value.failed) {
        exitCode = 1;
      }
    } else {
      const closed = await closing;
      if (exitCode === 0 && closed.failed) exitCode = 1;
    }
    io.signal?.removeEventListener("abort", onExternalAbort);
    unbindInterrupt?.();
    if (timedOutOnHungSocket) io.forceExit?.(exitCode);
  }
  return exitCode;
}

async function reportBusy(
  io: CliIo,
  plan: Extract<LogExecutionPlan, { kind: "stream" }>,
  quiet: boolean,
  alreadyReported: boolean,
): Promise<boolean> {
  if (alreadyReported || quiet) return alreadyReported;
  if (plan.streamFormat !== "human" && io.stderrIsTTY !== true) return alreadyReported;
  const styler = createStyler(resolveColor(io, "stderr"));
  await safeWriteStderr(
    io,
    `${styler.dim(`Файл лога занят сервером, повтор через ${plan.intervalSec} с…`)}\n`,
  );
  return true;
}

async function safeWriteStderr(io: CliIo, text: string): Promise<void> {
  try {
    await io.writeError(text);
  } catch {
    /* Ошибка записи пометки в stderr не прерывает цикл слежения. */
  }
}
