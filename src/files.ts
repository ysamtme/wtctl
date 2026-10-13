import { HcmError } from "./errors.js";
import { freezeRegistry } from "./immutable.js";
import { prepareScript, type ScriptData } from "./scripts.js";

/** One absolute platform URL; this predicate does not read its contents. */
export interface FileExistsInput {
  readonly url: string;
}
export interface FileExistsData {
  /** A file, a directory or a configured storage address exists; contents and access are not checked. */
  readonly exists: boolean;
}

/** One address of a file on the server. */
export interface FileReadInput {
  readonly url: string;
  /** "base64" gives the bytes even when the file is text. */
  readonly encoding?: "base64";
}
export interface FileReadData {
  /** The contents when they are UTF-8 text; a leading byte order mark is removed. */
  readonly text?: string;
  /** The contents when they are not text, or when base64 was asked for. */
  readonly base64?: string;
  readonly bytes: number;
}

/** The loader answers with base64 broken into lines; a caller wants the file itself. */
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
    // Bytes below 0x20 are valid UTF-8, but a file made of them is not text.
    return /[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)
      ? binary
      : { text, bytes: content.length };
  } catch {
    return binary;
  }
}

export const FILE_EXISTS_TARGET = "tools.file_url_exists_server";
// The shipped provider attribute lookup binds its URL to a 256-character SQL
// parameter. Keep the input within that declared bound instead of allowing a
// longer URL to be silently truncated by this provider's parameter binding.
// It is not a claim about every server's maximum filesystem path length.
export const FILE_EXISTS_URL_MAX_LENGTH = 256;

/** Validate without normalizing the URL passed to the stock predicate. */
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
  // XML cannot carry lone surrogate code units; reject them before bootstrap.
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

/** Exactly one of text (written in UTF-8) and base64. */
export type FileWriteInput = {
  readonly url: string;
  readonly text?: string;
  readonly base64?: string;
};
export type FileWriteData = { readonly bytes: number; readonly mutationOutcome: "confirmed" };
export type FileDeleteInput = { readonly url: string };
export type FileDeleteData = { readonly deleted: true; readonly mutationOutcome: "confirmed" };

/** Folders of the server: data ones take files through LDS, code ones only code on the server. */
export type FileFolders = { readonly data: readonly string[]; readonly code: readonly string[] };
/** Only the two folder lists of the application info are read; undefined when the server gave none. */
export function fileFolders(info: Record<string, unknown> | undefined): FileFolders | undefined {
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

/** The folder is the first part of the address and decides the route: no part may get around it. */
export function fileTarget(value: unknown, listing = false): { url: string; folder: string } {
  // A folder to list may end with a slash and have no path: x-local://share.
  const text = listing && typeof value === "string" ? value.replace(/\/$/, "") : value;
  const [folder = "", ...path] = typeof text === "string" ? text.slice(10).split("/") : [];
  // The server takes % as a plain character; the encoded dot, slashes and control characters are
  // refused all the same, so that no reading of the address leaves the folder.
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

/** The route is chosen before anything is sent; "unlisted": the server did not say which folders take files. */
export function fileRoute(
  operation: "write" | "delete",
  folders: FileFolders | undefined,
  folder: string,
  canExecute: boolean,
): "data" | "code" | "unlisted" {
  if (!folders) return "unlisted";
  // The server compares the folder name exactly: SHARE is not share.
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

/** The bytes to write: text in UTF-8, or base64 without line breaks. */
export function fileWriteContent(args: Record<string, unknown>) {
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

/** Code for the server; a file that does not fit the script limit is refused with its size limits. */
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
export function codeWrite(url: string, content: { base64: string; text?: string }) {
  const text = content.text !== undefined;
  return fileScript(
    `PutUrlData(PARAMS.url, ${text ? "PARAMS.text" : "Base64Decode(PARAMS.base64)"});
RESULT = [UrlFileSize(PARAMS.url)];`,
    text ? { url, text: content.text! } : { url, base64: content.base64 },
  );
}
export function codeDelete(url: string) {
  return fileScript(
    `if (IsDirectory(PARAMS.url)) RESULT = ['directory'];
else if (!UrlExists(PARAMS.url)) RESULT = ['absent'];
else { DeleteUrl(PARAMS.url); RESULT = ['deleted']; }`,
    { url },
  );
}
/** The code found a folder or nothing at the address and deleted nothing. */
export function codeDeleteRefusal(data: ScriptData): HcmError | undefined {
  if (data.result[0] === "directory")
    return new HcmError("FILE_IS_FOLDER", "Адрес — папка: в папке кода удаляется только файл.");
  if (data.result[0] === "absent")
    return new HcmError("FILE_NOT_FOUND", "По адресу нет файла.", "Адрес проверяет files.exists.");
  return undefined;
}

export interface FileListData {
  /** By name; a file has its size in bytes, a folder has folder:true. */
  readonly items: readonly ({ name: string; bytes: number } | { name: string; folder: true })[];
  readonly total: number;
}
/** One level of a folder: the addresses ReadDirectory gives, which of them are folders, and the file sizes. */
export function codeList(url: string) {
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
export function fileList(data: ScriptData, folder: string, search = ""): FileListData {
  if (data.result[0] === "none")
    throw new HcmError(
      "FOLDER_NOT_FOUND",
      "По адресу нет папки.",
      "Список показывает только папку; файл читает files.read, адрес проверяет files.exists.",
    );
  const rows = (data.result as { u?: unknown; f?: unknown; b?: unknown }[]).map((row) => {
    // A row is an address one level inside the folder; anything else is not shown.
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

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}
function wrapper(value: unknown, child: string): unknown {
  const node = object(value);
  if (
    (node["#text"] !== undefined &&
      (typeof node["#text"] !== "string" || node["#text"].trim() !== "")) ||
    Object.keys(node).some((key) => {
      if (key === child || key === "#text") return false;
      return (
        !/^@_xmlns(?::[A-Za-z_][\w.-]*)?$/.test(key) ||
        typeof node[key] !== "string" ||
        node[key].length > 1024
      );
    })
  )
    throw new Error();
  return node[child];
}

/** Decode only the fixed stock predicate's direct ResultData/Result boolean. */
export function parseFileExists(response: unknown): FileExistsData {
  try {
    const rpc = object(response);
    if (
      Object.keys(rpc).some((key) => !["xml", "valueType", "lexicalValue"].includes(key)) ||
      typeof rpc.valueType !== "string" ||
      rpc.valueType.toLowerCase() !== "bool"
    )
      throw new Error();
    const result = object(wrapper(wrapper(rpc.xml, "ResultData"), "Result"));
    if (
      Object.keys(result).some((key) => !["@_VALUE-TYPE", "#text"].includes(key)) ||
      typeof result["@_VALUE-TYPE"] !== "string" ||
      result["@_VALUE-TYPE"].toLowerCase() !== "bool" ||
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
