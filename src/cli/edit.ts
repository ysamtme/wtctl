import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectionConfig, OperationResult } from "../contracts.js";
import { XmlDocument, sameData } from "../documents.js";
import { HcmError } from "../errors.js";
import { ArgumentError } from "../protocol/error.js";
import {
  parsePhysicalDocumentId,
  resolvePhysicalDocumentLocation,
} from "../protocol/physical-documents.js";
import { rawXmlElement, unwrapLoadDocSoapXml } from "../protocol/xml.js";
import { withoutFalseOffset } from "../query.js";
import {
  CliInputError,
  exactPositionals,
  listOption,
  requirePositional,
  stringOption,
  type CliArguments,
} from "./arguments.js";
import { objectTarget } from "./commands.js";
import { renderLineDiff } from "./diff.js";
import type { Styler } from "./format/ansi.js";
import { extractDocXml, renderObjectPatch } from "./format/human.js";
import {
  assertFormatSupported,
  createStyler,
  formatBytes,
  resolveColor,
  type OutputMode,
} from "./format/index.js";
import { sanitizeTerminalText } from "./interactive.js";
import { failure, frontendResult, readStoredJson, safeDiagnostic } from "./output.js";
import type { ProgressIndicator } from "./progress.js";
import type { CliIo, RuntimePort } from "./types.js";

const LARGE_FILE_WRITE_THRESHOLD_BYTES = 512 * 1024;
const WINDOWS_RESERVED_NAME_RE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
const VALID_PATCH_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_:-]*$/;
const PATCH_ID_KEY_RE = /^(?:0x[0-9a-f]{1,16}|[1-9]\d{0,19})$/i;
const MAX_TEMP_FILENAME_CHARS = 80;
const MAX_TEMP_EXTENSION_CHARS = 16;

export type EditPlan =
  | {
      readonly kind: "files";
      readonly url: string;
      readonly editor?: string;
    }
  | {
      readonly kind: "object";
      readonly target: Record<string, unknown>;
      readonly fields?: readonly string[];
      readonly xml: boolean;
      readonly editor?: string;
    };

export type EditOutcome =
  | { readonly handled: true; readonly exitCode: number }
  | {
      readonly handled: false;
      readonly result: OperationResult;
      readonly requestArgs?: Readonly<Record<string, unknown>>;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function setOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Строит безопасное имя временного файла с сохранением расширения и без символов обхода пути. */
export function safeTempFileName(raw: string, fallback = "file.txt"): string {
  const withoutQuery = raw.split(/[?#]/, 1)[0] ?? "";
  const slashIndex = Math.max(withoutQuery.lastIndexOf("/"), withoutQuery.lastIndexOf("\\"));
  const segment = slashIndex >= 0 ? withoutQuery.slice(slashIndex + 1) : withoutQuery;
  let cleaned = segment
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+/, "")
    .replace(/\.+$/, "");

  if (!cleaned) return fallback;
  if (WINDOWS_RESERVED_NAME_RE.test(cleaned)) cleaned = `edit_${cleaned}`;
  if (cleaned.length <= MAX_TEMP_FILENAME_CHARS) return cleaned;

  const dot = cleaned.lastIndexOf(".");
  if (dot > 0 && cleaned.length - dot <= MAX_TEMP_EXTENSION_CHARS) {
    const ext = cleaned.slice(dot);
    return `${cleaned.slice(0, MAX_TEMP_FILENAME_CHARS - ext.length)}${ext}`;
  }
  return cleaned.slice(0, MAX_TEMP_FILENAME_CHARS);
}

function assertSafePatchSegment(key: string, fullPath: string): void {
  if (!VALID_PATCH_SEGMENT_RE.test(key)) {
    throw new HcmError(
      "UNSUPPORTED_PATCH_KEY",
      `Поле «${sanitizeTerminalText(fullPath)}» нельзя безопасно изменить в JSON-режиме из-за имени элемента.`,
      "Отредактировать документ в режиме --xml.",
    );
  }
}

/** Рекурсивно проверяет, что внутри добавляемой структуры нет ключей, недопустимых для XML-путей. */
function assertSafePatchValue(value: unknown, basePath: string): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertSafePatchValue(value[i], `${basePath}[${i}]`);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      const childPath = basePath ? `${basePath}.${key}` : key;
      assertSafePatchSegment(key, childPath);
      assertSafePatchValue(value[key], childPath);
    }
  }
}

function keysCouldCollide(left: string, right: string): boolean {
  if (left === right) return true;
  if (withoutFalseOffset(left) === withoutFalseOffset(right)) return true;
  if (PATCH_ID_KEY_RE.test(left) && PATCH_ID_KEY_RE.test(right)) {
    try {
      return BigInt(left) === BigInt(right);
    } catch {
      return false;
    }
  }
  return false;
}

function fieldValueCouldCollide(otherValue: unknown, keyValue: string): boolean {
  if (Array.isArray(otherValue)) {
    return otherValue.some((entry) => fieldValueCouldCollide(entry, keyValue));
  }
  if (otherValue === null || otherValue === undefined) return false;
  return keysCouldCollide(String(otherValue), keyValue);
}

function findUniqueAppendKey(
  item: unknown,
  existing: readonly unknown[],
): readonly [key: string, value: string] | undefined {
  if (!isPlainObject(item)) return undefined;
  for (const key of Object.keys(item)) {
    if (!VALID_PATCH_SEGMENT_RE.test(key)) continue;
    const raw = item[key];
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") continue;
    if (
      typeof raw === "number" &&
      (!Number.isFinite(raw) || (Number.isInteger(raw) && !Number.isSafeInteger(raw)))
    ) {
      continue;
    }
    const strVal = String(raw);
    if (strVal === "" || /[\]\u0000-\u001f]/.test(strVal)) continue;
    const collides = existing.some(
      (other) =>
        isPlainObject(other) &&
        Object.hasOwn(other, key) &&
        fieldValueCouldCollide(other[key], strVal),
    );
    if (!collides) return [key, strVal];
  }
  return undefined;
}

function diffRepeatedArray(
  bVal: readonly unknown[],
  aVal: unknown,
  path: string,
  patch: Record<string, unknown>,
  remove: string[],
): void {
  const n = bVal.length;
  if (n === 0) {
    if (Array.isArray(aVal) && aVal.length === 0) return;
    assertSafePatchValue(aVal, path);
    setOwnProperty(patch, path, aVal);
    return;
  }

  // Преобразование массива в пустой список эквивалентно удалению всех повторяющихся элементов.
  if (Array.isArray(aVal) && aVal.length === 0) {
    if (n === 1) {
      remove.push(path);
    } else {
      for (let i = n - 1; i >= 0; i--) remove.push(`${path}[${i}]`);
    }
    return;
  }

  // Массив заменён одиночным значением (не массивом).
  if (!Array.isArray(aVal)) {
    assertSafePatchValue(aVal, path);
    if (n === 1) {
      setOwnProperty(patch, path, aVal);
    } else {
      setOwnProperty(patch, `${path}[0]`, aVal);
      for (let i = n - 1; i >= 1; i--) remove.push(`${path}[${i}]`);
    }
    return;
  }

  const m = aVal.length;
  if (m === n) {
    for (let i = 0; i < n; i++) {
      if (sameData(bVal[i], aVal[i])) continue;
      const elemPath = `${path}[${i}]`;
      if (isPlainObject(bVal[i]) && isPlainObject(aVal[i])) {
        walkObjectDiff(
          bVal[i] as Record<string, unknown>,
          aVal[i] as Record<string, unknown>,
          elemPath,
          patch,
          remove,
        );
      } else {
        assertSafePatchValue(aVal[i], elemPath);
        setOwnProperty(patch, elemPath, aVal[i]);
      }
    }
    return;
  }

  if (m > n) {
    // Обновляем существующие элементы на месте (сохраняя их атрибуты и комментарии).
    for (let i = 0; i < n; i++) {
      if (sameData(bVal[i], aVal[i])) continue;
      const elemPath = `${path}[${i}]`;
      if (isPlainObject(bVal[i]) && isPlainObject(aVal[i])) {
        walkObjectDiff(
          bVal[i] as Record<string, unknown>,
          aVal[i] as Record<string, unknown>,
          elemPath,
          patch,
          remove,
        );
      } else {
        assertSafePatchValue(aVal[i], elemPath);
        setOwnProperty(patch, elemPath, aVal[i]);
      }
    }
    // Новые элементы добавляем только по уникальному ключу [key=value], учитывая и исходные, и обновлённые элементы.
    const seen: unknown[] = [...bVal, ...aVal.slice(0, n)];
    for (let k = n; k < m; k++) {
      const added = aVal[k];
      assertSafePatchValue(added, `${path}[${k}]`);
      const uniqueKey = findUniqueAppendKey(added, seen);
      if (!uniqueKey) {
        throw new HcmError(
          "UNSUPPORTED_LIST_APPEND",
          `Добавление элемента без уникального ключевого поля в список «${sanitizeTerminalText(path)}» в JSON-режиме может удалить атрибуты и комментарии существующих элементов.`,
          "Отредактировать документ в режиме --xml.",
        );
      }
      const [keyField, keyValue] = uniqueKey;
      setOwnProperty(patch, `${path}[${keyField}=${keyValue}]`, added);
      seen.push(added);
    }
    return;
  }

  // 0 < m < n: сначала обновляем оставшиеся индексы 0..m-1, затем удаляем хвост с конца n-1..m.
  for (let i = 0; i < m; i++) {
    if (sameData(bVal[i], aVal[i])) continue;
    const elemPath = `${path}[${i}]`;
    if (isPlainObject(bVal[i]) && isPlainObject(aVal[i])) {
      walkObjectDiff(
        bVal[i] as Record<string, unknown>,
        aVal[i] as Record<string, unknown>,
        elemPath,
        patch,
        remove,
      );
    } else {
      assertSafePatchValue(aVal[i], elemPath);
      setOwnProperty(patch, elemPath, aVal[i]);
    }
  }
  for (let i = n - 1; i >= m; i--) {
    remove.push(`${path}[${i}]`);
  }
}

function walkObjectDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix: string,
  patch: Record<string, unknown>,
  remove: string[],
): void {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  for (const key of keys) {
    const hasBefore = Object.hasOwn(before, key);
    const hasAfter = Object.hasOwn(after, key);
    const path = prefix ? `${prefix}.${key}` : key;

    if (hasBefore && !hasAfter) {
      assertSafePatchSegment(key, path);
      const bVal = before[key];
      if (Array.isArray(bVal) && bVal.length > 1) {
        for (let i = bVal.length - 1; i >= 0; i--) remove.push(`${path}[${i}]`);
      } else {
        remove.push(path);
      }
      continue;
    }

    if (!hasBefore && hasAfter) {
      assertSafePatchSegment(key, path);
      assertSafePatchValue(after[key], path);
      setOwnProperty(patch, path, after[key]);
      continue;
    }

    const bVal = before[key];
    const aVal = after[key];
    if (sameData(bVal, aVal)) continue;

    assertSafePatchSegment(key, path);
    if (Array.isArray(bVal)) {
      diffRepeatedArray(bVal, aVal, path, patch, remove);
    } else if (Array.isArray(aVal)) {
      diffRepeatedArray([bVal], aVal, path, patch, remove);
    } else if (isPlainObject(bVal) && isPlainObject(aVal)) {
      walkObjectDiff(bVal, aVal, path, patch, remove);
    } else {
      assertSafePatchValue(aVal, path);
      setOwnProperty(patch, path, aVal);
    }
  }
}

/** Вычисляет минимальный набор { patch, remove } для objects.patch по двум снимкам полей объекта. */
export function diffObjectFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { readonly patch: Record<string, unknown>; readonly remove: string[] } {
  const patch: Record<string, unknown> = {};
  const remove: string[] = [];
  walkObjectDiff(before, after, "", patch, remove);
  return { patch, remove };
}

function assertCanConfirmOrYes(args: CliArguments, io: CliIo): void {
  if (args.options.yes === true || typeof io.confirm === "function") return;
  throw new HcmError(
    "CONFIRMATION_REQUIRED",
    "Редактирование требует интерактивного подтверждения или флага -y / --yes.",
    "Запустить в интерактивном терминале либо передать -y / --yes.",
  );
}

/** Проверяет аргументы `files edit` и `object edit` до загрузки настроек и открытия сессии. */
export function planEditCommand(args: CliArguments, outputMode: OutputMode, io: CliIo): EditPlan {
  const [command] = args.positionals;
  const editor = stringOption(args, "editor");
  if (editor !== undefined && !editor.trim()) {
    throw new CliInputError("--editor не может быть пустым.");
  }

  if (command === "files") {
    if (stringOption(args, "output") !== undefined) {
      throw new CliInputError(
        "wtctl files edit не принимает --output: команда редактирует файл на сервере.",
      );
    }
    exactPositionals(args, 3);
    const url = requirePositional(args, 2, "адрес файла на сервере");
    if (!url.trim()) throw new CliInputError("Адрес файла не может быть пустым.");
    assertFormatSupported("files.write", outputMode.format, undefined, "wtctl files edit");
    if (typeof io.launchEditor !== "function") {
      throw new HcmError(
        "EDITOR_UNAVAILABLE",
        "Запуск внешнего редактора недоступен в этом окружении.",
      );
    }
    assertCanConfirmOrYes(args, io);
    return { kind: "files", url, ...(editor === undefined ? {} : { editor }) };
  }

  if (stringOption(args, "output") !== undefined) {
    throw new CliInputError(
      "wtctl object edit не принимает --output: команда редактирует объект на сервере.",
    );
  }
  const xml = args.options.xml === true;
  const hasFieldsFlag = args.options.fields !== undefined;
  const fields = listOption(args, "fields");
  if (xml && hasFieldsFlag) {
    throw new CliInputError(
      "--xml и --fields вместе не задаются: с --xml редактируется весь XML документа.",
    );
  }
  const target = objectTarget(args);
  if (typeof target.id === "string") {
    try {
      resolvePhysicalDocumentLocation(
        target.id,
        typeof target.dbName === "string" ? target.dbName : undefined,
      );
    } catch (error) {
      if (error instanceof ArgumentError) {
        throw new CliInputError(error.message, "Объект задают [ТИП] ID, --id ID или --url АДРЕС.");
      }
      throw error;
    }
  }
  assertFormatSupported(
    xml ? "native.lds.putDoc" : "objects.patch",
    outputMode.format,
    undefined,
    "wtctl object edit",
  );
  if (typeof io.launchEditor !== "function") {
    throw new HcmError(
      "EDITOR_UNAVAILABLE",
      "Запуск внешнего редактора недоступен в этом окружении.",
    );
  }
  assertCanConfirmOrYes(args, io);
  return {
    kind: "object",
    target,
    xml,
    ...(fields === undefined ? {} : { fields }),
    ...(editor === undefined ? {} : { editor }),
  };
}

function sanitizePreviewValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeTerminalText(value);
  if (Array.isArray(value)) return value.map(sanitizePreviewValue);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      setOwnProperty(out, sanitizeTerminalText(key), sanitizePreviewValue(item));
    }
    return out;
  }
  return value;
}

async function confirmEditSave(io: CliIo, args: CliArguments, question: string): Promise<boolean> {
  if (args.options.yes === true) return true;
  if (typeof io.confirm !== "function") {
    throw new HcmError(
      "CONFIRMATION_REQUIRED",
      "Невозможно запросить подтверждение без интерактивного терминала; изменения не сохранены.",
      "Передать -y / --yes, чтобы сохранить изменения без вопроса.",
    );
  }
  const confirmed = await io.confirm(question);
  if (!confirmed) {
    await io.writeError("Отменено.\n");
    return false;
  }
  return true;
}

function renderConnectionHeader(
  config: Pick<ConnectionConfig, "name" | "baseUrl">,
  targetLabel: string,
  targetValue: string,
  styler: Styler,
): string {
  const conn = `${styler.bold(sanitizeTerminalText(config.name))} (${sanitizeTerminalText(config.baseUrl)})`;
  const width = Math.max("Подключение".length, targetLabel.length) + 1;
  return [
    `${styler.dim("Подключение:".padEnd(width))}  ${conn}`,
    `${styler.dim(`${targetLabel}:`.padEnd(width))}  ${styler.bold(sanitizeTerminalText(targetValue))}`,
  ].join("\n");
}

function shouldRedirectEditorStdout(io: CliIo, outputMode: OutputMode): boolean {
  return (
    outputMode.format === "json" ||
    outputMode.requested === "json" ||
    outputMode.format === "jsonl" ||
    outputMode.format === "raw" ||
    io.stdoutIsTTY !== true
  );
}

async function withEditedTempFile<T>(
  fileName: string,
  initialContent: string,
  editor: string | undefined,
  io: CliIo,
  outputMode: OutputMode,
  progress: ProgressIndicator,
  closeRuntimeOnce: () => Promise<{
    readonly failed: boolean;
    readonly diagnostic?: OperationResult;
  }>,
  onEdited: (editedText: string, tempDir: string) => Promise<T>,
): Promise<T | { readonly handled: true; readonly exitCode: 1 }> {
  const tempDir = await mkdtemp(join(tmpdir(), "wtctl-edit-"));
  const tempPath = join(tempDir, fileName);
  try {
    await writeFile(tempPath, initialContent, { encoding: "utf8", mode: 0o600 });
    await progress.stop();

    const redirectStdoutToStderr = shouldRedirectEditorStdout(io, outputMode);
    const exitCode = await io.launchEditor!(
      editor,
      tempPath,
      redirectStdoutToStderr ? { redirectStdoutToStderr: true } : undefined,
    );
    if (exitCode !== 0) {
      await safeDiagnostic(
        io,
        failure(
          "EDITOR_EXITED",
          `Редактор завершился с кодом ${exitCode}; изменения не сохранены.`,
        ),
        outputMode.humanErrors ? "human" : "json",
      );
      await closeRuntimeOnce();
      return { handled: true, exitCode: 1 };
    }

    let rawBytes: Buffer;
    try {
      rawBytes = await readFile(tempPath);
    } catch {
      throw new HcmError(
        "EDITOR_FAILED",
        "Временный файл после редактирования не найден или не читается; изменения не сохранены.",
      );
    }
    let editedText: string;
    try {
      // ignoreBOM: true сохраняет ведущий UTF-8 BOM в файлах, где он был исходно.
      editedText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBytes);
    } catch {
      throw new HcmError(
        "INVALID_UTF8",
        "Отредактированный файл содержит некорректные байты UTF-8; изменения не сохранены.",
      );
    }

    return await onEdited(editedText, tempDir);
  } finally {
    await cleanupTempDir(tempDir, io);
  }
}

function binaryFileError(): HcmError {
  return new HcmError(
    "CLI_BINARY_FILE",
    "Двоичный файл нельзя редактировать в текстовом редакторе.",
    "Сохранить на диск: wtctl files read АДРЕС --to ФАЙЛ.",
  );
}

/**
 * Проверяет потоковый файл на корректный UTF-8 (и опционально на отсутствие управляющих байтов),
 * считая SHA-256 и размер в O(1) памяти; текст накапливается только до retainUpToBytes.
 */
async function validateAndHashTextFile(
  filePath: string,
  retainUpToBytes: number,
  checkControlBytes: boolean,
): Promise<{ readonly text?: string; readonly hash: string; readonly bytes: number }> {
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const parts: string[] = [];
  let retain = retainUpToBytes > 0;
  let bytes = 0;
  const decodeFailure = (): HcmError =>
    checkControlBytes
      ? binaryFileError()
      : new HcmError(
          "INVALID_UTF8",
          "Отредактированный файл содержит некорректные байты UTF-8; изменения не сохранены.",
        );
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buf.length;
      hash.update(buf);
      let piece: string;
      try {
        piece = decoder.decode(buf, { stream: true });
      } catch {
        throw decodeFailure();
      }
      if (checkControlBytes && /[\u0000-\u0008\u000b\u000e-\u001f]/.test(piece)) {
        throw binaryFileError();
      }
      if (retain) {
        if (bytes > retainUpToBytes) {
          retain = false;
          parts.length = 0;
        } else {
          parts.push(piece);
        }
      }
    }
    let tail: string;
    try {
      tail = decoder.decode();
    } catch {
      throw decodeFailure();
    }
    if (checkControlBytes && /[\u0000-\u0008\u000b\u000e-\u001f]/.test(tail)) {
      throw binaryFileError();
    }
    if (retain && tail) parts.push(tail);
  } finally {
    stream.destroy();
  }
  return {
    ...(retain ? { text: parts.join("") } : {}),
    hash: hash.digest("hex"),
    bytes,
  };
}

/** Считает SHA-256 локального файла потоково (O(1) памяти). */
async function hashLocalFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  try {
    for await (const chunk of stream) {
      hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } finally {
    stream.destroy();
  }
  return hash.digest("hex");
}

function decodeTextBytes(bytes: Uint8Array): {
  readonly text: string;
  readonly hash: string;
  readonly bytes: number;
} {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw binaryFileError();
  }
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(decoded)) throw binaryFileError();
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { text: decoded, hash, bytes: bytes.length };
}

async function readTextFileToDisk(
  runtime: RuntimePort,
  url: string,
  targetPath: string,
): Promise<
  | {
      readonly ok: true;
      readonly text?: string;
      readonly hash: string;
      readonly bytes: number;
      readonly writtenToDisk: boolean;
    }
  | { readonly ok: false; readonly result: OperationResult }
> {
  // Потоковая запись прямо на диск: сохраняет точные байты (включая UTF-8 BOM) и не держит большие файлы в куче.
  const readRes = await runtime.call("files.read", { url, file: targetPath, overwrite: true });
  if (!readRes.ok) return { ok: false, result: readRes };

  const readData =
    readRes.meta.truncated === true ? await readStoredJson(runtime, readRes) : readRes.data;
  if (!isRecord(readData)) throw binaryFileError();

  if (typeof readData.file === "string" && readData.file) {
    const { text, hash, bytes } = await validateAndHashTextFile(
      readData.file,
      LARGE_FILE_WRITE_THRESHOLD_BYTES,
      true,
    );
    if (readData.file !== targetPath) {
      await copyFile(readData.file, targetPath);
    }
    return {
      ok: true,
      ...(text === undefined ? {} : { text }),
      hash,
      bytes,
      writtenToDisk: true,
    };
  }
  if (typeof readData.base64 === "string") {
    const raw = Buffer.from(readData.base64, "base64");
    const { text, hash, bytes } = decodeTextBytes(raw);
    return { ok: true, text, hash, bytes, writtenToDisk: false };
  }
  if (readData.encoding === "base64" || typeof readData.text !== "string") {
    throw binaryFileError();
  }
  const text = readData.text;
  return {
    ok: true,
    text,
    hash: sha256Text(text),
    bytes: Buffer.byteLength(text, "utf8"),
    writtenToDisk: false,
  };
}

async function readCurrentServerFileHash(
  runtime: RuntimePort,
  url: string,
  scratchPath: string,
): Promise<{ readonly ok: true; readonly hash: string } | { readonly ok: false }> {
  try {
    const readRes = await runtime.call("files.read", { url, file: scratchPath, overwrite: true });
    if (!readRes.ok) return { ok: false };
    const readData =
      readRes.meta.truncated === true ? await readStoredJson(runtime, readRes) : readRes.data;
    if (!isRecord(readData)) return { ok: false };
    if (typeof readData.file === "string" && readData.file) {
      return { ok: true, hash: await hashLocalFile(readData.file) };
    }
    if (typeof readData.base64 === "string") {
      const bytes = Buffer.from(readData.base64, "base64");
      return { ok: true, hash: createHash("sha256").update(bytes).digest("hex") };
    }
    if (typeof readData.text === "string") {
      return { ok: true, hash: sha256Text(readData.text) };
    }
    return { ok: false };
  } finally {
    await unlink(scratchPath).catch(() => undefined);
  }
}

async function cleanupTempDir(tempDir: string, io: CliIo): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    try {
      await io.writeError(
        `Предупреждение: не удалось удалить временную папку ${sanitizeTerminalText(tempDir)}.\n`,
      );
    } catch {
      /* Предупреждение об уборке не должно скрывать результат серверной операции. */
    }
  }
}

async function runFilesEdit(
  plan: Extract<EditPlan, { kind: "files" }>,
  args: CliArguments,
  config: Pick<ConnectionConfig, "name" | "baseUrl">,
  io: CliIo,
  runtime: RuntimePort,
  outputMode: OutputMode,
  progress: ProgressIndicator,
  closeRuntimeOnce: () => Promise<{
    readonly failed: boolean;
    readonly diagnostic?: OperationResult;
  }>,
): Promise<EditOutcome> {
  const fileName = safeTempFileName(plan.url, "file.txt");
  const tempDir = await mkdtemp(join(tmpdir(), "wtctl-edit-"));
  const tempPath = join(tempDir, fileName);
  try {
    progress.update("Чтение файла…");
    const initial = await readTextFileToDisk(runtime, plan.url, tempPath);
    if (!initial.ok) return { handled: false, result: initial.result };

    const originalText = initial.text;
    const originalHash = initial.hash;
    const originalBytes = initial.bytes;
    if (!initial.writtenToDisk) {
      await writeFile(tempPath, originalText ?? "", { encoding: "utf8", mode: 0o600 });
    }

    await progress.stop();
    const redirectStdoutToStderr = shouldRedirectEditorStdout(io, outputMode);
    const exitCode = await io.launchEditor!(
      plan.editor,
      tempPath,
      redirectStdoutToStderr ? { redirectStdoutToStderr: true } : undefined,
    );
    if (exitCode !== 0) {
      await safeDiagnostic(
        io,
        failure(
          "EDITOR_EXITED",
          `Редактор завершился с кодом ${exitCode}; изменения не сохранены.`,
        ),
        outputMode.humanErrors ? "human" : "json",
      );
      await closeRuntimeOnce();
      return { handled: true, exitCode: 1 };
    }

    let editedStatSize: number;
    try {
      editedStatSize = (await stat(tempPath)).size;
    } catch {
      throw new HcmError(
        "EDITOR_FAILED",
        "Временный файл после редактирования не найден или не читается; изменения не сохранены.",
      );
    }

    const useStreamingSnapshot =
      editedStatSize > LARGE_FILE_WRITE_THRESHOLD_BYTES || originalText === undefined;

    let editedText: string | undefined;
    let snapshotPath: string | undefined;
    let editedBytes: number;
    if (useStreamingSnapshot) {
      // Фиксируем снимок файла до проверки и подтверждения, чтобы подмена во время confirm не попала в запись.
      snapshotPath = join(tempDir, ".verified-upload.tmp");
      try {
        await copyFile(tempPath, snapshotPath);
      } catch {
        throw new HcmError(
          "EDITOR_FAILED",
          "Временный файл после редактирования не найден или не читается; изменения не сохранены.",
        );
      }
      const checked = await validateAndHashTextFile(snapshotPath, 0, false);
      editedBytes = checked.bytes;
      if (checked.hash === originalHash) {
        return {
          handled: false,
          result: frontendResult("cli.files.edit", config.name, {
            url: plan.url,
            changed: false,
          }),
        };
      }
    } else {
      let rawBytes: Buffer;
      try {
        rawBytes = await readFile(tempPath);
      } catch {
        throw new HcmError(
          "EDITOR_FAILED",
          "Временный файл после редактирования не найден или не читается; изменения не сохранены.",
        );
      }
      try {
        editedText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBytes);
      } catch {
        throw new HcmError(
          "INVALID_UTF8",
          "Отредактированный файл содержит некорректные байты UTF-8; изменения не сохранены.",
        );
      }
      editedBytes = rawBytes.length;
      if (editedText === originalText) {
        return {
          handled: false,
          result: frontendResult("cli.files.edit", config.name, {
            url: plan.url,
            changed: false,
          }),
        };
      }
    }

    const styler = createStyler(resolveColor(io, "stderr"));
    const header = renderConnectionHeader(config, "Файл", plan.url, styler);
    const diff =
      originalText !== undefined && editedText !== undefined
        ? renderLineDiff(originalText, editedText, styler)
        : `Файл изменён (размер: ${formatBytes(originalBytes)} → ${formatBytes(editedBytes)}; построчный diff пропущен для файлов больше 512 КиБ).\n`;
    await io.writeError(`${header}\n\n${diff}`);

    const confirmed = await confirmEditSave(io, args, "Сохранить изменения на сервер? [y/N] ");
    if (!confirmed) {
      await closeRuntimeOnce();
      return { handled: true, exitCode: 1 };
    }

    progress.start("Проверка изменений на сервере…");
    const current = await readCurrentServerFileHash(
      runtime,
      plan.url,
      join(tempDir, ".server-current.tmp"),
    );
    if (!current.ok) {
      throw new HcmError(
        "FILE_CHANGED",
        "Не удалось перечитать файл перед записью: возможно, файл был удалён или изменён на сервере.",
        "Проверить актуальное состояние файла и повторить редактирование.",
      );
    }
    if (current.hash !== originalHash) {
      throw new HcmError(
        "FILE_CHANGED",
        "Файл на сервере изменился за время редактирования; изменения не сохранены.",
        "Повторить редактирование на актуальной версии файла.",
      );
    }

    progress.update("Сохранение файла…");
    const writeArgs: Record<string, unknown> =
      snapshotPath !== undefined
        ? { url: plan.url, file: snapshotPath }
        : { url: plan.url, text: editedText };
    const writeRes = await runtime.call("files.write", writeArgs);
    return { handled: false, result: writeRes, requestArgs: { url: plan.url } };
  } finally {
    await cleanupTempDir(tempDir, io);
  }
}

async function runObjectJsonEdit(
  plan: Extract<EditPlan, { kind: "object" }>,
  args: CliArguments,
  config: Pick<ConnectionConfig, "name" | "baseUrl">,
  io: CliIo,
  runtime: RuntimePort,
  outputMode: OutputMode,
  progress: ProgressIndicator,
  closeRuntimeOnce: () => Promise<{
    readonly failed: boolean;
    readonly diagnostic?: OperationResult;
  }>,
): Promise<EditOutcome> {
  progress.update("Чтение объекта…");
  const getArgs: Record<string, unknown> = {
    ...plan.target,
    ...(plan.fields === undefined ? {} : { fields: plan.fields }),
  };
  const getRes = await runtime.call("objects.get", getArgs);
  if (!getRes.ok) return { handled: false, result: getRes };

  const getData =
    getRes.meta.truncated === true ? await readStoredJson(runtime, getRes) : getRes.data;
  if (
    !isRecord(getData) ||
    !isPlainObject(getData.data) ||
    typeof getData.fingerprint !== "string"
  ) {
    throw new HcmError("INVALID_RESPONSE", "Неожиданный ответ objects.get при чтении объекта.");
  }

  const fingerprint = getData.fingerprint;
  const originalData = getData.data;
  const objectType =
    typeof getData.type === "string" && getData.type
      ? getData.type
      : typeof plan.target.type === "string"
        ? plan.target.type
        : "object";
  const objectId =
    typeof getData.id === "string" && getData.id
      ? getData.id
      : typeof plan.target.id === "string"
        ? plan.target.id
        : undefined;
  const objectUrl =
    typeof getData.url === "string" && getData.url
      ? getData.url
      : typeof plan.target.url === "string"
        ? plan.target.url
        : undefined;

  const baseName = objectId ? `${objectType}_${objectId}.json` : `${objectType}.json`;
  const fileName = safeTempFileName(baseName, "object.json");
  const initialJson = `${JSON.stringify(originalData, null, 2)}\n`;

  return await withEditedTempFile(
    fileName,
    initialJson,
    plan.editor,
    io,
    outputMode,
    progress,
    closeRuntimeOnce,
    async (editedText): Promise<EditOutcome> => {
      let parsedJson: unknown;
      try {
        const jsonSource = editedText.startsWith("\uFEFF") ? editedText.slice(1) : editedText;
        parsedJson = JSON.parse(jsonSource);
      } catch (error) {
        const detail = error instanceof Error ? ` (${error.message})` : "";
        throw new HcmError(
          "INVALID_JSON",
          `Отредактированный файл содержит некорректный JSON${detail}; изменения не сохранены.`,
          "Исправить синтаксис JSON и повторить редактирование.",
        );
      }
      if (!isPlainObject(parsedJson)) {
        throw new HcmError(
          "INVALID_JSON",
          "В файле должен быть объект JSON с полями документа, а не массив, строка или число; изменения не сохранены.",
        );
      }

      const { patch, remove } = diffObjectFields(originalData, parsedJson);
      const hasPatch = Object.keys(patch).length > 0;
      const hasRemove = remove.length > 0;
      if (!hasPatch && !hasRemove) {
        return {
          handled: false,
          result: frontendResult("cli.object.edit", config.name, {
            ...(objectId === undefined ? {} : { id: objectId }),
            ...(objectUrl === undefined ? {} : { url: objectUrl }),
            changed: false,
          }),
        };
      }

      const patchBaseArgs: Record<string, unknown> = {
        ...plan.target,
        ...(hasPatch ? { patch } : {}),
        ...(hasRemove ? { remove } : {}),
        expectedFingerprint: fingerprint,
      };

      progress.start("Проверка правок…");
      const previewRes = await runtime.call("objects.patch", { ...patchBaseArgs, preview: true });
      await progress.stop();
      if (!previewRes.ok) return { handled: false, result: previewRes };

      const previewData =
        previewRes.meta.truncated === true
          ? await readStoredJson(runtime, previewRes)
          : previewRes.data;
      if (isRecord(previewData) && previewData.noop === true) {
        return {
          handled: false,
          result: frontendResult("cli.object.edit", config.name, {
            ...(objectId === undefined ? {} : { id: objectId }),
            ...(objectUrl === undefined ? {} : { url: objectUrl }),
            changed: false,
          }),
        };
      }

      const styler = createStyler(resolveColor(io, "stderr"));
      const targetLabel = [objectType, objectId].filter(Boolean).join(" · ") || objectUrl || "—";
      const header = renderConnectionHeader(config, "Объект", targetLabel, styler);
      const sanitizedPreview = isRecord(previewData)
        ? (sanitizePreviewValue(previewData) as Record<string, unknown>)
        : {};
      const renderedPreview = renderObjectPatch(sanitizedPreview, styler);
      await io.writeError(`${header}\n\n${renderedPreview}`);

      const confirmed = await confirmEditSave(io, args, "Сохранить изменения объекта? [y/N] ");
      if (!confirmed) {
        await closeRuntimeOnce();
        return { handled: true, exitCode: 1 };
      }

      progress.start("Сохранение объекта…");
      const saveRes = await runtime.call("objects.patch", patchBaseArgs);
      return { handled: false, result: saveRes, requestArgs: patchBaseArgs };
    },
  );
}

function decodeBinaryPayloadText(data: unknown): string | undefined {
  if (!isRecord(data) || data.kind !== "binary") return undefined;
  let bytes: Uint8Array | undefined;
  if (data.bytes instanceof Uint8Array) {
    bytes = data.bytes;
  } else if (isRecord(data.bytes) && typeof data.bytes.base64 === "string") {
    bytes = Buffer.from(data.bytes.base64, "base64");
  }
  if (!bytes) return undefined;
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
}

/** Извлекает исходный XML документа из двоичного SOAP-ответа LoadDoc (сохраняя комментарии и порядок тегов). */
function extractRawDocXml(loadData: unknown): string | undefined {
  const rawEnvelope = decodeBinaryPayloadText(loadData);
  if (rawEnvelope !== undefined) {
    return unwrapLoadDocSoapXml(rawEnvelope);
  }
  return extractDocXml(loadData);
}

function normalizedDocId(value: unknown): bigint | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  try {
    return BigInt(resolvePhysicalDocumentLocation(text).objectId);
  } catch {
    return undefined;
  }
}

async function loadRawXmlSnapshot(
  runtime: RuntimePort,
  url: string,
): Promise<
  | { readonly ok: true; readonly xml: string }
  | { readonly ok: false; readonly result: OperationResult }
> {
  const loadRes = await runtime.call("native.lds.loadDoc", { url, useBinaryResponse: true });
  if (!loadRes.ok) return { ok: false, result: loadRes };

  const loadData =
    loadRes.meta.truncated === true ? await readStoredJson(runtime, loadRes) : loadRes.data;
  const extracted = extractRawDocXml(loadData);
  if (extracted === undefined) {
    throw new HcmError("INVALID_XML", "Не удалось извлечь XML документа из ответа сервера.");
  }
  return { ok: true, xml: extracted };
}

async function runObjectXmlEdit(
  plan: Extract<EditPlan, { kind: "object" }>,
  args: CliArguments,
  config: Pick<ConnectionConfig, "name" | "baseUrl">,
  io: CliIo,
  runtime: RuntimePort,
  outputMode: OutputMode,
  progress: ProgressIndicator,
  closeRuntimeOnce: () => Promise<{
    readonly failed: boolean;
    readonly diagnostic?: OperationResult;
  }>,
): Promise<EditOutcome> {
  const dbName = typeof plan.target.dbName === "string" ? plan.target.dbName : undefined;
  let url: string;
  let objectId: string | undefined;

  if (typeof plan.target.url === "string") {
    url = plan.target.url;
    objectId = typeof plan.target.id === "string" ? plan.target.id : parsePhysicalDocumentId(url);
  } else if (dbName !== undefined) {
    const location = resolvePhysicalDocumentLocation(String(plan.target.id), dbName);
    url = location.url;
    objectId = location.objectId;
  } else {
    // Узнаём реальный адрес документа в основной базе сервера (default_db_name), не подставляя wt_data вслепую.
    progress.update("Поиск документа…");
    const locateRes = await runtime.call("objects.get", { ...plan.target, fields: ["id"] });
    if (!locateRes.ok) return { handled: false, result: locateRes };
    const locateData =
      locateRes.meta.truncated === true ? await readStoredJson(runtime, locateRes) : locateRes.data;
    if (!isRecord(locateData) || typeof locateData.url !== "string" || !locateData.url) {
      throw new HcmError(
        "INVALID_RESPONSE",
        "Не удалось определить адрес документа для редактирования XML.",
      );
    }
    url = locateData.url;
    objectId =
      typeof locateData.id === "string" && locateData.id
        ? locateData.id
        : typeof plan.target.id === "string"
          ? plan.target.id
          : parsePhysicalDocumentId(url);
  }

  progress.update("Чтение XML документа…");
  const loaded = await loadRawXmlSnapshot(runtime, url);
  if (!loaded.ok) return { handled: false, result: loaded.result };

  const expectedType = typeof plan.target.type === "string" ? plan.target.type : undefined;
  let originalDoc: XmlDocument | undefined;
  let actualType: string | undefined;
  let hadIdElement = false;
  let expectedIdBigInt = normalizedDocId(objectId);
  try {
    originalDoc = XmlDocument.parse(loaded.xml);
    actualType = originalDoc.form().type;
    const snap = originalDoc.snapshot();
    if (Object.hasOwn(snap.data, "id") && snap.data.id !== undefined) {
      const idStr = String(snap.data.id).trim();
      if (idStr) {
        hadIdElement = true;
        expectedIdBigInt = normalizedDocId(idStr) ?? expectedIdBigInt;
      }
    }
  } catch {
    // Если документ нестандартный, не мешаем прямому редактированию XML, если тип не проверялся.
  }
  if (expectedType !== undefined && actualType !== undefined && actualType !== expectedType) {
    throw new HcmError(
      "TYPE_MISMATCH",
      `Тип объекта — ${actualType}, а не ${expectedType}.`,
      undefined,
      { actualType },
    );
  }

  const originalXml = loaded.xml.endsWith("\n") ? loaded.xml : `${loaded.xml}\n`;
  const originalHash = sha256Text(loaded.xml);
  const typeLabel = actualType ?? expectedType ?? "object";
  const rawFileName = objectId ? `${typeLabel}_${objectId}.xml` : safeTempFileName(url, "doc.xml");
  const fileName = safeTempFileName(
    rawFileName.toLowerCase().endsWith(".xml") ? rawFileName : `${rawFileName}.xml`,
    "document.xml",
  );

  return await withEditedTempFile(
    fileName,
    originalXml,
    plan.editor,
    io,
    outputMode,
    progress,
    closeRuntimeOnce,
    async (editedXml): Promise<EditOutcome> => {
      if (editedXml === originalXml) {
        return {
          handled: false,
          result: frontendResult("cli.object.edit", config.name, {
            ...(objectId === undefined ? {} : { id: objectId }),
            url,
            changed: false,
          }),
        };
      }

      const trimmedEditedXml = editedXml.startsWith("\uFEFF") ? editedXml.slice(1) : editedXml;
      try {
        rawXmlElement(trimmedEditedXml);
      } catch (error) {
        if (error instanceof ArgumentError) {
          throw new HcmError(
            "INVALID_XML",
            `Отредактированный XML некорректен: ${error.message}`,
            "Исправить разметку XML и повторить редактирование.",
          );
        }
        throw error;
      }

      // Проверяем реальный корневой тег до XmlDocument.parse, чтобы SOAP-конверт <Envelope> не проскочил внутрь.
      const rootTagMatch =
        /^(?:\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->))*\s*<([^\s/>!?][^\s/>]*)/.exec(trimmedEditedXml);
      const rawRootTag = rootTagMatch?.[1];
      const rawRootLocal = rawRootTag
        ? rawRootTag.includes(":")
          ? rawRootTag.slice(rawRootTag.lastIndexOf(":") + 1)
          : rawRootTag
        : undefined;
      const requiredType = actualType ?? expectedType;
      if (
        rawRootLocal === "Envelope" ||
        (requiredType !== undefined && rawRootLocal !== requiredType)
      ) {
        throw new HcmError(
          "TYPE_MISMATCH",
          `Корневой элемент изменён с <${requiredType ?? "документ"}> на <${rawRootTag ?? "?"}>; тип документа менять нельзя.`,
          "Вернуть прежний корневой элемент документа.",
          ...(rawRootTag === undefined ? [] : [{ actualType: rawRootTag }]),
        );
      }

      let editedDoc: XmlDocument;
      try {
        editedDoc = XmlDocument.parse(trimmedEditedXml);
      } catch (error) {
        if (error instanceof HcmError) throw error;
        throw new HcmError(
          "INVALID_XML",
          "Не удалось разобрать отредактированный XML документа; изменения не сохранены.",
          "Исправить разметку XML и повторить редактирование.",
        );
      }
      const editedType = editedDoc.form().type;
      if (requiredType !== undefined && editedType !== requiredType) {
        throw new HcmError(
          "TYPE_MISMATCH",
          `Корневой элемент изменён с <${requiredType}> на <${editedType}>; тип документа менять нельзя.`,
          "Вернуть прежний корневой элемент документа.",
          { actualType: editedType },
        );
      }
      const editedSnap = editedDoc.snapshot();
      const editedRawId = Object.hasOwn(editedSnap.data, "id") ? editedSnap.data.id : undefined;
      const editedIdText =
        typeof editedRawId === "string" || typeof editedRawId === "number"
          ? String(editedRawId).trim()
          : "";
      if (hadIdElement && !editedIdText) {
        throw new HcmError(
          "IMMUTABLE_ID",
          "Элемент <id> удалён или очищен; ID документа менять нельзя.",
          "Вернуть исходное значение элемента <id>.",
        );
      }
      if (editedIdText && expectedIdBigInt !== undefined) {
        const editedIdBigInt = normalizedDocId(editedIdText);
        if (editedIdBigInt === undefined || editedIdBigInt !== expectedIdBigInt) {
          throw new HcmError(
            "IMMUTABLE_ID",
            "ID документа в отредактированном XML не совпадает с исходным; изменения не сохранены.",
            "Вернуть исходное значение элемента <id>.",
          );
        }
      }

      const styler = createStyler(resolveColor(io, "stderr"));
      const header = renderConnectionHeader(config, "Документ", url, styler);
      const diff = renderLineDiff(originalXml, editedXml, styler);
      await io.writeError(`${header}\n\n${diff}`);

      const confirmed = await confirmEditSave(io, args, "Сохранить изменения документа? [y/N] ");
      if (!confirmed) {
        await closeRuntimeOnce();
        return { handled: true, exitCode: 1 };
      }

      progress.start("Проверка изменений на сервере…");
      const current = await loadRawXmlSnapshot(runtime, url);
      if (!current.ok) {
        throw new HcmError(
          "CONFLICT",
          "Не удалось перечитать документ перед записью: возможно, он был удалён или изменён на сервере.",
          "Проверить актуальное состояние документа и повторить редактирование.",
        );
      }
      if (current.xml !== loaded.xml || sha256Text(current.xml) !== originalHash) {
        throw new HcmError(
          "CONFLICT",
          "Документ на сервере изменился за время редактирования; изменения не сохранены.",
          "Повторить редактирование на актуальной версии документа.",
        );
      }

      progress.update("Сохранение XML документа…");
      const putArgs = { url, data: trimmedEditedXml, writeDocInfo: true };
      const putRes = await runtime.call("native.lds.putDoc", putArgs);
      return { handled: false, result: putRes, requestArgs: { url } };
    },
  );
}

/** Выполняет интерактивное редактирование файла или объекта (JSON / XML). */
export async function runEditCommand(
  plan: EditPlan,
  args: CliArguments,
  config: Pick<ConnectionConfig, "name" | "baseUrl">,
  io: CliIo,
  runtime: RuntimePort,
  outputMode: OutputMode,
  progress: ProgressIndicator,
  closeRuntimeOnce: () => Promise<{
    readonly failed: boolean;
    readonly diagnostic?: OperationResult;
  }>,
): Promise<EditOutcome> {
  if (plan.kind === "files") {
    return await runFilesEdit(
      plan,
      args,
      config,
      io,
      runtime,
      outputMode,
      progress,
      closeRuntimeOnce,
    );
  }
  if (plan.xml) {
    return await runObjectXmlEdit(
      plan,
      args,
      config,
      io,
      runtime,
      outputMode,
      progress,
      closeRuntimeOnce,
    );
  }
  return await runObjectJsonEdit(
    plan,
    args,
    config,
    io,
    runtime,
    outputMode,
    progress,
    closeRuntimeOnce,
  );
}
