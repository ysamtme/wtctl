import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, open, unlink, type FileHandle } from "node:fs/promises";
import { constants, copyFile, link, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { HcmError, boundedInteger, requiredString } from "./errors.js";
import type { ConnectionConfig, OperationResult } from "./contracts.js";

export interface ResultExportInput {
  resultId: string;
  path: string;
  format?: "json" | "jsonl" | "text";
  overwrite?: boolean;
}
export async function writeResultFile(
  path: string,
  chunks: AsyncIterable<string> | string[],
  overwrite = false,
): Promise<number> {
  if (path.includes("\0"))
    throw new HcmError("INVALID_ARGUMENT", "path: в пути есть нулевой символ.");
  const target = resolve(path);
  if ((await stat(target).catch(() => undefined))?.isDirectory())
    throw new HcmError(
      "INVALID_ARGUMENT",
      "path: по этому пути папка, а нужен путь к файлу.",
      "К пути нужно добавить имя файла, например result.json.",
    );
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, chunks, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const bytes = (await stat(temporary)).size;
    // Эксклюзивная жёсткая ссылка публикует полный файл без гонки, которая есть
    // у переименования без перезаписи.
    if (overwrite) await rename(temporary, target);
    else
      await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") throw error;
        return copyFile(temporary, target, constants.COPYFILE_EXCL); // ФС без жёстких ссылок.
      });
    return bytes;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST")
      throw new HcmError(
        "FILE_EXISTS",
        "Файл по этому пути уже есть.",
        "Нужно разрешить замену файла (overwrite) или выбрать другой путь.",
      );
    if (code === "ENOENT")
      throw new HcmError(
        "FOLDER_NOT_FOUND",
        "Папки для файла нет.",
        "Сначала нужно создать папку.",
      );
    throw error;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Выбирает внешний массив или элемент-список ответа, не буферизуя даже одну полную строку. */
async function* jsonLines(
  source: AsyncIterable<string>,
  count: { items: number },
  list = "items",
): AsyncGenerator<string> {
  // Ключ в том виде, в каком его пишет JSON-текст, с закрывающей кавычкой.
  const name = JSON.stringify(list).slice(1);
  let depth = 0,
    selected = -1,
    quoted = 0,
    key = "",
    row = false;
  for await (const chunk of source) {
    let output = "";
    for (const char of chunk) {
      if (selected > 0 && depth >= selected) {
        const end = !quoted && depth === selected && (char === "," || char === "]");
        output += end ? (row ? "\n" : "") : char;
        if (end && row) count.items++;
        row = !end;
        if (end && char === "]") selected = 0;
      }
      if (quoted) {
        if (depth === 1 && key.length < name.length) key += char;
        quoted = quoted === 2 ? 1 : char === "\\" ? 2 : char === '"' ? 0 : 1;
      } else if (char === '"') {
        quoted = 1;
        key = "";
      } else {
        if (char === "[" && selected < 0 && (!depth || (depth === 1 && key === name)))
          selected = depth + 1;
        if (char === "[" || char === "{") depth++;
        if (char === "]" || char === "}") depth--;
        if (char !== ":") key = "";
      }
    }
    yield output;
  }
  if (selected < 0) throw exportFormatError();
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
 */
function listOf(data: unknown): { key: string; items: unknown[] } | undefined {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return undefined;
  if (textOf(data) !== undefined) return undefined;
  let found: { key: string; items: unknown[]; bytes: number } | undefined;
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value) || value.length < 2 || key.length > 256) continue;
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > (found?.bytes ?? 0)) found = { key, items: value, bytes };
  }
  return found && found.bytes * 2 > Buffer.byteLength(JSON.stringify(data)) ? found : undefined;
}

const CHUNK_CHARS = 65536;
const RECORD_BYTES = 16;
const MAX_METADATA_BYTES = 4096;
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
function high(value: string): boolean {
  return /[\uD800-\uDBFF]/.test(value);
}
function low(value: string): boolean {
  return /[\uDC00-\uDFFF]/.test(value);
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
      if (high(text.charAt(offset + length - 1)) && low(text.charAt(offset + length))) length--;
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
 * Непрозрачные ID привязаны к подключению и пользователю. Опубликованные метаданные
 * указывают только на полные локальные payload.
 */
export class ResultStore {
  readonly directory: string;
  constructor(readonly config: ConnectionConfig) {
    const scope = createHash("sha256")
      .update(`${config.name}\n${config.baseUrl}\n${config.username ?? "anonymous"}`)
      .digest("hex")
      .slice(0, 24);
    this.directory = join(resolve(config.runtimeDir), scope, "results");
  }
  path(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
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
  async export(input: ResultExportInput, envelope?: OperationResult) {
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
    const bytes = await writeResultFile(path, wrapped(), input.overwrite === true);
    return { path, bytes, format, ...(format === "jsonl" ? count : {}) };
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
  async put(data: unknown): Promise<{ resultId: string; bytes: number; list?: string }> {
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
      const list = listOf(data);
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
        const serialised = JSON.stringify(data);
        if (serialised === undefined)
          throw new HcmError("RESULT_SERIALIZATION", "Результат — не значение JSON.");
        await writer.append(serialised);
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
      throw new HcmError(
        "RESULT_NOT_FOUND",
        "Результата с таким resultId нет, или он сохранён другим подключением.",
      );
    }
    if (size > MAX_METADATA_BYTES)
      return this.legacy(manifest, size, offsetValue, limitValue, formatValue);
    let envelope: unknown;
    try {
      envelope = JSON.parse(await readFile(manifest, "utf8"));
    } catch {
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
      if (offset && high(text.charAt(0)) && low(text.charAt(1)))
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
        if (relative && high(decoded.charAt(relative - 1)) && low(decoded.charAt(relative)))
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
    if (end && high(source.charAt(end - 1)) && low(source.charAt(end))) {
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
    if (offset && high(text.charAt(offset - 1)) && low(text.charAt(offset)))
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
