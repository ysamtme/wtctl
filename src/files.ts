import { HcmError, requiredString } from "./errors.js";
import { freezeRegistry } from "./immutable.js";
import type { HcmServer } from "./hcm-server.js";
import type { WriteOutcome } from "./write-outcome.js";
import { prepareScript, type ScriptData } from "./scripts.js";
import { exactKeys, isType, rpcArgument, strictResponse } from "./server-value.js";

/** Один абсолютный URL платформы; предикат не читает содержимое. */
export interface FileExistsInput {
  readonly url: string;
}
export interface FileExistsData {
  /** Существует файл, папка или адрес хранилища из настроек; содержимое и доступ не проверяются. */
  readonly exists: boolean;
}

/** Один адрес файла на сервере. */
export interface FileReadInput {
  readonly url: string;
  /** "base64" отдаёт байты, даже если файл текстовый. */
  readonly encoding?: "base64";
}
export interface FileReadData {
  /** Содержимое, если это текст UTF-8; метка порядка байтов в начале убирается. */
  readonly text?: string;
  /** Содержимое, если это не текст или запрошен base64. */
  readonly base64?: string;
  readonly bytes: number;
}

/** Загрузчик отвечает base64, разбитым на строки; вызывающему нужен сам файл. */
export function fileContent(response: unknown, encoding?: unknown): FileReadData {
  if (encoding !== undefined && encoding !== "base64")
    throw new HcmError(
      "INVALID_ARGUMENT",
      'encoding: допустимо только "base64".',
      "Без encoding текст в UTF-8 приходит в text, остальное — в base64.",
    );
  const data =
    response !== null && typeof response === "object"
      ? (response as Record<string, unknown>).Data
      : undefined;
  if (typeof data !== "string" || /[^A-Za-z0-9+/=\s]/.test(data))
    throw new HcmError("FILE_READ_RESPONSE", "Сервер вернул файл в неожиданном виде.");
  const content = Buffer.from(data.replace(/\s+/g, ""), "base64");
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

/** Ровно одно из text (запись в UTF-8) и base64. */
export type FileWriteInput = {
  readonly url: string;
  readonly text?: string;
  readonly base64?: string;
};
export type FileWriteData = { readonly bytes: number; readonly mutationOutcome: "confirmed" };
export type FileDeleteInput = { readonly url: string };
export type FileDeleteData = { readonly deleted: true; readonly mutationOutcome: "confirmed" };

/** Папки сервера: в папки данных файлы идут через LDS, в папки кода — только код на сервере. */
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

/** Маршрут выбирается до отправки; "unlisted" — сервер не сообщил, какие папки принимают файлы. */
function fileRoute(
  operation: "write" | "delete",
  folders: FileFolders | undefined,
  folder: string,
  canExecute: boolean,
): "data" | "code" | "unlisted" {
  if (!folders) return "unlisted";
  // Сервер сравнивает имя папки точно: SHARE — не share.
  if (folders.data.includes(folder)) return "data";
  if (!folders.code.includes(folder))
    throw new HcmError(
      "FOLDER_NOT_WRITABLE",
      `Папка ${folder} не принимает файлы.`,
      `Папки данных: ${folders.data.join(", ")}. Папки кода (нужны права write и execute): ${folders.code.join(", ")}.`,
    );
  if (!canExecute)
    throw new HcmError(
      "EXECUTE_DISABLED",
      `Папка ${folder} на этом сервере принимает ${operation === "write" ? "запись" : "удаление"} только кодом на сервере: нужно ещё право execute.`,
      "Право execute включает владелец подключения в настройках подключения (permissions.execute).",
    );
  return "code";
}

/** Байты для записи: текст в UTF-8 или base64 без переносов строк. */
function fileWriteContent(args: Record<string, unknown>) {
  const { text, base64 } = args;
  const bytes =
    typeof text === "string" && !/\p{Cs}/u.test(text)
      ? Buffer.from(text)
      : typeof base64 === "string"
        ? Buffer.from(base64, "base64")
        : undefined;
  if (
    (text === undefined) === (base64 === undefined) ||
    !bytes ||
    (text === undefined && bytes.toString("base64") !== base64)
  )
    throw new HcmError(
      "INVALID_ARGUMENT",
      "Нужно ровно одно из text (без непарных суррогатов) и base64 (без переводов строк).",
    );
  return {
    ...(typeof text === "string" ? { text } : {}),
    base64: bytes.toString("base64"),
    bytes: bytes.length,
  };
}

/** Код для сервера; файл, не умещающийся в лимит скрипта, отклоняется с указанием размеров. */
function fileScript(code: string, params: Record<string, string>) {
  try {
    return prepareScript(code, params);
  } catch (error) {
    if (!(error instanceof HcmError) || error.code !== "SCRIPT_TOO_LARGE") throw error;
    throw new HcmError(
      "FILE_TOO_LARGE",
      "Файл не помещается в код для сервера.",
      "В папку кода файл записывает код на сервере: текст — до 750 КБ (меньше, если в нём много переводов строк), двоичные данные — до 580 КБ.",
    );
  }
}
function codeWrite(url: string, content: { base64: string; text?: string }) {
  const text = content.text !== undefined;
  return fileScript(
    `PutUrlData(PARAMS.url, ${text ? "PARAMS.text" : "Base64Decode(PARAMS.base64)"});
RESULT = [UrlFileSize(PARAMS.url)];`,
    text ? { url, text: content.text! } : { url, base64: content.base64 },
  );
}
function codeDelete(url: string) {
  return fileScript(
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
    undefined,
    "indeterminate",
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

export interface FileListData {
  /** По имени; у файла указан размер в байтах, у папки folder:true. */
  readonly items: readonly ({ name: string; bytes: number } | { name: string; folder: true })[];
  readonly total: number;
}
/** Один уровень папки: адреса из ReadDirectory, какие из них папки, и размеры файлов. */
function codeList(url: string) {
  return fileScript(
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

/** Что операция сообщает runtime об одном вызове: из этого строятся исход и подсказка при сбое. */
export interface FileCall {
  outcome: WriteOutcome;
  causeRuledOut?: true;
}

/** Файловые операции: метод — вся цепочка одной, от проверки адреса до проверки после ответа. */
export class ServerFiles {
  constructor(
    private readonly server: Pick<HcmServer, "call" | "read" | "runCode" | "applicationInfo">,
    private readonly permissions: { readonly execute: boolean },
  ) {}

  async exists(args: Record<string, unknown>): Promise<FileExistsData> {
    return parseFileExists(
      await this.server.read("native.rpc.call", {
        target: FILE_EXISTS_TARGET,
        args: [rpcArgument(fileExistsUrl(args.url))],
      }),
    );
  }

  async read(args: Record<string, unknown>): Promise<FileReadData> {
    return fileContent(
      await this.server.call("native.lds.loadUrl", { url: requiredString(args.url, "url") }),
      args.encoding,
    );
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

  async write(args: Record<string, unknown>, call: FileCall): Promise<FileWriteData> {
    const target = fileTarget(args.url);
    const content = fileWriteContent(args);
    if ((await this.route("write", target.folder, call)) === "code") {
      const data = await this.server.runCode(codeWrite(target.url, content), call.outcome);
      return { bytes: Number(data.result[0]), mutationOutcome: "confirmed" };
    }
    await this.server.call(
      "native.lds.putUrl",
      { url: target.url, data: { base64: content.base64 } },
      call.outcome,
    );
    return { bytes: content.bytes, mutationOutcome: "confirmed" };
  }

  async delete(args: Record<string, unknown>, call: FileCall): Promise<FileDeleteData> {
    const target = fileTarget(args.url);
    assertFileDeletable(target.folder);
    if ((await this.route("delete", target.folder, call)) === "code") {
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

  private async route(operation: "write" | "delete", folder: string, call: FileCall) {
    const route = fileRoute(operation, await this.folders(), folder, this.permissions.execute);
    // Обычная причина отказа записи (папка кода не в списке) называется, только если списков нет.
    if (operation === "write" && route !== "unlisted") call.causeRuledOut = true;
    return route;
  }
}
