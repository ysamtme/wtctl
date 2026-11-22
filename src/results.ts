import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { LOCAL_LIMITS } from "./config.js";
import { HcmError, boundedInteger, requiredString } from "./errors.js";
import { saveLocalFile } from "./local-file.js";
import type { ConnectionConfig, OperationResult } from "./contracts.js";

/** Аргументы exportResult. */
export interface ResultExportInput {
  /** ID сохранённого результата: meta.resultId ответа. */
  readonly resultId: string;
  /** Путь к файлу на этом компьютере; папка должна быть, иначе FOLDER_NOT_FOUND. */
  readonly path: string;
  /**
   * json — ответ целиком одним JSON (по умолчанию); jsonl — элементы списка, по строке на элемент;
   * text — сохранённый текст как есть.
   */
  readonly format?: "json" | "jsonl" | "text";
  /** Заменить файл, если он уже есть; иначе FILE_EXISTS. */
  readonly overwrite?: boolean;
}
/** Ответ exportResult. */
export interface ResultExportData {
  /** Путь к файлу, как передан. */
  readonly path: string;
  /** Размер файла в байтах. */
  readonly bytes: number;
  /** Формат записи. */
  readonly format: "json" | "jsonl" | "text";
  /** Сколько элементов записано; только у jsonl. */
  readonly items?: number;
}

/** Потоковая запись сохранённого результата-списка по элементам с O(1) памяти. @internal */
export interface ListResultSaver {
  writeItem(item: unknown): Promise<void>;
  beginRawItem(): Promise<void>;
  writeRawChunk(chunk: string): Promise<void>;
  endRawItem(): Promise<void>;
  commit(
    extra?: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly resultId: string; readonly bytes: number; readonly rows: number }>;
  abort(): Promise<void>;
}

/** Выбирает внешний массив или элемент-список ответа, не буферизуя даже одну полную строку. */
async function* jsonLines(
  source: AsyncIterable<string>,
  count: { items: number },
  list = "items",
  objectsOnly = false,
): AsyncGenerator<string> {
  // Ключ в том виде, в каком его пишет JSON-текст, с закрывающей кавычкой.
  const name = JSON.stringify(list).slice(1);
  let depth = 0,
    selected = -1,
    singleObjectDepth = -1,
    quoted = 0,
    key = "",
    row = false,
    itemKind: "none" | "object" | "skip" = "none";
  for await (const chunk of source) {
    let output = "";
    for (const char of chunk) {
      if (singleObjectDepth > 0 && depth >= singleObjectDepth) {
        output += char;
        if (!quoted && depth === singleObjectDepth && char === "}") {
          output += "\n";
          count.items++;
          singleObjectDepth = 0;
        }
      } else if (selected > 0 && depth >= selected) {
        const end = !quoted && depth === selected && (char === "," || char === "]");
        if (end) {
          if (row && (!objectsOnly || itemKind === "object")) {
            output += "\n";
            count.items++;
          }
          row = false;
          itemKind = "none";
          if (char === "]") selected = 0;
        } else if (objectsOnly) {
          if (
            itemKind === "none" &&
            !quoted &&
            depth === selected &&
            (char === " " || char === "\n" || char === "\r" || char === "\t")
          ) {
            // Пропускаем пробелы перед началом очередного элемента массива.
          } else {
            if (itemKind === "none") itemKind = !quoted && char === "{" ? "object" : "skip";
            if (itemKind === "object") {
              output += char;
              row = true;
            }
          }
        } else {
          output += char;
          row = true;
        }
      }
      if (quoted) {
        if (depth === 1 && key.length < name.length) key += char;
        quoted = quoted === 2 ? 1 : char === "\\" ? 2 : char === '"' ? 0 : 1;
      } else if (char === '"') {
        quoted = 1;
        key = "";
      } else {
        if (
          char === "[" &&
          selected < 0 &&
          singleObjectDepth < 0 &&
          (!depth || (depth === 1 && key === name))
        ) {
          selected = depth + 1;
          itemKind = "none";
        } else if (
          objectsOnly &&
          char === "{" &&
          selected < 0 &&
          singleObjectDepth < 0 &&
          depth === 1 &&
          key === name
        ) {
          singleObjectDepth = depth + 1;
          output += char;
        }
        if (char === "[" || char === "{") depth++;
        if (char === "]" || char === "}") depth--;
        if (char !== ":") key = "";
      }
    }
    yield output;
  }
  if (selected < 0 && singleObjectDepth < 0) throw exportFormatError();
}

const exportFormatError = () =>
  new HcmError(
    "INVALID_RESULT_FORMAT",
    "Этот результат нельзя отдать в запрошенном формате.",
    "text подходит сохранённой строке и ответу с полем text, jsonl — списку; json подходит любому результату.",
  );
/** Текст ответа, который в основном одна длинная строка: лог или файл, прочитанный как текст. */
function textOf(data: unknown): string | undefined {
  if (typeof data === "string") return data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return undefined;
  const text = (data as Record<string, unknown>).text;
  return typeof text === "string" ? text : undefined;
}
/**
 * Список, из которого состоит ответ: элементы поиска, типы, поля, шаги пакета. Читается по
 * элементам, как и голый список. Список засчитывается, когда составляет основную часть ответа:
 * имена неизвестных полей рядом с длинным документом — не то, за чем пришёл вызывающий.
 * Список, который назвала сама операция (named), засчитывается при любой длине.
 */
function listOf(
  data: unknown,
  named?: string,
  maxItemBytes?: number,
): { key: string; items: unknown[] } | undefined {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return undefined;
  const own = named === undefined ? undefined : (data as Record<string, unknown>)[named];
  if (Array.isArray(own)) return { key: named!, items: own };
  if (textOf(data) !== undefined) return undefined;
  let found: { key: string; items: unknown[]; bytes: number } | undefined;
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value) || value.length < 2 || key.length > 256) continue;
    // Если первый элемент уже не помещается на страницу, эвристика «списка» только заблокирует
    // чтение по умолчанию на blockedItem (как databases в getAppInfo): лучше читать JSON целиком.
    if (
      maxItemBytes !== undefined &&
      (maxItemBytes <= 0 || Buffer.byteLength(JSON.stringify(value[0]) ?? "null") > maxItemBytes)
    )
      continue;
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > (found?.bytes ?? 0)) found = { key, items: value, bytes };
  }
  return found && found.bytes * 2 > Buffer.byteLength(JSON.stringify(data)) ? found : undefined;
}

const CHUNK_CHARS = 65536;
const RECORD_BYTES = 16;
const MAX_METADATA_BYTES = 4096;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const RESULT_ID = new RegExp(`^${UUID}$`);
/** Файлы сохранённого результата: описание <id>.json и данные рядом с ним. */
const RESULT_FILE = new RegExp(`^(${UUID})\\.(json|data\\.json|data\\.idx|rows\\.idx|text\\.bin)$`);
interface Metadata {
  version: 2;
  createdAt: string;
  kind: "array" | "string" | "json";
  jsonBytes: number;
  jsonChars: number;
  checkpoints: number;
  rows?: number;
  textChars?: number;
  /** Поле сохранённого объекта, в котором лежит его список; rows индексируют его элементы. */
  list?: string;
}
function invalid(): HcmError {
  return new HcmError(
    "RESULT_INVALID",
    "Сохранённый результат не читается: его файлы повреждены или неполны.",
  );
}
function notFound(): HcmError {
  return new HcmError(
    "RESULT_NOT_FOUND",
    "Результата с таким resultId нет, или он сохранён другим подключением.",
    "Результат мог быть удалён по сроку хранения: нужно повторить запрос, который его вернул.",
  );
}
function natural(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function record(first: number, second: number): Buffer {
  const bytes = Buffer.alloc(RECORD_BYTES);
  bytes.writeBigUInt64LE(BigInt(first));
  bytes.writeBigUInt64LE(BigInt(second), 8);
  return bytes;
}
function numbers(bytes: Buffer): [number, number] {
  const first = Number(bytes.readBigUInt64LE());
  const second = Number(bytes.readBigUInt64LE(8));
  if (!natural(first) || !natural(second)) throw invalid();
  return [first, second];
}
async function writeAll(file: FileHandle, bytes: Buffer): Promise<void> {
  for (let offset = 0; offset < bytes.length;) {
    const written = (await file.write(bytes, offset, bytes.length - offset)).bytesWritten;
    if (!written) throw new Error("Запись результата не продвигается");
    offset += written;
  }
}
async function readExactly(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  for (let offset = 0; offset < length;) {
    const read = (await file.read(bytes, offset, length - offset, position + offset)).bytesRead;
    if (!read) throw invalid();
    offset += read;
  }
  return bytes;
}
async function reading<T>(
  paths: string[],
  action: (files: FileHandle[]) => Promise<T>,
): Promise<T> {
  const files: FileHandle[] = [];
  try {
    for (const path of paths) files.push(await open(path, "r"));
    return await action(files);
  } finally {
    await Promise.all(files.map((file) => file.close()));
  }
}
/** Делит ли index пару суррогатов: перед ним старшая половина пары, на нём младшая. */
function splitsPair(text: string, index: number): boolean {
  return (
    /[\uD800-\uDBFF]/.test(text.charAt(index - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(index))
  );
}

/** Пишет ограниченные куски UTF-8 и разреженный индекс перехода от символа UTF-16 к байту. */
class JsonWriter {
  bytes = 0;
  chars = 0;
  checkpoints = 0;
  private pending = "";
  constructor(
    private readonly body: FileHandle,
    private readonly index: FileHandle,
  ) {}
  async append(text: string): Promise<void> {
    for (let offset = 0; offset < text.length;) {
      if (!this.pending) {
        await writeAll(this.index, record(this.chars, this.bytes));
        this.checkpoints++;
      }
      let length = Math.min(CHUNK_CHARS - this.pending.length, text.length - offset);
      if (splitsPair(text, offset + length)) length--;
      if (!length) {
        await this.flush();
        continue;
      }
      const part = text.slice(offset, offset + length);
      this.pending += part;
      this.chars += part.length;
      this.bytes += Buffer.byteLength(part);
      offset += length;
      if (this.pending.length >= CHUNK_CHARS) await this.flush();
    }
  }
  async flush(): Promise<void> {
    if (this.pending) {
      await writeAll(this.body, Buffer.from(this.pending));
      this.pending = "";
    }
  }
}

/**
 * Пишет то же, что JSON.stringify, но строку — сам результат или поле объекта — частями: текст
 * прочитанного файла не копируется в JSON целиком. Глубже полей не идёт: цикл в данных ловит
 * JSON.stringify.
 */
async function appendJson(writer: JsonWriter, value: unknown, nested = false): Promise<void> {
  if (typeof value === "string") {
    await writer.append('"');
    for (let offset = 0, end = 0; offset < value.length; offset = end) {
      end = Math.min(offset + CHUNK_CHARS, value.length);
      // Половину пары суррогатов JSON.stringify записал бы как \uXXXX.
      if (splitsPair(value, end)) end--;
      await writer.append(JSON.stringify(value.slice(offset, end)).slice(1, -1));
    }
    await writer.append('"');
  } else if (nested || value === null || typeof value !== "object" || Array.isArray(value)) {
    await writer.append(JSON.stringify(value) ?? "null");
  } else {
    let separator = "{";
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
      await writer.append(`${separator}${JSON.stringify(key)}:`);
      await appendJson(writer, child, true);
      separator = ",";
    }
    await writer.append(separator === "{" ? "{}" : "}");
  }
}

/**
 * Непрозрачные ID привязаны к подключению и пользователю. Опубликованные метаданные
 * указывают только на полные локальные payload.
 * @internal
 */
export class ResultStore {
  private static readonly PRUNE_INTERVAL_MS = 60_000;
  private static readonly PRUNE_MAX_ACCUMULATED_BYTES = 4 * 1024 * 1024;
  readonly directory: string;
  private lastPrunedAt: number | undefined;
  private bytesSincePrune = 0;
  private pruning: Promise<void> | undefined;
  constructor(
    readonly config: ConnectionConfig,
    private readonly now: () => number = Date.now,
  ) {
    const scope = createHash("sha256")
      .update(`${config.name}\n${config.baseUrl}\n${config.username ?? "anonymous"}`)
      .digest("hex")
      .slice(0, 24);
    this.directory = join(resolve(config.runtimeDir), scope, "results");
  }
  path(id: string): string {
    if (!RESULT_ID.test(id))
      throw new HcmError(
        "INVALID_RESULT_ID",
        "resultId неверен: нужен ID из meta.resultId ответа.",
      );
    return join(this.directory, `${id}.json`);
  }
  private payload(
    id: string,
    extension: "data.json" | "data.idx" | "rows.idx" | "text.bin",
  ): string {
    this.path(id);
    return join(this.directory, `${id}.${extension}`);
  }
  async export(input: ResultExportInput, envelope?: OperationResult): Promise<ResultExportData> {
    const id = requiredString(input.resultId, "resultId"),
      path = requiredString(input.path, "path");
    const format = input.format ?? "json";
    if (!["json", "jsonl", "text"].includes(format)) throw exportFormatError();
    if (envelope) await mkdir(dirname(resolve(path)), { recursive: true });
    const count = { items: 0 };
    const store = this;
    const source = async function* () {
      for (let offset: unknown = 0; offset !== undefined;) {
        const page = await store.read(id, offset, 65536, format === "text" ? "text" : "json");
        if (format === "text" && page.format !== "text") throw exportFormatError();
        yield String(page.text);
        offset = page.nextOffset;
      }
    };
    const wrapped = async function* () {
      if (envelope) {
        const { truncated: _, ...meta } = envelope.meta;
        yield `${JSON.stringify({ ...envelope, data: undefined, meta }).slice(0, -1)},"data":`;
      }
      yield* format === "jsonl" ? jsonLines(source(), count, await store.listName(id)) : source();
      if (envelope) yield "}\n";
    };
    const bytes = await saveLocalFile(path, input.overwrite === true, (file) =>
      writeFile(file, wrapped(), "utf8"),
    );
    return { path, bytes, format, ...(format === "jsonl" ? count : {}) };
  }
  /** Потоково декодирует верхнеуровневое поле base64 сохранённого результата прямо в файл (O(1) памяти). */
  async exportBinary(
    resultId: string,
    path: string,
    overwrite = false,
  ): Promise<{ bytes: number }> {
    const id = requiredString(resultId, "resultId");
    const target = requiredString(path, "path");
    const dataPath = this.payload(id, "data.json");
    try {
      await stat(this.path(id));
      await stat(dataPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new HcmError("RESULT_NOT_FOUND", `Сохранённый результат ${id} не найден.`);
      throw error;
    }
    await mkdir(dirname(resolve(target)), { recursive: true });
    const bytes = await saveLocalFile(target, overwrite, async (file) => {
      const stream = createReadStream(dataPath, { encoding: "utf8", highWaterMark: 64 * 1024 });
      let depth = 0;
      let inString = false;
      let escaped = false;
      let readingKey = false;
      let keyBuf = "";
      let afterKey = false;
      let expectBase64Value = false;
      let readingBase64 = false;
      let foundBase64 = false;
      let pending = "";
      const FLUSH_CHARS = 48 * 1024;

      const flushPending = async (final: boolean): Promise<void> => {
        const usable = final ? pending.length : pending.length - (pending.length % 4);
        if (usable === 0) return;
        const slice = pending.slice(0, usable);
        pending = pending.slice(usable);
        await writeAll(file, Buffer.from(slice, "base64"));
      };

      try {
        for await (const chunk of stream) {
          for (let i = 0; i < chunk.length; i++) {
            const ch = chunk[i]!;
            if (readingBase64) {
              if (escaped) {
                escaped = false;
                continue;
              }
              if (ch === "\\") {
                escaped = true;
                continue;
              }
              if (ch === '"') {
                readingBase64 = false;
                await flushPending(true);
                break;
              }
              pending += ch;
              if (pending.length >= FLUSH_CHARS) await flushPending(false);
              continue;
            }
            if (inString) {
              if (escaped) {
                escaped = false;
                continue;
              }
              if (ch === "\\") {
                escaped = true;
                continue;
              }
              if (ch === '"') {
                inString = false;
                if (readingKey) {
                  readingKey = false;
                  afterKey = true;
                }
              } else if (readingKey && keyBuf.length < 16) {
                keyBuf += ch;
              }
              continue;
            }
            if (ch === '"') {
              if (expectBase64Value) {
                expectBase64Value = false;
                readingBase64 = true;
                foundBase64 = true;
              } else {
                inString = true;
                if (depth === 1 && !afterKey) {
                  readingKey = true;
                  keyBuf = "";
                }
              }
              continue;
            }
            if (ch === ":" && depth === 1 && afterKey) {
              afterKey = false;
              expectBase64Value = keyBuf === "base64";
              continue;
            }
            if (ch === "," && depth === 1) {
              afterKey = false;
              expectBase64Value = false;
              continue;
            }
            if (ch === "{" || ch === "[") {
              expectBase64Value = false;
              depth++;
            } else if (ch === "}" || ch === "]") {
              expectBase64Value = false;
              depth--;
            }
          }
          if (foundBase64 && !readingBase64) break;
        }
      } finally {
        stream.destroy();
      }
      if (!foundBase64 || readingBase64) throw exportFormatError();
    });
    return { bytes };
  }
  /** Потоково сохраняет список построчно (jsonl), а одиночный объект — одной строкой JSON (O(1) памяти). */
  async exportJsonlAny(
    resultId: string,
    path: string,
    overwrite = false,
    listKey?: string,
  ): Promise<{ bytes: number }> {
    const id = requiredString(resultId, "resultId");
    const target = requiredString(path, "path");
    const dataPath = this.payload(id, "data.json");
    try {
      await stat(this.path(id));
      await stat(dataPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new HcmError("RESULT_NOT_FOUND", `Сохранённый результат ${id} не найден.`);
      throw error;
    }
    await mkdir(dirname(resolve(target)), { recursive: true });
    const resolvedList = listKey ?? (await this.listName(id));
    const allowSingleObject = resolvedList === "Task";
    try {
      const count = { items: 0 };
      const bytes = await saveLocalFile(target, overwrite, (file) =>
        writeFile(
          file,
          jsonLines(
            createReadStream(dataPath, { encoding: "utf8", highWaterMark: 64 * 1024 }),
            count,
            resolvedList,
            allowSingleObject,
          ),
          "utf8",
        ),
      );
      return { bytes };
    } catch (error) {
      if (!(error instanceof HcmError) || error.code !== "INVALID_RESULT_FORMAT") throw error;
    }
    if (allowSingleObject) {
      const bytes = await saveLocalFile(target, overwrite, async () => {});
      return { bytes };
    }
    const bytes = await saveLocalFile(target, overwrite, async (file) => {
      const stream = createReadStream(dataPath, { highWaterMark: 64 * 1024 });
      try {
        for await (const chunk of stream) {
          await writeAll(file, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        await writeAll(file, Buffer.from("\n"));
      } finally {
        stream.destroy();
      }
    });
    return { bytes };
  }
  /** Потоково читает data.json сохранённого результата блоками по 64 КиБ (O(1) памяти). */
  async *openJsonStream(resultId: string): AsyncGenerator<string> {
    const id = requiredString(resultId, "resultId");
    const dataPath = this.payload(id, "data.json");
    try {
      await stat(this.path(id));
      await stat(dataPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new HcmError("RESULT_NOT_FOUND", `Сохранённый результат ${id} не найден.`);
      throw error;
    }
    const stream = createReadStream(dataPath, { encoding: "utf8", highWaterMark: 64 * 1024 });
    try {
      for await (const chunk of stream) {
        yield typeof chunk === "string" ? chunk : chunk.toString("utf8");
      }
    } finally {
      stream.destroy();
    }
  }
  /** Потоково читает элементы списка сохранённого результата по одному (O(1) памяти). */
  async *openListItems(resultId: string, listKey?: string): AsyncGenerator<unknown> {
    const id = requiredString(resultId, "resultId");
    const dataPath = this.payload(id, "data.json");
    try {
      await stat(this.path(id));
      await stat(dataPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new HcmError("RESULT_NOT_FOUND", `Сохранённый результат ${id} не найден.`);
      throw error;
    }
    const resolvedList = listKey ?? (await this.listName(id));
    const allowSingleObject = resolvedList === "Task";
    const count = { items: 0 };
    const MAX_ITEM_CHARS = 8 * 1024 * 1024;
    let buffer = "";
    const stream = createReadStream(dataPath, { encoding: "utf8", highWaterMark: 64 * 1024 });
    try {
      for await (const chunk of jsonLines(stream, count, resolvedList, allowSingleObject)) {
        let start = 0;
        for (;;) {
          const nl = chunk.indexOf("\n", start);
          if (nl < 0) {
            buffer += chunk.slice(start);
            if (buffer.length > MAX_ITEM_CHARS) {
              throw new HcmError(
                "RESULT_TOO_LARGE_FOR_FORMAT",
                "Отдельный элемент результата превышает 8 МиБ и не форматируется в таблице/CSV.",
                `Сохранить потоково: wtctl result export ${id} --to ФАЙЛ --format jsonl (или json).`,
              );
            }
            break;
          }
          const line = buffer + chunk.slice(start, nl);
          buffer = "";
          start = nl + 1;
          if (line.trim()) yield JSON.parse(line);
        }
      }
      if (buffer.trim()) yield JSON.parse(buffer);
    } catch (error) {
      if (
        allowSingleObject &&
        error instanceof HcmError &&
        error.code === "INVALID_RESULT_FORMAT"
      ) {
        return;
      }
      throw error;
    } finally {
      stream.destroy();
    }
  }
  /** Читает сохранённые данные результата целиком (до 8 МиБ), для табличного форматирования CLI в --output. */
  async loadData(resultId: string): Promise<unknown> {
    const id = requiredString(resultId, "resultId");
    const info = await stat(this.payload(id, "data.json")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT")
        throw new HcmError("RESULT_NOT_FOUND", `Сохранённый результат ${id} не найден.`);
      throw error;
    });
    const MAX_LOAD_BYTES = 8 * 1024 * 1024;
    if (info.size > MAX_LOAD_BYTES) {
      throw new HcmError(
        "RESULT_TOO_LARGE_FOR_FORMAT",
        "Сохранённый результат больше 8 МиБ и не форматируется в памяти целиком.",
        `Сохранить потоково: wtctl result export ${id} --to ФАЙЛ --format jsonl (или json/text).`,
      );
    }
    const chunks: string[] = [];
    for (let offset: unknown = 0; offset !== undefined;) {
      const page = await this.read(id, offset, 65536, "json");
      chunks.push(String(page.text));
      offset = page.nextOffset;
    }
    return JSON.parse(chunks.join(""));
  }
  private async listName(id: string): Promise<string | undefined> {
    try {
      const manifest = this.path(id);
      if ((await stat(manifest)).size > MAX_METADATA_BYTES) return undefined;
      const list = (JSON.parse(await readFile(manifest, "utf8")) as { list?: unknown }).list;
      return typeof list === "string" ? list : undefined;
    } catch {
      return undefined;
    }
  }
  /**
   * Открывает потоковую запись результата-списка по элементам (O(1) памяти):
   * файлы data.json, data.idx и rows.idx пишутся сразу на диск.
   * @internal
   */
  async openListSaver(listKey = "items"): Promise<ListResultSaver> {
    const id = randomUUID();
    const created: string[] = [];
    const files: FileHandle[] = [];
    const create = async (path: string): Promise<FileHandle> => {
      const file = await open(`${path}.tmp`, "wx", 0o600);
      files.push(file);
      created.push(`${path}.tmp`);
      return file;
    };
    const cleanup = async (): Promise<void> => {
      await Promise.allSettled(files.map((file) => file.close()));
      files.length = 0;
      await Promise.allSettled(created.map((path) => unlink(path)));
      created.length = 0;
    };
    try {
      await mkdir(this.directory, { recursive: true });
      const body = await create(this.payload(id, "data.json"));
      const index = await create(this.payload(id, "data.idx"));
      const rowsHandle = await create(this.payload(id, "rows.idx"));
      const writer = new JsonWriter(body, index);
      await writer.append(`{${JSON.stringify(listKey)}:[`);
      let rowCount = 0;
      let pendingIndex: Buffer[] = [];
      let rawItemStartBytes = -1;
      let finished = false;
      const store = this;
      const recordRow = async (startBytes: number, lengthBytes: number): Promise<void> => {
        pendingIndex.push(record(startBytes, lengthBytes));
        if (pendingIndex.length >= 4096) {
          await writeAll(rowsHandle, Buffer.concat(pendingIndex));
          pendingIndex = [];
        }
        rowCount++;
      };
      return {
        async writeItem(item: unknown): Promise<void> {
          if (finished) return;
          if (rowCount > 0) await writer.append(",");
          const startBytes = writer.bytes;
          const serialised = JSON.stringify(item) ?? "null";
          await writer.append(serialised);
          await recordRow(startBytes, Buffer.byteLength(serialised));
        },
        async beginRawItem(): Promise<void> {
          if (finished) return;
          if (rowCount > 0) await writer.append(",");
          rawItemStartBytes = writer.bytes;
        },
        async writeRawChunk(chunk: string): Promise<void> {
          if (finished || !chunk) return;
          await writer.append(chunk);
        },
        async endRawItem(): Promise<void> {
          if (finished || rawItemStartBytes < 0) return;
          const startBytes = rawItemStartBytes;
          rawItemStartBytes = -1;
          await recordRow(startBytes, writer.bytes - startBytes);
        },
        async commit(
          extra?: Readonly<Record<string, unknown>>,
        ): Promise<{ readonly resultId: string; readonly bytes: number; readonly rows: number }> {
          if (finished) throw new Error("Запись результата уже завершена");
          finished = true;
          try {
            if (pendingIndex.length > 0) {
              await writeAll(rowsHandle, Buffer.concat(pendingIndex));
              pendingIndex = [];
            }
            await writer.append("]");
            if (extra) {
              const rest = JSON.stringify({ ...extra, [listKey]: undefined });
              if (rest && rest !== "{}") await writer.append(`,${rest.slice(1)}`);
              else await writer.append("}");
            } else {
              await writer.append("}");
            }
            await writer.flush();
            const metadata: Metadata = {
              version: 2,
              createdAt: new Date().toISOString(),
              kind: "json",
              jsonBytes: writer.bytes,
              jsonChars: writer.chars,
              checkpoints: writer.checkpoints,
              rows: rowCount,
              list: listKey,
            };
            await Promise.all(files.map((file) => file.close()));
            files.length = 0;
            for (const temporary of [...created]) {
              const target = temporary.slice(0, -4);
              await rename(temporary, target);
              created.push(target);
            }
            const manifest = store.path(id);
            const metadataFile = await create(manifest);
            await writeAll(metadataFile, Buffer.from(JSON.stringify(metadata)));
            await metadataFile.close();
            files.length = 0;
            await rename(`${manifest}.tmp`, manifest);
            created.push(manifest);
            await store.maybePrune(writer.bytes);
            return { resultId: id, bytes: writer.bytes, rows: rowCount };
          } catch (error) {
            await cleanup();
            if (error instanceof HcmError) throw error;
            if (error instanceof TypeError)
              throw new HcmError("RESULT_SERIALIZATION", "Результат нельзя записать как JSON.");
            throw new HcmError(
              "RESULT_WRITE_FAILED",
              "Не удалось сохранить результат на этом компьютере.",
              "Проверить права на папку runtimeDir и свободное место на диске.",
            );
          }
        },
        async abort(): Promise<void> {
          if (finished) return;
          finished = true;
          await cleanup();
        },
      };
    } catch (error) {
      await cleanup();
      if (error instanceof HcmError) throw error;
      throw new HcmError(
        "RESULT_WRITE_FAILED",
        "Не удалось сохранить результат на этом компьютере.",
        "Проверить права на папку runtimeDir и свободное место на диске.",
      );
    }
  }
  /**
   * Сохраняет результат и чистит папку подключения; сбой чистки ответа не меняет. list — поле,
   * которое операция называет своим списком; без него список угадывается по ответу.
   */
  async put(
    data: unknown,
    list?: string,
  ): Promise<{ resultId: string; bytes: number; list?: string }> {
    const saved = await this.write(data, list);
    await this.maybePrune(saved.bytes);
    return saved;
  }
  private async maybePrune(savedBytes: number): Promise<void> {
    const maxAge = (this.config.resultsMaxAgeDays ?? LOCAL_LIMITS.resultsMaxAgeDays) * DAY;
    const maxBytes = this.config.resultsMaxBytes ?? LOCAL_LIMITS.resultsMaxBytes;
    if (!maxAge && !maxBytes) return;
    this.bytesSincePrune += savedBytes;
    const byteThreshold =
      maxBytes > 0
        ? Math.min(Math.floor(maxBytes / 4), ResultStore.PRUNE_MAX_ACCUMULATED_BYTES)
        : ResultStore.PRUNE_MAX_ACCUMULATED_BYTES;
    const now = this.now();
    const due =
      this.lastPrunedAt === undefined ||
      now - this.lastPrunedAt >= ResultStore.PRUNE_INTERVAL_MS ||
      this.bytesSincePrune >= byteThreshold;
    if (due && !this.pruning) {
      this.lastPrunedAt = now;
      this.bytesSincePrune = 0;
      this.pruning = this.prune()
        .catch(() => {})
        .finally(() => {
          this.pruning = undefined;
        });
      await this.pruning;
    }
  }
  /**
   * Удаляет результаты старше resultsMaxAgeDays, затем самые старые сверх resultsMaxBytes.
   * Результаты моложе часа остаются: их может читать другой процесс того же подключения.
   */
  private async prune(): Promise<void> {
    const maxAge = (this.config.resultsMaxAgeDays ?? LOCAL_LIMITS.resultsMaxAgeDays) * DAY;
    const maxBytes = this.config.resultsMaxBytes ?? LOCAL_LIMITS.resultsMaxBytes;
    if (!maxAge && !maxBytes) return;
    const found = new Map<string, { payloads: string[]; bytes: number; time?: number }>();
    const names = await readdir(this.directory);
    let next = 0;
    const workers = Math.min(32, names.length);
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (next < names.length) {
          const name = names[next++]!;
          // Журнал записей и файлы .tmp недописанных результатов под шаблон не подходят.
          const [, id, extension] = RESULT_FILE.exec(name) ?? [];
          if (id === undefined) continue;
          const info = await stat(join(this.directory, name)).catch(() => undefined);
          if (!info) continue;
          const result = found.get(id) ?? { payloads: [], bytes: 0 };
          found.set(id, result);
          result.bytes += info.size;
          if (extension === "json") result.time = info.mtimeMs;
          else result.payloads.push(name);
        }
      }),
    );
    // Без описания результат ещё пишется: его файлы не трогаются.
    const results = [...found]
      .flatMap(([id, { time, ...files }]) => (time === undefined ? [] : [{ id, time, ...files }]))
      .sort((left, right) => left.time - right.time);
    let total = results.reduce((sum, result) => sum + result.bytes, 0);
    const now = this.now();
    for (const { id, time, payloads, bytes } of results) {
      const age = now - time;
      if (age < HOUR || ((!maxAge || age <= maxAge) && (!maxBytes || total <= maxBytes))) break;
      // Описание удаляется последним: недоудалённый результат удалится при следующей чистке.
      // Он и не держит сумму: иначе ради него удалялись бы все остальные результаты.
      total -= bytes;
      try {
        for (const name of [...payloads, `${id}.json`])
          await unlink(join(this.directory, name)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
      } catch {
        // Файл занят или не удаляется: остальные результаты чистятся дальше.
      }
    }
  }
  private async write(
    data: unknown,
    named?: string,
  ): Promise<{ resultId: string; bytes: number; list?: string }> {
    const id = randomUUID();
    const created: string[] = [];
    const files: FileHandle[] = [];
    const create = async (path: string): Promise<FileHandle> => {
      const file = await open(`${path}.tmp`, "wx", 0o600);
      files.push(file);
      created.push(`${path}.tmp`);
      return file;
    };
    try {
      await mkdir(this.directory, { recursive: true });
      const body = await create(this.payload(id, "data.json"));
      const index = await create(this.payload(id, "data.idx"));
      const writer = new JsonWriter(body, index);
      const metadata: Metadata = {
        version: 2,
        createdAt: new Date().toISOString(),
        kind: Array.isArray(data) ? "array" : typeof data === "string" ? "string" : "json",
        jsonBytes: 0,
        jsonChars: 0,
        checkpoints: 0,
      };
      const list = listOf(data, named, Math.floor(this.config.outputLimitBytes / 2) - 128);
      const elements = Array.isArray(data) ? data : list?.items;
      if (elements) {
        const rows = await create(this.payload(id, "rows.idx"));
        metadata.rows = elements.length;
        if (list) metadata.list = list.key;
        // Сначала пишется список: его элементы индексируются, остальной ответ идёт за ним.
        await writer.append(list ? `{${JSON.stringify(list.key)}:[` : "[");
        let pendingIndex: Buffer[] = [];
        for (const [position, item] of elements.entries()) {
          if (position) await writer.append(",");
          const serialised = JSON.stringify(item) ?? "null";
          pendingIndex.push(record(writer.bytes, Buffer.byteLength(serialised)));
          if (pendingIndex.length >= 4096) {
            await writeAll(rows, Buffer.concat(pendingIndex));
            pendingIndex = [];
          }
          await writer.append(serialised);
        }
        if (pendingIndex.length) await writeAll(rows, Buffer.concat(pendingIndex));
        await writer.append("]");
        if (list) {
          const rest = JSON.stringify({ ...(data as object), [list.key]: undefined });
          await writer.append(rest === "{}" ? "}" : `,${rest.slice(1)}`);
        }
      } else {
        if (data === undefined || typeof data === "function" || typeof data === "symbol")
          throw new HcmError("RESULT_SERIALIZATION", "Результат — не значение JSON.");
        await appendJson(writer, data);
      }
      await writer.flush();
      Object.assign(metadata, {
        jsonBytes: writer.bytes,
        jsonChars: writer.chars,
        checkpoints: writer.checkpoints,
      });
      const text = textOf(data);
      if (text !== undefined) {
        // UTF-16LE сохраняет каждую кодовую единицу строки, в том числе одиночные суррогаты.
        const plain = await create(this.payload(id, "text.bin"));
        metadata.textChars = text.length;
        for (let offset = 0; offset < text.length; offset += CHUNK_CHARS)
          await writeAll(plain, Buffer.from(text.slice(offset, offset + CHUNK_CHARS), "utf16le"));
      }
      await Promise.all(files.map((file) => file.close()));
      files.length = 0;
      for (const temporary of [...created]) {
        const target = temporary.slice(0, -4);
        await rename(temporary, target);
        created.push(target);
      }
      const manifest = this.path(id);
      const metadataFile = await create(manifest);
      await writeAll(metadataFile, Buffer.from(JSON.stringify(metadata)));
      await metadataFile.close();
      files.length = 0;
      await rename(`${manifest}.tmp`, manifest);
      created.push(manifest);
      return { resultId: id, bytes: writer.bytes, ...(list ? { list: list.key } : {}) };
    } catch (error) {
      await Promise.allSettled(files.map((file) => file.close()));
      await Promise.allSettled(created.map((path) => unlink(path)));
      if (error instanceof HcmError) throw error;
      if (error instanceof TypeError)
        throw new HcmError("RESULT_SERIALIZATION", "Результат нельзя записать как JSON.");
      throw new HcmError(
        "RESULT_WRITE_FAILED",
        "Не удалось сохранить результат на этом компьютере.",
        "Проверить права на папку runtimeDir и свободное место на диске.",
      );
    }
  }
  async read(
    id: string,
    offsetValue?: unknown,
    limitValue?: unknown,
    formatValue?: unknown,
  ): Promise<Record<string, unknown>> {
    const manifest = this.path(id);
    if (formatValue !== undefined && !["auto", "json", "text"].includes(formatValue as string))
      throw new HcmError("INVALID_RESULT_FORMAT", "format: нужно auto, json или text.");
    let size: number;
    try {
      size = (await stat(manifest)).size;
    } catch {
      throw notFound();
    }
    if (size > MAX_METADATA_BYTES)
      return this.legacy(manifest, size, offsetValue, limitValue, formatValue);
    let envelope: unknown;
    try {
      envelope = JSON.parse(await readFile(manifest, "utf8"));
    } catch (error) {
      // Чистка удалила результат между stat и чтением.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notFound();
      throw invalid();
    }
    if (
      envelope !== null &&
      typeof envelope === "object" &&
      "version" in envelope &&
      envelope.version === 1
    )
      return this.legacy(manifest, size, offsetValue, limitValue, formatValue);
    const metadata = this.metadata(envelope);
    const arrayPage =
      (metadata.kind === "array" || metadata.list !== undefined) && formatValue !== "json";
    const offset = boundedInteger(offsetValue, 0, Number.MAX_SAFE_INTEGER, "offset");
    // Один лимит обслуживает оба вида страниц: вызывающий заранее не знает, какую получит.
    const asked = boundedInteger(limitValue, arrayPage ? 100 : 12000, 65536, "limit");
    if (!asked) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    const limit = arrayPage ? Math.min(asked, 1000) : asked;
    try {
      await this.assertSize(this.payload(id, "data.json"), metadata.jsonBytes);
      await this.assertSize(this.payload(id, "data.idx"), metadata.checkpoints * RECORD_BYTES);
      if (arrayPage && formatValue !== "text") return await this.array(id, metadata, offset, limit);
      if (formatValue === "text" && metadata.textChars === undefined) throw exportFormatError();
      // Сохранённый ответ с текстом (лог, файл) читается как текст, не как экранированный JSON.
      const plain = metadata.textChars !== undefined && formatValue !== "json";
      const total = plain ? metadata.textChars! : metadata.jsonChars;
      const text = plain
        ? await this.plain(id, metadata, offset, limit)
        : await this.json(id, metadata, offset, limit);
      return this.textPage(text, offset, total, limit, plain ? "text" : "json");
    } catch (error) {
      if (error instanceof HcmError) throw error;
      // Чистка удаляет описание последним: описание без данных — результат, удалённый не до конца.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notFound();
      throw invalid();
    }
  }
  private metadata(value: unknown): Metadata {
    if (value === null || typeof value !== "object") throw invalid();
    const source = value as Record<string, unknown>;
    if (
      source.version !== 2 ||
      !["array", "string", "json"].includes(String(source.kind)) ||
      typeof source.createdAt !== "string" ||
      !natural(source.jsonBytes) ||
      source.jsonBytes < 1 ||
      !natural(source.jsonChars) ||
      source.jsonChars < 1 ||
      !natural(source.checkpoints) ||
      source.checkpoints < 1 ||
      source.checkpoints > source.jsonChars ||
      source.checkpoints * RECORD_BYTES > Number.MAX_SAFE_INTEGER ||
      source.checkpoints < Math.ceil(source.jsonChars / CHUNK_CHARS) ||
      source.checkpoints > Math.ceil(source.jsonChars / (CHUNK_CHARS - 1)) ||
      (source.kind === "array" &&
        (!natural(source.rows) || source.rows * RECORD_BYTES > Number.MAX_SAFE_INTEGER)) ||
      (source.list !== undefined &&
        (typeof source.list !== "string" ||
          source.kind !== "json" ||
          !natural(source.rows) ||
          source.rows * RECORD_BYTES > Number.MAX_SAFE_INTEGER)) ||
      (source.kind === "string" && source.textChars === undefined) ||
      (source.kind === "array" && source.textChars !== undefined) ||
      (source.textChars !== undefined &&
        (!natural(source.textChars) || source.textChars * 2 > Number.MAX_SAFE_INTEGER))
    )
      throw invalid();
    return source as unknown as Metadata;
  }
  private async assertSize(path: string, expected: number): Promise<void> {
    if ((await stat(path)).size !== expected) throw invalid();
  }
  private async array(
    id: string,
    metadata: Metadata,
    offset: number,
    limit: number,
  ): Promise<Record<string, unknown>> {
    const count = metadata.rows!;
    await this.assertSize(this.payload(id, "rows.idx"), count * RECORD_BYTES);
    if (offset >= count)
      return {
        items: [],
        total: count,
        ...(metadata.list === undefined ? {} : { list: metadata.list }),
      };
    return reading(
      [this.payload(id, "rows.idx"), this.payload(id, "data.json")],
      async ([index, body]) => {
        const selected = await readExactly(
          index!,
          offset * RECORD_BYTES,
          Math.min(limit, count - offset) * RECORD_BYTES,
        );
        const items: unknown[] = [];
        let used = 128;
        for (let position = 0; position < selected.length; position += RECORD_BYTES) {
          const [start, bytes] = numbers(selected.subarray(position, position + RECORD_BYTES));
          if (start < 1 || !bytes || start + bytes >= metadata.jsonBytes) throw invalid();
          if (used + bytes > this.config.outputLimitBytes / 2) {
            if (!items.length)
              return {
                items,
                total: count,
                blockedItem: { index: offset, bytes },
                hint: "Элемент blockedItem не помещается в ответ и не пропущен. Читать результат с format:json — текстом JSON по частям.",
                ...(metadata.list === undefined ? {} : { list: metadata.list }),
              };
            break;
          }
          items.push(
            JSON.parse(
              new TextDecoder("utf8", { fatal: true }).decode(
                await readExactly(body!, start, bytes),
              ),
            ),
          );
          used += bytes + 1;
        }
        return {
          items,
          total: count,
          ...(offset + items.length < count ? { nextOffset: offset + items.length } : {}),
          ...(items.length < Math.min(limit, count - offset) ? { cutBySize: true } : {}),
          ...(metadata.list === undefined ? {} : { list: metadata.list }),
        };
      },
    );
  }
  private async plain(
    id: string,
    metadata: Metadata,
    offset: number,
    limit: number,
  ): Promise<string> {
    await this.assertSize(this.payload(id, "text.bin"), metadata.textChars! * 2);
    if (offset >= metadata.textChars!) return "";
    const file = await open(this.payload(id, "text.bin"), "r");
    try {
      const start = Math.max(0, offset - 1);
      const text = (
        await readExactly(file, start * 2, Math.min(limit + 3, metadata.textChars! - start) * 2)
      ).toString("utf16le");
      if (offset && splitsPair(text, 1))
        throw new HcmError(
          "INVALID_OFFSET",
          "offset попадает в середину символа Unicode: нужно брать nextOffset из прошлого ответа.",
        );
      return text.slice(offset - start);
    } finally {
      await file.close();
    }
  }
  private async json(
    id: string,
    metadata: Metadata,
    offset: number,
    limit: number,
  ): Promise<string> {
    if (offset >= metadata.jsonChars) return "";
    return reading(
      [this.payload(id, "data.idx"), this.payload(id, "data.json")],
      async ([index, body]) => {
        const first = numbers(await readExactly(index!, 0, RECORD_BYTES));
        if (first[0] !== 0 || first[1] !== 0) throw invalid();
        let left = 0;
        let right = metadata.checkpoints - 1;
        let selected: [number, number] = [0, 0];
        const target = Math.max(0, offset - 1);
        while (left <= right) {
          const middle = Math.floor((left + right) / 2);
          const checkpoint = numbers(
            await readExactly(index!, middle * RECORD_BYTES, RECORD_BYTES),
          );
          if (checkpoint[0] >= metadata.jsonChars || checkpoint[1] >= metadata.jsonBytes)
            throw invalid();
          if (checkpoint[0] <= target) {
            selected = checkpoint;
            left = middle + 1;
          } else right = middle - 1;
        }
        const [start, byteOffset] = selected;
        if (target - start >= CHUNK_CHARS) throw invalid();
        const amount = Math.min(metadata.jsonBytes - byteOffset, (offset - start + limit + 2) * 4);
        const decoded = new TextDecoder("utf8", { fatal: true }).decode(
          await readExactly(body!, byteOffset, amount),
          { stream: byteOffset + amount < metadata.jsonBytes },
        );
        const relative = offset - start;
        if (decoded.length < Math.min(metadata.jsonChars - start, relative + limit + 1))
          throw invalid();
        if (
          byteOffset + amount === metadata.jsonBytes &&
          decoded.length !== metadata.jsonChars - start
        )
          throw invalid();
        if (splitsPair(decoded, relative))
          throw new HcmError(
            "INVALID_OFFSET",
            "offset попадает в середину символа Unicode: нужно брать nextOffset из прошлого ответа.",
          );
        return decoded.slice(relative, relative + limit + 1);
      },
    );
  }
  private textPage(
    source: string,
    offset: number,
    total: number,
    limit: number,
    format: "text" | "json",
  ): Record<string, unknown> {
    if (!source.length && offset < total) throw invalid();
    let lower = 0;
    let upper = Math.min(limit, source.length);
    while (lower < upper) {
      const middle = Math.ceil((lower + upper) / 2);
      if (
        Buffer.byteLength(JSON.stringify(source.slice(0, middle))) <=
        this.config.outputLimitBytes / 2
      )
        lower = middle;
      else upper = middle - 1;
    }
    let end = lower;
    if (splitsPair(source, end)) {
      if (end === 1) end++;
      else end--;
    }
    if (!end && source.length)
      throw new HcmError(
        "RESULT_OUTPUT_LIMIT",
        "В ответ не помещается даже один символ: предел размера ответа слишком мал.",
      );
    return {
      text: source.slice(0, end),
      format,
      totalChars: total,
      ...(offset + end < total ? { nextOffset: offset + end } : {}),
      ...(end < Math.min(limit, source.length) ? { cutBySize: true } : {}),
    };
  }
  /** Артефакты версии 1 читает прежний ограниченный читатель; новые ссылки — индексированная v2. */
  private async legacy(
    path: string,
    bytes: number,
    offsetValue: unknown,
    limitValue: unknown,
    format: unknown,
  ): Promise<Record<string, unknown>> {
    if (bytes > this.config.maxResponseBytes * 2)
      throw new HcmError(
        "LEGACY_RESULT_TOO_LARGE",
        "Результат сохранён прежней версией клиента и слишком велик, чтобы его прочитать.",
        "Новые результаты хранятся иначе и читаются по частям; этот файл нужно открыть напрямую в папке runtimeDir.",
      );
    let data: unknown;
    try {
      const envelope: unknown = JSON.parse(await readFile(path, "utf8"));
      if (
        envelope === null ||
        typeof envelope !== "object" ||
        !("version" in envelope) ||
        envelope.version !== 1 ||
        !("data" in envelope)
      )
        throw invalid();
      data = envelope.data;
    } catch {
      throw invalid();
    }
    const array = Array.isArray(data) && format !== "json";
    const offset = boundedInteger(offsetValue, 0, Number.MAX_SAFE_INTEGER, "offset");
    const limit = boundedInteger(limitValue, array ? 100 : 12000, array ? 1000 : 65536, "limit");
    if (!limit) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    if (array) {
      const rows = data as unknown[];
      const items: unknown[] = [];
      let used = 128;
      for (const item of rows.slice(offset, offset + limit)) {
        const size = Buffer.byteLength(JSON.stringify(item));
        if (used + size > this.config.outputLimitBytes / 2) {
          if (!items.length)
            return {
              items,
              total: rows.length,
              blockedItem: { index: offset, bytes: size },
              hint: "Элемент blockedItem не помещается в ответ и не пропущен. Читать результат с format:json.",
            };
          break;
        }
        items.push(item);
        used += size + 1;
      }
      return {
        items,
        total: rows.length,
        ...(offset + items.length < rows.length ? { nextOffset: offset + items.length } : {}),
      };
    }
    const text = typeof data === "string" && format !== "json" ? data : JSON.stringify(data);
    if (splitsPair(text, offset))
      throw new HcmError(
        "INVALID_OFFSET",
        "offset попадает в середину символа Unicode: нужно брать nextOffset из прошлого ответа.",
      );
    return this.textPage(
      text.slice(offset, offset + limit + 1),
      offset,
      text.length,
      limit,
      typeof data === "string" && format !== "json" ? "text" : "json",
    );
  }
}
