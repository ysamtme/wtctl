import type { ConnectionConfig, OperationResult } from "../contracts.js";
import { HcmError } from "../errors.js";
import { errorInFrontendTerms } from "../frontend-names.js";
import { ResultStore, type ListResultSaver } from "../results.js";
import { CliInputError, integerOption, stringOption, type CliArguments } from "./arguments.js";
import { formatCsvRow, formatTsvRow, tabularCellText } from "./format/csv.js";
import { collectObjectKeys, compactJson } from "./format/human.js";
import { formatOperationOutput, resolveColor, type OutputMode } from "./format/index.js";
import {
  failure,
  frontendFailure,
  reportSaved,
  safeDiagnostic,
  serializeResult,
  storedResultId,
} from "./output.js";
import type { ProgressIndicator } from "./progress.js";
import type { CliIo, FileTextWriter, RuntimePort } from "./types.js";

const DEFAULT_ALL_PAGE_SIZE = 200;
const STREAM_FLUSH_CHARS = 64 * 1024;
const MAX_SINGLE_ITEM_CHARS = 8 * 1024 * 1024;
const MAX_WRAPPER_CHARS = 256 * 1024;

export interface QueryAllOptions {
  readonly pageSize: number;
  readonly maxRows?: number;
}

interface PageMeta {
  readonly total?: number;
  readonly nextStartPosition?: number;
  readonly incomplete?: boolean;
  readonly hint?: string;
  readonly unknownFields?: readonly string[];
}

interface ParsedQueryPage extends PageMeta {
  readonly items: readonly unknown[];
}

interface StreamedPageSummary extends PageMeta {
  readonly seenItems: number;
  readonly emittedItems: number;
}

class StreamOutputError extends Error {
  constructor(readonly result: OperationResult) {
    super(result.error?.message ?? "Ошибка вывода.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Извлекает параметры постраничного чтения query --all (после валидации в commands.ts). */
export function queryAllOptions(args: CliArguments): QueryAllOptions | undefined {
  if (args.options.all !== true) return undefined;
  const pageSize = integerOption(args, "page-size", 1, 1000) ?? DEFAULT_ALL_PAGE_SIZE;
  const maxRows = integerOption(args, "max-rows", 1, 10_000_000);
  return {
    pageSize,
    ...(maxRows === undefined ? {} : { maxRows }),
  };
}

function extractPageMeta(value: Record<string, unknown>): PageMeta {
  return {
    ...(typeof value.total === "number" ? { total: value.total } : {}),
    ...(typeof value.nextStartPosition === "number"
      ? { nextStartPosition: value.nextStartPosition }
      : {}),
    ...(value.incomplete === true ? { incomplete: true } : {}),
    ...(typeof value.hint === "string" ? { hint: value.hint } : {}),
    ...(Array.isArray(value.unknownFields)
      ? {
          unknownFields: value.unknownFields.filter(
            (field): field is string => typeof field === "string",
          ),
        }
      : {}),
  };
}

function asQueryPage(value: unknown): ParsedQueryPage | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined;
  return { items: value.items, ...extractPageMeta(value) };
}

function incompleteResult(source: OperationResult, hint?: string): OperationResult {
  return {
    ok: false,
    error: {
      code: "QUERY_INCOMPLETE",
      message: "Страница запроса неполная: строки после неё не прочитаны.",
      ...(hint === undefined ? {} : { hint }),
      retryable: false,
    },
    meta: source.meta,
  };
}

function columnsChangedResult(
  source: OperationResult,
  headers: readonly string[],
  added: readonly string[],
): OperationResult {
  const suggested = [...headers, ...added].join(",");
  return {
    ok: false,
    error: {
      code: "QUERY_COLUMNS_CHANGED",
      message: `На следующей странице появились новые поля (${added.join(", ")}), которых не было в заголовке.`,
      hint: `Задать столбцы явно через --fields ${suggested} или переключиться на --format jsonl.`,
      retryable: false,
    },
    meta: source.meta,
  };
}

function formatProgressLabel(received: number, total?: number): string {
  if (total !== undefined && total > received) {
    return `получено ${received} строк (из ${total})`;
  }
  return `получено ${received} строк`;
}

function memoryTextWriter(path: string, io: CliIo): FileTextWriter {
  const parts: string[] = [];
  let closed = false;
  return {
    write(chunk: string): void {
      if (chunk) parts.push(chunk);
    },
    async commit(): Promise<number> {
      if (closed) return 0;
      closed = true;
      const text = parts.join("");
      await io.writeFile(path, text);
      return Buffer.byteLength(text, "utf8");
    },
    async abort(): Promise<void> {
      closed = true;
      parts.length = 0;
    },
  };
}

async function* readResultJsonChunks(
  runtime: RuntimePort,
  resultId: string,
  storedError: (message: string) => HcmError,
): AsyncGenerator<string> {
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const chunk = await runtime.call("results.read", {
      resultId,
      offset,
      limit: 65536,
      format: "json",
    });
    if (!chunk.ok) throw storedError("Не удалось дочитать сохранённую страницу запроса.");
    const data = isRecord(chunk.data) ? chunk.data : undefined;
    if (data?.format !== "json" || typeof data.text !== "string") {
      throw storedError("Не удалось дочитать сохранённую страницу запроса в формате JSON.");
    }
    yield data.text;
    if (data.nextOffset === undefined) {
      offset = undefined;
    } else if (
      typeof data.nextOffset === "number" &&
      Number.isSafeInteger(data.nextOffset) &&
      data.nextOffset > offset
    ) {
      offset = data.nextOffset;
    } else {
      throw storedError("Чтение сохранённой страницы запроса не продвигается.");
    }
  }
}

/**
 * Потоково читает сохранённую на диск страницу runtime.query блоками по 64 КиБ (O(1) по памяти).
 * Для jsonl срезы байтов элементов идут прямо в поток без JSON.parse и без посимвольных склеек;
 * для остальных форматов разбирается по одному элементу за раз.
 */
async function streamStoredQueryPage(
  runtime: RuntimePort,
  result: OperationResult,
  maxItems: number,
  mode:
    | { readonly kind: "raw-jsonl"; readonly writeRaw: (chunk: string) => Promise<void> }
    | {
        readonly kind: "raw-json-array";
        readonly writeRaw: (chunk: string) => Promise<void>;
        readonly state: { started: boolean; items: number };
      }
    | {
        readonly kind: "raw-spill";
        readonly saver: ListResultSaver;
        readonly preview: {
          readonly items: unknown[];
          readonly budget: number;
          bytes: number;
          open: boolean;
        };
      }
    | { readonly kind: "items"; readonly onItem: (item: unknown) => Promise<void> },
): Promise<StreamedPageSummary> {
  const resultId = storedResultId(result);
  if (!resultId) {
    throw new HcmError(
      "RESULT_TRUNCATED",
      "Страница запроса обрезана, а resultId для дочитывания отсутствует.",
    );
  }
  const storedError = (message: string): HcmError =>
    new HcmError(
      "RESULT_STORED",
      message,
      `Уменьшить --page-size или прочитать результат: wtctl result read ${resultId}.`,
      { resultId },
    );

  const isRawMode =
    mode.kind === "raw-jsonl" || mode.kind === "raw-json-array" || mode.kind === "raw-spill";

  let depth = 0;
  let inString = false;
  let escaped = false;
  let expectKey = false;
  let readingTopKey = false;
  let topKey = "";
  let afterTopKey = false;
  let expectTopValue = false;
  let isItemsValue = false;
  let inItems = false;
  let foundItems = false;
  let hasItemContent = false;
  let itemPrefixEmitted = false;
  let pendingRawSpillBegin = false;
  let rawSpillOpen = false;
  const previewItemParts: string[] = [];
  let previewItemBytes = 0;

  const wrapperParts: string[] = [];
  let wrapperLen = 0;
  const itemParts: string[] = [];
  let itemLen = 0;
  const outParts: string[] = [];
  let outLen = 0;
  let seenItems = 0;
  let emittedItems = 0;

  const flushRaw = async (): Promise<void> => {
    if (!isRawMode) return;
    if (mode.kind === "raw-spill") {
      if (pendingRawSpillBegin) {
        pendingRawSpillBegin = false;
        rawSpillOpen = true;
        await mode.saver.beginRawItem();
      }
      if (!outParts.length) return;
      const text = outParts.length === 1 ? outParts[0]! : outParts.join("");
      outParts.length = 0;
      outLen = 0;
      await mode.saver.writeRawChunk(text);
      return;
    }
    if (!outParts.length) return;
    const text = outParts.length === 1 ? outParts[0]! : outParts.join("");
    outParts.length = 0;
    outLen = 0;
    await mode.writeRaw(text);
  };

  const pushCaptured = (slice: string): void => {
    if (!slice) return;
    if (isRawMode) {
      if (mode.kind === "raw-json-array" && !itemPrefixEmitted) {
        itemPrefixEmitted = true;
        if (!mode.state.started) {
          mode.state.started = true;
          outParts.push('{"ok":true,"data":{"items":[');
          outLen += 28;
        }
        if (mode.state.items > 0) {
          outParts.push(",");
          outLen += 1;
        }
      } else if (mode.kind === "raw-spill") {
        if (!itemPrefixEmitted) {
          itemPrefixEmitted = true;
          pendingRawSpillBegin = true;
        }
        if (mode.preview.open) {
          previewItemBytes += Buffer.byteLength(slice, "utf8");
          const sep = mode.preview.items.length > 0 ? 1 : 0;
          if (mode.preview.bytes + sep + previewItemBytes <= mode.preview.budget) {
            previewItemParts.push(slice);
          } else {
            mode.preview.open = false;
            previewItemParts.length = 0;
            previewItemBytes = 0;
          }
        }
      }
      outParts.push(slice);
      outLen += slice.length;
      return;
    }
    itemLen += slice.length;
    if (itemLen > MAX_SINGLE_ITEM_CHARS) {
      throw new HcmError(
        "RESULT_TOO_LARGE_FOR_FORMAT",
        "Отдельная строка результата превышает 8 МиБ и не форматируется в таблице/CSV.",
        "Для потокового вывода больших строк подходит --format jsonl.",
        { resultId },
      );
    }
    itemParts.push(slice);
  };

  const pushWrapper = (slice: string): void => {
    if (!slice) return;
    wrapperLen += slice.length;
    if (wrapperLen > MAX_WRAPPER_CHARS) {
      throw storedError("Служебные поля сохранённой страницы превысили допустимый размер.");
    }
    wrapperParts.push(slice);
  };

  const finishItem = async (): Promise<void> => {
    const emitThis = seenItems < maxItems;
    seenItems++;
    hasItemContent = false;
    itemPrefixEmitted = false;
    if (!emitThis) {
      itemParts.length = 0;
      itemLen = 0;
      previewItemParts.length = 0;
      previewItemBytes = 0;
      return;
    }
    if (mode.kind === "raw-jsonl") {
      outParts.push("\n");
      outLen += 1;
      emittedItems++;
      if (outLen >= STREAM_FLUSH_CHARS) await flushRaw();
      return;
    }
    if (mode.kind === "raw-json-array") {
      mode.state.items++;
      emittedItems++;
      if (outLen >= STREAM_FLUSH_CHARS) await flushRaw();
      return;
    }
    if (mode.kind === "raw-spill") {
      await flushRaw();
      if (rawSpillOpen) {
        rawSpillOpen = false;
        await mode.saver.endRawItem();
      }
      if (mode.preview.open && previewItemParts.length > 0) {
        const rawPreview = previewItemParts.join("");
        try {
          const parsedItem = JSON.parse(rawPreview);
          const step =
            Buffer.byteLength(compactJson(parsedItem), "utf8") +
            (mode.preview.items.length > 0 ? 1 : 0);
          if (mode.preview.bytes + step <= mode.preview.budget) {
            mode.preview.items.push(parsedItem);
            mode.preview.bytes += step;
          } else {
            mode.preview.open = false;
          }
        } catch {
          mode.preview.open = false;
        }
      }
      previewItemParts.length = 0;
      previewItemBytes = 0;
      emittedItems++;
      return;
    }
    const raw = itemParts.length === 1 ? itemParts[0]! : itemParts.join("");
    itemParts.length = 0;
    itemLen = 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw storedError("Сохранённая страница запроса содержит повреждённый JSON.");
    }
    await mode.onItem(parsed);
    emittedItems++;
  };

  const chunks = runtime.results?.openJsonStream
    ? runtime.results.openJsonStream(resultId)
    : readResultJsonChunks(runtime, resultId, storedError);

  for await (const text of chunks) {
    let captureStart = -1;
    let wrapperStart = -1;

    const flushCaptureSlice = (end: number): void => {
      if (captureStart >= 0) {
        if (end > captureStart) pushCaptured(text.slice(captureStart, end));
        captureStart = -1;
      }
    };
    const flushWrapperSlice = (end: number): void => {
      if (wrapperStart >= 0) {
        if (end > wrapperStart) pushWrapper(text.slice(wrapperStart, end));
        wrapperStart = -1;
      }
    };

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (inItems) {
        if (inString) {
          if (seenItems < maxItems && captureStart < 0) captureStart = i;
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }

        if (depth === 2 && (ch === "," || ch === "]")) {
          flushCaptureSlice(i);
          if (hasItemContent) await finishItem();
          if (ch === "]") {
            inItems = false;
            depth = 1;
          }
          continue;
        }
        if (
          depth === 2 &&
          !hasItemContent &&
          (ch === " " || ch === "\n" || ch === "\r" || ch === "\t")
        ) {
          continue;
        }
        hasItemContent = true;
        if (seenItems < maxItems) {
          if (mode.kind === "raw-jsonl" && (ch === "\n" || ch === "\r")) {
            flushCaptureSlice(i);
          } else if (captureStart < 0) {
            captureStart = i;
          }
        }
        if (ch === '"') inString = true;
        else if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") depth--;
        continue;
      }

      // Вне массива items — собираем только компактную оболочку метаданных.
      if (!inString && depth === 1 && expectTopValue && isItemsValue && ch === "[") {
        flushWrapperSlice(i);
        inItems = true;
        foundItems = true;
        depth = 2;
        expectTopValue = false;
        isItemsValue = false;
        hasItemContent = false;
        itemParts.length = 0;
        itemLen = 0;
        pushWrapper("[]");
        continue;
      }

      if (wrapperStart < 0) wrapperStart = i;

      if (inString) {
        if (escaped) {
          escaped = false;
          if (readingTopKey) topKey = "\0";
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
          if (readingTopKey) {
            readingTopKey = false;
            afterTopKey = true;
          }
        } else if (readingTopKey && topKey.length < 16) {
          topKey += ch;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        if (depth === 1 && expectKey) {
          expectKey = false;
          readingTopKey = true;
          topKey = "";
        } else if (depth === 1) {
          expectTopValue = false;
          isItemsValue = false;
        }
      } else if (ch === ":" && depth === 1 && afterTopKey) {
        afterTopKey = false;
        expectTopValue = true;
        isItemsValue = topKey === "items";
      } else if (ch === "," && depth === 1) {
        expectKey = true;
        afterTopKey = false;
        expectTopValue = false;
        isItemsValue = false;
      } else if (ch === "{") {
        if (depth === 0) expectKey = true;
        else if (depth === 1) {
          expectTopValue = false;
          isItemsValue = false;
        }
        depth++;
      } else if (ch === "[") {
        if (depth === 1) {
          expectTopValue = false;
          isItemsValue = false;
        }
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
      } else if (
        depth === 1 &&
        expectTopValue &&
        ch !== " " &&
        ch !== "\n" &&
        ch !== "\r" &&
        ch !== "\t"
      ) {
        expectTopValue = false;
        isItemsValue = false;
      }
    }

    flushCaptureSlice(text.length);
    flushWrapperSlice(text.length);
    if (outLen >= STREAM_FLUSH_CHARS) await flushRaw();
  }

  await flushRaw();

  if (!foundItems || depth !== 0 || inString) {
    throw storedError("Сохранённая страница запроса имеет неполную структуру JSON.");
  }
  let metaObj: unknown;
  try {
    metaObj = JSON.parse(wrapperParts.join(""));
  } catch {
    throw storedError("Сохранённая страница запроса содержит повреждённый JSON.");
  }
  if (!isRecord(metaObj)) {
    throw storedError("Сохранённая страница запроса не является объектом JSON.");
  }
  return {
    ...extractPageMeta(metaObj),
    seenItems,
    emittedItems,
  };
}

/**
 * Постраничное чтение query --all.
 * Для csv, tsv, jsonl, raw и json с --output пишет строки потоково по страницам (O(1) по памяти);
 * для json без --output, human и table соблюдает предел outputLimitBytes, сбрасывая крупный ответ в ResultStore.
 */
export async function runQueryAll(
  baseArgs: Record<string, unknown>,
  options: QueryAllOptions,
  parsed: CliArguments,
  config: ConnectionConfig,
  io: CliIo,
  runtime: RuntimePort,
  outputMode: OutputMode,
  progress: ProgressIndicator,
  closeRuntime: () => Promise<{ readonly failed: boolean; readonly diagnostic?: OperationResult }>,
): Promise<
  | { readonly handled: false; readonly result: OperationResult }
  | { readonly handled: true; readonly exitCode: number }
> {
  if (baseArgs.startPosition !== undefined) {
    const rawStart = baseArgs.startPosition;
    if (
      typeof rawStart !== "number" ||
      !Number.isSafeInteger(rawStart) ||
      rawStart < 0 ||
      rawStart > 1_000_000
    ) {
      throw new CliInputError("startPosition должен быть целым числом от 0 до 1000000.");
    }
  }

  const streaming =
    outputMode.format === "csv" ||
    outputMode.format === "tsv" ||
    outputMode.format === "jsonl" ||
    outputMode.format === "raw";
  const output = stringOption(parsed, "output");
  const streamingJsonFile = !streaming && output !== undefined && outputMode.format === "json";
  const requestedFields =
    Array.isArray(baseArgs.fields) &&
    baseArgs.fields.every((item): item is string => typeof item === "string")
      ? [...new Set(baseArgs.fields)]
      : undefined;

  let startPosition = typeof baseArgs.startPosition === "number" ? baseArgs.startPosition : 0;
  let totalRows = 0;
  let totalDurationMs = 0;
  let lastTotal: number | undefined;
  let lastNextStartPosition: number | undefined;
  let lastHint: string | undefined;
  let connection = config.name;
  const unknownFields = new Set<string>();
  const collected: unknown[] = [];
  let collectedBytes = 12; // {"items":[]}
  const limitBytes = config.outputLimitBytes;
  const previewState = {
    items: [] as unknown[],
    budget: Math.floor(limitBytes / 2),
    bytes: 12,
    open: true,
  };
  let spillSaver: ListResultSaver | undefined;
  const jsonFileState = { started: false, items: 0 };

  let headers: readonly string[] | undefined =
    requestedFields && requestedFields.length > 0 ? requestedFields : undefined;
  let headerSet: Set<string> | undefined = headers ? new Set(headers) : undefined;
  let headerWritten = false;
  let writer: FileTextWriter | undefined;
  let textBuffer = "";

  const openWriter = async (): Promise<FileTextWriter> => {
    if (writer) return writer;
    writer = io.openTextWriter ? await io.openTextWriter(output!) : memoryTextWriter(output!, io);
    return writer;
  };

  const openSpillSaver = async (): Promise<ListResultSaver> => {
    if (spillSaver) return spillSaver;
    spillSaver = runtime.results?.openListSaver
      ? await runtime.results.openListSaver("items")
      : await new ResultStore(config).openListSaver("items");
    return spillSaver;
  };

  const writeRaw = async (chunk: string): Promise<void> => {
    if (!chunk) return;
    try {
      if (output) {
        await (await openWriter()).write(chunk);
        return;
      }
      if (io.stdoutIsTTY === true) await progress.clear();
      await io.writeOut(chunk);
    } catch {
      throw new StreamOutputError(
        failure(
          output ? "cli.output_failed" : "OUTPUT_WRITE_FAILED",
          output
            ? "Не удалось записать результат в локальный файл."
            : "Не удалось записать результат в stdout.",
        ),
      );
    }
  };

  const flushTextBuffer = async (): Promise<void> => {
    if (!textBuffer) return;
    const chunk = textBuffer;
    textBuffer = "";
    await writeRaw(chunk);
  };

  const appendJsonChunk = async (chunk: string): Promise<void> => {
    textBuffer += chunk;
    if (textBuffer.length >= STREAM_FLUSH_CHARS) await flushTextBuffer();
  };

  const collectNonStreamItem = async (item: unknown): Promise<void> => {
    if (streamingJsonFile) {
      if (!jsonFileState.started) {
        jsonFileState.started = true;
        await appendJsonChunk('{"ok":true,"data":{"items":[');
      }
      if (jsonFileState.items > 0) await appendJsonChunk(",");
      await appendJsonChunk(compactJson(item));
      jsonFileState.items++;
      return;
    }
    const serialized = compactJson(item);
    const rawItemBytes = Buffer.byteLength(serialized, "utf8");
    const previewStep = rawItemBytes + (previewState.items.length > 0 ? 1 : 0);
    if (previewState.open) {
      if (previewState.bytes + previewStep <= previewState.budget) {
        previewState.items.push(item);
        previewState.bytes += previewStep;
      } else {
        // Превью всегда остаётся строгим префиксом [0..k-1] без пропуска крупных первых строк.
        previewState.open = false;
      }
    }
    if (spillSaver) {
      await spillSaver.writeItem(item);
      return;
    }
    const collectStep = rawItemBytes + (collected.length > 0 ? 1 : 0);
    if (collectedBytes + collectStep > limitBytes) {
      const saver = await openSpillSaver();
      for (const prev of collected) await saver.writeItem(prev);
      collected.length = 0;
      await saver.writeItem(item);
      return;
    }
    collected.push(item);
    collectedBytes += collectStep;
  };

  const appendTextLine = async (line: string): Promise<void> => {
    textBuffer += `${line}\n`;
    if (textBuffer.length >= STREAM_FLUSH_CHARS) await flushTextBuffer();
  };

  const emitTabularHeader = async (format: "csv" | "tsv" | "raw"): Promise<void> => {
    if (headerWritten || !headers || headers.length === 0) return;
    headerWritten = true;
    if (format === "csv") await appendTextLine(formatCsvRow(headers));
    else if (format === "tsv") await appendTextLine(formatTsvRow(headers));
  };

  const emitStreamItem = async (
    item: unknown,
    format: "csv" | "tsv" | "jsonl" | "raw",
    sourceResult: OperationResult,
  ): Promise<void> => {
    if (format === "jsonl") {
      await appendTextLine(compactJson(item));
      return;
    }
    const record = isRecord(item) ? item : {};
    if (headers === undefined) {
      const detected = collectObjectKeys([record]);
      if (detected && detected.length > 0) {
        headers = detected;
        headerSet = new Set(detected);
      }
    } else if (requestedFields === undefined && headerSet !== undefined) {
      const added: string[] = [];
      for (const key of Object.keys(record)) {
        if (!headerSet.has(key)) added.push(key);
      }
      if (added.length > 0) {
        throw new StreamOutputError(columnsChangedResult(sourceResult, headers, added));
      }
    }
    if (!headers || headers.length === 0) return;
    await emitTabularHeader(format);
    const values = headers.map((key) => (Object.hasOwn(record, key) ? record[key] : ""));
    if (format === "csv") await appendTextLine(formatCsvRow(values));
    else if (format === "tsv") await appendTextLine(formatTsvRow(values));
    else if (headers.length === 1) await appendTextLine(tabularCellText(values[0]));
    else await appendTextLine(formatTsvRow(values));
  };

  const failStream = async (
    errorResult: OperationResult,
  ): Promise<{ readonly handled: true; readonly exitCode: number }> => {
    textBuffer = "";
    await writer?.abort().catch(() => undefined);
    await spillSaver?.abort().catch(() => undefined);
    await progress.stop();
    await closeRuntime();
    await safeDiagnostic(
      io,
      errorInFrontendTerms(errorResult, "cli"),
      outputMode.humanErrors ? "human" : "json",
    );
    return { handled: true, exitCode: 1 };
  };

  const handleFailure = async (
    errorResult: OperationResult,
  ): Promise<
    | { readonly handled: false; readonly result: OperationResult }
    | { readonly handled: true; readonly exitCode: number }
  > => {
    if (streaming) return await failStream(errorResult);
    textBuffer = "";
    await writer?.abort().catch(() => undefined);
    await spillSaver?.abort().catch(() => undefined);
    return { handled: false, result: errorResult };
  };

  try {
    for (;;) {
      const remaining =
        options.maxRows === undefined
          ? options.pageSize
          : Math.min(options.pageSize, options.maxRows - totalRows);
      if (remaining <= 0) break;

      const pageArgs: Record<string, unknown> = {
        ...baseArgs,
        limit: remaining,
        startPosition,
      };
      const result = await runtime.call("runtime.query", pageArgs);
      totalDurationMs += result.meta.durationMs;
      connection = result.meta.connection;

      if (!result.ok) return await handleFailure(result);

      const sliceLimit =
        options.maxRows === undefined ? Infinity : Math.max(0, options.maxRows - totalRows);

      let pageMeta: PageMeta;
      let pageItemsSeen: number;
      let pageItemsEmitted: number;

      if (result.meta.truncated === true) {
        // ReplyPacker кладёт поля ответа внутрь data.preview — проверяем incomplete до вывода первой строки.
        const preview =
          isRecord(result.data) && isRecord(result.data.preview) ? result.data.preview : undefined;
        if (
          (isRecord(result.data) && result.data.incomplete === true) ||
          preview?.incomplete === true
        ) {
          const hint =
            typeof preview?.hint === "string"
              ? preview.hint
              : isRecord(result.data) && typeof result.data.hint === "string"
                ? result.data.hint
                : undefined;
          return await handleFailure(incompleteResult(result, hint));
        }

        const format = outputMode.format as "csv" | "tsv" | "jsonl" | "raw";
        if (streaming && format === "jsonl") {
          const summary = await streamStoredQueryPage(runtime, result, sliceLimit, {
            kind: "raw-jsonl",
            writeRaw,
          });
          pageMeta = summary;
          pageItemsSeen = summary.seenItems;
          pageItemsEmitted = summary.emittedItems;
        } else if (streaming) {
          const tabularFormat = format as "csv" | "tsv" | "raw";
          // Если столбцы ещё не определены (--fields не задан и это первая непустая страница),
          // делаем быстрый O(1)-проход по ключам этой страницы, чтобы набор столбцов
          // совпадал с несохранённой первой страницей (и проверяем incomplete до вывода).
          if (headers === undefined) {
            const seenKeys = new Set<string>();
            const preScan = await streamStoredQueryPage(runtime, result, sliceLimit, {
              kind: "items",
              onItem: async (item) => {
                if (isRecord(item)) {
                  for (const key of Object.keys(item)) seenKeys.add(key);
                }
              },
            });
            if (preScan.incomplete === true) {
              return await handleFailure(incompleteResult(result, preScan.hint));
            }
            if (seenKeys.size > 0) {
              headers = [...seenKeys];
              headerSet = seenKeys;
            }
          }
          const summary = await streamStoredQueryPage(runtime, result, sliceLimit, {
            kind: "items",
            onItem: (item) => emitStreamItem(item, tabularFormat, result),
          });
          if (!headerWritten && headers !== undefined && headers.length > 0) {
            await emitTabularHeader(tabularFormat);
          }
          await flushTextBuffer();
          pageMeta = summary;
          pageItemsSeen = summary.seenItems;
          pageItemsEmitted = summary.emittedItems;
        } else if (streamingJsonFile) {
          await flushTextBuffer();
          const summary = await streamStoredQueryPage(runtime, result, sliceLimit, {
            kind: "raw-json-array",
            writeRaw,
            state: jsonFileState,
          });
          pageMeta = summary;
          pageItemsSeen = summary.seenItems;
          pageItemsEmitted = summary.emittedItems;
        } else {
          // Сохранённая страница сама превышает outputLimitBytes: сразу пишем элементы готовыми фрагментами JSON в ResultStore без JSON.parse.
          const saver = await openSpillSaver();
          if (collected.length > 0) {
            for (const prev of collected) await saver.writeItem(prev);
            collected.length = 0;
          }
          const summary = await streamStoredQueryPage(runtime, result, sliceLimit, {
            kind: "raw-spill",
            saver,
            preview: previewState,
          });
          pageMeta = summary;
          pageItemsSeen = summary.seenItems;
          pageItemsEmitted = summary.emittedItems;
        }

        if (pageMeta.incomplete === true) {
          return await handleFailure(incompleteResult(result, pageMeta.hint));
        }
      } else {
        const page = asQueryPage(result.data);
        if (!page) {
          return await handleFailure(
            failure(
              "QUERY_RESPONSE_INVALID",
              "Не удалось разобрать страницу ответа runtime.query.",
            ),
          );
        }
        if (page.incomplete === true) {
          return await handleFailure(incompleteResult(result, page.hint));
        }

        pageMeta = page;
        pageItemsSeen = page.items.length;
        const items = page.items.length > sliceLimit ? page.items.slice(0, sliceLimit) : page.items;
        pageItemsEmitted = items.length;

        if (streaming) {
          const format = outputMode.format as "csv" | "tsv" | "jsonl" | "raw";
          if (format !== "jsonl") {
            if (headers === undefined && items.length > 0) {
              const detected = collectObjectKeys(items);
              if (detected && detected.length > 0) {
                headers = detected;
                headerSet = new Set(detected);
              }
            }
            if (!headerWritten && headers !== undefined && headers.length > 0) {
              await emitTabularHeader(format);
            }
          }
          for (const item of items) {
            await emitStreamItem(item, format, result);
          }
          await flushTextBuffer();
        } else {
          for (const item of items) await collectNonStreamItem(item);
        }
      }

      totalRows += pageItemsEmitted;
      if (pageMeta.total !== undefined) lastTotal = pageMeta.total;
      if (pageMeta.hint !== undefined) lastHint = pageMeta.hint;
      if (pageMeta.unknownFields) {
        for (const field of pageMeta.unknownFields) unknownFields.add(field);
      }

      const reachedMax = options.maxRows !== undefined && totalRows >= options.maxRows;
      if (reachedMax) {
        lastNextStartPosition =
          pageItemsSeen > pageItemsEmitted
            ? startPosition + pageItemsEmitted
            : pageMeta.nextStartPosition;
        break;
      }

      if (pageMeta.nextStartPosition === undefined) {
        lastNextStartPosition = undefined;
        break;
      }
      if (pageMeta.nextStartPosition <= startPosition) {
        return await handleFailure(
          incompleteResult(result, "Смещение следующей страницы не продвинулось; чтение прервано."),
        );
      }

      progress.update(formatProgressLabel(totalRows, lastTotal));
      startPosition = pageMeta.nextStartPosition;
    }

    const extraFields: Record<string, unknown> = {
      ...(lastTotal === undefined ? {} : { total: lastTotal }),
      ...(lastNextStartPosition === undefined ? {} : { nextStartPosition: lastNextStartPosition }),
      ...(unknownFields.size > 0 ? { unknownFields: [...unknownFields] } : {}),
      ...(lastHint === undefined ? {} : { hint: lastHint }),
    };

    if (streamingJsonFile) {
      if (!jsonFileState.started) {
        jsonFileState.started = true;
        await appendJsonChunk('{"ok":true,"data":{"items":[');
      }
      await appendJsonChunk("]");
      const extraJson = compactJson(extraFields);
      if (extraJson !== "{}") await appendJsonChunk(`,${extraJson.slice(1)}`);
      else await appendJsonChunk("}");
      const meta = {
        operationId: "runtime.query",
        connection,
        durationMs: totalDurationMs,
      };
      await appendJsonChunk(`,"meta":${compactJson(meta)}}\n`);
      await flushTextBuffer();
      await progress.stop();
      const closed = await closeRuntime();
      let bytes: number;
      try {
        const targetWriter = await openWriter();
        bytes = await targetWriter.commit();
      } catch {
        return await failStream(
          failure(
            "cli.output_failed",
            "Результат получен, но сохранить локальный файл не удалось.",
          ),
        );
      }
      const receipt: OperationResult = {
        ok: !closed.failed,
        data: { saved: true, output: output!, bytes },
        ...(closed.failed && closed.diagnostic?.error ? { error: closed.diagnostic.error } : {}),
        meta: {
          ...meta,
          ...(closed.failed ? { cleanupFailed: true } : {}),
        },
      };
      try {
        await io.writeOut(serializeResult(receipt, io.pretty === true));
      } catch {
        return { handled: true, exitCode: 1 };
      }
      return { handled: true, exitCode: closed.failed ? 1 : 0 };
    }

    if (!streaming) {
      const meta = {
        operationId: "runtime.query",
        connection,
        durationMs: totalDurationMs,
      };
      const prettyReply = outputMode.format === "json" && io.pretty === true;
      const quiet = parsed.options.quiet === true;
      const connectionArg = stringOption(parsed, "connection");
      const measureTable =
        output === undefined && (outputMode.format === "human" || outputMode.format === "table");
      const replyBytes = (reply: OperationResult): number => {
        if (measureTable) {
          const formatted = formatOperationOutput(
            reply,
            reply.meta.truncated ? "human" : outputMode.format,
            {
              ...(io.columns === undefined ? {} : { columns: io.columns }),
              color: resolveColor(io, "stdout"),
              quiet,
              ...(reply.meta.truncated
                ? {}
                : {
                    ...(requestedFields === undefined ? {} : { requestedFields }),
                    requestArgs: baseArgs,
                    ...(connectionArg === undefined ? {} : { connectionArg }),
                  }),
            },
          );
          return formatted.kind === "text"
            ? Buffer.byteLength(formatted.text, "utf8")
            : formatted.bytes.length;
        }
        return Buffer.byteLength(serializeResult(reply, prettyReply), "utf8");
      };
      if (!spillSaver) {
        const fullResult: OperationResult = {
          ok: true,
          data: { items: collected, ...extraFields },
          meta,
        };
        if (replyBytes(fullResult) <= limitBytes) {
          return {
            handled: false,
            result: fullResult,
          };
        }
        const saver = await openSpillSaver();
        for (const item of collected) await saver.writeItem(item);
        collected.length = 0;
      }
      const saved = await spillSaver!.commit(extraFields);
      const buildTruncated = (
        previewObj: Record<string, unknown> | undefined,
        shownCount: number,
      ): OperationResult => ({
        ok: true,
        data: {
          ...(previewObj === undefined ? {} : { preview: previewObj }),
          resultId: saved.resultId,
          hint: `Ответ не поместился и сохранён целиком: wtctl result read ${saved.resultId} читает список items по элементам${
            shownCount < totalRows ? ` (в preview первые ${shownCount} из ${totalRows})` : ""
          }, wtctl result export ${saved.resultId} --to ФАЙЛ --format jsonl сохраняет в файл.`,
        },
        meta: {
          ...meta,
          truncated: true,
          resultId: saved.resultId,
          resultBytes: saved.bytes,
        },
      });
      const previewItems = previewState.items;
      while (
        previewItems.length > 0 &&
        replyBytes(buildTruncated({ items: previewItems, ...extraFields }, previewItems.length)) >
          limitBytes
      ) {
        previewItems.pop();
      }
      let finalReply = buildTruncated({ items: previewItems, ...extraFields }, previewItems.length);
      if (replyBytes(finalReply) > limitBytes) {
        // Если даже с пустым items поля extraFields (например, длинный unknownFields) не помещаются —
        // переходим к компактному виду ReplyPacker.
        const compactPreview: Record<string, unknown> = {
          kind: "stored-result",
          items: [],
          ...(lastTotal === undefined ? {} : { total: lastTotal }),
          ...(lastNextStartPosition === undefined
            ? {}
            : { nextStartPosition: lastNextStartPosition }),
          ...(unknownFields.size > 0 ? { unknownFields: `[список: ${unknownFields.size}]` } : {}),
          ...(lastHint === undefined
            ? {}
            : { hint: lastHint.length > 120 ? `${lastHint.slice(0, 120)}…` : lastHint }),
        };
        finalReply = buildTruncated(compactPreview, 0);
        if (replyBytes(finalReply) > limitBytes) {
          finalReply = buildTruncated({ kind: "stored-result", items: [] }, 0);
        }
        if (replyBytes(finalReply) > limitBytes) {
          finalReply = buildTruncated(undefined, 0);
        }
      }
      return {
        handled: false,
        result: finalReply,
      };
    }

    await progress.stop();
    const closed = await closeRuntime();
    const summaryResult: OperationResult = {
      ok: !closed.failed,
      data: { rows: totalRows },
      meta: { operationId: "runtime.query", connection, durationMs: totalDurationMs },
    };
    const finalResult =
      closed.failed && closed.diagnostic
        ? frontendFailure(summaryResult, closed.diagnostic, "cleanupFailed")
        : summaryResult;

    if (output) {
      let bytes: number;
      try {
        const targetWriter = await openWriter();
        bytes = await targetWriter.commit();
      } catch {
        return await failStream(
          failure(
            "cli.output_failed",
            "Результат получен, но сохранить локальный файл не удалось.",
          ),
        );
      }
      if (!(await reportSaved(output, bytes, finalResult, parsed, io, `строк: ${totalRows}`))) {
        return { handled: true, exitCode: 1 };
      }
    }

    return { handled: true, exitCode: closed.failed ? 1 : 0 };
  } catch (error) {
    if (error instanceof StreamOutputError) return await failStream(error.result);
    await writer?.abort().catch(() => undefined);
    await spillSaver?.abort().catch(() => undefined);
    throw error;
  }
}
