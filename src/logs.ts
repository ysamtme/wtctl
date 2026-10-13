import { createHash } from "node:crypto";
import { HcmError, inputObject, boundedInteger, requiredString } from "./errors.js";
import type { ServerPort } from "./hcm-server.js";
import { parseXml } from "./protocol/xml.js";
import { rpcArgument } from "./server-value.js";
import { WsHcmApiError, attachCleanupError, isTransportFailure } from "./protocol/error.js";

export type LogGateway = ServerPort;
export interface LogFile {
  readonly name: string;
  readonly url: string;
  readonly title: string;
  readonly type: string;
  readonly sizeBytes: string;
  readonly dateLabel: string;
  readonly dateHint?: string;
  readonly rawDateSeconds?: string;
  readonly redFlag: boolean;
}
export interface LogListInput {
  readonly type?: string;
  readonly nameContains?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly offset?: number;
  readonly limit?: number;
}
export interface LogListData {
  readonly files: readonly LogFile[];
  readonly total: number;
  readonly nextOffset?: number;
  readonly dateSemantics: "server calendar date; timezone unspecified";
}
export interface LogReadInput {
  readonly file: string;
  readonly tailBytes?: number;
  readonly full?: boolean;
}
/**
 * Собственный читатель сервера отказал на файле из списка и при повторной попытке. Причину
 * сервер не называет; на стендах это бывает, пока он пишет в этот файл.
 */
export class LogReadUnavailableError extends HcmError {
  constructor() {
    super(
      "LOG_READ_UNAVAILABLE",
      "Сервер не отдал текст лога и со второй попытки. Несколько секунд после каждой записанной строки он держит файл лога занятым.",
      "На нагруженном сервере лог за сегодня может не читаться вовсе; логи за прошлые даты читаются в любое время.",
    );
  }
}
export interface LogReadData {
  readonly file: LogFile;
  readonly text: string;
  readonly requestedMode: "full" | "tail";
  readonly requestedTailBytes?: number;
  /** Фактически переданный серверу ограниченный диапазон; может быть меньше запрошенного хвоста. */
  readonly effectiveTailBytes: number;
  readonly sizeBytesBefore: string;
  readonly sizeBytesAfter: string;
  readonly serverTailNotice: boolean;
  readonly truncated: boolean;
  readonly returnedChars: number;
  readonly fingerprint: string;
  readonly semantics: "server RPC text; byte offsets and original encoding are not preserved";
  readonly consistency:
    | "file size checked before and after; full reads also compare available date metadata; no atomic snapshot or same-size rewrite guarantee"
    | "empty file reported before and after; zero range does not open file or flush pending log writes";
}
export type LogLevel = "normal" | "debug" | "info" | "warning" | "error" | "critical";
export interface LogEvent {
  readonly sequence: number;
  readonly time?: string;
  readonly dateHint?: string;
  readonly context?: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly text: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly partialBeginning?: boolean;
}
export interface LogSearchInput extends LogReadInput {
  readonly text?: string;
  readonly level?: LogLevel;
  readonly context?: string;
  readonly offset?: number;
  readonly limit?: number;
  /** Сначала новейшие совпадения; offset тогда считается с конца файла. */
  readonly newestFirst?: boolean;
  readonly expectedFingerprint?: string;
}
export interface LogSearchData {
  readonly file: LogFile;
  readonly events: readonly LogEvent[];
  readonly totalEvents: number;
  readonly matches: number;
  readonly fingerprint: string;
  readonly truncated: boolean;
  readonly nextOffset?: number;
  readonly severityDetection: "text heuristic";
  readonly lineNumbers: "relative to fetched text";
}
export interface LogFollowInput extends LogReadInput {
  readonly cursor?: string;
}
export interface LogFollowData {
  readonly file: LogFile;
  readonly events: readonly LogEvent[];
  readonly cursor: string;
  readonly changed: boolean;
  readonly gapPossible: boolean;
  readonly windowTruncated: boolean;
  readonly resetReason?: "overlap-not-found" | "file-size-decreased" | "ambiguous-overlap";
  readonly semantics: "tail overlap; updated final events may be repeated; no byte cursor or exactly-once guarantee";
}

const LEVELS: readonly LogLevel[] = ["normal", "debug", "info", "warning", "error", "critical"];
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
function text(value: unknown, label: string, optional = false): string {
  if (typeof value === "string") return value;
  if (
    value !== null &&
    typeof value === "object" &&
    "#text" in value &&
    typeof value["#text"] === "string"
  )
    return value["#text"];
  if (optional && value === undefined) return "";
  throw new HcmError("LOG_REPORT_INVALID", `Отчёт сервера о логах: не читается ${label}.`);
}
function date(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const source = requiredString(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(source) ||
    Number.isNaN(Date.parse(`${source}T00:00:00Z`)) ||
    new Date(`${source}T00:00:00Z`).toISOString().slice(0, 10) !== source
  )
    throw new HcmError("INVALID_LOG_DATE", `${label}: нужна дата в виде ГГГГ-ММ-ДД.`);
  return source;
}
function filename(value: unknown): string {
  const source = requiredString(value, "file");
  if (
    source.length > 255 ||
    /[\\/\u0000-\u001F\u007F]/.test(source) ||
    !/\.log$/i.test(source) ||
    source === "." ||
    source === ".."
  )
    throw new HcmError(
      "INVALID_LOG_FILE",
      "Нужно имя файла .log или его адрес из logs.list; путь с папками не принимается.",
    );
  return source;
}
/**
 * К какому логу относится файл: его имя без даты. Собственный столбец типа на сервере
 * сводит большинство логов в одну группу, поэтому по нему их не различить.
 */
export function logKind(name: string): string {
  return name.replace(/\.log$/i, "").replace(/[_-]?\d{4}-\d{2}-\d{2}.*$/, "") || name;
}
function canonicalUrl(name: string): string {
  return `x-local://Logs/${encodeURIComponent(name)}`;
}
function selectedName(value: unknown): string {
  const source = requiredString(value, "file");
  if (!source.includes("://")) return filename(source);
  let url: URL;
  let name: string;
  try {
    url = new URL(source);
    name = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new HcmError("INVALID_LOG_FILE", "Адрес лога записан неверно.");
  }
  if (
    url.protocol !== "x-local:" ||
    url.hostname.toLowerCase() !== "logs" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new HcmError(
      "INVALID_LOG_FILE",
      "Читаются только логи из папки Logs сервера: адрес вида x-local://Logs/имя.log.",
    );
  return filename(name);
}

/** Разбирает фактические ячейки таблицы данных от tools_report.server_log_report. */
export function parseLogReport(source: string): LogFile[] {
  const parsed = parseXml(source);
  if (Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, "data"))
    throw new HcmError("LOG_REPORT_INVALID", "Сервер вернул отчёт о логах в неожиданном виде.");
  const data = parsed.data;
  if (data === "") return [];
  const container = inputObject(data, "отчёт о логах").rs;
  if (container === undefined || container === "") return [];
  const raw = inputObject(container, "строки отчёта о логах").r;
  const rows = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  if (rows.length > 10000)
    throw new HcmError("LOG_REPORT_TOO_LARGE", "В отчёте сервера о логах больше 10000 строк.");
  const names = new Set<string>();
  return rows.map((value) => {
    const rawCells = inputObject(
      inputObject(value, "строка отчёта о логах").cs,
      "ячейки строки отчёта о логах",
    ).c;
    if (!Array.isArray(rawCells) || rawCells.length < 7)
      throw new HcmError(
        "LOG_REPORT_INVALID",
        "В строке отчёта сервера о логах меньше семи ячеек.",
      );
    const cells = rawCells.map((cell) =>
      cell === "" ? {} : inputObject(cell, "ячейка отчёта о логах"),
    );
    const name = filename(text(cells[2]!.t, "имя файла"));
    const reportedUrl = text(cells[6]!.t, "адрес файла");
    if (selectedName(reportedUrl) !== name)
      throw new HcmError(
        "LOG_REPORT_INVALID",
        "В отчёте сервера о логах адрес файла не совпадает с его именем.",
      );
    if (names.has(name))
      throw new HcmError("LOG_REPORT_INVALID", "В отчёте сервера о логах имя файла повторяется.");
    names.add(name);
    const sizeBytes = text(cells[3]!.r ?? cells[3]!.t, "размер файла");
    if (!/^\d{1,20}$/.test(sizeBytes) || BigInt(sizeBytes) > 0xffffffffffffffffn)
      throw new HcmError(
        "LOG_REPORT_INVALID",
        "В отчёте сервера о логах размер файла — не целое неотрицательное число.",
      );
    const dateLabel = text(cells[1]!.t, "дата", true);
    const dateFromName = /(?:^|[_-])(\d{4}-\d{2}-\d{2})(?:\D|$)/.exec(name)?.[1];
    const labelMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateLabel);
    const dateHint =
      dateFromName ??
      (labelMatch ? `${labelMatch[3]}-${labelMatch[2]}-${labelMatch[1]}` : undefined);
    const rawDateSeconds = text(cells[1]!.r, "дата в секундах", true);
    return {
      name,
      url: canonicalUrl(name),
      title: text(cells[0]!.t, "заголовок", true),
      type: logKind(name),
      sizeBytes,
      dateLabel,
      ...(dateHint === undefined ? {} : { dateHint }),
      ...(rawDateSeconds === "" ? {} : { rawDateSeconds }),
      redFlag: text(cells[5]!.t, "признак redFlag", true) === "true",
    };
  });
}

// Сервер не пишет уровень; отказ попадает в лог голой русской строкой вроде «Элемент не найден».
const ERROR_WORDS =
  /\b(?:error|exception|failed|denied|invalid)\b|not defined|not found|not allowed|unknown object property|unknown method|unregistered|wrong number of arguments|already declared|(?:^|\s)major:|ошибк|не найден|не удалось|исключени|недопустим|отказано|запрещ[её]н|уже открыт|невозможно/i;
function severity(message: string): LogLevel {
  if (/\b(?:critical|fatal)\b|критическ/i.test(message)) return "critical";
  if (ERROR_WORDS.test(message)) return "error";
  if (/\b(?:warning|warn)\b|предупрежд/i.test(message)) return "warning";
  if (/\b(?:debug|trace)\b/i.test(message)) return "debug";
  if (/\b(?:info|information|inform)\b/i.test(message)) return "info";
  return "normal";
}
/** Сохраняет строки продолжения и стеки; время остаётся текстом в местном времени сервера. */
export function parseLogEvents(
  source: string,
  dateHint?: string,
  partialBeginning = false,
): LogEvent[] {
  const lines = source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events: Array<{
    sequence: number;
    time?: string;
    dateHint?: string;
    context?: string;
    message: string;
    lines: string[];
    lineStart: number;
    lineEnd: number;
    partialBeginning?: boolean;
  }> = [];
  for (const [index, line] of lines.entries()) {
    const match = /^\s{0,3}((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:[.,]\d+)?)(?:\s+(.*)|$)/.exec(line);
    if (match || (!events.length && line !== "")) {
      let message = match?.[2] ?? line;
      const context = /^\[([^\]]+)\]\s*/.exec(message);
      if (context) message = message.slice(context[0].length);
      events.push({
        sequence: events.length + 1,
        ...(match?.[1] === undefined ? {} : { time: match[1] }),
        ...(dateHint === undefined ? {} : { dateHint }),
        ...(context?.[1] === undefined ? {} : { context: context[1] }),
        message,
        lines: [line],
        lineStart: index + 1,
        lineEnd: index + 1,
        ...(!events.length && partialBeginning ? { partialBeginning: true } : {}),
      });
    } else if (events.length) {
      const last = events.at(-1)!;
      last.lines.push(line);
      last.lineEnd = index + 1;
    }
  }
  // Каждое завершённое тело оценивается один раз. Время и контекст остаются в тексте, но
  // на серьёзность влияют только первое сообщение и его строки продолжения.
  return events.map(({ lines, ...event }) => ({
    ...event,
    level: severity([event.message, ...lines.slice(1)].join("\n")),
    text: lines.join("\n"),
  }));
}

function rpcString(value: unknown): string {
  const result = inputObject(value, "ответ функции сервера");
  if (result.valueType !== "string" || typeof result.lexicalValue !== "string")
    throw new HcmError("LOG_RESPONSE_INVALID", "Функция сервера вернула не строку.");
  return result.lexicalValue;
}
interface FollowCursor {
  version: 1;
  file: string;
  fingerprint: string;
  sizeBytes: string;
  anchors: string[];
}

/** Доступ к логам только удалённо: два существующих проверенных метода чтения платформы. */
export class LogReader {
  private readonly maxTailBytes: number;
  private readonly busyMs: number;
  private busyUntil = 0;
  constructor(
    private readonly gateway: LogGateway,
    options: { readonly maxResponseBytes: number; readonly logBusyMs?: number },
  ) {
    this.busyMs = options.logBusyMs ?? 5500;
    if (!Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes < 1024)
      throw new HcmError("INVALID_ARGUMENT", "maxResponseBytes: нужно целое число не меньше 1024.");
    this.maxTailBytes = Math.max(1, Math.floor((options.maxResponseBytes - 512) / 6));
  }
  /**
   * Сервер держит файл лога за собой около пяти секунд после записи в него строки
   * (замер на 2025.1.1333 и 2025.2.1535) и всё это время отказывает в чтении. Владелец
   * отмечает запрос, который сервер только что отклонил, потому что в лог пишется именно отказ.
   */
  serverWroteLog(): void {
    this.busyUntil = Date.now() + this.busyMs;
  }
  private async whileBusy(): Promise<void> {
    const wait = this.busyUntil - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  private async allFiles(): Promise<LogFile[]> {
    const params =
      "<func_params><server_log_report><type_id>all</type_id><show_alert>false</show_alert></server_log_report></func_params>";
    const response = await this.gateway.call("native.rpc.call", {
      target: "tools_report.server_log_report",
      args: [rpcArgument(encodeURIComponent(params))],
    });
    return parseLogReport(rpcString(response));
  }
  async list(input: LogListInput = {}): Promise<LogListData> {
    const start = date(input.startDate, "startDate");
    const end = date(input.endDate, "endDate");
    if (start && end && start > end)
      throw new HcmError("INVALID_LOG_DATE", "startDate позже endDate.");
    const offset = boundedInteger(input.offset, 0, Number.MAX_SAFE_INTEGER, "offset");
    const limit = boundedInteger(input.limit, 30, 1000, "limit");
    if (!limit) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    const type = input.type === undefined ? undefined : requiredString(input.type, "type");
    const filter =
      input.nameContains === undefined
        ? undefined
        : requiredString(input.nameContains, "nameContains").toLowerCase();
    const files = (await this.allFiles())
      .filter(
        (file) =>
          (!type || file.type === type) &&
          (!filter || file.name.toLowerCase().includes(filter)) &&
          (!start || (file.dateHint !== undefined && file.dateHint >= start)) &&
          (!end || (file.dateHint !== undefined && file.dateHint <= end)),
      )
      // Сервер перечисляет по имени, поэтому первая страница — самые старые файлы первого лога.
      .sort(
        (left, right) =>
          (right.dateHint ?? "").localeCompare(left.dateHint ?? "") ||
          left.name.localeCompare(right.name),
      );
    return {
      files: files.slice(offset, offset + limit),
      total: files.length,
      ...(offset + limit < files.length ? { nextOffset: offset + limit } : {}),
      dateSemantics: "server calendar date; timezone unspecified",
    };
  }
  async read(input: LogReadInput): Promise<LogReadData> {
    const name = selectedName(input.file);
    if (input.full !== undefined && typeof input.full !== "boolean")
      throw new HcmError("INVALID_ARGUMENT", "full: нужно true или false.");
    if (input.full && input.tailBytes !== undefined)
      throw new HcmError("INVALID_ARGUMENT", "Нужно указать full или tailBytes, но не оба.");
    const tailBytes = boundedInteger(
      input.tailBytes,
      Math.min(524288, this.maxTailBytes),
      this.maxTailBytes,
      "tailBytes",
    );
    if (!tailBytes) throw new HcmError("INVALID_ARGUMENT", "tailBytes: нужно число больше нуля.");
    const refused = (error: unknown): error is WsHcmApiError =>
      error instanceof WsHcmApiError &&
      error.kind === "soap-fault" &&
      error.status === 500 &&
      error.operation === "CallMethod" &&
      error.requestSent !== false &&
      !isTransportFailure(error);
    // Размер и диапазон заново на каждой попытке: отклонённое чтение пишет в лог свою строку.
    const attempt = async () => {
      const file = (await this.allFiles()).find((item) => item.name === name);
      if (!file)
        throw new HcmError(
          "LOG_NOT_FOUND",
          "Такого файла нет среди логов сервера.",
          "Имена файлов показывает logs.list. Файлы вне списка логов не читаются.",
        );
      const sizeBefore = BigInt(file.sizeBytes);
      if (input.full && sizeBefore > BigInt(this.maxTailBytes))
        throw new HcmError(
          "LOG_TOO_LARGE",
          "Лог целиком не помещается в предел чтения подключения.",
          "Нужно прочитать конец файла (tailBytes) или увеличить maxResponseBytes подключения.",
        );
      // Штатная функция берёт LoadUrlData для null или слишком большого хвоста. Активные
      // логи сервера могут отклонить режим совместного доступа этого загрузчика. Диапазон не
      // больше известного размера файла (включая равенство) выбирает LoadFileDataRange; это
      // всё равно зависит от правил доступа и совместного использования на сервере.
      const effectiveTailBytes = Number(
        input.full || sizeBefore < BigInt(tailBytes) ? sizeBefore : BigInt(tailBytes),
      );
      try {
        const response = await this.gateway.call("native.rpc.call", {
          target: "tools.load_url_data_server",
          args: [rpcArgument(file.url), rpcArgument(effectiveTailBytes)],
        });
        return { file, sizeBefore, effectiveTailBytes, response };
      } catch (error) {
        if (!refused(error)) throw error;
        return { refusal: error };
      }
    };
    await this.whileBusy();
    let read = await attempt();
    if ("refusal" in read) {
      const first = read.refusal;
      // Отклонённое чтение само пишется в лог сервера, поэтому ожидание идёт заново отсюда.
      this.serverWroteLog();
      await this.whileBusy();
      read = await attempt();
      if ("refusal" in read) {
        const unavailable = new LogReadUnavailableError();
        for (const error of [first, read.refusal])
          if (error.cleanupError !== undefined) attachCleanupError(unavailable, error.cleanupError);
        throw unavailable;
      }
    }
    const { file, sizeBefore, effectiveTailBytes, response } = read;
    const returned = rpcString(response);
    const notice =
      /^Показано последние (\d+) байт файла\. Для просмотра всего файла его нужно сохранить\.\r?\n/.exec(
        returned,
      );
    if (notice && notice[1] !== String(effectiveTailBytes))
      throw new HcmError(
        "LOG_RESPONSE_INVALID",
        "Сервер сообщил не тот размер прочитанного конца файла, который был запрошен.",
      );
    const after = (await this.allFiles()).find((item) => item.name === name);
    if (
      !after ||
      BigInt(after.sizeBytes) < sizeBefore ||
      (sizeBefore === 0n && BigInt(after.sizeBytes) !== 0n) ||
      (input.full && BigInt(after.sizeBytes) !== sizeBefore) ||
      ((input.full || sizeBefore === 0n) &&
        (file.rawDateSeconds !== after.rawDateSeconds ||
          file.dateHint !== after.dateHint ||
          file.dateLabel !== after.dateLabel)) ||
      !notice
    )
      throw new HcmError(
        "LOG_CHANGED",
        "Лог изменился или исчез, пока читался.",
        "Чтение нужно повторить: прочитанный текст отброшен. Список файлов покажет logs.list.",
      );
    const body = notice ? returned.slice(notice[0].length) : returned;
    if (effectiveTailBytes === 0 && body !== "")
      throw new HcmError("LOG_RESPONSE_INVALID", "Сервер вернул текст, хотя файл лога пуст.");
    return {
      file: after,
      text: body,
      requestedMode: input.full ? "full" : "tail",
      ...(input.full ? {} : { requestedTailBytes: tailBytes }),
      effectiveTailBytes,
      sizeBytesBefore: file.sizeBytes,
      sizeBytesAfter: after.sizeBytes,
      serverTailNotice: !!notice,
      truncated:
        sizeBefore > BigInt(effectiveTailBytes) ||
        BigInt(after.sizeBytes) > BigInt(effectiveTailBytes),
      returnedChars: body.length,
      fingerprint: hash(body),
      semantics: "server RPC text; byte offsets and original encoding are not preserved",
      consistency:
        sizeBefore === 0n
          ? "empty file reported before and after; zero range does not open file or flush pending log writes"
          : "file size checked before and after; full reads also compare available date metadata; no atomic snapshot or same-size rewrite guarantee",
    };
  }
  async search(input: LogSearchInput): Promise<LogSearchData> {
    if (input.level !== undefined && !LEVELS.includes(input.level))
      throw new HcmError(
        "INVALID_LOG_LEVEL",
        "level: нужно одно из normal, debug, info, warning, error, critical.",
      );
    const offset = boundedInteger(input.offset, 0, Number.MAX_SAFE_INTEGER, "offset");
    const limit = boundedInteger(input.limit, 100, 1000, "limit");
    if (!limit) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    const query =
      input.text === undefined ? undefined : requiredString(input.text, "text").toLowerCase();
    const context =
      input.context === undefined
        ? undefined
        : requiredString(input.context, "context").toLowerCase();
    const read = await this.read(input);
    if (input.expectedFingerprint !== undefined && input.expectedFingerprint !== read.fingerprint)
      throw new HcmError(
        "LOG_CHANGED",
        "Лог изменился между страницами поиска.",
        "Поиск нужно начать с первой страницы и дальше передавать fingerprint из нового ответа.",
      );
    const all = parseLogEvents(read.text, read.file.dateHint, read.truncated);
    const events = all.filter(
      (event) =>
        (!input.level || event.level === input.level) &&
        (!query || event.text.toLowerCase().includes(query)) &&
        (!context || event.context?.toLowerCase().includes(context)),
    );
    if (input.newestFirst === true) events.reverse();
    return {
      file: read.file,
      events: events.slice(offset, offset + limit),
      totalEvents: all.length,
      matches: events.length,
      fingerprint: read.fingerprint,
      truncated: read.truncated,
      ...(offset + limit < events.length ? { nextOffset: offset + limit } : {}),
      severityDetection: "text heuristic",
      lineNumbers: "relative to fetched text",
    };
  }
  async follow(input: LogFollowInput): Promise<LogFollowData> {
    let previous: FollowCursor | undefined;
    if (input.cursor !== undefined) {
      try {
        if (input.cursor.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
        const raw = inputObject(
          JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
        );
        if (
          raw.version !== 1 ||
          typeof raw.file !== "string" ||
          typeof raw.fingerprint !== "string" ||
          !/^[0-9a-f]{16}$/.test(raw.fingerprint) ||
          typeof raw.sizeBytes !== "string" ||
          !/^\d+$/.test(raw.sizeBytes) ||
          raw.sizeBytes.length > 20 ||
          !Array.isArray(raw.anchors) ||
          raw.anchors.length > 8 ||
          raw.anchors.some((anchor) => typeof anchor !== "string" || !/^[0-9a-f]{16}$/.test(anchor))
        )
          throw new Error();
        previous = raw as unknown as FollowCursor;
        if (selectedName(previous.file) !== selectedName(input.file)) throw new Error();
      } catch {
        throw new HcmError(
          "INVALID_LOG_CURSOR",
          "cursor неверен или получен для другого файла лога.",
        );
      }
    }
    const read = await this.read(input);
    const events = parseLogEvents(read.text, read.file.dateHint, read.truncated);
    // Завершающий перевод строки файла при дозаписи становится разделителем перед новым событием.
    // В якорях перекрытия игнорируются лишь завершающие переводы строк; текст событий сохраняется.
    // Курсор ездит с каждым вызовом, поэтому несёт короткие метки: 64 бита различают
    // события одного окна, а для поиска перекрытия хватает последних восьми событий.
    const hashes = events.map((event) => hash(event.text.replace(/\n+$/, "")).slice(0, 16));
    const fingerprint = read.fingerprint.slice(0, 16);
    let start = 0;
    let resetReason: LogFollowData["resetReason"];
    const changed =
      !previous ||
      previous.fingerprint !== fingerprint ||
      previous.sizeBytes !== read.file.sizeBytes;
    if (previous) {
      if (BigInt(read.file.sizeBytes) < BigInt(previous.sizeBytes))
        resetReason = "file-size-decreased";
      else if (!changed) start = events.length;
      else {
        let matched = -1;
        let ambiguous = false;
        for (const anchor of [...previous.anchors].reverse()) {
          const first = hashes.indexOf(anchor);
          if (first < 0) continue;
          if (first !== hashes.lastIndexOf(anchor)) {
            ambiguous = true;
            continue;
          }
          matched = first;
          break;
        }
        if (matched >= 0) start = matched + 1;
        else resetReason = ambiguous ? "ambiguous-overlap" : "overlap-not-found";
      }
    }
    const cursor: FollowCursor = {
      version: 1,
      file: read.file.url,
      fingerprint,
      sizeBytes: read.file.sizeBytes,
      anchors: hashes.slice(-8),
    };
    return {
      file: read.file,
      events: events.slice(start),
      cursor: Buffer.from(JSON.stringify(cursor)).toString("base64url"),
      changed,
      gapPossible: !!resetReason,
      windowTruncated: read.truncated,
      ...(resetReason === undefined ? {} : { resetReason }),
      semantics:
        "tail overlap; updated final events may be repeated; no byte cursor or exactly-once guarantee",
    };
  }
}
