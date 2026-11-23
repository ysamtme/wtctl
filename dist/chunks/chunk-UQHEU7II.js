import { createRequire as __wtctlRequire } from "node:module";
const require = __wtctlRequire(import.meta.url);
import {
  HcmError,
  HcmServer,
  LOCAL_LIMITS,
  LibraryReader,
  SchemaReader,
  ServerFiles,
  WriteOutcome,
  XmlDocument,
  boundedInteger,
  cleanXmlValue,
  describeHcmOperation,
  hasStructure,
  identifier,
  inputObject,
  isSimilarName,
  listHcmOperations,
  normalizeXmlLineEndings,
  operationDefinition,
  operationEffect,
  operationSpec,
  operations,
  patchSegments,
  permissionHint,
  platformFailure,
  projectFields,
  queryPage,
  readServerInfo,
  requiredString,
  rpcArgument,
  sameData,
  saveLocalFile,
  scalar,
  serverDatabases,
  similarHint,
  withRepeated,
  withRequestSignal,
  withoutFalseOffset
} from "./chunk-T672SCY6.js";
import {
  NativeGateway,
  freezeRegistry,
  trustedGatewayPort,
  validate
} from "./chunk-VCNJKZJ7.js";
import {
  ArgumentError,
  WsHcmApiError,
  attachCleanupError,
  buildXml,
  findXmlNode,
  isTransportFailure,
  parsePhysicalDocumentId,
  parseXml,
  redactCredentials,
  resolvePhysicalDocumentLocation,
  validateDbName
} from "./chunk-JZ7VTFSJ.js";

// src/results.ts
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
async function* jsonLines(source, count, list = "items", objectsOnly = false) {
  const name = JSON.stringify(list).slice(1);
  let depth = 0, selected = -1, singleObjectDepth = -1, quoted = 0, key = "", row = false, itemKind = "none";
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
          if (itemKind === "none" && !quoted && depth === selected && (char === " " || char === "\n" || char === "\r" || char === "	")) {
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
        if (char === "[" && selected < 0 && singleObjectDepth < 0 && (!depth || depth === 1 && key === name)) {
          selected = depth + 1;
          itemKind = "none";
        } else if (objectsOnly && char === "{" && selected < 0 && singleObjectDepth < 0 && depth === 1 && key === name) {
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
var exportFormatError = () => new HcmError(
  "INVALID_RESULT_FORMAT",
  "Этот результат нельзя отдать в запрошенном формате.",
  "text подходит сохранённой строке и ответу с полем text, jsonl — списку; json подходит любому результату."
);
function textOf(data) {
  if (typeof data === "string") return data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return void 0;
  const text2 = data.text;
  return typeof text2 === "string" ? text2 : void 0;
}
function listOf(data, named, maxItemBytes) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return void 0;
  const own = named === void 0 ? void 0 : data[named];
  if (Array.isArray(own)) return { key: named, items: own };
  if (textOf(data) !== void 0) return void 0;
  let found;
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value) || value.length < 2 || key.length > 256) continue;
    if (maxItemBytes !== void 0 && (maxItemBytes <= 0 || Buffer.byteLength(JSON.stringify(value[0]) ?? "null") > maxItemBytes))
      continue;
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > (found?.bytes ?? 0)) found = { key, items: value, bytes };
  }
  return found && found.bytes * 2 > Buffer.byteLength(JSON.stringify(data)) ? found : void 0;
}
var CHUNK_CHARS = 65536;
var RECORD_BYTES = 16;
var MAX_METADATA_BYTES = 4096;
var HOUR = 3600 * 1e3;
var DAY = 24 * HOUR;
var UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
var RESULT_ID = new RegExp(`^${UUID}$`);
var RESULT_FILE = new RegExp(`^(${UUID})\\.(json|data\\.json|data\\.idx|rows\\.idx|text\\.bin)$`);
function invalid() {
  return new HcmError(
    "RESULT_INVALID",
    "Сохранённый результат не читается: его файлы повреждены или неполны."
  );
}
function notFound() {
  return new HcmError(
    "RESULT_NOT_FOUND",
    "Результата с таким resultId нет, или он сохранён другим подключением.",
    "Результат мог быть удалён по сроку хранения: нужно повторить запрос, который его вернул."
  );
}
function natural(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function record(first, second) {
  const bytes = Buffer.alloc(RECORD_BYTES);
  bytes.writeBigUInt64LE(BigInt(first));
  bytes.writeBigUInt64LE(BigInt(second), 8);
  return bytes;
}
function numbers(bytes) {
  const first = Number(bytes.readBigUInt64LE());
  const second = Number(bytes.readBigUInt64LE(8));
  if (!natural(first) || !natural(second)) throw invalid();
  return [first, second];
}
async function writeAll(file, bytes) {
  for (let offset = 0; offset < bytes.length; ) {
    const written = (await file.write(bytes, offset, bytes.length - offset)).bytesWritten;
    if (!written) throw new Error("Запись результата не продвигается");
    offset += written;
  }
}
async function readExactly(file, position, length) {
  const bytes = Buffer.alloc(length);
  for (let offset = 0; offset < length; ) {
    const read = (await file.read(bytes, offset, length - offset, position + offset)).bytesRead;
    if (!read) throw invalid();
    offset += read;
  }
  return bytes;
}
async function reading(paths, action) {
  const files = [];
  try {
    for (const path of paths) files.push(await open(path, "r"));
    return await action(files);
  } finally {
    await Promise.all(files.map((file) => file.close()));
  }
}
function splitsPair(text2, index) {
  return /[\uD800-\uDBFF]/.test(text2.charAt(index - 1)) && /[\uDC00-\uDFFF]/.test(text2.charAt(index));
}
var JsonWriter = class {
  constructor(body, index) {
    this.body = body;
    this.index = index;
  }
  bytes = 0;
  chars = 0;
  checkpoints = 0;
  pending = "";
  async append(text2) {
    for (let offset = 0; offset < text2.length; ) {
      if (!this.pending) {
        await writeAll(this.index, record(this.chars, this.bytes));
        this.checkpoints++;
      }
      let length = Math.min(CHUNK_CHARS - this.pending.length, text2.length - offset);
      if (splitsPair(text2, offset + length)) length--;
      if (!length) {
        await this.flush();
        continue;
      }
      const part = text2.slice(offset, offset + length);
      this.pending += part;
      this.chars += part.length;
      this.bytes += Buffer.byteLength(part);
      offset += length;
      if (this.pending.length >= CHUNK_CHARS) await this.flush();
    }
  }
  async flush() {
    if (this.pending) {
      await writeAll(this.body, Buffer.from(this.pending));
      this.pending = "";
    }
  }
};
async function appendJson(writer, value, nested = false) {
  if (typeof value === "string") {
    await writer.append('"');
    for (let offset = 0, end = 0; offset < value.length; offset = end) {
      end = Math.min(offset + CHUNK_CHARS, value.length);
      if (splitsPair(value, end)) end--;
      await writer.append(JSON.stringify(value.slice(offset, end)).slice(1, -1));
    }
    await writer.append('"');
  } else if (nested || value === null || typeof value !== "object" || Array.isArray(value)) {
    await writer.append(JSON.stringify(value) ?? "null");
  } else {
    let separator = "{";
    for (const [key, child] of Object.entries(value)) {
      if (child === void 0 || typeof child === "function" || typeof child === "symbol") continue;
      await writer.append(`${separator}${JSON.stringify(key)}:`);
      await appendJson(writer, child, true);
      separator = ",";
    }
    await writer.append(separator === "{" ? "{}" : "}");
  }
}
var ResultStore = class _ResultStore {
  constructor(config, now = Date.now) {
    this.config = config;
    this.now = now;
    const scope = createHash("sha256").update(`${config.name}
${config.baseUrl}
${config.username ?? "anonymous"}`).digest("hex").slice(0, 24);
    this.directory = join(resolve(config.runtimeDir), scope, "results");
  }
  static PRUNE_INTERVAL_MS = 6e4;
  static PRUNE_MAX_ACCUMULATED_BYTES = 4 * 1024 * 1024;
  directory;
  lastPrunedAt;
  bytesSincePrune = 0;
  pruning;
  path(id) {
    if (!RESULT_ID.test(id))
      throw new HcmError(
        "INVALID_RESULT_ID",
        "resultId неверен: нужен ID из meta.resultId ответа."
      );
    return join(this.directory, `${id}.json`);
  }
  payload(id, extension) {
    this.path(id);
    return join(this.directory, `${id}.${extension}`);
  }
  async export(input2, envelope) {
    const id = requiredString(input2.resultId, "resultId"), path = requiredString(input2.path, "path");
    const format = input2.format ?? "json";
    if (!["json", "jsonl", "text"].includes(format)) throw exportFormatError();
    if (envelope) await mkdir(dirname(resolve(path)), { recursive: true });
    const count = { items: 0 };
    const store = this;
    const source = async function* () {
      for (let offset = 0; offset !== void 0; ) {
        const page = await store.read(id, offset, 65536, format === "text" ? "text" : "json");
        if (format === "text" && page.format !== "text") throw exportFormatError();
        yield String(page.text);
        offset = page.nextOffset;
      }
    };
    const wrapped = async function* () {
      if (envelope) {
        const { truncated: _, ...meta } = envelope.meta;
        yield `${JSON.stringify({ ...envelope, data: void 0, meta }).slice(0, -1)},"data":`;
      }
      yield* format === "jsonl" ? jsonLines(source(), count, await store.listName(id)) : source();
      if (envelope) yield "}\n";
    };
    const bytes = await saveLocalFile(
      path,
      input2.overwrite === true,
      (file) => writeFile(file, wrapped(), "utf8")
    );
    return { path, bytes, format, ...format === "jsonl" ? count : {} };
  }
  /** Потоково декодирует верхнеуровневое поле base64 сохранённого результата прямо в файл (O(1) памяти). */
  async exportBinary(resultId, path, overwrite = false) {
    const id = requiredString(resultId, "resultId");
    const target = requiredString(path, "path");
    const dataPath = this.payload(id, "data.json");
    try {
      await stat(this.path(id));
      await stat(dataPath);
    } catch (error) {
      if (error.code === "ENOENT")
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
      const flushPending = async (final) => {
        const usable = final ? pending.length : pending.length - pending.length % 4;
        if (usable === 0) return;
        const slice = pending.slice(0, usable);
        pending = pending.slice(usable);
        await writeAll(file, Buffer.from(slice, "base64"));
      };
      try {
        for await (const chunk of stream) {
          for (let i = 0; i < chunk.length; i++) {
            const ch = chunk[i];
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
  async exportJsonlAny(resultId, path, overwrite = false, listKey) {
    const id = requiredString(resultId, "resultId");
    const target = requiredString(path, "path");
    const dataPath = this.payload(id, "data.json");
    try {
      await stat(this.path(id));
      await stat(dataPath);
    } catch (error) {
      if (error.code === "ENOENT")
        throw new HcmError("RESULT_NOT_FOUND", `Сохранённый результат ${id} не найден.`);
      throw error;
    }
    await mkdir(dirname(resolve(target)), { recursive: true });
    const resolvedList = listKey ?? await this.listName(id);
    const allowSingleObject = resolvedList === "Task";
    try {
      const count = { items: 0 };
      const bytes2 = await saveLocalFile(
        target,
        overwrite,
        (file) => writeFile(
          file,
          jsonLines(
            createReadStream(dataPath, { encoding: "utf8", highWaterMark: 64 * 1024 }),
            count,
            resolvedList,
            allowSingleObject
          ),
          "utf8"
        )
      );
      return { bytes: bytes2 };
    } catch (error) {
      if (!(error instanceof HcmError) || error.code !== "INVALID_RESULT_FORMAT") throw error;
    }
    if (allowSingleObject) {
      const bytes2 = await saveLocalFile(target, overwrite, async () => {
      });
      return { bytes: bytes2 };
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
  async *openJsonStream(resultId) {
    const id = requiredString(resultId, "resultId");
    const dataPath = this.payload(id, "data.json");
    try {
      await stat(this.path(id));
      await stat(dataPath);
    } catch (error) {
      if (error.code === "ENOENT")
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
  async *openListItems(resultId, listKey) {
    const id = requiredString(resultId, "resultId");
    const dataPath = this.payload(id, "data.json");
    try {
      await stat(this.path(id));
      await stat(dataPath);
    } catch (error) {
      if (error.code === "ENOENT")
        throw new HcmError("RESULT_NOT_FOUND", `Сохранённый результат ${id} не найден.`);
      throw error;
    }
    const resolvedList = listKey ?? await this.listName(id);
    const allowSingleObject = resolvedList === "Task";
    const count = { items: 0 };
    const MAX_ITEM_CHARS = 8 * 1024 * 1024;
    let buffer = "";
    const stream = createReadStream(dataPath, { encoding: "utf8", highWaterMark: 64 * 1024 });
    try {
      for await (const chunk of jsonLines(stream, count, resolvedList, allowSingleObject)) {
        let start = 0;
        for (; ; ) {
          const nl = chunk.indexOf("\n", start);
          if (nl < 0) {
            buffer += chunk.slice(start);
            if (buffer.length > MAX_ITEM_CHARS) {
              throw new HcmError(
                "RESULT_TOO_LARGE_FOR_FORMAT",
                "Отдельный элемент результата превышает 8 МиБ и не форматируется в таблице/CSV.",
                `Сохранить потоково: wtctl result export ${id} --to ФАЙЛ --format jsonl (или json).`
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
      if (allowSingleObject && error instanceof HcmError && error.code === "INVALID_RESULT_FORMAT") {
        return;
      }
      throw error;
    } finally {
      stream.destroy();
    }
  }
  /** Читает сохранённые данные результата целиком (до 8 МиБ), для табличного форматирования CLI в --output. */
  async loadData(resultId) {
    const id = requiredString(resultId, "resultId");
    const info = await stat(this.payload(id, "data.json")).catch((error) => {
      if (error.code === "ENOENT")
        throw new HcmError("RESULT_NOT_FOUND", `Сохранённый результат ${id} не найден.`);
      throw error;
    });
    const MAX_LOAD_BYTES = 8 * 1024 * 1024;
    if (info.size > MAX_LOAD_BYTES) {
      throw new HcmError(
        "RESULT_TOO_LARGE_FOR_FORMAT",
        "Сохранённый результат больше 8 МиБ и не форматируется в памяти целиком.",
        `Сохранить потоково: wtctl result export ${id} --to ФАЙЛ --format jsonl (или json/text).`
      );
    }
    const chunks = [];
    for (let offset = 0; offset !== void 0; ) {
      const page = await this.read(id, offset, 65536, "json");
      chunks.push(String(page.text));
      offset = page.nextOffset;
    }
    return JSON.parse(chunks.join(""));
  }
  async listName(id) {
    try {
      const manifest = this.path(id);
      if ((await stat(manifest)).size > MAX_METADATA_BYTES) return void 0;
      const list = JSON.parse(await readFile(manifest, "utf8")).list;
      return typeof list === "string" ? list : void 0;
    } catch {
      return void 0;
    }
  }
  /**
   * Открывает потоковую запись результата-списка по элементам (O(1) памяти):
   * файлы data.json, data.idx и rows.idx пишутся сразу на диск.
   * @internal
   */
  async openListSaver(listKey = "items") {
    const id = randomUUID();
    const created = [];
    const files = [];
    const create = async (path) => {
      const file = await open(`${path}.tmp`, "wx", 384);
      files.push(file);
      created.push(`${path}.tmp`);
      return file;
    };
    const cleanup = async () => {
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
      let pendingIndex = [];
      let rawItemStartBytes = -1;
      let finished = false;
      const store = this;
      const recordRow = async (startBytes, lengthBytes) => {
        pendingIndex.push(record(startBytes, lengthBytes));
        if (pendingIndex.length >= 4096) {
          await writeAll(rowsHandle, Buffer.concat(pendingIndex));
          pendingIndex = [];
        }
        rowCount++;
      };
      return {
        async writeItem(item) {
          if (finished) return;
          if (rowCount > 0) await writer.append(",");
          const startBytes = writer.bytes;
          const serialised = JSON.stringify(item) ?? "null";
          await writer.append(serialised);
          await recordRow(startBytes, Buffer.byteLength(serialised));
        },
        async beginRawItem() {
          if (finished) return;
          if (rowCount > 0) await writer.append(",");
          rawItemStartBytes = writer.bytes;
        },
        async writeRawChunk(chunk) {
          if (finished || !chunk) return;
          await writer.append(chunk);
        },
        async endRawItem() {
          if (finished || rawItemStartBytes < 0) return;
          const startBytes = rawItemStartBytes;
          rawItemStartBytes = -1;
          await recordRow(startBytes, writer.bytes - startBytes);
        },
        async commit(extra) {
          if (finished) throw new Error("Запись результата уже завершена");
          finished = true;
          try {
            if (pendingIndex.length > 0) {
              await writeAll(rowsHandle, Buffer.concat(pendingIndex));
              pendingIndex = [];
            }
            await writer.append("]");
            if (extra) {
              const rest = JSON.stringify({ ...extra, [listKey]: void 0 });
              if (rest && rest !== "{}") await writer.append(`,${rest.slice(1)}`);
              else await writer.append("}");
            } else {
              await writer.append("}");
            }
            await writer.flush();
            const metadata = {
              version: 2,
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              kind: "json",
              jsonBytes: writer.bytes,
              jsonChars: writer.chars,
              checkpoints: writer.checkpoints,
              rows: rowCount,
              list: listKey
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
              "Проверить права на папку runtimeDir и свободное место на диске."
            );
          }
        },
        async abort() {
          if (finished) return;
          finished = true;
          await cleanup();
        }
      };
    } catch (error) {
      await cleanup();
      if (error instanceof HcmError) throw error;
      throw new HcmError(
        "RESULT_WRITE_FAILED",
        "Не удалось сохранить результат на этом компьютере.",
        "Проверить права на папку runtimeDir и свободное место на диске."
      );
    }
  }
  /**
   * Сохраняет результат и чистит папку подключения; сбой чистки ответа не меняет. list — поле,
   * которое операция называет своим списком; без него список угадывается по ответу.
   */
  async put(data, list) {
    const saved = await this.write(data, list);
    await this.maybePrune(saved.bytes);
    return saved;
  }
  async maybePrune(savedBytes) {
    const maxAge = (this.config.resultsMaxAgeDays ?? LOCAL_LIMITS.resultsMaxAgeDays) * DAY;
    const maxBytes = this.config.resultsMaxBytes ?? LOCAL_LIMITS.resultsMaxBytes;
    if (!maxAge && !maxBytes) return;
    this.bytesSincePrune += savedBytes;
    const byteThreshold = maxBytes > 0 ? Math.min(Math.floor(maxBytes / 4), _ResultStore.PRUNE_MAX_ACCUMULATED_BYTES) : _ResultStore.PRUNE_MAX_ACCUMULATED_BYTES;
    const now = this.now();
    const due = this.lastPrunedAt === void 0 || now - this.lastPrunedAt >= _ResultStore.PRUNE_INTERVAL_MS || this.bytesSincePrune >= byteThreshold;
    if (due && !this.pruning) {
      this.lastPrunedAt = now;
      this.bytesSincePrune = 0;
      this.pruning = this.prune().catch(() => {
      }).finally(() => {
        this.pruning = void 0;
      });
      await this.pruning;
    }
  }
  /**
   * Удаляет результаты старше resultsMaxAgeDays, затем самые старые сверх resultsMaxBytes.
   * Результаты моложе часа остаются: их может читать другой процесс того же подключения.
   */
  async prune() {
    const maxAge = (this.config.resultsMaxAgeDays ?? LOCAL_LIMITS.resultsMaxAgeDays) * DAY;
    const maxBytes = this.config.resultsMaxBytes ?? LOCAL_LIMITS.resultsMaxBytes;
    if (!maxAge && !maxBytes) return;
    const found = /* @__PURE__ */ new Map();
    const names = await readdir(this.directory);
    let next = 0;
    const workers = Math.min(32, names.length);
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (next < names.length) {
          const name = names[next++];
          const [, id, extension] = RESULT_FILE.exec(name) ?? [];
          if (id === void 0) continue;
          const info = await stat(join(this.directory, name)).catch(() => void 0);
          if (!info) continue;
          const result = found.get(id) ?? { payloads: [], bytes: 0 };
          found.set(id, result);
          result.bytes += info.size;
          if (extension === "json") result.time = info.mtimeMs;
          else result.payloads.push(name);
        }
      })
    );
    const results = [...found].flatMap(([id, { time, ...files }]) => time === void 0 ? [] : [{ id, time, ...files }]).sort((left, right) => left.time - right.time);
    let total = results.reduce((sum, result) => sum + result.bytes, 0);
    const now = this.now();
    for (const { id, time, payloads, bytes } of results) {
      const age = now - time;
      if (age < HOUR || (!maxAge || age <= maxAge) && (!maxBytes || total <= maxBytes)) break;
      total -= bytes;
      try {
        for (const name of [...payloads, `${id}.json`])
          await unlink(join(this.directory, name)).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
      } catch {
      }
    }
  }
  async write(data, named) {
    const id = randomUUID();
    const created = [];
    const files = [];
    const create = async (path) => {
      const file = await open(`${path}.tmp`, "wx", 384);
      files.push(file);
      created.push(`${path}.tmp`);
      return file;
    };
    try {
      await mkdir(this.directory, { recursive: true });
      const body = await create(this.payload(id, "data.json"));
      const index = await create(this.payload(id, "data.idx"));
      const writer = new JsonWriter(body, index);
      const metadata = {
        version: 2,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        kind: Array.isArray(data) ? "array" : typeof data === "string" ? "string" : "json",
        jsonBytes: 0,
        jsonChars: 0,
        checkpoints: 0
      };
      const list = listOf(data, named, Math.floor(this.config.outputLimitBytes / 2) - 128);
      const elements = Array.isArray(data) ? data : list?.items;
      if (elements) {
        const rows = await create(this.payload(id, "rows.idx"));
        metadata.rows = elements.length;
        if (list) metadata.list = list.key;
        await writer.append(list ? `{${JSON.stringify(list.key)}:[` : "[");
        let pendingIndex = [];
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
          const rest = JSON.stringify({ ...data, [list.key]: void 0 });
          await writer.append(rest === "{}" ? "}" : `,${rest.slice(1)}`);
        }
      } else {
        if (data === void 0 || typeof data === "function" || typeof data === "symbol")
          throw new HcmError("RESULT_SERIALIZATION", "Результат — не значение JSON.");
        await appendJson(writer, data);
      }
      await writer.flush();
      Object.assign(metadata, {
        jsonBytes: writer.bytes,
        jsonChars: writer.chars,
        checkpoints: writer.checkpoints
      });
      const text2 = textOf(data);
      if (text2 !== void 0) {
        const plain = await create(this.payload(id, "text.bin"));
        metadata.textChars = text2.length;
        for (let offset = 0; offset < text2.length; offset += CHUNK_CHARS)
          await writeAll(plain, Buffer.from(text2.slice(offset, offset + CHUNK_CHARS), "utf16le"));
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
      return { resultId: id, bytes: writer.bytes, ...list ? { list: list.key } : {} };
    } catch (error) {
      await Promise.allSettled(files.map((file) => file.close()));
      await Promise.allSettled(created.map((path) => unlink(path)));
      if (error instanceof HcmError) throw error;
      if (error instanceof TypeError)
        throw new HcmError("RESULT_SERIALIZATION", "Результат нельзя записать как JSON.");
      throw new HcmError(
        "RESULT_WRITE_FAILED",
        "Не удалось сохранить результат на этом компьютере.",
        "Проверить права на папку runtimeDir и свободное место на диске."
      );
    }
  }
  async read(id, offsetValue, limitValue, formatValue) {
    const manifest = this.path(id);
    if (formatValue !== void 0 && !["auto", "json", "text"].includes(formatValue))
      throw new HcmError("INVALID_RESULT_FORMAT", "format: нужно auto, json или text.");
    let size;
    try {
      size = (await stat(manifest)).size;
    } catch {
      throw notFound();
    }
    if (size > MAX_METADATA_BYTES)
      return this.legacy(manifest, size, offsetValue, limitValue, formatValue);
    let envelope;
    try {
      envelope = JSON.parse(await readFile(manifest, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") throw notFound();
      throw invalid();
    }
    if (envelope !== null && typeof envelope === "object" && "version" in envelope && envelope.version === 1)
      return this.legacy(manifest, size, offsetValue, limitValue, formatValue);
    const metadata = this.metadata(envelope);
    const arrayPage = (metadata.kind === "array" || metadata.list !== void 0) && formatValue !== "json";
    const offset = boundedInteger(offsetValue, 0, Number.MAX_SAFE_INTEGER, "offset");
    const asked = boundedInteger(limitValue, arrayPage ? 100 : 12e3, 65536, "limit");
    if (!asked) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    const limit = arrayPage ? Math.min(asked, 1e3) : asked;
    try {
      await this.assertSize(this.payload(id, "data.json"), metadata.jsonBytes);
      await this.assertSize(this.payload(id, "data.idx"), metadata.checkpoints * RECORD_BYTES);
      if (arrayPage && formatValue !== "text") return await this.array(id, metadata, offset, limit);
      if (formatValue === "text" && metadata.textChars === void 0) throw exportFormatError();
      const plain = metadata.textChars !== void 0 && formatValue !== "json";
      const total = plain ? metadata.textChars : metadata.jsonChars;
      const text2 = plain ? await this.plain(id, metadata, offset, limit) : await this.json(id, metadata, offset, limit);
      return this.textPage(text2, offset, total, limit, plain ? "text" : "json");
    } catch (error) {
      if (error instanceof HcmError) throw error;
      if (error.code === "ENOENT") throw notFound();
      throw invalid();
    }
  }
  metadata(value) {
    if (value === null || typeof value !== "object") throw invalid();
    const source = value;
    if (source.version !== 2 || !["array", "string", "json"].includes(String(source.kind)) || typeof source.createdAt !== "string" || !natural(source.jsonBytes) || source.jsonBytes < 1 || !natural(source.jsonChars) || source.jsonChars < 1 || !natural(source.checkpoints) || source.checkpoints < 1 || source.checkpoints > source.jsonChars || source.checkpoints * RECORD_BYTES > Number.MAX_SAFE_INTEGER || source.checkpoints < Math.ceil(source.jsonChars / CHUNK_CHARS) || source.checkpoints > Math.ceil(source.jsonChars / (CHUNK_CHARS - 1)) || source.kind === "array" && (!natural(source.rows) || source.rows * RECORD_BYTES > Number.MAX_SAFE_INTEGER) || source.list !== void 0 && (typeof source.list !== "string" || source.kind !== "json" || !natural(source.rows) || source.rows * RECORD_BYTES > Number.MAX_SAFE_INTEGER) || source.kind === "string" && source.textChars === void 0 || source.kind === "array" && source.textChars !== void 0 || source.textChars !== void 0 && (!natural(source.textChars) || source.textChars * 2 > Number.MAX_SAFE_INTEGER))
      throw invalid();
    return source;
  }
  async assertSize(path, expected) {
    if ((await stat(path)).size !== expected) throw invalid();
  }
  async array(id, metadata, offset, limit) {
    const count = metadata.rows;
    await this.assertSize(this.payload(id, "rows.idx"), count * RECORD_BYTES);
    if (offset >= count)
      return {
        items: [],
        total: count,
        ...metadata.list === void 0 ? {} : { list: metadata.list }
      };
    return reading(
      [this.payload(id, "rows.idx"), this.payload(id, "data.json")],
      async ([index, body]) => {
        const selected = await readExactly(
          index,
          offset * RECORD_BYTES,
          Math.min(limit, count - offset) * RECORD_BYTES
        );
        const items = [];
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
                ...metadata.list === void 0 ? {} : { list: metadata.list }
              };
            break;
          }
          items.push(
            JSON.parse(
              new TextDecoder("utf8", { fatal: true }).decode(
                await readExactly(body, start, bytes)
              )
            )
          );
          used += bytes + 1;
        }
        return {
          items,
          total: count,
          ...offset + items.length < count ? { nextOffset: offset + items.length } : {},
          ...items.length < Math.min(limit, count - offset) ? { cutBySize: true } : {},
          ...metadata.list === void 0 ? {} : { list: metadata.list }
        };
      }
    );
  }
  async plain(id, metadata, offset, limit) {
    await this.assertSize(this.payload(id, "text.bin"), metadata.textChars * 2);
    if (offset >= metadata.textChars) return "";
    const file = await open(this.payload(id, "text.bin"), "r");
    try {
      const start = Math.max(0, offset - 1);
      const text2 = (await readExactly(file, start * 2, Math.min(limit + 3, metadata.textChars - start) * 2)).toString("utf16le");
      if (offset && splitsPair(text2, 1))
        throw new HcmError(
          "INVALID_OFFSET",
          "offset попадает в середину символа Unicode: нужно брать nextOffset из прошлого ответа."
        );
      return text2.slice(offset - start);
    } finally {
      await file.close();
    }
  }
  async json(id, metadata, offset, limit) {
    if (offset >= metadata.jsonChars) return "";
    return reading(
      [this.payload(id, "data.idx"), this.payload(id, "data.json")],
      async ([index, body]) => {
        const first = numbers(await readExactly(index, 0, RECORD_BYTES));
        if (first[0] !== 0 || first[1] !== 0) throw invalid();
        let left = 0;
        let right = metadata.checkpoints - 1;
        let selected = [0, 0];
        const target = Math.max(0, offset - 1);
        while (left <= right) {
          const middle = Math.floor((left + right) / 2);
          const checkpoint = numbers(
            await readExactly(index, middle * RECORD_BYTES, RECORD_BYTES)
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
          await readExactly(body, byteOffset, amount),
          { stream: byteOffset + amount < metadata.jsonBytes }
        );
        const relative = offset - start;
        if (decoded.length < Math.min(metadata.jsonChars - start, relative + limit + 1))
          throw invalid();
        if (byteOffset + amount === metadata.jsonBytes && decoded.length !== metadata.jsonChars - start)
          throw invalid();
        if (splitsPair(decoded, relative))
          throw new HcmError(
            "INVALID_OFFSET",
            "offset попадает в середину символа Unicode: нужно брать nextOffset из прошлого ответа."
          );
        return decoded.slice(relative, relative + limit + 1);
      }
    );
  }
  textPage(source, offset, total, limit, format) {
    if (!source.length && offset < total) throw invalid();
    let lower = 0;
    let upper = Math.min(limit, source.length);
    while (lower < upper) {
      const middle = Math.ceil((lower + upper) / 2);
      if (Buffer.byteLength(JSON.stringify(source.slice(0, middle))) <= this.config.outputLimitBytes / 2)
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
        "В ответ не помещается даже один символ: предел размера ответа слишком мал."
      );
    return {
      text: source.slice(0, end),
      format,
      totalChars: total,
      ...offset + end < total ? { nextOffset: offset + end } : {},
      ...end < Math.min(limit, source.length) ? { cutBySize: true } : {}
    };
  }
  /** Артефакты версии 1 читает прежний ограниченный читатель; новые ссылки — индексированная v2. */
  async legacy(path, bytes, offsetValue, limitValue, format) {
    if (bytes > this.config.maxResponseBytes * 2)
      throw new HcmError(
        "LEGACY_RESULT_TOO_LARGE",
        "Результат сохранён прежней версией клиента и слишком велик, чтобы его прочитать.",
        "Новые результаты хранятся иначе и читаются по частям; этот файл нужно открыть напрямую в папке runtimeDir."
      );
    let data;
    try {
      const envelope = JSON.parse(await readFile(path, "utf8"));
      if (envelope === null || typeof envelope !== "object" || !("version" in envelope) || envelope.version !== 1 || !("data" in envelope))
        throw invalid();
      data = envelope.data;
    } catch {
      throw invalid();
    }
    const array = Array.isArray(data) && format !== "json";
    const offset = boundedInteger(offsetValue, 0, Number.MAX_SAFE_INTEGER, "offset");
    const limit = boundedInteger(limitValue, array ? 100 : 12e3, array ? 1e3 : 65536, "limit");
    if (!limit) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    if (array) {
      const rows = data;
      const items = [];
      let used = 128;
      for (const item of rows.slice(offset, offset + limit)) {
        const size = Buffer.byteLength(JSON.stringify(item));
        if (used + size > this.config.outputLimitBytes / 2) {
          if (!items.length)
            return {
              items,
              total: rows.length,
              blockedItem: { index: offset, bytes: size },
              hint: "Элемент blockedItem не помещается в ответ и не пропущен. Читать результат с format:json."
            };
          break;
        }
        items.push(item);
        used += size + 1;
      }
      return {
        items,
        total: rows.length,
        ...offset + items.length < rows.length ? { nextOffset: offset + items.length } : {}
      };
    }
    const text2 = typeof data === "string" && format !== "json" ? data : JSON.stringify(data);
    if (splitsPair(text2, offset))
      throw new HcmError(
        "INVALID_OFFSET",
        "offset попадает в середину символа Unicode: нужно брать nextOffset из прошлого ответа."
      );
    return this.textPage(
      text2.slice(offset, offset + limit + 1),
      offset,
      text2.length,
      limit,
      typeof data === "string" && format !== "json" ? "text" : "json"
    );
  }
};

// src/logs.ts
import { createHash as createHash2 } from "node:crypto";
var LogReadUnavailableError = class extends HcmError {
  constructor() {
    super(
      "LOG_READ_UNAVAILABLE",
      "Сервер не отдал текст лога и со второй попытки. Несколько секунд после каждой записанной строки он держит файл лога занятым.",
      "Повторить через несколько секунд. На нагруженном сервере лог за сегодня может не читаться вовсе; логи за прошлые даты читаются в любое время."
    );
  }
};
var LEVELS = ["normal", "debug", "info", "warning", "error", "critical"];
var hash = (text2) => createHash2("sha256").update(text2).digest("hex");
function text(value, label, optional = false) {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && "#text" in value && typeof value["#text"] === "string")
    return value["#text"];
  if (optional && value === void 0) return "";
  throw new HcmError("LOG_REPORT_INVALID", `Отчёт сервера о логах: не читается ${label}.`);
}
function date(value, label) {
  if (value === void 0) return void 0;
  const source = requiredString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source) || Number.isNaN(Date.parse(`${source}T00:00:00Z`)) || (/* @__PURE__ */ new Date(`${source}T00:00:00Z`)).toISOString().slice(0, 10) !== source)
    throw new HcmError("INVALID_LOG_DATE", `${label}: нужна дата в виде ГГГГ-ММ-ДД.`);
  return source;
}
function filename(value) {
  const source = requiredString(value, "file");
  if (source.length > 255 || /[\\/\u0000-\u001F\u007F]/.test(source) || !/\.log$/i.test(source) || source === "." || source === "..")
    throw new HcmError(
      "INVALID_LOG_FILE",
      "Нужно имя файла .log или его адрес из logs.list; путь с папками не принимается."
    );
  return source;
}
function logKind(name) {
  return name.replace(/\.log$/i, "").replace(/[_-]?\d{4}-\d{2}-\d{2}.*$/, "") || name;
}
function decodeFollowCursor(token, expectedFile) {
  try {
    if (token.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const raw = inputObject(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
    if (raw.version !== 1 || typeof raw.file !== "string" || typeof raw.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(raw.fingerprint) || typeof raw.sizeBytes !== "string" || !/^\d+$/.test(raw.sizeBytes) || raw.sizeBytes.length > 20 || !Array.isArray(raw.anchors) || raw.anchors.length > 8 || raw.anchors.some((anchor) => typeof anchor !== "string" || !/^[0-9a-f]{16}$/.test(anchor)))
      throw new Error();
    const cursor = raw;
    if (selectedName(cursor.file) !== selectedName(expectedFile)) throw new Error();
    return cursor;
  } catch {
    throw new HcmError("INVALID_LOG_CURSOR", "cursor неверен или получен для другого файла лога.");
  }
}
function diffEventsAfterCursor(previous, fileName, fingerprintFull, sizeBytes, events) {
  const hashes = events.map((event) => hash(event.text.replace(/\n+$/, "")).slice(0, 16));
  const fingerprint = fingerprintFull.slice(0, 16);
  const size = String(sizeBytes);
  let start = 0;
  let resetReason;
  const changed = !previous || previous.fingerprint !== fingerprint || previous.sizeBytes !== size;
  if (previous) {
    if (BigInt(size) < BigInt(previous.sizeBytes)) resetReason = "file-size-decreased";
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
  const encodedCursor = buildLogFollowCursorWithAnchors(
    fileName,
    fingerprintFull,
    size,
    hashes.slice(-8)
  );
  return {
    events: events.slice(start),
    cursor: encodedCursor,
    changed,
    gapPossible: !!resetReason,
    ...resetReason === void 0 ? {} : { resetReason }
  };
}
function sliceEventsAfterCursorToken(cursorToken, fileName, fingerprintFull, sizeBytes, events) {
  if (!canBuildFollowCursor(fileName, fingerprintFull, sizeBytes)) return void 0;
  try {
    const previous = decodeFollowCursor(cursorToken, fileName);
    return diffEventsAfterCursor(previous, fileName, fingerprintFull, sizeBytes, events);
  } catch {
    return void 0;
  }
}
function canBuildFollowCursor(fileName, fingerprint, sizeBytes) {
  const shortFp = fingerprint.slice(0, 16).toLowerCase();
  const size = String(sizeBytes);
  if (!/^[0-9a-f]{16}$/.test(shortFp) || !/^\d+$/.test(size) || size.length > 20) return void 0;
  try {
    return { canonical: canonicalUrl(selectedName(fileName)), shortFp, size };
  } catch {
    return void 0;
  }
}
function buildLogFollowCursorWithAnchors(fileName, fingerprint, sizeBytes, anchors) {
  const meta = canBuildFollowCursor(fileName, fingerprint, sizeBytes);
  if (!meta) return void 0;
  const cursor = {
    version: 1,
    file: meta.canonical,
    fingerprint: meta.shortFp,
    sizeBytes: meta.size,
    anchors: [...anchors]
  };
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
function buildLogFollowCursor(fileName, fingerprint, sizeBytes, events) {
  const anchors = events.slice(-8).map((event) => hash(event.text.replace(/\n+$/, "")).slice(0, 16));
  return buildLogFollowCursorWithAnchors(fileName, fingerprint, sizeBytes, anchors);
}
function canonicalUrl(name) {
  return `x-local://Logs/${encodeURIComponent(name)}`;
}
function selectedName(value) {
  const source = requiredString(value, "file");
  if (!source.includes("://")) return filename(source);
  let url;
  let name;
  try {
    url = new URL(source);
    name = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new HcmError("INVALID_LOG_FILE", "Адрес лога записан неверно.");
  }
  if (url.protocol !== "x-local:" || url.hostname.toLowerCase() !== "logs" || url.username || url.password || url.port || url.search || url.hash)
    throw new HcmError(
      "INVALID_LOG_FILE",
      "Читаются только логи из папки Logs сервера: адрес вида x-local://Logs/имя.log."
    );
  return filename(name);
}
function parseLogReport(source) {
  const parsed = parseXml(source);
  if (Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, "data"))
    throw new HcmError("LOG_REPORT_INVALID", "Сервер вернул отчёт о логах в неожиданном виде.");
  const data = parsed.data;
  if (data === "") return [];
  const container = inputObject(data, "отчёт о логах").rs;
  if (container === void 0 || container === "") return [];
  const raw = inputObject(container, "строки отчёта о логах").r;
  const rows = raw === void 0 ? [] : Array.isArray(raw) ? raw : [raw];
  if (rows.length > 1e4)
    throw new HcmError("LOG_REPORT_TOO_LARGE", "В отчёте сервера о логах больше 10000 строк.");
  const names = /* @__PURE__ */ new Set();
  return rows.map((value) => {
    const rawCells = inputObject(
      inputObject(value, "строка отчёта о логах").cs,
      "ячейки строки отчёта о логах"
    ).c;
    if (!Array.isArray(rawCells) || rawCells.length < 7)
      throw new HcmError(
        "LOG_REPORT_INVALID",
        "В строке отчёта сервера о логах меньше семи ячеек."
      );
    const cells = rawCells.map(
      (cell) => cell === "" ? {} : inputObject(cell, "ячейка отчёта о логах")
    );
    const name = filename(text(cells[2].t, "имя файла"));
    const reportedUrl = text(cells[6].t, "адрес файла");
    if (selectedName(reportedUrl) !== name)
      throw new HcmError(
        "LOG_REPORT_INVALID",
        "В отчёте сервера о логах адрес файла не совпадает с его именем."
      );
    if (names.has(name))
      throw new HcmError("LOG_REPORT_INVALID", "В отчёте сервера о логах имя файла повторяется.");
    names.add(name);
    const sizeBytes = text(cells[3].r ?? cells[3].t, "размер файла");
    if (!/^\d{1,20}$/.test(sizeBytes) || BigInt(sizeBytes) > 0xffffffffffffffffn)
      throw new HcmError(
        "LOG_REPORT_INVALID",
        "В отчёте сервера о логах размер файла — не целое неотрицательное число."
      );
    const dateLabel = text(cells[1].t, "дата", true);
    const dateFromName = /(?:^|[_-])(\d{4}-\d{2}-\d{2})(?:\D|$)/.exec(name)?.[1];
    const labelMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateLabel);
    const dateHint = dateFromName ?? (labelMatch ? `${labelMatch[3]}-${labelMatch[2]}-${labelMatch[1]}` : void 0);
    const rawDateSeconds = text(cells[1].r, "дата в секундах", true);
    return {
      name,
      url: canonicalUrl(name),
      title: text(cells[0].t, "заголовок", true),
      type: logKind(name),
      sizeBytes,
      dateLabel,
      ...dateHint === void 0 ? {} : { dateHint },
      ...rawDateSeconds === "" ? {} : { rawDateSeconds },
      redFlag: text(cells[5].t, "признак redFlag", true) === "true"
    };
  });
}
var ERROR_WORDS = /\b(?:error|exception|failed|denied|invalid)\b|not defined|not found|not allowed|unknown object property|unknown method|unregistered|wrong number of arguments|already declared|(?:^|\s)major:|ошибк|не найден|не удалось|исключени|недопустим|отказано|запрещ[её]н|уже открыт|невозможно/i;
function severity(message) {
  if (/\b(?:critical|fatal)\b|критическ/i.test(message)) return "critical";
  if (ERROR_WORDS.test(message)) return "error";
  if (/\b(?:warning|warn)\b|предупрежд/i.test(message)) return "warning";
  if (/\b(?:debug|trace)\b/i.test(message)) return "debug";
  if (/\b(?:info|information|inform)\b/i.test(message)) return "info";
  return "normal";
}
function parseLogEvents(source, dateHint, partialBeginning = false) {
  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events = [];
  for (const [index, line] of lines.entries()) {
    const match = /^\s{0,3}((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:[.,]\d+)?)(?:\s+(.*)|$)/.exec(line);
    if (match || !events.length && line !== "") {
      let message = match?.[2] ?? line;
      const context = /^\[([^\]]+)\]\s*/.exec(message);
      if (context) message = message.slice(context[0].length);
      events.push({
        sequence: events.length + 1,
        ...match?.[1] === void 0 ? {} : { time: match[1] },
        ...dateHint === void 0 ? {} : { dateHint },
        ...context?.[1] === void 0 ? {} : { context: context[1] },
        message,
        lines: [line],
        lineStart: index + 1,
        lineEnd: index + 1,
        ...!events.length && partialBeginning ? { partialBeginning: true } : {}
      });
    } else if (events.length) {
      const last = events.at(-1);
      last.lines.push(line);
      last.lineEnd = index + 1;
    }
  }
  return events.map(({ lines: lines2, ...event }) => ({
    ...event,
    level: severity([event.message, ...lines2.slice(1)].join("\n")),
    text: lines2.join("\n")
  }));
}
function rpcString(value) {
  const result = inputObject(value, "ответ функции сервера");
  if (result.valueType !== "string" || typeof result.lexicalValue !== "string")
    throw new HcmError("LOG_RESPONSE_INVALID", "Функция сервера вернула не строку.");
  return result.lexicalValue;
}
function maxLogTailBytes(maxResponseBytes) {
  return Math.max(1, Math.floor((maxResponseBytes - 512) / 6));
}
var LogReader = class {
  constructor(gateway, options) {
    this.gateway = gateway;
    this.busyMs = options.logBusyMs ?? 5500;
    if (!Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes < 1024)
      throw new HcmError("INVALID_ARGUMENT", "maxResponseBytes: нужно целое число не меньше 1024.");
    this.maxTailBytes = maxLogTailBytes(options.maxResponseBytes);
  }
  maxTailBytes;
  busyMs;
  busyUntil = 0;
  /**
   * Сервер держит файл лога за собой около пяти секунд после записи в него строки
   * (замер на 2025.1.1333 и 2025.2.1535) и всё это время отказывает в чтении. Владелец
   * отмечает запрос, который сервер только что отклонил, потому что в лог пишется именно отказ.
   */
  serverWroteLog() {
    this.busyUntil = Date.now() + this.busyMs;
  }
  async whileBusy() {
    const wait = this.busyUntil - Date.now();
    if (wait > 0) await new Promise((resolve2) => setTimeout(resolve2, wait));
  }
  async allFiles() {
    const params = "<func_params><server_log_report><type_id>all</type_id><show_alert>false</show_alert></server_log_report></func_params>";
    const response = await this.gateway.call("native.rpc.call", {
      target: "tools_report.server_log_report",
      args: [rpcArgument(encodeURIComponent(params))]
    });
    return parseLogReport(rpcString(response));
  }
  async list(input2 = {}) {
    const start = date(input2.startDate, "startDate");
    const end = date(input2.endDate, "endDate");
    if (start && end && start > end)
      throw new HcmError("INVALID_LOG_DATE", "startDate позже endDate.");
    const offset = boundedInteger(input2.offset, 0, Number.MAX_SAFE_INTEGER, "offset");
    const limit = boundedInteger(input2.limit, 30, 1e3, "limit");
    if (!limit) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    const type = input2.type === void 0 ? void 0 : requiredString(input2.type, "type");
    const filter = input2.nameContains === void 0 ? void 0 : requiredString(input2.nameContains, "nameContains").toLowerCase();
    const files = (await this.allFiles()).filter(
      (file) => (!type || file.type === type) && (!filter || file.name.toLowerCase().includes(filter)) && (!start || file.dateHint !== void 0 && file.dateHint >= start) && (!end || file.dateHint !== void 0 && file.dateHint <= end)
    ).sort(
      (left, right) => (right.dateHint ?? "").localeCompare(left.dateHint ?? "") || left.name.localeCompare(right.name)
    );
    return {
      files: files.slice(offset, offset + limit),
      total: files.length,
      ...offset + limit < files.length ? { nextOffset: offset + limit } : {},
      dateSemantics: "server calendar date; timezone unspecified"
    };
  }
  async read(input2) {
    const name = selectedName(input2.file);
    if (input2.full !== void 0 && typeof input2.full !== "boolean")
      throw new HcmError("INVALID_ARGUMENT", "full: нужно true или false.");
    if (input2.full && input2.tailBytes !== void 0)
      throw new HcmError("INVALID_ARGUMENT", "Нужно указать full или tailBytes, но не оба.");
    const tailBytes = boundedInteger(
      input2.tailBytes,
      Math.min(524288, this.maxTailBytes),
      this.maxTailBytes,
      "tailBytes"
    );
    if (!tailBytes) throw new HcmError("INVALID_ARGUMENT", "tailBytes: нужно число больше нуля.");
    const refused = (error) => error instanceof WsHcmApiError && error.kind === "soap-fault" && error.status === 500 && error.operation === "CallMethod" && error.requestSent !== false && !isTransportFailure(error);
    const attempt = async (retry) => {
      const locate = async () => {
        const files2 = await this.allFiles();
        const found = files2.find((item) => item.name === name);
        if (!found)
          throw new HcmError(
            "LOG_NOT_FOUND",
            "Такого файла нет среди логов сервера.",
            "Имена файлов показывает logs.list. Файлы вне списка логов не читаются."
          );
        return { files: files2, file: found };
      };
      let { files, file: file2 } = await locate();
      const isArchived = file2.dateHint !== void 0 && files.some(
        (other) => other.type === file2.type && other.dateHint !== void 0 && other.dateHint > file2.dateHint
      );
      if (!retry && !isArchived && this.busyUntil > Date.now()) {
        await this.whileBusy();
        ({ file: file2 } = await locate());
      }
      const sizeBefore2 = BigInt(file2.sizeBytes);
      if (input2.full && sizeBefore2 > BigInt(this.maxTailBytes))
        throw new HcmError(
          "LOG_TOO_LARGE",
          "Лог целиком не помещается в предел чтения подключения.",
          "Нужно прочитать конец файла (tailBytes) или увеличить maxResponseBytes подключения."
        );
      const effectiveTailBytes2 = Number(
        input2.full || sizeBefore2 < BigInt(tailBytes) ? sizeBefore2 : BigInt(tailBytes)
      );
      try {
        const response2 = await this.gateway.call("native.rpc.call", {
          target: "tools.load_url_data_server",
          args: [rpcArgument(file2.url), rpcArgument(effectiveTailBytes2)]
        });
        return { file: file2, sizeBefore: sizeBefore2, effectiveTailBytes: effectiveTailBytes2, response: response2 };
      } catch (error) {
        if (!refused(error)) throw error;
        return { refusal: error };
      }
    };
    let read = await attempt(false);
    if ("refusal" in read) {
      const first = read.refusal;
      this.serverWroteLog();
      await this.whileBusy();
      read = await attempt(true);
      if ("refusal" in read) {
        const unavailable = new LogReadUnavailableError();
        for (const error of [first, read.refusal])
          if (error.cleanupError !== void 0) attachCleanupError(unavailable, error.cleanupError);
        throw unavailable;
      }
    }
    const { file, sizeBefore, effectiveTailBytes, response } = read;
    const returned = rpcString(response);
    const notice = /^Показано последние (\d+) байт файла\. Для просмотра всего файла его нужно сохранить\.\r?\n/.exec(
      returned
    );
    if (notice && notice[1] !== String(effectiveTailBytes))
      throw new HcmError(
        "LOG_RESPONSE_INVALID",
        "Сервер сообщил не тот размер прочитанного конца файла, который был запрошен."
      );
    const after = (await this.allFiles()).find((item) => item.name === name);
    if (!after || BigInt(after.sizeBytes) < sizeBefore || sizeBefore === 0n && BigInt(after.sizeBytes) !== 0n || input2.full && BigInt(after.sizeBytes) !== sizeBefore || (input2.full || sizeBefore === 0n) && (file.rawDateSeconds !== after.rawDateSeconds || file.dateHint !== after.dateHint || file.dateLabel !== after.dateLabel) || !notice)
      throw new HcmError(
        "LOG_CHANGED",
        "Лог изменился или исчез, пока читался.",
        "Чтение нужно повторить: прочитанный текст отброшен. Список файлов покажет logs.list."
      );
    const body = returned.slice(notice[0].length);
    if (effectiveTailBytes === 0 && body !== "")
      throw new HcmError("LOG_RESPONSE_INVALID", "Сервер вернул текст, хотя файл лога пуст.");
    return {
      file: after,
      text: body,
      requestedMode: input2.full ? "full" : "tail",
      ...input2.full ? {} : { requestedTailBytes: tailBytes },
      effectiveTailBytes,
      sizeBytesBefore: file.sizeBytes,
      sizeBytesAfter: after.sizeBytes,
      serverTailNotice: true,
      truncated: sizeBefore > BigInt(effectiveTailBytes) || BigInt(after.sizeBytes) > BigInt(effectiveTailBytes),
      returnedChars: body.length,
      fingerprint: hash(body)
    };
  }
  async search(input2) {
    if (input2.level !== void 0 && !LEVELS.includes(input2.level))
      throw new HcmError(
        "INVALID_LOG_LEVEL",
        "level: нужно одно из normal, debug, info, warning, error, critical."
      );
    const offset = boundedInteger(input2.offset, 0, Number.MAX_SAFE_INTEGER, "offset");
    const limit = boundedInteger(input2.limit, 100, 1e3, "limit");
    if (!limit) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    const query = input2.text === void 0 ? void 0 : requiredString(input2.text, "text").toLowerCase();
    const context = input2.context === void 0 ? void 0 : requiredString(input2.context, "context").toLowerCase();
    const read = await this.read(input2);
    if (input2.expectedFingerprint !== void 0 && input2.expectedFingerprint !== read.fingerprint)
      throw new HcmError(
        "LOG_CHANGED",
        "Лог изменился между страницами поиска.",
        "Поиск нужно начать с первой страницы и дальше передавать fingerprint из нового ответа."
      );
    const all = parseLogEvents(read.text, read.file.dateHint, read.truncated);
    const events = all.filter(
      (event) => (!input2.level || event.level === input2.level) && (!query || event.text.toLowerCase().includes(query)) && (!context || event.context?.toLowerCase().includes(context))
    );
    if (input2.newestFirst === true) events.reverse();
    return {
      file: read.file,
      events: events.slice(offset, offset + limit),
      totalEvents: all.length,
      matches: events.length,
      fingerprint: read.fingerprint,
      truncated: read.truncated,
      ...offset + limit < events.length ? { nextOffset: offset + limit } : {}
    };
  }
  async follow(input2) {
    const previous = input2.cursor === void 0 ? void 0 : decodeFollowCursor(input2.cursor, input2.file);
    const read = await this.read(input2);
    const events = parseLogEvents(read.text, read.file.dateHint, read.truncated);
    const diff = diffEventsAfterCursor(
      previous,
      read.file.url,
      read.fingerprint,
      read.file.sizeBytes,
      events
    );
    return {
      file: read.file,
      events: diff.events,
      cursor: diff.cursor,
      changed: diff.changed,
      gapPossible: diff.gapPossible,
      windowTruncated: read.truncated,
      ...diff.resetReason === void 0 ? {} : { resetReason: diff.resetReason }
    };
  }
};

// src/rpc-catalog.ts
var RPC_CATALOG_PAGE_MAX_BYTES = 16 * 1024;
function input(id, value) {
  try {
    validate(value, operationDefinition(id).inputSchema);
    return inputObject(value);
  } catch {
    throw new HcmError(
      "INVALID_ARGUMENT",
      "Аргументы поиска функций не подходят.",
      "Аргументы операции описывает api.describe."
    );
  }
}
function unknownTarget(targetId, available, { skipped }) {
  const [library, method] = targetId.split(".");
  const inLibrary = available.filter((item) => item.id.startsWith(`${library}.`));
  const near = inLibrary.map((item) => item.id.slice(library.length + 1)).filter((name) => name.toLowerCase().includes(method.toLowerCase())).slice(0, 5);
  const similar = near.length ? `Похожие: ${near.join(", ")}. ` : "";
  if (skipped?.includes(library))
    return new HcmError(
      "UNKNOWN_RPC_TARGET",
      `Библиотеку ${library} прочитать не удалось, описания функции ${method} нет.`,
      `${similar}rpc.call вызывает функцию и без описания; есть ли она, проверит сервер.`
    );
  return new HcmError(
    "UNKNOWN_RPC_TARGET",
    inLibrary.length ? `В библиотеке ${library} нет функции ${method}.` : `Среди библиотек сервера нет библиотеки ${library} или в ней нет функций.`,
    `${similar}Имена ищет rpc.list: query — часть имени, all:true — вместе с функциями, которые вызываются только из кода на сервере.`
  );
}
var RpcCatalog = class {
  reader;
  constructor(applicationInfo, readFile2, ttlMs, now) {
    if (applicationInfo && readFile2)
      this.reader = new LibraryReader(applicationInfo, readFile2, ttlMs, now);
  }
  /** Сбросить кэш прочитанных библиотек сервера. */
  invalidate() {
    this.reader?.invalidate();
  }
  async catalog(library) {
    const server = await this.reader?.read(library);
    if (!server)
      throw new HcmError(
        "RPC_CATALOG_UNAVAILABLE",
        "Список функций библиотек сервера не получен.",
        "Проверить подключение через runtime.check или повторить позже."
      );
    return {
      targets: server.targets,
      source: "server",
      ...server.skipped.length ? { skipped: server.skipped } : {}
    };
  }
  /** Почему сервер отказал в вызове, если это объясняет его собственный список функций. */
  async refusal(targetId) {
    const server = await this.reader?.read(targetId.split(".")[0], { fresh: true });
    if (!server) return void 0;
    const target = server.targets.find((item) => item.id === targetId);
    if (!target)
      return server.skipped.length || server.excluded.length ? void 0 : unknownTarget(targetId, server.targets, { source: "server" });
    if (target.allowed !== false) return void 0;
    const [library, method] = targetId.split(".");
    return new HcmError(
      "RPC_SERVER_ONLY",
      `Функцию ${targetId} сервер не разрешает вызывать с клиента.`,
      `Вызывать её нужно из кода на сервере: execute.script, например r = ${library}.${method}(…); RESULT = [r + '']; — массив обойти циклом, из объекта взять нужные поля.`
    );
  }
  async list(filter = {}, pageBytes = RPC_CATALOG_PAGE_MAX_BYTES) {
    const args = input("rpc.list", filter);
    const query = filter.query?.trim().toLowerCase();
    const cursor = boundedInteger(args.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor");
    const limit = boundedInteger(args.limit, 30, 100, "limit");
    const { targets: available, ...metadata } = await this.catalog(filter.library);
    const matching = available.filter((target) => {
      const [library, method] = target.id.split(".");
      return (filter.library === void 0 || library === filter.library) && (filter.method === void 0 || method === filter.method) && (!query || [target.id, ...target.parameters].some((value) => value.toLowerCase().includes(query)));
    });
    const filtered = filter.all === true ? matching : matching.filter((target) => target.serverOnly !== true);
    const total = filtered.length;
    const hidden = matching.length - filtered.length;
    const serverOnlyHidden = hidden ? {
      serverOnlyHidden: hidden,
      hint: "serverOnlyHidden — сколько подходящих функций не показано: они вызываются только из кода на сервере. all:true (в CLI --all) добавит их в список."
    } : {};
    const limitBytes = Math.max(256, pageBytes);
    const emptyBytes = Buffer.byteLength(
      JSON.stringify({ ...metadata, targets: [], total, ...serverOnlyHidden }, null, 2),
      "utf8"
    );
    let cardsBytes = 0;
    const selected = [];
    for (const { id, parameters, allowed, serverOnly } of filtered.slice(cursor, cursor + limit)) {
      const target = { id, parameters, allowed, ...serverOnly ? { serverOnly } : {} };
      const card = JSON.stringify(target, null, 2);
      let lines = 1;
      for (let i = 0; i < card.length; i++) if (card.charCodeAt(i) === 10) lines++;
      const itemBytes = Buffer.byteLength(card, "utf8") + 4 * lines;
      const wrapperDelta = selected.length === 0 ? 4 : 2;
      const nextCursor2 = cursor + selected.length + 1;
      const cursorBytes = nextCursor2 < total ? Buffer.byteLength(`,
  "nextCursor": ${nextCursor2}`, "utf8") : 0;
      if (emptyBytes + cardsBytes + wrapperDelta + itemBytes + cursorBytes > limitBytes) {
        if (selected.length === 0)
          throw new HcmError(
            "RPC_METADATA_TOO_LARGE",
            "Описание следующей функции не помещается в страницу.",
            "Эту функцию нужно прочитать отдельно: rpc.describe.",
            { targetId: target.id }
          );
        break;
      }
      selected.push(target);
      cardsBytes += wrapperDelta + itemBytes;
    }
    const nextCursor = cursor + selected.length;
    return freezeRegistry({
      ...metadata,
      targets: selected,
      total,
      ...serverOnlyHidden,
      ...nextCursor < total ? { nextCursor } : {}
    });
  }
  async describe(targetId, options = {}) {
    input("rpc.describe", { ...inputObject(options), targetId });
    const { targets: available, ...metadata } = await this.catalog(targetId.split(".")[0]);
    const target = available.find((item) => item.id === targetId);
    if (!target) throw unknownTarget(targetId, available, metadata);
    const { id, parameters, allowed, serverOnly } = target;
    let code = {};
    if (options.source === true) {
      const bytes = Buffer.from(target.code ?? "", "utf8");
      code = {
        code: new TextDecoder().decode(bytes.subarray(0, 8192), { stream: true }),
        ...bytes.length > 8192 ? { codeTruncated: true } : {}
      };
    }
    return freezeRegistry({
      id,
      parameters,
      allowed,
      ...serverOnly ? {
        serverOnly,
        note: `С клиента функция не вызывается (нет ALLOW-CALL-FROM-CLIENT). Вызывать её нужно из кода на сервере: ${id}(…).`
      } : {},
      ...metadata,
      ...code
    });
  }
};

// src/objects.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { appendFile, mkdir as mkdir2, rename as rename2, stat as stat2 } from "node:fs/promises";
import { join as join2 } from "node:path";

// src/verification.ts
var shown = (value) => value === void 0 ? null : typeof value === "string" ? value.length > 200 ? `${value.slice(0, 200)}…` : value : Array.isArray(value) ? `[список: ${value.length}]` : value !== null && typeof value === "object" ? "{структура}" : value;
function record2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function bool(value) {
  if (value === true || value === "true" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  return void 0;
}
var DATE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:\d{2})?$/;
function serverDate(value) {
  const match = typeof value === "string" ? DATE.exec(value) : null;
  return match ? `${match[1]}T${match[2] ?? "00:00"}:${match[3] ?? "00"}` : void 0;
}
function isServerDate(value) {
  return DATE.test(value);
}
function equivalent(expected, actual, path, fields, prior, inCollection = false, differences = [], normalizeEol = true) {
  const differ = () => {
    if (differences.length < 5)
      differences.push({ path, requested: shown(expected), actual: shown(actual) });
    return false;
  };
  const field = fields.get(path.replace(/\[\d+\]/g, ""));
  const child = (key) => prior?.[key];
  const hasAttrs = record2(prior) && Object.keys(prior).some((key) => key.startsWith("@_"));
  const text2 = record2(prior) && /\S/.test(String(prior["#text"] ?? ""));
  if (!hasAttrs && !text2 && record2(prior) && typeof expected === "string" && expected.trim() === "")
    expected = "";
  if (field?.multiple === true && !inCollection) {
    const left = expected === void 0 || expected === "" ? [] : Array.isArray(expected) ? expected : [expected];
    const right = actual === void 0 || actual === "" ? [] : Array.isArray(actual) ? actual : [actual];
    if (left.length !== right.length) return differ();
    return left.every(
      (item, index) => equivalent(
        item,
        right[index],
        `${path}[${index}]`,
        fields,
        child(index) ?? prior,
        true,
        differences
      )
    );
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return differ();
    return expected.every(
      (item, i) => equivalent(item, actual[i], `${path}[${i}]`, fields, child(i), false, differences)
    );
  }
  if (record2(expected)) {
    const received = !hasAttrs && !text2 && (actual == null || actual === "") ? {} : actual;
    if (!record2(received)) return differ();
    return Object.entries(expected).every(
      ([key, value]) => equivalent(value, received[key], `${path}.${key}`, fields, child(key), false, differences)
    );
  }
  if (expected === void 0 || expected === "" || expected === null)
    return actual === void 0 || actual === "" || actual === null || differ();
  if (actual !== null && typeof actual === "object") return differ();
  if (field?.type === "bool")
    return bool(expected) !== void 0 && bool(expected) === bool(actual) || differ();
  if (field?.type === "integer" && /^(?:-?\d+|0x[0-9a-f]+)$/i.test(String(expected)) && /^(?:-?\d+|0x[0-9a-f]+)$/i.test(String(actual)))
    return BigInt(String(expected)) === BigInt(String(actual)) || differ();
  const date2 = serverDate(expected);
  if (date2 !== void 0 && date2 === serverDate(actual)) return true;
  if (normalizeEol && (field?.type === void 0 || field.type === "" || field.type === "string") && normalizeXmlLineEndings(String(expected)) === normalizeXmlLineEndings(String(actual)))
    return true;
  return String(expected) === String(actual) || differ();
}
function xmlRoot(source) {
  const entry = Object.entries(parseXml(source)).find(
    ([key]) => !key.startsWith("?") && !key.startsWith("#")
  );
  return record2(entry?.[1]) ? entry[1] : {};
}
function verifyFields(expected, actual, descriptors, names = Object.keys(expected), original) {
  const reference = original ? xmlRoot(original) : expected;
  const fields = /* @__PURE__ */ new Map();
  if (Array.isArray(descriptors)) {
    for (const field of descriptors)
      if (record2(field) && typeof field.path === "string") fields.set(field.path, field);
  }
  const differences = [];
  const mismatches = [...new Set(names)].filter(
    (name) => !equivalent(expected[name], actual[name], name, fields, reference[name], false, differences)
  );
  if (mismatches.length)
    throw new HcmError(
      "READ_BACK_MISMATCH",
      "Документ сохранён, но поля из details.fields не приняли запрошенные значения.",
      "Что не совпало — в details.differences. Остальные поля запроса сохранены: заново объект не создавать. Обычная причина: сервер переписывает значение или внутри структуры нет такого поля; поля показывает schema.get.",
      { fields: mismatches, differences }
    );
}
function verifyRemovals(expected, actual, changes, descriptors) {
  const collect = (data, path, allowNormalizedKey) => {
    let nodes = [data];
    let fieldPath = "";
    for (const match of patchSegments(path)) {
      fieldPath += `${fieldPath ? "." : ""}${match[1]}`;
      const next = [];
      for (const node of nodes) {
        const value = record2(node) ? node[match[1]] : void 0;
        if (match[3] !== void 0) {
          const keyPath = `${fieldPath}.${match[3]}`;
          const field = Array.isArray(descriptors) ? descriptors.find((item) => record2(item) && item.path === keyPath) : void 0;
          const items = Array.isArray(value) ? value : value === void 0 ? [] : [value];
          const matchByKey = (normalizeEol) => items.filter(
            (item) => record2(item) && equivalent(
              match[4],
              item[match[3]],
              keyPath,
              /* @__PURE__ */ new Map([[keyPath, field]]),
              void 0,
              false,
              [],
              normalizeEol
            )
          );
          const exact = matchByKey(false);
          const chosen = exact.length > 0 || !allowNormalizedKey ? exact : matchByKey(true);
          next.push(...chosen);
        } else if (match[2] !== void 0) {
          const picked = Array.isArray(value) ? value[Number(match[2])] : Number(match[2]) === 0 ? value : void 0;
          if (picked !== void 0) next.push(picked);
        } else if (value !== void 0) {
          next.push(value);
        }
      }
      nodes = next;
      if (nodes.length === 0) break;
    }
    return nodes;
  };
  const nonEmpty = (values) => values.filter((value) => value !== void 0 && value !== "" && value !== null);
  for (const raw of changes) {
    if (!record2(raw) || raw.op !== "remove" || typeof raw.path !== "string" || patchSegments(raw.path).at(-1)[2] !== void 0)
      continue;
    if (collect(expected, raw.path, false).length > 0) continue;
    const exactActual = nonEmpty(collect(actual, raw.path, false));
    const leftBehind = exactActual.length > 0 || nonEmpty(collect(actual, raw.path, true)).length > nonEmpty(collect(expected, raw.path, true)).length;
    if (leftBehind)
      throw new HcmError(
        "READ_BACK_MISMATCH",
        "Поле, которое нужно было удалить, осталось в документе.",
        "До повтора проверить, не задаёт ли форма этому полю значение по умолчанию.",
        { fields: [raw.path] }
      );
  }
}

// src/objects.ts
function isBinary(value) {
  return !!value && typeof value === "object" && "kind" in value && value.kind === "binary" && "bytes" in value && value.bytes instanceof Uint8Array;
}
function documentText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HcmError("INVALID_XML", "XML документа — не текст UTF-8.");
  }
}
function patchInput(patch, remove, resave = false) {
  if (remove === void 0) {
    if (patch === void 0) {
      if (resave) return [];
      throw new HcmError("INVALID_ARGUMENT", "Нужно указать patch, remove или оба.");
    }
    return patch;
  }
  if (!Array.isArray(remove) || remove.some((path) => typeof path !== "string"))
    throw new HcmError("INVALID_ARGUMENT", "remove: нужен список путей.");
  const set = Array.isArray(patch) ? patch : Object.entries(inputObject(patch ?? {}, "patch")).map(([path, value]) => ({
    op: "set",
    path,
    value
  }));
  return [...set, ...remove.map((path) => ({ op: "remove", path }))];
}
var ServerObjects = class {
  constructor(server, schema, journalFile) {
    this.server = server;
    this.schema = schema;
    this.journalFile = journalFile;
  }
  /** Один объект по id или url, как отвечает objects.get. */
  async get(args) {
    const loaded = await this.load(args);
    const snapshot = loaded.document.snapshot();
    const data = withoutFalseOffset(projectFields(snapshot.data, args.fields));
    const absent = Array.isArray(args.fields) ? args.fields.filter((field) => !Object.hasOwn(data, field)) : [];
    const shape = absent.length || hasStructure(data) ? await this.schema.documentShape(snapshot.type, snapshot.formUrl).catch(() => void 0) : void 0;
    const row = await this.catalogRow(snapshot.type, loaded.url, loaded.id, absent);
    const unknownFields = shape?.fields.size ? absent.filter((field) => !shape.fields.has(field) && !row.known.has(field)) : [];
    const emptyFields = shape?.fields.size ? absent.filter(
      (field) => !unknownFields.includes(field) && !Object.hasOwn(row.values, field)
    ) : [];
    return {
      ...loaded.id === void 0 ? {} : { id: loaded.id },
      type: snapshot.type,
      url: loaded.url,
      data: shape ? withRepeated(data, shape.repeated) : data,
      ...Object.keys(row.values).length ? { fromCatalog: row.values } : {},
      ...emptyFields.length ? { emptyFields } : {},
      ...unknownFields.length ? { unknownFields } : {},
      fingerprint: snapshot.fingerprint,
      ...snapshot.formUrl === void 0 ? {} : { formUrl: snapshot.formUrl }
    };
  }
  async resolveDbName(dbName, info) {
    if (dbName !== void 0) return validateDbName(requiredString(dbName, "dbName"), "dbName");
    const appInfo = info ?? await this.server.applicationInfo().catch(() => void 0);
    return typeof appInfo?.default_db_name === "string" && appInfo.default_db_name ? validateDbName(appInfo.default_db_name, "default_db_name") : "wt_data";
  }
  async load(args) {
    const explicitDb = args.dbName === void 0 ? void 0 : validateDbName(requiredString(args.dbName, "dbName"), "dbName");
    if (args.url !== void 0 && explicitDb !== void 0)
      throw new HcmError(
        "INVALID_ARGUMENT",
        "dbName не задаётся вместе с url: адрес уже называет базу."
      );
    let requested;
    let url;
    if (args.url !== void 0) {
      requested = args.id === void 0 ? void 0 : resolvePhysicalDocumentLocation(requiredString(args.id, "id"));
      url = requiredString(args.url, "url");
    } else {
      const idLexeme = requiredString(args.id, "id");
      resolvePhysicalDocumentLocation(idLexeme);
      const dbName = await this.resolveDbName(explicitDb);
      requested = resolvePhysicalDocumentLocation(idLexeme, dbName);
      url = requested.url;
    }
    const response = await this.server.call("native.lds.loadDoc", {
      url,
      useBinaryResponse: true
    });
    let document;
    try {
      document = XmlDocument.parse(
        isBinary(response) ? documentText(response.bytes) : buildXml(findXmlNode(response, "Data"))
      );
    } catch (error) {
      if (args.url === void 0 || !(error instanceof HcmError)) throw error;
      throw new HcmError(
        error.code,
        error.message,
        "Если по адресу не документ объекта: файл читает files.read, поля формы — schema.get с url."
      );
    }
    const snapshot = document.snapshot();
    const documentId = typeof snapshot.data.id === "string" && snapshot.data.id !== "" ? snapshot.data.id : void 0;
    const id = documentId ?? parsePhysicalDocumentId(url);
    if (requested) {
      if (id === void 0)
        throw new HcmError(
          "TARGET_MISMATCH",
          "В документе нет ID, и адрес его не называет: сверить его с id нечем.",
          "Нужно передать что-то одно: id или url."
        );
      if (BigInt(resolvePhysicalDocumentLocation(id).objectId) !== BigInt(requested.objectId))
        throw new HcmError(
          "TARGET_MISMATCH",
          `${documentId === void 0 ? "Адрес документа" : "Прочитанный документ"} — объекта ${id}, а не того, что в id.`,
          args.url === void 0 ? void 0 : "Нужно передать id и url одного объекта или что-то одно."
        );
    }
    if (args.type !== void 0 && snapshot.type !== identifier(args.type, "type"))
      throw new HcmError(
        "TYPE_MISMATCH",
        `Тип объекта — ${snapshot.type}, а не ${String(args.type)}.`,
        void 0,
        { actualType: snapshot.type }
      );
    return { document, url, id };
  }
  async journal(entry) {
    const { directory, maxBytes } = this.journalFile;
    const path = join2(directory, "mutations.jsonl");
    await mkdir2(directory, { recursive: true });
    if (maxBytes && ((await stat2(path).catch(() => void 0))?.size ?? 0) > maxBytes)
      await rename2(path, join2(directory, "mutations.1.jsonl")).catch(() => {
      });
    await appendFile(path, `${JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ...entry })}
`, {
      encoding: "utf8",
      mode: 384
    });
  }
  async resolveCatalog(type, documentUrl) {
    const info = await this.server.applicationInfo();
    let dbName = typeof info.default_db_name === "string" ? info.default_db_name : void 0;
    const url = documentUrl ? URL.parse(documentUrl) : null;
    if (url?.protocol === "x-local:") dbName = url.hostname;
    const catalogs = serverDatabases(info).find((db) => db.id === dbName)?.catalogs ?? [];
    const named = (value, objectType, id) => value.object_type === objectType && typeof value.id === "string" && (id === void 0 || value.id === id);
    let matches = catalogs.filter((value) => named(value, type));
    if (!matches.length) matches = catalogs.filter((value) => named(value, "", `${type}s`));
    return matches.length === 1 ? identifier(inputObject(matches[0]).id, "catalog") : void 0;
  }
  /**
   * Значения названных полей в строке каталога объекта. В `known` — имена, которые являются
   * полями каталога, есть у строки значение для них или нет.
   */
  async catalogRow(type, url, id, names) {
    const none = { values: {}, known: /* @__PURE__ */ new Set() };
    if (!names.length || id === void 0) return none;
    try {
      const catalog = await this.resolveCatalog(type, url);
      if (!catalog) return none;
      const shape = await this.schema.catalogShape({ catalog });
      const known = new Set(names.filter((name) => shape?.fields.has(name)));
      if (!known.size) return none;
      const response = await this.server.read("native.lds.xQuery", {
        query: `for $elem in ${catalog} where $elem/id = ${resolvePhysicalDocumentLocation(id).objectId} return $elem`,
        maxCount: 1,
        expectToReadAll: false
      });
      const [item] = queryPage(response, 0, 1, [...known], false).items;
      const values = Object.fromEntries(
        Object.entries(withoutFalseOffset(item ?? {})).filter(
          ([name]) => known.has(name)
        )
      );
      return { values, known };
    } catch {
      return none;
    }
  }
  async catalogHasId(catalog, id) {
    const lexicalId = resolvePhysicalDocumentLocation(id).objectId;
    const response = await this.server.read("native.lds.xQuery", {
      query: `for $elem in ${catalog} where $elem/id = ${lexicalId} return $elem`,
      maxCount: 2,
      expectToReadAll: false
    });
    const data = cleanXmlValue(findXmlNode(response, "Data"));
    return data !== null && typeof data === "object" && Object.values(data).some((value) => Array.isArray(value) ? value.length > 0 : value !== "");
  }
  /**
   * Чего сервер не сохранит, отклоняется до записи: поле, которого нет у типа, выпадает из
   * сохранённого документа, как и значение поля, которое сервер вычисляет сам, а дата, которую
   * сервер не может прочитать, сохраняется другим значением. Ответ — поля, которые сервер
   * заполняет при сохранении сам, с полем, из которого их стоит менять, если оно угадывается.
   */
  async requireFields(type, formUrl, entries, givenShape) {
    const filled = /* @__PURE__ */ new Map();
    const shape = givenShape ?? await this.schema.documentShape(type, formUrl).catch(() => void 0);
    if (!shape) return filled;
    const unknownSet = /* @__PURE__ */ new Set();
    const computedSet = /* @__PURE__ */ new Set();
    const wrongDates = /* @__PURE__ */ new Set();
    const topNames = /* @__PURE__ */ new Set();
    const checkPath = (path) => {
      const parts = path.split(".");
      const top = parts[0];
      topNames.add(top);
      if (shape.fields.size && !shape.partial && !shape.fields.has(top)) {
        unknownSet.add(top);
        return false;
      }
      if (shape.computed?.has(top)) computedSet.add(top);
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join(".");
        const current = `${parent}.${parts[i]}`;
        if (shape.parents?.has(parent) && !shape.partial && !shape.types.has(current)) {
          unknownSet.add(current);
          return false;
        }
        if (shape.computed?.has(current)) computedSet.add(current);
      }
      return true;
    };
    const checkValue = (path, value) => {
      if (!checkPath(path)) return;
      if (Array.isArray(value)) {
        for (const item of value) checkValue(path, item);
        return;
      }
      if (shape.types.get(path) === "date") {
        if (value !== null && value !== void 0 && value !== "" && (typeof value !== "string" || !isServerDate(value)))
          wrongDates.add(path);
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [childKey, childValue] of Object.entries(value))
          checkValue(`${path}.${childKey}`, childValue);
      }
    };
    for (const entry of entries) {
      if (entry.keys) for (const key of entry.keys) checkValue(key.path, key.value);
      checkValue(entry.path, entry.value);
    }
    const unknown = [...unknownSet];
    if (unknown.length) {
      const topUnknown = unknown.filter((name) => !name.includes("."));
      const rows = topUnknown.length ? await this.schema.catalogShape({ type }).catch(() => void 0) : void 0;
      const rowOnly = topUnknown.filter((name) => rows?.fields.has(name));
      const near = [];
      for (const name of unknown) {
        const dot = name.lastIndexOf(".");
        if (dot === -1) {
          for (const field of shape.fields)
            if (!shape.computed?.has(field) && isSimilarName(field, name)) near.push(field);
        } else {
          const parent = name.slice(0, dot);
          const leaf = name.slice(dot + 1);
          const prefix = `${parent}.`;
          for (const candidate of shape.types.keys())
            if (!shape.computed?.has(candidate) && candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes(".") && isSimilarName(candidate.slice(prefix.length), leaf))
              near.push(candidate);
        }
      }
      throw new HcmError(
        "UNKNOWN_FIELD",
        `У типа ${type} нет поля: ${unknown.join(", ")}.`,
        `${rowOnly.length ? `${rowOnly.join(", ")}: есть только в строке каталога, в документ не пишется. ` : ""}${similarHint(near)}Поля типа показывает schema.get.`,
        { fields: unknown }
      );
    }
    const computed = [...computedSet];
    if (computed.length)
      throw new HcmError(
        "INVALID_ARGUMENT",
        `${computed.join(", ")}: значение вычисляет сервер, записать его нельзя.`,
        "Менять нужно поля, из которых сервер его складывает. Вычисляемые поля в schema.get помечены computed:true.",
        { fields: computed }
      );
    const wrong = [...wrongDates];
    if (wrong.length)
      throw new HcmError(
        "INVALID_ARGUMENT",
        `${wrong.join(", ")}: дата записана не так, как её читает сервер.`,
        'Писать нужно "2026-12-05" или "2026-12-05T09:30:00". Время — местное время сервера: смещение в значении сервер не учитывает.',
        { fields: wrong }
      );
    for (const name of [...topNames].filter((name2) => shape.serverFilled?.has(name2))) {
      const source = name.replace(/_name$/, "_id");
      const usable = source !== name && shape.fields.has(source) && !shape.serverFilled?.has(source);
      filled.set(name, usable ? source : void 0);
    }
    return filled;
  }
  async create(args, out) {
    const type = identifier(args.type, "type");
    const data = inputObject(args.data, "data");
    if (data.id !== void 0)
      throw new HcmError(
        "IMMUTABLE_ID",
        "ID новому объекту выдаёт сервер: нужно убрать id из data."
      );
    if (!Object.keys(data).length)
      throw new HcmError(
        "INVALID_ARGUMENT",
        "data: нет ни одного поля.",
        "Нужно передать поля нового объекта, например {name: '…'}; значения по умолчанию сервер подставит сам."
      );
    XmlDocument.create(type, data).snapshot();
    if (args.formUrl === void 0) await this.schema.requireType(type);
    const formUrl = args.formUrl === void 0 ? await this.schema.typeFormUrl(type) : requiredString(args.formUrl, "formUrl");
    const form = await this.schema.documentForm(formUrl);
    if (!Array.isArray(form.roots) || !form.roots.includes(type))
      throw new HcmError("FORM_TYPE_MISMATCH", "В форме нет запрошенного типа объекта.");
    await this.requireFields(
      type,
      formUrl,
      Object.entries(data).map(([path, value]) => ({ path, value }))
    );
    const info = await this.server.applicationInfo().catch(() => void 0);
    const dbName = await this.resolveDbName(args.dbName, info);
    const databases = serverDatabases(info ?? {}).map((db) => db.id);
    if (databases.length && !databases.includes(dbName))
      throw new HcmError(
        "INVALID_ARGUMENT",
        `dbName: базы ${dbName} на сервере нет.`,
        `Базы сервера: ${databases.join(", ")}.`
      );
    const mutationId = randomUUID2();
    out.note({ mutationId });
    await this.journal({ mutationId, operation: "objects.create", stage: "allocating", type });
    const allocated = await this.server.call(
      "native.lds.getNewObjectId",
      { dbName },
      new WriteOutcome()
    );
    const location = resolvePhysicalDocumentLocation(
      scalar(findXmlNode(allocated, "ObjectID"), "ObjectID"),
      dbName
    );
    out.note({ objectId: location.objectId, url: location.url });
    const snapshot = XmlDocument.create(
      type,
      { id: location.objectId, ...data },
      formUrl
    ).snapshot();
    await this.journal({
      mutationId,
      operation: "objects.create",
      stage: "prepared",
      objectId: location.objectId
    });
    await this.server.call(
      "native.lds.putDoc",
      { url: location.url, data: snapshot.xml, writeDocInfo: true, neverSaved: true },
      out
    );
    const loaded = await this.load({ url: location.url, type });
    const result = loaded.document.snapshot();
    if (BigInt(requiredString(loaded.id, "ID при проверочном чтении")) !== BigInt(location.objectId))
      throw new HcmError(
        "READ_BACK_MISMATCH",
        "При проверочном чтении ID созданного объекта не совпал с выданным.",
        void 0,
        { mutationId }
      );
    verifyFields(snapshot.data, result.data, form.fields, Object.keys(data));
    await this.journal({
      mutationId,
      operation: "objects.create",
      stage: "verified",
      objectId: location.objectId
    });
    return {
      id: location.objectId,
      url: location.url,
      type,
      fingerprint: result.fingerprint,
      mutationId,
      mutationOutcome: "confirmed"
    };
  }
  async patch(args, out) {
    const operations2 = patchInput(args.patch, args.remove, args.resave === true);
    const loaded = await this.load(args);
    const schemaReadsBefore = this.schema.serverReads;
    const { type, formUrl } = loaded.document.form();
    const shape = await this.schema.documentShape(type, formUrl);
    const changes = loaded.document.patch(operations2, shape.types.size ? shape.types : void 0);
    if (args.expectedFingerprint !== void 0 && args.expectedFingerprint !== changes.before.fingerprint)
      throw new HcmError(
        "CONFLICT",
        "Объект изменился после чтения: его fingerprint не равен expectedFingerprint.",
        "Прочитать объект заново и составить изменение по его текущему состоянию."
      );
    const writtenEntries = changes.written.map(({ path, value }) => {
      const segments = patchSegments(path);
      const keys = [];
      for (let i = 0; i < segments.length; i++) {
        const key = segments[i][3];
        if (key !== void 0)
          keys.push({
            path: `${segments.slice(0, i + 1).map((part) => part[1]).join(".")}.${key}`,
            value: segments[i][4]
          });
      }
      return { path: segments.map((part) => part[1]).join("."), value, keys };
    });
    const filled = await this.requireFields(
      changes.before.type,
      changes.before.formUrl,
      writtenEntries,
      shape
    );
    const noop = changes.before.fingerprint === changes.after.fingerprint;
    if (args.preview === true || noop && args.resave !== true)
      return {
        preview: args.preview === true,
        noop: noop && args.resave !== true,
        changes: changes.changes,
        fingerprint: changes.before.fingerprint,
        ...filled.size ? { serverFilled: [...filled.keys()] } : {}
      };
    const form = await this.schema.documentForm(
      changes.before.formUrl ?? await this.schema.typeFormUrl(changes.before.type)
    );
    if (this.schema.serverReads !== schemaReadsBefore) {
      const current = await this.load({ url: loaded.url });
      if (current.document.snapshot().fingerprint !== changes.before.fingerprint)
        throw new HcmError(
          "CONFLICT",
          "Объект изменился, пока готовилась запись.",
          "Прочитать объект заново и составить изменение по его текущему состоянию."
        );
    }
    const branches = changes.changes.map((change) => patchSegments(change.path)[0][1]);
    const mutationId = randomUUID2();
    await this.journal({
      mutationId,
      operation: "objects.patch",
      stage: "prepared",
      fingerprint: changes.before.fingerprint
    });
    out.note({
      mutationId,
      url: loaded.url,
      ...loaded.id === void 0 ? {} : { objectId: loaded.id }
    });
    await this.server.call(
      "native.lds.putDoc",
      { url: loaded.url, data: changes.after.xml, writeDocInfo: true },
      out
    );
    const verified = await this.load({
      url: loaded.url,
      ...args.id === void 0 ? {} : { id: args.id },
      ...args.type === void 0 ? {} : { type: args.type }
    });
    const snapshot = verified.document.snapshot();
    try {
      verifyFields(changes.after.data, snapshot.data, form.fields, branches, changes.before.xml);
    } catch (error) {
      const fields = error instanceof HcmError ? error.details?.fields : void 0;
      const copies = Array.isArray(fields) ? [...filled.keys()].filter((name) => fields.includes(name)) : [];
      if (!(error instanceof HcmError) || !copies.length) throw error;
      const sources = copies.flatMap((name) => {
        const source = filled.get(name);
        return source ? [`${source} вместо ${name}`] : [];
      });
      throw new HcmError(
        error.code,
        error.message,
        `${copies.join(", ")}: сервер заполняет при сохранении документа из связанного объекта. Менять нужно связанное поле${sources.length ? `: ${sources.join(", ")}` : ""}. Остальные поля запроса сохранены: заново объект не создавать.`,
        error.details
      );
    }
    verifyRemovals(changes.after.data, snapshot.data, changes.changes, form.fields);
    await this.journal({
      mutationId,
      operation: "objects.patch",
      stage: "verified",
      fingerprint: snapshot.fingerprint
    });
    const serverChanged = Object.keys({ ...changes.after.data, ...snapshot.data }).filter(
      (key) => key !== "doc_info" && !branches.includes(key) && !sameData(changes.after.data[key], snapshot.data[key], {
        fieldTypes: shape.types,
        path: key
      })
    );
    return {
      ...verified.id === void 0 ? {} : { id: verified.id },
      type: snapshot.type,
      url: loaded.url,
      fingerprint: snapshot.fingerprint,
      changes: changes.changes,
      ...serverChanged.length ? { serverChanged: serverChanged.slice(0, 20) } : {},
      mutationId,
      mutationOutcome: "confirmed"
    };
  }
  async delete(args, out) {
    if (args.permanent !== true)
      throw new HcmError(
        "DELETE_MODE_REQUIRED",
        "Объект удаляется безвозвратно: для этого нужен permanent:true.",
        "Корзины у этой операции нет."
      );
    const loaded = await this.load(args);
    const snapshot = loaded.document.snapshot();
    const objectId = requiredString(loaded.id, "ID объекта");
    const catalog = args.catalog === void 0 ? await this.resolveCatalog(snapshot.type, loaded.url) : identifier(args.catalog, "catalog");
    if (catalog !== void 0 && !await this.catalogHasId(catalog, objectId))
      throw new HcmError(
        "CATALOG_MISMATCH",
        "Объекта нет в каталоге, по которому проверяется удаление.",
        "Нужно указать каталог, в котором объект есть."
      );
    const mutationId = randomUUID2();
    await this.journal({ mutationId, operation: "objects.delete", stage: "prepared", objectId });
    out.note({ mutationId, objectId, url: loaded.url });
    await this.server.call("native.lds.deleteDoc", { url: loaded.url, strictDelete: true }, out);
    if (catalog !== void 0 && await this.catalogHasId(catalog, objectId)) {
      const info = await readServerInfo(this.server).catch(() => void 0);
      throw new HcmError(
        "READ_BACK_MISMATCH",
        "После удаления объект всё ещё есть в каталоге.",
        info?.database === "mssql" && info.versionServer.startsWith("2025.2.") ? "Сервер 2025.2 с MS SQL не удаляет документы, пока после запуска или простоя не сохранён ни один документ. Сохранить любой документ (objects.patch с resave) и повторить удаление." : "Перед повтором удаления прочитать объект. Причину сервер пишет в лог spxml_unibridge."
      );
    }
    await this.journal({
      mutationId,
      operation: "objects.delete",
      stage: catalog === void 0 ? "acknowledged" : "verified-absence",
      objectId
    });
    return {
      id: objectId,
      mutationId,
      mutationOutcome: "confirmed",
      verification: catalog === void 0 ? "server" : "catalog",
      ...catalog === void 0 ? {} : { catalog }
    };
  }
};

// src/reply.ts
function setOwnProperty(target, key, value) {
  if (key === "__proto__")
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true
    });
  else target[key] = value;
}
function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array)
    return { base64: Buffer.from(value).toString("base64"), bytes: value.length };
  if (Array.isArray(value)) {
    let copy;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const next = jsonSafe(item);
      if (copy !== void 0) {
        copy[i] = next;
      } else if (next !== item) {
        copy = value.slice(0, i);
        copy.push(next);
      }
    }
    return copy ?? value;
  }
  if (value && typeof value === "object") {
    const record3 = value;
    let copy;
    const keys = Object.keys(record3);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const child = record3[key];
      const next = jsonSafe(child);
      if (copy !== void 0) {
        setOwnProperty(copy, key, next);
      } else if (next !== child) {
        copy = {};
        for (let j = 0; j < i; j++) {
          const prevKey = keys[j];
          setOwnProperty(copy, prevKey, record3[prevKey]);
        }
        setOwnProperty(copy, key, next);
      }
    }
    return copy ?? value;
  }
  return value;
}
var jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value) ?? "null");
function longerThan(data, limit) {
  let chars = 0;
  const count = (value) => {
    if (typeof value === "string") chars += value.length;
    else if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) if (chars <= limit) count(item);
    }
  };
  count(data);
  return chars > limit || jsonBytes(data) > limit;
}
function beginning(data, budget, summarised) {
  const whole = data === null || typeof data !== "object" || Array.isArray(data);
  const entries = whole ? [["", data]] : Object.entries(data);
  const shown2 = entries.map(
    ([, value]) => Array.isArray(value) ? [] : typeof value === "string" ? value.slice(0, 1e3) : value
  );
  const preview = () => whole ? shown2[0] : Object.fromEntries(entries.map(([key], index) => [key, shown2[index]]));
  let used = jsonBytes(preview());
  for (const [index, [key, value]] of entries.entries()) {
    if (!Array.isArray(value)) continue;
    const items = shown2[index];
    for (const item of value) {
      const bytes = jsonBytes(item) + (items.length ? 1 : 0);
      if (used + bytes > budget) break;
      used += bytes;
      items.push(item);
    }
    if (value.length && (!items.length || key === summarised && items.length < value.length))
      return void 0;
  }
  return preview();
}
var ReplyPacker = class {
  constructor(config, results) {
    this.config = config;
    this.results = results;
  }
  /** Место под payload одного ответа; остаток лимита вывода оставлен другим его полям. */
  get pageBytes() {
    return Math.floor(this.config.outputLimitBytes * 0.6);
  }
  /** Что вернула операция; ответ сверх лимита сохраняется целиком и заменяется своим началом. */
  async success(id, start, value, bound) {
    const rules = operationSpec(id)?.reply;
    const data = jsonSafe(value);
    const outcome = (stored) => {
      const error = rules?.failed?.(data, stored);
      return error ? { ok: false, error } : { ok: true };
    };
    if (bound && longerThan(data, this.config.outputLimitBytes) && rules?.store !== "never") {
      const own = rules?.list;
      const stored = await this.results.put(data, own?.key);
      const budget = this.config.outputLimitBytes / 2;
      const fitted = beginning(data, budget, own?.key);
      const preview = fitted !== void 0 && jsonBytes(fitted) <= budget ? fitted : {
        kind: "stored-result",
        ...data !== null && typeof data === "object" && !Array.isArray(data) ? Object.fromEntries(
          Object.entries(data).slice(0, 40).map(([key, value2]) => [
            key,
            Array.isArray(value2) ? key === own?.key ? [] : `[список: ${value2.length}]` : value2 !== null && typeof value2 === "object" ? "{структура}" : typeof value2 === "string" && value2.length > 120 ? `${value2.slice(0, 120)}…` : value2
          ])
        ) : {}
      };
      const { list } = stored;
      const whole = list === void 0 ? [] : data[list];
      const shown2 = list === void 0 ? void 0 : preview[list];
      const result = outcome(true);
      const durationMs = Math.round(performance.now() - start);
      const reply = () => ({
        ...result,
        data: {
          preview,
          resultId: stored.resultId,
          hint: `Ответ не поместился и сохранён целиком: results.read читает ${list === void 0 ? "его частями" : `список ${list} по элементам${Array.isArray(shown2) && shown2.length < whole.length ? ` (в preview первые ${shown2.length} из ${whole.length})` : ""}`}, results.export сохраняет в файл.`
        },
        meta: {
          operationId: id,
          connection: this.config.name,
          durationMs,
          truncated: true,
          resultId: stored.resultId,
          resultBytes: stored.bytes
        }
      });
      if (own && preview !== fitted && Array.isArray(shown2)) {
        let previewBytes = jsonBytes(preview);
        let replyBytes = jsonBytes(reply());
        const totalStr = String(whole.length);
        const hintSuffixBytes = (count) => count < whole.length ? Buffer.byteLength(` (в preview первые ${count} из ${totalStr})`) : 0;
        let prevHintBytes = hintSuffixBytes(shown2.length);
        for (const item of whole) {
          const summary = own.summary(item);
          const step = jsonBytes(summary) + (shown2.length > 0 ? 1 : 0);
          const nextHintBytes = hintSuffixBytes(shown2.length + 1);
          const nextPreviewBytes = previewBytes + step;
          const nextReplyBytes = replyBytes + step + (nextHintBytes - prevHintBytes);
          if (nextPreviewBytes > budget || nextReplyBytes > this.config.outputLimitBytes) break;
          shown2.push(summary);
          previewBytes = nextPreviewBytes;
          replyBytes = nextReplyBytes;
          prevHintBytes = nextHintBytes;
        }
        while (shown2.length > 0 && jsonBytes(reply()) > this.config.outputLimitBytes) shown2.pop();
      }
      return reply();
    }
    const kept = bound && (typeof rules?.store === "function" ? rules.store(data) : rules?.store === "always") ? await this.results.put(data, rules?.list?.key).catch(() => void 0) : void 0;
    return {
      ...outcome(false),
      data,
      meta: {
        operationId: id,
        connection: this.config.name,
        durationMs: Math.round(performance.now() - start),
        ...kept ? { resultId: kept.resultId } : {}
      }
    };
  }
  /** Что операция выбросила: формулировка по классу ошибки, без секретов, в пределах лимита. */
  failure(id, start, error, verdict, extra = {}) {
    const failure = this.pack(id, start, error, verdict, extra.afterSend);
    if (!extra.batchRecovery) return failure;
    return { ...failure, data: this.batchRecoveryData(extra.batchRecovery) };
  }
  /** Сбой локального хранилища не стирает выполненные шаги и не помечает ушедший пакет not_sent. */
  batchRecoveryData(recovery) {
    const data = {
      partial: true,
      receiptOnly: true,
      completed: recovery.completed,
      requested: recovery.requested,
      sentMutationSteps: recovery.sentMutationSteps,
      receipts: [],
      omittedReceipts: recovery.receipts.length
    };
    const receipts = data.receipts;
    const budget = Math.floor(this.config.outputLimitBytes / 3);
    let used = jsonBytes(data);
    let prevOmittedDigits = String(data.omittedReceipts).length;
    for (const receipt of recovery.receipts) {
      const compact = { ...receipt };
      if (typeof compact.url === "string" && compact.url.length > 256) delete compact.url;
      const step = jsonBytes(compact) + (receipts.length > 0 ? 1 : 0);
      const nextOmitted = recovery.receipts.length - (receipts.length + 1);
      const nextOmittedDigits = String(nextOmitted).length;
      const nextUsed = used + step + (nextOmittedDigits - prevOmittedDigits);
      if (nextUsed > budget) break;
      receipts.push(compact);
      data.omittedReceipts = nextOmitted;
      used = nextUsed;
      prevOmittedDigits = nextOmittedDigits;
    }
    return data;
  }
  pack(id, start, error, verdict, afterSend) {
    const bound = (text2, limit) => text2.length > limit ? `${text2.slice(0, limit - 1)}…` : text2;
    const redact = (message, limit = 500) => {
      let safe = message;
      for (const secret of [
        this.config.password,
        this.config.username && this.config.password ? Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64") : void 0
      ])
        if (secret && secret.length >= 6) safe = safe.replaceAll(secret, "[redacted]");
      safe = redactCredentials(safe.replace(/\b[A-Za-z]:[\\/][^\r\n<>"']*/g, "[server-path]"));
      return bound(safe, limit);
    };
    const { mutationOutcome, refusedAfterSend, ids, exactIds } = verdict;
    const { mutationOutcome: _own, ...normal } = error instanceof HcmError ? error.toJSON() : error instanceof WsHcmApiError ? {
      code: `PLATFORM_${error.kind.toUpperCase()}`,
      ...platformFailure(
        error,
        this.config.baseUrl,
        operationSpec(id)?.usualCause,
        // Своё сообщение после отправки операция даёт сама (afterSend).
        mutationOutcome === "indeterminate" && !afterSend
      ),
      retryable: false,
      ...error.status === void 0 ? {} : { details: { status: error.status } }
    } : error instanceof ArgumentError ? {
      code: "INVALID_ARGUMENT",
      message: error.message,
      hint: "Аргументы операции описывает api.describe.",
      retryable: false
    } : {
      code: "INTERNAL_ERROR",
      message: "Операция не выполнена: внутренняя ошибка клиента.",
      hint: "Это дефект клиента: подбирать аргументы не нужно.",
      retryable: false
    };
    if (refusedAfterSend)
      normal.hint = `${normal.hint ?? ""} До этого отказа запрос на запись уже ушёл: после восстановления входа проверить, прошла ли запись, прежде чем повторять.`.trim();
    if (afterSend && mutationOutcome === "indeterminate") {
      normal.hint = [afterSend.hint, normal.message, normal.hint].filter(Boolean).join(" ");
      normal.message = afterSend.message;
    }
    const trim = (value, depth = 0, limit = 256) => {
      if (typeof value === "string") return redact(value, limit);
      if (depth > 3) return "[details omitted]";
      if (Array.isArray(value)) return value.slice(0, 12).map((item) => trim(item, depth + 1));
      if (value !== null && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).slice(0, 12).map(([key, item]) => [
            key.slice(0, 128),
            trim(item, depth + 1, key === "scriptError" ? 2048 : 256)
          ])
        );
      return value;
    };
    let details = {
      ...trim({
        ...normal.details,
        ...ids.mutationId === void 0 ? {} : { mutationId: ids.mutationId },
        ...ids.objectId === void 0 ? {} : { objectId: ids.objectId },
        ...ids.url === void 0 ? {} : { url: ids.url },
        ...ids.executionId === void 0 ? {} : { executionId: ids.executionId },
        ...ids.threadId === void 0 ? {} : { threadId: ids.threadId }
      }),
      ...exactIds
    };
    if (jsonBytes(details) > this.config.outputLimitBytes / 4)
      details = {
        omitted: true,
        ...exactIds
      };
    const omitOversizedConnection = (value) => {
      const bytes = jsonBytes(value);
      if (bytes <= this.config.outputLimitBytes) return value;
      const omitted = {
        ...value,
        meta: { ...value.meta, connection: "[omitted]", connectionOmitted: true }
      };
      return jsonBytes(omitted) < bytes ? omitted : value;
    };
    const result = omitOversizedConnection({
      ok: false,
      error: {
        ...normal,
        // Отказ платформы формулируется здесь из фиксированного текста и настроенного адреса,
        // отказ по аргументу — из текста клиента и имени аргумента: пароль, случайно ставший
        // частью слова, и имя аргумента password не должны вырезать в них дыры. Имя аргумента
        // задаёт вызывающий, поэтому длина сообщения всё равно ограничена.
        ...error instanceof WsHcmApiError ? {} : error instanceof ArgumentError ? { message: bound(normal.message, 500) } : {
          message: redact(normal.message),
          // Подсказка бывает длиннее сообщения: она называет имена, из которых выбирать.
          ...normal.hint === void 0 ? {} : { hint: redact(normal.hint, 1e3) }
        },
        ...mutationOutcome === void 0 ? {} : { mutationOutcome },
        ...Object.keys(details).length ? { details } : {}
      },
      meta: {
        operationId: typeof id === "string" && id.length <= 128 ? id : "[invalid-operation]",
        connection: this.config.name,
        durationMs: Math.round(performance.now() - start)
      }
    });
    return result;
  }
};

// src/runtime.ts
var MAX_DOC_TYPE_PAGES = 50;
async function readDocTypeTitles(server) {
  const titles = /* @__PURE__ */ new Map();
  let startPos = 0;
  for (let pageIndex = 0; pageIndex < MAX_DOC_TYPE_PAGES; pageIndex++) {
    const response = await server.read("native.lds.xQuery", {
      query: "for $e in doc_types return $e",
      startPos,
      maxCount: 1e3,
      expectToReadAll: false
    });
    const page = queryPage(response, startPos, 1e3, ["object_name", "name"], false);
    if (page.incomplete)
      throw new HcmError(
        "QUERY_INCOMPLETE",
        "Каталог doc_types вернул неполный ответ: заголовки пользовательских типов не прочитаны."
      );
    for (const row of page.items) {
      if (typeof row.object_name === "string" && row.object_name && typeof row.name === "string" && row.name)
        titles.set(row.object_name, row.name);
    }
    if (page.nextStartPosition === void 0 || page.nextStartPosition <= startPos) return titles;
    startPos = page.nextStartPosition;
  }
  throw new HcmError(
    "QUERY_INCOMPLETE",
    "Каталог doc_types превысил предел чтения страниц: заголовки пользовательских типов прочитаны не полностью."
  );
}
var HcmRuntime = class {
  constructor(config, port) {
    this.config = config;
    this.results = new ResultStore(config);
    this.replies = new ReplyPacker(config, this.results);
    this.gateway = new NativeGateway(config);
    this.server = new HcmServer(port ?? trustedGatewayPort(this.gateway));
    this.logs = new LogReader({ call: (id, args) => this.server.read(id, args) }, config);
    this.files = new ServerFiles(this.server, config);
    this.rpcCatalog = new RpcCatalog(
      (fresh) => this.server.applicationInfo(fresh),
      (url) => this.server.call("native.lds.loadUrl", { url })
    );
    this.schemaReader = new SchemaReader(
      () => this.server.applicationInfo(),
      async (url) => requiredString(
        await this.server.call(
          url.startsWith("x-local://udt/") ? "web.pages.getForm" : "native.spxml2.getForm",
          { url }
        ),
        "ответ с формой"
      ),
      async (url) => (await this.objects.load({ url })).document.snapshot().data,
      void 0,
      void 0,
      () => readDocTypeTitles(this.server)
    );
    this.objects = new ServerObjects(this.server, this.schemaReader, {
      directory: this.results.directory,
      maxBytes: config.journalMaxBytes ?? LOCAL_LIMITS.journalMaxBytes
    });
    this.context = {
      config,
      server: this.server,
      objects: this.objects,
      files: this.files,
      schema: this.schemaReader,
      logs: this.logs,
      results: this.results,
      rpcCatalog: this.rpcCatalog,
      pageBytes: this.replies.pageBytes,
      operationCount: operations.length,
      pipeline: {
        describe: (id) => this.describe(id),
        failure: (id, error) => this.failure(id, performance.now(), error, this.unsent(id)),
        step: (id, args, call) => this.perform(id, args, performance.now(), false, call),
        // async: и отказ до первого запроса приходит отклонённым промисом, а не исключением.
        invoke: async (id, args, signal) => withRequestSignal(
          signal,
          () => this.operation(id).run(this.context, args, {
            outcome: new WriteOutcome(),
            effect: "read"
          })
        )
      }
    };
  }
  gateway;
  results;
  logs;
  replies;
  server;
  schemaReader;
  files;
  objects;
  rpcCatalog;
  context;
  queue = Promise.resolve();
  closed = false;
  closePromise;
  listOperations(filter = {}) {
    return listHcmOperations(filter);
  }
  describe(id) {
    return describeHcmOperation(id);
  }
  /**
   * Условные побочные эффекты по фактическим аргументам; MCP, CLI и SDK обязаны вызвать это
   * до маршрутизации.
   */
  getOperationEffect(id, args = {}) {
    return operationEffect(id, args);
  }
  /** Определение операции; отказ для неверного или неизвестного ID формулирует describe. */
  operation(id) {
    this.describe(id);
    return operationSpec(id);
  }
  call(id, args = {}) {
    const start = performance.now();
    const unsent = this.unsent(id);
    if (this.closed)
      return Promise.resolve(
        this.failure(id, start, new HcmError("RUNTIME_CLOSED", "Подключение уже закрыто."), unsent)
      );
    let snapshot;
    try {
      snapshot = inputObject(structuredClone(args));
    } catch {
      return Promise.resolve(
        this.failure(
          id,
          start,
          new HcmError(
            "INVALID_ARGUMENT",
            "Аргументы операции — не объект, или в них есть значение, которое нельзя скопировать.",
            "Нужно передать значения, совместимые с JSON; двоичные данные — как {base64: …}, XML — как {xml: …}."
          ),
          unsent
        )
      );
    }
    const run = this.queue.then(() => this.perform(id, snapshot, performance.now()));
    this.queue = run.catch(() => void 0);
    return run;
  }
  /** Вызов, отклонённый до первого запроса: исход not_sent несут только запись и выполнение кода. */
  unsent(id) {
    return { outcome: new WriteOutcome(), effect: operationDefinition(id)?.effect ?? "unknown" };
  }
  authorize(effect) {
    if ((effect === "write" || effect === "unknown") && !this.config.permissions.write)
      throw new HcmError(
        "WRITE_DISABLED",
        "Подключение не разрешает запись.",
        permissionHint(this.config, "write")
      );
    if ((effect === "execute" || effect === "unknown") && !this.config.permissions.execute)
      throw new HcmError(
        "EXECUTE_DISABLED",
        "Подключение не разрешает выполнять код, функции и запросы XQuery на сервере.",
        permissionHint(this.config, "execute")
      );
  }
  invalidateAfterWrite(id, args, state, error) {
    const verdict = state.outcome.verdict(state.effect, error);
    if (!verdict.sent || verdict.mutationOutcome === "not_sent" || id === "files.list" || id === "runtime.batch" || id === "native.lds.xQuery" && typeof args.query === "string" && !/^\s*sql\s*:/i.test(args.query))
      return;
    if ((id === "objects.create" || id === "objects.patch" || id === "objects.delete") && (typeof args.url !== "string" || parsePhysicalDocumentId(args.url) !== void 0)) {
      this.schemaReader.invalidateDocuments();
      return;
    }
    this.server.invalidateApplicationInfo();
    this.schemaReader.invalidate();
    this.rpcCatalog.invalidate();
  }
  async perform(id, args, start, boundOutput = true, state = { outcome: new WriteOutcome(), effect: "read" }) {
    let caughtError;
    try {
      const operation = this.operation(id);
      state.effect = operation.effect;
      validate(args, operation.inputSchema);
      state.effect = operationEffect(id, args);
      this.authorize(state.effect);
      const value = await operation.run(this.context, args, state);
      return await this.replies.success(id, start, value, boundOutput);
    } catch (error) {
      caughtError = error;
      return this.failure(id, start, error, state);
    } finally {
      this.invalidateAfterWrite(id, args, state, caughtError);
    }
  }
  failure(id, start, error, state = { outcome: new WriteOutcome(), effect: "read" }) {
    if (error instanceof WsHcmApiError && error.status === 500 || error instanceof HcmError && (error.code === "SCRIPT_FAILED" || error.code === "UPLOAD_REFUSED"))
      this.logs.serverWroteLog();
    return this.replies.failure(
      id,
      start,
      error,
      state.outcome.verdict(state.effect, error),
      state
    );
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    return this.closePromise = this.queue.then(() => this.gateway.close()).then(() => void 0);
  }
};

export {
  ResultStore,
  sliceEventsAfterCursorToken,
  buildLogFollowCursor,
  parseLogEvents,
  maxLogTailBytes,
  ReplyPacker,
  HcmRuntime
};
