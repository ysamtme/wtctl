import { HcmError } from "./errors.js";
import { freezeRegistry } from "./immutable.js";

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
    throw new HcmError(
      "FILE_READ_RESPONSE",
      "Сервер вернул файл в неожиданном виде.",
      "Прочитать его можно операцией native.lds.loadUrl.",
    );
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
