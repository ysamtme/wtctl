import { performance } from "node:perf_hooks";
import type { ConnectionConfig, OperationResult } from "../contracts.js";
import { HcmError } from "../errors.js";
import { errorInFrontendTerms } from "../frontend-names.js";
import { logEntry, type LogEntry } from "../log-output.js";
import { maxLogTailBytes, parseLogEvents, type LogEvent } from "../logs.js";
import { ReplyPacker } from "../reply.js";
import { ResultStore } from "../results.js";
import { createStyler, formatBytes, resolveColor } from "./format/index.js";
import { readStoredJson } from "./output.js";
import type { ProgressIndicator } from "./progress.js";
import type { CliIo, RuntimePort } from "./types.js";

const DAY_SECONDS = 86_400;
const AGENT_LOG_TOLERANCE_SEC = 2;
const AGENT_LOG_TAIL_BYTES = 512 * 1024;
const MAX_AGENT_LOG_FILES = 3;
const MAX_SUMMARY_FIELD_CHARS = 120;

export interface AgentRunLogsAttachment {
  readonly type: "xhttp" | "agent";
  readonly file?: string;
  readonly files?: readonly string[];
  readonly events: readonly LogEntry[];
  readonly warning?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Экранирует управляющие символы C0/C1 (включая BEL и ESC), чтобы данные сервера не искажали терминал. */
export function sanitizeTerminalText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, (ch) => {
    const hex = ch.codePointAt(0)!.toString(16).padStart(2, "0");
    return `\\x${hex}`;
  });
}

/** Интерактивное подтверждение [y/N] включается в интерактивном терминале при наличии io.confirm, независимо от формата вывода. */
export function isInteractiveConfirm(io: CliIo): boolean {
  return io.stdoutIsTTY === true && typeof io.confirm === "function";
}

function renderPromptLines(entries: readonly (readonly [string, string])[], io: CliIo): string {
  const styler = createStyler(resolveColor(io, "stderr"));
  const nonEmpty = entries.filter(([, value]) => value !== "");
  const width = Math.max(...nonEmpty.map(([label]) => label.length)) + 1;
  return `${nonEmpty
    .map(([label, value]) => `${styler.dim(`${label}:`.padEnd(width))}  ${value}`)
    .join("\n")}\n`;
}

function compactSummaryValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return undefined;
  }
  const text = sanitizeTerminalText(String(value).replace(/[\r\n\t]+/g, " "))
    .replace(/ +/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > MAX_SUMMARY_FIELD_CHARS
    ? `${text.slice(0, MAX_SUMMARY_FIELD_CHARS - 1)}…`
    : text;
}

const OBJECT_SUMMARY_FIELDS: readonly (readonly [string, string])[] = [
  ["fullname", "ФИО"],
  ["name", "Название"],
  ["title", "Заголовок"],
  ["code", "Код"],
  ["login", "Логин"],
];

function extractObjectPreview(
  result: OperationResult | undefined,
  args: Readonly<Record<string, unknown>>,
): {
  readonly type?: string;
  readonly id?: string;
  readonly url?: string;
  readonly fields: readonly (readonly [string, string])[];
} {
  const data = result?.ok && isRecord(result.data) ? result.data : undefined;
  const source = data && isRecord(data.preview) ? data.preview : data;
  const type =
    (typeof source?.type === "string" && source.type) ||
    (typeof args.type === "string" ? args.type : undefined);
  const id =
    (typeof source?.id === "string" && source.id) ||
    (typeof args.id === "string" ? args.id : undefined);
  const url =
    (typeof source?.url === "string" && source.url) ||
    (typeof args.url === "string" ? args.url : undefined);

  const fields: [string, string][] = [];
  const docData = source && isRecord(source.data) ? source.data : undefined;
  const catalogData = source && isRecord(source.fromCatalog) ? source.fromCatalog : undefined;
  for (const [key, label] of OBJECT_SUMMARY_FIELDS) {
    const value =
      (docData && Object.hasOwn(docData, key) ? compactSummaryValue(docData[key]) : undefined) ??
      (catalogData && Object.hasOwn(catalogData, key)
        ? compactSummaryValue(catalogData[key])
        : undefined);
    if (value !== undefined) fields.push([label, value]);
  }
  return {
    ...(type === undefined ? {} : { type }),
    ...(id === undefined ? {} : { id }),
    ...(url === undefined ? {} : { url }),
    fields,
  };
}

/**
 * Показывает подключение и сведения о цели удаления / остановки и спрашивает подтверждение [y/N].
 * При отказе печатает «Отменено.» в stderr и возвращает false.
 */
export async function confirmDestructiveAction(
  operationId: "objects.delete" | "files.delete" | "web.spxml.killAsyncMethod",
  args: Readonly<Record<string, unknown>>,
  config: Pick<ConnectionConfig, "name" | "baseUrl">,
  runtime: RuntimePort,
  io: CliIo,
  progress: ProgressIndicator,
): Promise<boolean> {
  const styler = createStyler(resolveColor(io, "stderr"));
  const safeConnName = sanitizeTerminalText(config.name);
  const safeBaseUrl = sanitizeTerminalText(config.baseUrl);
  const connectionLine = `${styler.bold(safeConnName)} (${safeBaseUrl})`;
  let question: string;
  const entries: [string, string][] = [["Подключение", connectionLine]];

  if (operationId === "objects.delete") {
    progress.update("Проверка объекта…");
    const getArgs: Record<string, unknown> = {};
    if (typeof args.id === "string") getArgs.id = args.id;
    if (typeof args.url === "string") getArgs.url = args.url;
    if (typeof args.type === "string") getArgs.type = args.type;
    if (typeof args.dbName === "string") getArgs.dbName = args.dbName;

    let fetched: OperationResult | undefined;
    try {
      fetched = await runtime.call("objects.get", getArgs);
    } catch {
      // Ошибка предварительного чтения не должна блокировать подтверждение.
    }
    await progress.stop();

    const preview = extractObjectPreview(fetched, args);
    const safeType = preview.type ? sanitizeTerminalText(preview.type) : undefined;
    const safeId = preview.id ? sanitizeTerminalText(preview.id) : undefined;
    const safeUrl = preview.url ? sanitizeTerminalText(preview.url) : undefined;
    const label = [safeType, safeId].filter(Boolean).join(" · ");
    entries.push(["Объект", label ? styler.bold(label) : (safeUrl ?? "—")]);
    if (safeUrl && label) entries.push(["Адрес", safeUrl]);
    if (typeof args.dbName === "string") entries.push(["База", sanitizeTerminalText(args.dbName)]);
    for (const [fieldLabel, value] of preview.fields) entries.push([fieldLabel, value]);
    question = "Удалить объект без возможности восстановления? [y/N] ";
  } else if (operationId === "files.delete") {
    progress.update("Проверка файла…");
    const url = typeof args.url === "string" ? args.url : "";
    let existsResult: OperationResult | undefined;
    if (url) {
      try {
        existsResult = await runtime.call("files.exists", { url });
      } catch {
        // Ошибка предварительной проверки не должна блокировать подтверждение.
      }
    }
    await progress.stop();

    entries.push(["Файл", styler.bold(sanitizeTerminalText(url))]);
    if (existsResult?.ok && isRecord(existsResult.data)) {
      if (existsResult.data.exists === true) {
        const sizeRaw =
          typeof existsResult.data.bytes === "number"
            ? existsResult.data.bytes
            : typeof existsResult.data.sizeBytes === "number"
              ? existsResult.data.sizeBytes
              : undefined;
        const typeRaw =
          typeof existsResult.data.type === "string"
            ? sanitizeTerminalText(existsResult.data.type)
            : undefined;
        const details = [
          "существует",
          typeRaw,
          sizeRaw === undefined ? undefined : formatBytes(sizeRaw),
        ].filter(Boolean);
        entries.push(["Сведения", details.join(", ")]);
      } else if (existsResult.data.exists === false) {
        entries.push(["Сведения", styler.yellow("не найден на сервере")]);
      }
    }
    question = "Удалить файл на сервере? [y/N] ";
  } else {
    await progress.stop();
    const trackingId = typeof args.trackingId === "string" ? args.trackingId : "";
    entries.push(["Задача", styler.bold(sanitizeTerminalText(trackingId))]);
    entries.push(["Внимание", styler.yellow("Уже сделанные изменения не откатываются.")]);
    question = "Остановить фоновую задачу? [y/N] ";
  }

  await io.writeError(renderPromptLines(entries, io));
  const confirmed = await io.confirm!(question);
  if (!confirmed) {
    await io.writeError("Отменено.\n");
    return false;
  }
  return true;
}

function parseIsoTimestampMs(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?/.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  const fracMs = match[7] ? Math.round(Number(`0.${match[7]}`) * 1000) : 0;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second) + fracMs;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return undefined;
  }
  return ms;
}

function parseTimeOfDaySec(value: string): number | undefined {
  const match = /(?:^|T)(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?/.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const frac = match[4] ? Number(`0.${match[4]}`) : 0;
  return hour * 3600 + minute * 60 + second + frac;
}

function formatUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function extractDateFromFileName(name: string): string | undefined {
  const match = /(\d{4})[-_](\d{2})[-_](\d{2})/.exec(name);
  if (!match) return undefined;
  const candidate = `${match[1]}-${match[2]}-${match[3]}`;
  return parseIsoTimestampMs(`${candidate}T00:00:00`) !== undefined ? candidate : undefined;
}

function parseDateAndTimeMs(dateHint: string, time: string): number | undefined {
  const timeMatch = /(?:^|T)(\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/.exec(time.trim());
  if (!timeMatch) return undefined;
  return parseIsoTimestampMs(`${dateHint}T${timeMatch[1]}`);
}

/**
 * Отбирает события лога, попавшие в интервал [startedAt, finishedAt] с допуском ±toleranceSec.
 * При известной дате события/файла сравнивает полную дату и время; без даты — время суток с переходом через полночь.
 */
export function filterLogEventsByInterval(
  events: readonly LogEvent[],
  startedAt: string,
  finishedAt: string,
  toleranceSec = AGENT_LOG_TOLERANCE_SEC,
  fileDateHint?: string,
): LogEvent[] {
  let startSec = parseTimeOfDaySec(startedAt);
  let endSec = parseTimeOfDaySec(finishedAt);
  if (startSec === undefined || endSec === undefined) return [];

  const startMs = parseIsoTimestampMs(startedAt);
  const endMs = parseIsoTimestampMs(finishedAt);
  const hasFullRange = startMs !== undefined && endMs !== undefined;
  const minMs = hasFullRange ? Math.min(startMs, endMs) - toleranceSec * 1000 : undefined;
  const maxMs = hasFullRange ? Math.max(startMs, endMs) + toleranceSec * 1000 : undefined;

  if (hasFullRange && endMs < startMs) {
    [startSec, endSec] = [endSec, startSec];
  }

  const fullDayNoDate =
    (hasFullRange && maxMs! - minMs! >= DAY_SECONDS * 1000) ||
    ((endSec - startSec + DAY_SECONDS) % DAY_SECONDS) + 2 * toleranceSec >= DAY_SECONDS;
  const lo = (((startSec - toleranceSec) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  const hi = (((endSec + toleranceSec) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;

  return events.filter((event) => {
    if (event.time === undefined) return false;
    const eventDate = event.dateHint ?? fileDateHint;
    if (hasFullRange && eventDate !== undefined) {
      const eventMs = parseDateAndTimeMs(eventDate, event.time);
      if (eventMs !== undefined) {
        return eventMs >= minMs! && eventMs <= maxMs!;
      }
    }
    const t = parseTimeOfDaySec(event.time);
    if (t === undefined) return false;
    if (fullDayNoDate) return true;
    return lo <= hi ? t >= lo && t <= hi : t >= lo || t <= hi;
  });
}

async function finalizeAttachedLogs(
  agentResult: OperationResult,
  logs: AgentRunLogsAttachment,
  runtime: RuntimePort,
  config: ConnectionConfig,
  hasOutputFile: boolean,
): Promise<OperationResult> {
  const base = isRecord(agentResult.data) ? agentResult.data : {};
  const combinedData = { ...base, logs };
  if (!hasOutputFile) {
    const bytes = Buffer.byteLength(JSON.stringify(combinedData), "utf8");
    if (bytes > config.outputLimitBytes) {
      const put = runtime.results?.put?.bind(runtime.results);
      const store: Pick<ResultStore, "put"> = put ? { put } : new ResultStore(config);
      const packed = await new ReplyPacker(config, store).success(
        agentResult.meta.operationId,
        performance.now(),
        combinedData,
        true,
      );
      return {
        ...packed,
        meta: {
          ...packed.meta,
          durationMs: agentResult.meta.durationMs,
        },
      };
    }
  }
  return {
    ...agentResult,
    data: combinedData,
  };
}

interface ListedLogCandidate {
  readonly name: string;
  readonly dateHint?: string;
}

function selectLogFilesForInterval(
  rawFiles: readonly unknown[],
  startedAt: string,
  finishedAt: string,
): ListedLogCandidate[] {
  const candidates: ListedLogCandidate[] = [];
  for (const item of rawFiles) {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name) continue;
    const dateHint =
      (typeof item.date === "string" && item.date ? item.date : undefined) ??
      (typeof item.dateHint === "string" && item.dateHint ? item.dateHint : undefined) ??
      extractDateFromFileName(item.name);
    candidates.push({
      name: item.name,
      ...(dateHint === undefined ? {} : { dateHint }),
    });
  }
  if (candidates.length === 0) return [];

  const startMs = parseIsoTimestampMs(startedAt);
  const endMs = parseIsoTimestampMs(finishedAt);
  if (startMs === undefined || endMs === undefined) return [candidates[0]!];

  const minMs = Math.min(startMs, endMs) - AGENT_LOG_TOLERANCE_SEC * 1000;
  const maxMs = Math.max(startMs, endMs) + AGENT_LOG_TOLERANCE_SEC * 1000;
  const startDate = formatUtcDate(minMs);
  const endDate = formatUtcDate(maxMs);

  const dated = candidates.filter((file) => file.dateHint !== undefined);
  if (dated.length === 0) return [candidates[0]!];

  const inRange = dated.filter((file) => file.dateHint! >= startDate && file.dateHint! <= endDate);
  if (inRange.length === 0) return [candidates[0]!];

  // Хронологический порядок: сначала ранние даты, затем поздние; не более MAX_AGENT_LOG_FILES.
  inRange.sort(
    (left, right) =>
      left.dateHint!.localeCompare(right.dateHint!) || left.name.localeCompare(right.name),
  );
  return inRange.slice(-MAX_AGENT_LOG_FILES);
}

/**
 * Для `wtctl agent run --logs`: дочитывает в той же сессии файлы лога xhttp (или agent при started:false)
 * за даты интервала [startedAt, finishedAt] ± 2 с и проверяет outputLimitBytes. Ошибка чтения лога не отменяет агента.
 */
export async function attachAgentRunLogs(
  agentResult: OperationResult,
  runtime: RuntimePort,
  config: ConnectionConfig,
  progress: ProgressIndicator,
  hasOutputFile = false,
): Promise<OperationResult> {
  if (!agentResult.ok || !isRecord(agentResult.data) || agentResult.meta.truncated === true) {
    return agentResult;
  }

  const started = agentResult.data.started === true;
  const startedAt =
    typeof agentResult.data.startedAt === "string" ? agentResult.data.startedAt : "";
  const finishedAt =
    typeof agentResult.data.finishedAt === "string" ? agentResult.data.finishedAt : "";
  const logType: "xhttp" | "agent" = started ? "xhttp" : "agent";

  progress.update(`Чтение лога ${logType}…`);

  let resolvedFile: string | undefined;
  try {
    const listed = await runtime.call("logs.list", { type: logType, limit: 10 });
    if (!listed.ok) {
      const translated = errorInFrontendTerms(listed, "cli").error;
      const code = translated?.code ?? "LOG_LIST_FAILED";
      const message = translated?.message ?? "Не удалось получить список файлов лога.";
      return await finalizeAttachedLogs(
        agentResult,
        {
          type: logType,
          events: [],
          warning: `Не удалось получить список логов ${logType} [${code}]: ${message}`,
          error: { code, message },
        },
        runtime,
        config,
        hasOutputFile,
      );
    }

    const listedRaw =
      listed.meta.truncated === true ? await readStoredJson(runtime, listed) : listed.data;
    const rawFiles = isRecord(listedRaw) && Array.isArray(listedRaw.files) ? listedRaw.files : [];
    const targets = selectLogFilesForInterval(rawFiles, startedAt, finishedAt);
    if (targets.length === 0) {
      return await finalizeAttachedLogs(
        agentResult,
        {
          type: logType,
          events: [],
          warning: `Файлы лога типа "${logType}" на сервере не найдены.`,
          error: { code: "LOG_NOT_FOUND", message: `Файлы лога типа "${logType}" не найдены.` },
        },
        runtime,
        config,
        hasOutputFile,
      );
    }

    const tailBytes = Math.min(AGENT_LOG_TAIL_BYTES, maxLogTailBytes(config.maxResponseBytes));
    const collected: LogEntry[] = [];
    const readFileNames: string[] = [];
    const warnings: string[] = [];
    let firstError: { readonly code: string; readonly message: string } | undefined;

    for (const target of targets) {
      resolvedFile = target.name;
      const readRes = await runtime.call("logs.read", { file: target.name, tailBytes });
      if (!readRes.ok) {
        const translated = errorInFrontendTerms(readRes, "cli").error;
        const code = translated?.code ?? "LOG_READ_FAILED";
        const message = translated?.message ?? "Не удалось прочитать файл лога.";
        firstError ??= { code, message };
        warnings.push(`Не удалось прочитать лог ${target.name} [${code}]: ${message}`);
        continue;
      }

      const raw =
        readRes.meta.truncated === true ? await readStoredJson(runtime, readRes) : readRes.data;
      const readData = isRecord(raw) ? raw : {};
      const text = typeof readData.text === "string" ? readData.text : "";
      const fileName = typeof readData.file === "string" ? readData.file : target.name;
      const tailOnly = readData.tailOnly === true;
      const effectiveDateHint = target.dateHint ?? extractDateFromFileName(fileName);

      readFileNames.push(fileName);
      const allEvents = parseLogEvents(text, effectiveDateHint, tailOnly);
      const matched = filterLogEventsByInterval(
        allEvents,
        startedAt,
        finishedAt,
        AGENT_LOG_TOLERANCE_SEC,
        effectiveDateHint,
      );
      for (const event of matched) collected.push(logEntry(event));
    }

    const primaryFile =
      readFileNames.length > 0
        ? readFileNames[readFileNames.length - 1]!
        : targets[targets.length - 1]!.name;
    const attachment: AgentRunLogsAttachment = {
      type: logType,
      file: primaryFile,
      ...(readFileNames.length > 1 ? { files: readFileNames } : {}),
      events: collected,
      ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
      ...(firstError && readFileNames.length === 0 ? { error: firstError } : {}),
    };
    return await finalizeAttachedLogs(agentResult, attachment, runtime, config, hasOutputFile);
  } catch (error) {
    const code = error instanceof HcmError ? error.code : "LOG_READ_FAILED";
    const message =
      error instanceof HcmError
        ? error.message
        : `Не удалось прочитать лог ${resolvedFile ?? logType}.`;
    return await finalizeAttachedLogs(
      agentResult,
      {
        type: logType,
        ...(resolvedFile === undefined ? {} : { file: resolvedFile }),
        events: [],
        warning: `Не удалось прочитать лог ${resolvedFile ?? logType} [${code}]: ${message}`,
        error: { code, message },
      },
      runtime,
      config,
      hasOutputFile,
    );
  }
}
