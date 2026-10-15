import { createHash } from "node:crypto";
import { open, writeFile, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { HcmError, requiredString } from "./errors.js";
import { permissionHint } from "./config.js";
import type { ConnectionConfig } from "./contracts.js";
import { freezeRegistry } from "./immutable.js";
import type { HcmServer } from "./hcm-server.js";
import { saveLocalFile } from "./results.js";
import type { WriteOutcome } from "./write-outcome.js";
import { prepareScript, type ScriptData } from "./scripts.js";
import { exactKeys, isType, rpcArgument, strictResponse } from "./server-value.js";

/** Аргументы fileExists. */
export interface FileExistsInput {
  /** Адрес на сервере: x-local://…, до 256 знаков. */
  readonly url: string;
}
/** Ответ fileExists. */
export interface FileExistsData {
  /** Существует файл, папка или адрес хранилища из настроек; содержимое и доступ не проверяются. */
  readonly exists: boolean;
}

/** Аргументы readFile без file: файл приходит в ответе. */
export interface FileReadInput {
  /** Адрес файла на сервере: x-local://…. */
  readonly url: string;
  /** "base64" отдаёт байты, даже если файл текстовый. */
  readonly encoding?: "base64";
  /** Не задаётся: файл на диск сохраняет вызов с FileSaveInput. */
  readonly file?: undefined;
}
/** Ответ readFile: ровно одно из text и base64. */
export interface FileReadData {
  /** Содержимое, если это текст UTF-8; метка порядка байтов в начале убирается. */
  readonly text?: string;
  /** Содержимое, если это не текст или запрошен base64. */
  readonly base64?: string;
  /** Размер файла в байтах. */
  readonly bytes: number;
}
/** Аргументы readFile с file: файл сохраняется на этот компьютер. */
export interface FileSaveInput {
  /** Адрес файла на сервере: x-local://…. */
  readonly url: string;
  /** Полный путь, куда сохранить файл байт в байт; размер не ограничен. Папка должна быть. */
  readonly file: string;
  /** Заменить файл, если он уже есть; иначе FILE_EXISTS. */
  readonly overwrite?: boolean;
}
/** Ответ readFile с file. */
export interface FileSaveData {
  /** Размер файла в байтах. */
  readonly bytes: number;
  /** Полный путь к сохранённому файлу. */
  readonly file: string;
}

/** Файл целиком: текст, если это текст в UTF-8, иначе base64. */
export function fileContent(content: Buffer, encoding?: "base64"): FileReadData {
  const binary = { base64: content.toString("base64"), bytes: content.length };
  if (encoding === "base64") return binary;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    // Байты ниже 0x20 — допустимый UTF-8, но файл из них не текст.
    return /[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)
      ? binary
      : { text, bytes: content.length };
  } catch {
    return binary;
  }
}

const FILE_EXISTS_TARGET = "tools.file_url_exists_server";
// Штатный поиск атрибута провайдера привязывает URL к параметру SQL на 256 символов.
// Вход держится в этом объявленном пределе, чтобы длинный URL не был молча обрезан при
// привязке параметра этим провайдером.
// Это не утверждение о максимальной длине пути файловой системы на любом сервере.
export const FILE_EXISTS_URL_MAX_LENGTH = 256;

/** Проверяет, не нормализуя URL, который передаётся штатному предикату. */
export function fileExistsUrl(value: unknown): string {
  const invalid = () =>
    new HcmError(
      "INVALID_ARGUMENT",
      "url: нужен адрес x-local://… не длиннее 256 знаков.",
      "Адрес вида x-local://папка/путь: без имени пользователя и пароля, порта, знаков ? и #, обратной косой черты и управляющих символов.",
    );
  if (
    typeof value !== "string" ||
    value.length > FILE_EXISTS_URL_MAX_LENGTH ||
    !value.startsWith("x-local://") ||
    /[\\?#\u0000-\u001f\u007f]/u.test(value)
  )
    throw invalid();
  const authority = value.slice("x-local://".length).split("/", 1)[0]!;
  if (!authority || /[\s@:\\]/u.test(authority)) throw invalid();
  // XML не может нести одиночные суррогатные кодовые единицы; отказ до bootstrap.
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw invalid();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw invalid();
    else if (unit === 0xfffe || unit === 0xffff) throw invalid();
  }
  return value;
}

/** Ровно одно из text, base64 и file. */
export type FileWriteInput = {
  /** Адрес файла на сервере: x-local://…; файл заменяется целиком. */
  readonly url: string;
  /** Текст; пишется в UTF-8. */
  readonly text?: string;
  /** Двоичные данные в base64. */
  readonly base64?: string;
  /** Полный путь к файлу на этом компьютере: он читается частями, память не растёт с размером. */
  readonly file?: string;
};
/** Ответ writeFile. */
export type FileWriteData = {
  /** Сколько байт записано. */
  readonly bytes: number;
  /** Исход записи: файл на сервере прочитан назад и совпал с отправленным. */
  readonly mutationOutcome: "confirmed";
};
/** Аргументы deleteFile. */
export type FileDeleteInput = {
  /** Адрес файла на сервере: x-local://…. */
  readonly url: string;
};
/** Ответ deleteFile. */
export type FileDeleteData = {
  /** Файл удалён. */
  readonly deleted: true;
  /** Исход записи: подтверждена. */
  readonly mutationOutcome: "confirmed";
};

/** Папки сервера: папка кода хранит код сервера, поэтому запись в неё требует ещё права execute. */
export type FileFolders = { readonly data: readonly string[]; readonly code: readonly string[] };
/** Читаются только два списка папок из сведений о приложении; undefined, если сервер их не дал. */
function fileFolders(info: Record<string, unknown> | undefined): FileFolders | undefined {
  const data = new Set<string>();
  const design = new Set<string>();
  const entries = Array.isArray(info?.config_entries) ? info.config_entries : [];
  for (const entry of entries as { name?: unknown; value?: unknown }[]) {
    const list =
      entry?.name === "DATA-DB" ? data : entry?.name === "DESIGN-DB" ? design : undefined;
    if (list && typeof entry.value === "string" && entry.value) list.add(entry.value);
  }
  if (!data.size && !design.size) return undefined;
  return { data: [...data], code: [...design].filter((name) => !data.has(name)) };
}

/** Папка — первая часть адреса и определяет маршрут: никакая часть не должна его обходить. */
function fileTarget(value: unknown, listing = false): { url: string; folder: string } {
  // Папка для списка файлов может оканчиваться косой чертой и не иметь пути: x-local://share.
  const text = listing && typeof value === "string" ? value.replace(/\/$/, "") : value;
  const [folder = "", ...path] = typeof text === "string" ? text.slice(10).split("/") : [];
  // Сервер принимает % как обычный символ, но закодированные точку, косые черты и управляющие
  // символы всё равно отклоняет, чтобы никакое прочтение адреса не вышло из папки.
  const plain = (part: string) => !/^[. ]*$|%(?:2e|2f|5c|[01][0-9a-f]|7f)/i.test(part);
  if (
    typeof text !== "string" ||
    !text.startsWith("x-local://") ||
    /[\\?#\p{Cc}\p{Cs}]/u.test(text) ||
    !/^[\w-]+$/.test(folder) ||
    !(listing || path.length) ||
    !path.every(plain)
  )
    throw new HcmError(
      "INVALID_ARGUMENT",
      listing
        ? "url: нужен адрес x-local://папка или x-local://папка/путь."
        : "url: нужен адрес x-local://папка/путь.",
      `${listing ? "Без" : "Путь не пустой, без"} частей из одних точек и пробелов, без %2e, %2f, %5c, знаков \\ ? #. Например, x-local://share/report.txt.`,
    );
  return { url: text, folder };
}

/**
 * Папки базы: удаление по адресу молча ничего не удаляет (2025.1.1333 - 2025.2.1535);
 * отказ до любого запроса.
 */
function assertFileDeletable(folder: string): void {
  if (folder === "wt_data" || folder === "trash")
    throw new HcmError(
      "FILE_NOT_DELETABLE",
      `В папке ${folder} сервер не удаляет файлы и папки по адресу.`,
      "Это папка базы сервера. Документ объекта удаляет objects.delete; обычный файл клиент здесь не удаляет.",
    );
}

/** Вид папки по спискам сервера, до отправки; undefined — сервер не сообщил списков. */
function folderKind(folders: FileFolders | undefined, folder: string): "data" | "code" | undefined {
  if (!folders) return undefined;
  // Сервер сравнивает имя папки точно: SHARE — не share.
  if (folders.data.includes(folder)) return "data";
  if (folders.code.includes(folder)) return "code";
  throw new HcmError(
    "FOLDER_NOT_WRITABLE",
    `Папка ${folder} не принимает файлы.`,
    `Папки данных: ${folders.data.join(", ")}. Папки кода (нужны права write и execute): ${folders.code.join(", ")}.`,
  );
}

/** Столько байт за раз шлёт штатная настольная админка. */
export const UPLOAD_BLOCK_BYTES = 10_000_000;
const WRITE_INTERRUPTED = {
  message:
    "Запись прервалась: файл на сервере может быть пустым или недописанным. Запись можно повторить целиком.",
};
const READ_BACK_FAILED = {
  message: "Файл записан, но прочитать его для сверки не удалось.",
  hint: "Содержимое на сервере не проверено: сравнить через files.read; запись можно повторить целиком.",
};
const WRITE_MISMATCH_HINT =
  "Файл записывается целиком: запись можно повторить; если расхождение повторяется — сервер портит файл при записи, проверить через files.read.";

/** Что записать: размер известен до начала записи, байты идут блоками. */
interface WriteSource {
  readonly bytes: number;
  blocks(): AsyncGenerator<Buffer>;
  close(): Promise<void>;
}
/** Ровно одно из text, base64 и file; файл открыт и проверен до отправки. */
async function writeSource(args: Record<string, unknown>): Promise<WriteSource> {
  const { text, base64, file } = args;
  if ([text, base64, file].filter((value) => value !== undefined).length !== 1)
    throw new HcmError("INVALID_ARGUMENT", "Нужно ровно одно из text, base64 и file.");
  if (typeof file === "string") return diskSource(file);
  const bytes =
    typeof text === "string" && !/\p{Cs}/u.test(text)
      ? Buffer.from(text)
      : typeof base64 === "string"
        ? Buffer.from(base64, "base64")
        : undefined;
  if (!bytes || (base64 !== undefined && bytes.toString("base64") !== base64))
    throw new HcmError(
      "INVALID_ARGUMENT",
      "text — без непарных суррогатов, base64 — без переводов строк.",
    );
  return {
    bytes: bytes.length,
    async *blocks() {
      for (let start = 0; start < bytes.length; start += UPLOAD_BLOCK_BYTES)
        yield bytes.subarray(start, start + UPLOAD_BLOCK_BYTES);
    },
    close: async () => undefined,
  };
}
/** file — путь на компьютере вызывающего. */
function localPathError(message: string): HcmError {
  return new HcmError(
    "INVALID_ARGUMENT",
    `file: ${message}`,
    "Путь — на компьютере, где работает клиент; у MCP-сервера — там, где он запущен.",
  );
}
async function diskSource(path: string): Promise<WriteSource> {
  if (!isAbsolute(path) || path.includes("\0")) throw localPathError("нужен полный путь к файлу.");
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch {
    throw localPathError("файл не открывается для чтения.");
  }
  const info = await handle.stat().catch(() => undefined);
  if (!info?.isFile()) {
    await handle.close();
    throw localPathError("по этому пути не файл.");
  }
  const size = info.size;
  return {
    bytes: size,
    // Ровно столько байт, сколько названо в начале записи. Один буфер на все блоки: прошлый блок
    // к этому времени уже отправлен.
    async *blocks() {
      const block = Buffer.allocUnsafe(Math.min(UPLOAD_BLOCK_BYTES, size));
      for (let position = 0; position < size;) {
        const length = Math.min(block.length, size - position);
        for (let filled = 0; filled < length;) {
          const { bytesRead } = await handle.read(
            block,
            filled,
            length - filled,
            position + filled,
          );
          if (!bytesRead)
            throw new HcmError("INVALID_ARGUMENT", "file: файл стал короче, пока шла запись.");
          filled += bytesRead;
        }
        yield block.subarray(0, length);
        position += length;
      }
    },
    close: () => handle.close(),
  };
}
/** Тело ответа в памяти, не больше limit байт. */
async function collect(body: AsyncIterable<Uint8Array>, limit: number): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.length;
    if (bytes > limit)
      throw new HcmError(
        "FILE_TOO_LARGE",
        `Файл больше предела ответа подключения maxResponseBytes (${limit} байт).`,
        "Файл любого размера сохраняет на диск files.read с file.",
      );
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

/** Ответ функции записи: строка с ID записи или true. */
function uploadAnswer(response: unknown, type: "string" | "bool"): string {
  try {
    const { rpc } = strictResponse(response);
    const value = rpc.lexicalValue;
    if (
      !isType(rpc.valueType, type) ||
      typeof value !== "string" ||
      !(type === "string" ? value : value === "1")
    )
      throw new Error();
    return value;
  } catch {
    throw new HcmError("FILE_WRITE_RESPONSE", "Сервер ответил на запись файла в неожиданном виде.");
  }
}

function codeDelete(url: string) {
  return prepareScript(
    `if (IsDirectory(PARAMS.url)) RESULT = ['directory'];
else if (!UrlExists(PARAMS.url)) RESULT = ['absent'];
else { DeleteUrl(PARAMS.url); if (UrlExists(PARAMS.url)) RESULT = ['remains']; else RESULT = ['deleted']; }`,
    { url },
  );
}
function fileRemains(): HcmError {
  return new HcmError(
    "READ_BACK_MISMATCH",
    "Сервер ответил на удаление без ошибки, но файл или папка по адресу остались.",
    "Адрес нужно проверить через files.exists перед повтором.",
  );
}
/** Код нашёл по адресу папку или ничего и ничего не удалил. */
function codeDeleteRefusal(data: ScriptData): HcmError | undefined {
  if (data.result[0] === "directory")
    return new HcmError("FILE_IS_FOLDER", "Адрес — папка: в папке кода удаляется только файл.");
  if (data.result[0] === "absent")
    return new HcmError("FILE_NOT_FOUND", "По адресу нет файла.", "Адрес проверяет files.exists.");
  return undefined;
}

/** Аргументы listFiles. */
export interface FileListInput {
  /** Папка на сервере: x-local://папка или x-local://папка/путь. */
  readonly url: string;
  /** Оставить имена с этой частью; регистр не важен. */
  readonly search?: string;
}
/** Ответ listFiles. */
export interface FileListData {
  /** По имени; у файла указан размер в байтах, у папки folder:true. */
  readonly items: readonly (
    | {
        /** Имя файла. */
        name: string;
        /** Размер файла в байтах. */
        bytes: number;
      }
    | {
        /** Имя папки. */
        name: string;
        /** Это папка. */
        folder: true;
      }
  )[];
  /** Сколько элементов в списке. */
  readonly total: number;
}
/** Один уровень папки: адреса из ReadDirectory, какие из них папки, и размеры файлов. */
function codeList(url: string) {
  return prepareScript(
    `var rows = [];
var item = '';
var folder = false;
var dir = false;
try { dir = IsDirectory(PARAMS.url); } catch (e) { dir = false; }
if (dir) { for (item in ReadDirectory(PARAMS.url)) { folder = IsDirectory(item); rows.push({ u: item, f: folder, b: folder ? 0 : UrlFileSize(item) }); } }
RESULT = dir ? rows : ['none'];`,
    { url },
  );
}
function fileList(data: ScriptData, folder: string, search = ""): FileListData {
  if (data.result[0] === "none")
    throw new HcmError(
      "FOLDER_NOT_FOUND",
      "По адресу нет папки.",
      "Список показывает только папку; файл читает files.read, адрес проверяет files.exists.",
    );
  const rows = (data.result as { u?: unknown; f?: unknown; b?: unknown }[]).map((row) => {
    // Строка — адрес на один уровень внутри папки; всё остальное не показывается.
    const name =
      typeof row?.u === "string" && row.u.startsWith(`${folder}/`)
        ? row.u.slice(folder.length + 1).replace(/\/$/, "")
        : "";
    const bytes = Number(row?.b);
    if (!name || /[/\\]/.test(name) || (row.f !== "1" && !Number.isFinite(bytes)))
      throw new HcmError("SCRIPT_RESPONSE", "Сервер вернул список папки в неожиданном виде.");
    return row.f === "1" ? { name, folder: true as const } : { name, bytes };
  });
  const part = search.toLowerCase();
  const items = rows.filter((item) => item.name.toLowerCase().includes(part));
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { items, total: items.length };
}

/** Разбирает только прямой булев ResultData/Result фиксированного штатного предиката. */
export function parseFileExists(response: unknown): FileExistsData {
  try {
    const { rpc, result } = strictResponse(response);
    exactKeys(result, ["@_VALUE-TYPE", "#text"]);
    if (
      !isType(rpc.valueType, "bool") ||
      !isType(result["@_VALUE-TYPE"], "bool") ||
      (result["#text"] !== "0" && result["#text"] !== "1") ||
      rpc.lexicalValue !== result["#text"]
    )
      throw new Error();
    return freezeRegistry({
      exists: result["#text"] === "1",
    });
  } catch {
    throw new HcmError(
      "FILE_EXISTS_RESPONSE",
      "Сервер ответил на проверку файла в неожиданном виде.",
      "Ожидается значение Bool 0 или 1 от функции tools.file_url_exists_server. Её ответ как есть покажет rpc.call.",
    );
  }
}

/**
 * Что операция сообщает runtime об одном вызове: из этого строятся исход и сообщение при сбое.
 * Часть OperationCall, своим типом: объявления пакета не тянут за собой устройство runtime.
 */
export interface FileCall {
  outcome: WriteOutcome;
  afterSend?: { message: string; hint?: string };
}

/** Файловые операции: метод — вся цепочка одной, от проверки адреса до проверки после ответа. */
export class ServerFiles {
  constructor(
    private readonly server: Pick<
      HcmServer,
      "call" | "read" | "stream" | "runCode" | "applicationInfo"
    >,
    private readonly config: ConnectionConfig,
  ) {}

  async exists(args: Record<string, unknown>): Promise<FileExistsData> {
    return parseFileExists(
      await this.server.read("native.rpc.call", {
        target: FILE_EXISTS_TARGET,
        args: [rpcArgument(fileExistsUrl(args.url))],
      }),
    );
  }

  /** Без file файл собирается в память в пределах maxResponseBytes; с file идёт на диск без предела. */
  async read(args: Record<string, unknown>): Promise<FileReadData | FileSaveData> {
    const url = requiredString(args.url, "url");
    const { encoding, file, overwrite } = args;
    if (file === undefined) {
      if (overwrite === true)
        throw new HcmError("INVALID_ARGUMENT", "overwrite действует только вместе с file.");
      const limit = this.config.maxResponseBytes;
      return fileContent(
        await this.load(url, (body) => collect(body, limit)),
        encoding as "base64" | undefined,
      );
    }
    if (encoding !== undefined)
      throw new HcmError(
        "INVALID_ARGUMENT",
        "encoding не нужен вместе с file: файл сохраняется байт в байт.",
      );
    const path = requiredString(file, "file");
    if (!isAbsolute(path)) throw localPathError("нужен полный путь к файлу.");
    const bytes = await saveLocalFile(
      path,
      overwrite === true,
      (handle) => this.load(url, (body) => writeFile(handle, body)),
      "file",
    );
    return { bytes, file: resolve(path) };
  }

  /** Файл сервера потоком байт: read читает тело ответа, пока запрос занимает подключение. */
  private load<T>(url: string, read: (body: AsyncIterable<Uint8Array>) => Promise<T>): Promise<T> {
    return this.server.stream("native.lds.loadUrl", { url, useBinaryResponse: true }, read);
  }

  async list(args: Record<string, unknown>, call: FileCall): Promise<FileListData> {
    const folder = fileTarget(args.url, true).url;
    const search = args.search === undefined ? "" : requiredString(args.search, "search");
    const data = await this.server.runCode(
      codeList(folder),
      call.outcome,
      (answer) => answer.result[0] === "none",
    );
    return fileList(data, folder, search);
  }

  /**
   * Путь настольной админки, одинаковый для всех папок: начало записи делает файл пустым, блоки
   * ложатся по месту, затем файл читается назад и сверяется по размеру и SHA256.
   */
  async write(args: Record<string, unknown>, call: FileCall): Promise<FileWriteData> {
    const target = fileTarget(args.url);
    const source = await writeSource(args);
    try {
      const kind = folderKind(await this.folders(), target.folder);
      if (kind !== "data" && !this.config.permissions.execute)
        throw new HcmError(
          "EXECUTE_DISABLED",
          kind === "code"
            ? `Папка ${target.folder} — папка кода: файл в ней — код сервера, поэтому запись требует ещё права execute.`
            : "Сервер не сообщил, какие папки — папки кода, поэтому запись требует ещё права execute.",
          permissionHint(this.config, "execute"),
        );
      const upload = (method: string, ...values: unknown[]) =>
        this.server.call(
          "native.rpc.call",
          { target: `tools.upload_${method}`, args: values.map(rpcArgument) },
          call.outcome,
        );
      call.afterSend = WRITE_INTERRUPTED;
      const id = uploadAnswer(await upload("begin", target.url, source.bytes), "string");
      const sent = createHash("sha256");
      let bytes = 0;
      for await (const block of source.blocks()) {
        sent.update(block);
        const end = bytes + block.length;
        uploadAnswer(await upload("range", id, bytes, end, block.toString("base64")), "bool");
        bytes = end;
      }
      uploadAnswer(await upload("end", id), "bool");
      call.afterSend = READ_BACK_FAILED;
      const read = await this.readBack(target.url);
      // Расхождение — не обрыв: у него своё сообщение.
      delete call.afterSend;
      if (read.bytes !== bytes || !read.digest.equals(sent.digest()))
        throw new HcmError(
          "READ_BACK_MISMATCH",
          read.bytes !== bytes
            ? `Файл на сервере после записи отличается от отправленного: ${read.bytes} байт вместо ${bytes}.`
            : "Файл на сервере после записи того же размера, что отправленный, но с другим содержимым.",
          WRITE_MISMATCH_HINT,
        );
      return { bytes, mutationOutcome: "confirmed" };
    } finally {
      await source.close();
    }
  }

  /** Размер и SHA256 файла на сервере: файл читается потоком и в памяти не собирается. */
  private readBack(url: string): Promise<{ bytes: number; digest: Buffer }> {
    return this.load(url, async (body) => {
      const hash = createHash("sha256");
      let bytes = 0;
      for await (const chunk of body) {
        hash.update(chunk);
        bytes += chunk.length;
      }
      return { bytes, digest: hash.digest() };
    });
  }

  async delete(args: Record<string, unknown>, call: FileCall): Promise<FileDeleteData> {
    const target = fileTarget(args.url);
    assertFileDeletable(target.folder);
    if (folderKind(await this.folders(), target.folder) === "code") {
      if (!this.config.permissions.execute)
        throw new HcmError(
          "EXECUTE_DISABLED",
          `Папка ${target.folder} на этом сервере принимает удаление только кодом на сервере: нужно ещё право execute.`,
          permissionHint(this.config, "execute"),
        );
      const data = await this.server.runCode(
        codeDelete(target.url),
        call.outcome,
        (answer) => !!codeDeleteRefusal(answer),
      );
      const refusal = codeDeleteRefusal(data);
      if (refusal) throw refusal;
      if (data.result[0] === "remains") throw fileRemains();
      return { deleted: true, mutationOutcome: "confirmed" };
    }
    await this.server.call("native.lds.deleteUrl", { url: target.url }, call.outcome);
    // Адрес, который проверка существования не принимает (больше 256 символов), не проверяется.
    if (target.url.length <= FILE_EXISTS_URL_MAX_LENGTH)
      if ((await this.exists({ url: target.url })).exists) throw fileRemains();
    return { deleted: true, mutationOutcome: "confirmed" };
  }

  /** Сбой чтения сведений о приложении означает, что сервер не дал списков папок. */
  async folders(): Promise<FileFolders | undefined> {
    return fileFolders(await this.server.applicationInfo().catch(() => undefined));
  }
}
