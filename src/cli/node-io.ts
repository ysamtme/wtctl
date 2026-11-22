import process from "node:process";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readlink,
  realpath,
  rename,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { MAX_CONFIG_BYTES } from "../config.js";
import { HcmError } from "../errors.js";
import { saveLocalFile } from "../local-file.js";
import type { Readable } from "node:stream";
import { CliInputError } from "./arguments.js";
import type { CliIo, FileTextWriter } from "./types.js";

export async function readBoundedBytes(stream: Readable, maximumBytes = Infinity): Promise<Buffer> {
  const parts: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const part of stream) {
      const buffer = Buffer.isBuffer(part) ? part : Buffer.from(String(part));
      bytes += buffer.length;
      if (bytes > maximumBytes) throw new CliInputError("Ввод превышает допустимый размер.");
      parts.push(buffer);
    }
    return Buffer.concat(parts, bytes);
  } finally {
    if (stream !== process.stdin) stream.destroy();
  }
}

export async function readBounded(stream: Readable, maximumBytes?: number): Promise<string> {
  const bytes = await readBoundedBytes(stream, maximumBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    // Строку длиннее 2^29 − 24 знаков Node.js не создаёт.
    if ((error as { code?: unknown }).code === "ERR_STRING_TOO_LONG")
      throw new CliInputError(
        "Текст ввода длиннее строки, которую держит Node.js: около 512 млн знаков.",
      );
    throw new CliInputError("Ввод должен быть текстом UTF-8.");
  }
}

function writeStream(stream: NodeJS.WritableStream, chunk: string | Uint8Array): Promise<void> {
  return new Promise((done, reject) => {
    stream.write(chunk, (error?: Error | null) => (error ? reject(error) : done()));
  });
}

export async function writeAtomicOutput(path: string, text: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await saveLocalFile(path, true, (file) => file.writeFile(text, "utf8"));
}

export async function writeAtomicBinaryOutput(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await saveLocalFile(path, true, (file) => file.writeFile(bytes));
}

/** Ожидание с мгновенным завершением по сигналу отмены. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((done) => {
    const onAbort = () => {
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      done();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function writeAllHandle(file: FileHandle, bytes: Buffer): Promise<void> {
  for (let offset = 0; offset < bytes.length;) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) throw new Error("Запись локального файла не продвигается.");
    offset += bytesWritten;
  }
}

/** Потоково пишет текстовые фрагменты во временный файл и публикует его только после commit. */
export async function openAtomicTextWriter(path: string): Promise<FileTextWriter> {
  if (path.includes("\0")) {
    throw new HcmError("INVALID_ARGUMENT", "output: в пути есть нулевой символ.");
  }
  const target = resolve(path);
  const existing = await stat(target).catch(() => undefined);
  if (existing?.isDirectory()) {
    throw new HcmError(
      "INVALID_ARGUMENT",
      "output: по этому пути папка, а нужен путь к файлу.",
      "К пути нужно добавить имя файла.",
    );
  }
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined = await open(temporary, "wx", 0o600);
  let closed = false;
  let totalBytes = 0;

  return {
    async write(chunk: string): Promise<void> {
      if (!handle) throw new Error("Файл вывода уже закрыт.");
      if (!chunk) return;
      const bytes = Buffer.from(chunk, "utf8");
      await writeAllHandle(handle, bytes);
      totalBytes += bytes.length;
    },
    async commit(): Promise<number> {
      if (closed) return totalBytes;
      closed = true;
      const file = handle;
      handle = undefined;
      try {
        await file?.close();
        await rename(temporary, target);
        return totalBytes;
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    },
    async abort(): Promise<void> {
      if (closed) return;
      closed = true;
      const file = handle;
      handle = undefined;
      await file?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    },
  };
}

const CONFIG_CONFLICT_HINT = "Повторить команду, чтобы не перезаписать чужую правку.";
const CONFIG_LOCK_HINT =
  "Повторить команду. Если другой процесс не запущен, удалить оставшийся файл блокировки .lock рядом с файлом подключений.";

async function resolveAncestor(path: string): Promise<string> {
  const tail: string[] = [];
  let current = path;
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      tail.push(basename(current));
      current = parent;
    }
  }
}

async function resolveConfigPath(path: string): Promise<string> {
  let current = resolve(path);
  for (let hop = 0; hop < 32; hop++) {
    try {
      return await realpath(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        current = resolve(await resolveAncestor(dirname(current)), await readlink(current));
        continue;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return resolveAncestor(current);
  }
  throw Object.assign(new Error(`Слишком много уровней символических ссылок: ${path}`), {
    code: "ELOOP",
  });
}

export async function writeConfigIfUnchanged(
  path: string,
  expectedText: string | undefined,
  text: string,
): Promise<void> {
  const target = await resolveConfigPath(path);
  await mkdir(dirname(target), { recursive: true });
  const lockPath = `${target}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new HcmError(
        "CONFIG_CONFLICT",
        "Файл подключений сейчас изменяется другим процессом.",
        CONFIG_LOCK_HINT,
      );
    throw error;
  }
  try {
    if (expectedText === undefined) {
      const exists = await stat(target).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (exists)
        throw new HcmError(
          "CONFIG_CONFLICT",
          "Файл подключений появился за время выполнения команды.",
          CONFIG_CONFLICT_HINT,
        );
    } else {
      let current: string;
      try {
        current = await readBounded(createReadStream(target), MAX_CONFIG_BYTES);
      } catch (error) {
        if (error instanceof CliInputError || (error as NodeJS.ErrnoException).code === "ENOENT")
          throw new HcmError(
            "CONFIG_CONFLICT",
            "Файл подключений изменился за время выполнения команды.",
            CONFIG_CONFLICT_HINT,
          );
        throw error;
      }
      if (current !== expectedText)
        throw new HcmError(
          "CONFIG_CONFLICT",
          "Файл подключений изменился за время выполнения команды.",
          CONFIG_CONFLICT_HINT,
        );
    }
    await saveLocalFile(target, true, (file) => file.writeFile(text, "utf8"));
  } finally {
    await lock.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}

/** Вопросы идут в stderr: в stdout — JSON команды. */
async function promptLine(question: string, secret = false): Promise<string> {
  const lines = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  if (secret) {
    // Редактор строки выводит каждую клавишу через этот метод: вопрос оставить, нажатия отбросить.
    const quiet = lines as unknown as { _writeToOutput(text: string): void };
    quiet._writeToOutput = (text) => {
      if (text.includes(question)) process.stderr.write(question);
    };
  }
  try {
    return await lines.question(question);
  } finally {
    lines.close();
    if (secret) process.stderr.write("\n");
  }
}

/** Разбирает ответ подтверждения [y/N]: принимает y, yes, д, да без учёта регистра. */
export function parseConfirmAnswer(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes" || normalized === "д" || normalized === "да";
}

/** Спрашивает подтверждение [y/N] на заданных потоках; пустой ввод, EOF и Ctrl+C завершают вопрос отказом. */
export async function confirmOnStream(
  question: string,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  terminal = true,
  signal?: AbortSignal,
): Promise<boolean> {
  const lines = createInterface({ input, output, terminal });
  const ac = new AbortController();
  let abortedBySigint = false;
  const onSigint = () => {
    abortedBySigint = true;
    if (!ac.signal.aborted) ac.abort();
  };
  const onClose = () => {
    if (!ac.signal.aborted) ac.abort();
  };
  const onExternalAbort = () => {
    abortedBySigint = true;
    if (!ac.signal.aborted) ac.abort();
  };
  if (signal?.aborted) onExternalAbort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  lines.once("SIGINT", onSigint);
  lines.once("close", onClose);
  try {
    const answer = await lines.question(question, { signal: ac.signal });
    return abortedBySigint ? false : parseConfirmAnswer(answer);
  } catch {
    return false;
  } finally {
    signal?.removeEventListener("abort", onExternalAbort);
    lines.off("SIGINT", onSigint);
    lines.off("close", onClose);
    lines.close();
    if (abortedBySigint) output.write("\n");
  }
}

/** Спрашивает подтверждение [y/N] в stderr; пустой ввод, EOF, Ctrl+C и SIGTERM считаются отказом. */
async function confirmLine(question: string): Promise<boolean> {
  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await confirmOnStream(question, process.stdin, process.stderr, true, ac.signal);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

const EDITOR_HINT =
  "Указать редактор через --editor, переменную окружения WTCTL_EDITOR, VISUAL или EDITOR.";

/** Определяет команду редактора по приоритету: --editor → WTCTL_EDITOR → VISUAL → EDITOR → системный. */
export function resolveEditorCommand(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  for (const candidate of [explicit, env.WTCTL_EDITOR, env.VISUAL, env.EDITOR]) {
    if (candidate !== undefined && candidate.trim() !== "") return candidate.trim();
  }
  return platform === "win32" ? "notepad" : "vi";
}

/** Разбирает команду редактора на [исполняемый_файл, ...аргументы] с учётом кавычек и путей Windows. */
export function parseEditorCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
): [string, ...string[]] {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let i = 0;

  while (i < command.length) {
    const ch = command[i]!;
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      i++;
      continue;
    }
    if (ch === "'") {
      hasToken = true;
      i++;
      let closed = false;
      while (i < command.length) {
        if (command[i] === "'") {
          closed = true;
          i++;
          break;
        }
        current += command[i]!;
        i++;
      }
      if (!closed) {
        throw new HcmError(
          "EDITOR_FAILED",
          "В команде редактора не закрыта одинарная кавычка.",
          EDITOR_HINT,
        );
      }
      continue;
    }
    if (ch === '"') {
      hasToken = true;
      i++;
      let closed = false;
      while (i < command.length) {
        const inner = command[i]!;
        if (inner === "\\") {
          let slashes = 0;
          while (i < command.length && command[i] === "\\") {
            slashes++;
            i++;
          }
          if (i < command.length && command[i] === '"') {
            current += "\\".repeat(Math.floor(slashes / 2));
            if (slashes % 2 === 1) {
              current += '"';
              i++;
            } else {
              closed = true;
              i++;
              break;
            }
          } else {
            current += "\\".repeat(slashes);
          }
          continue;
        }
        if (inner === '"') {
          closed = true;
          i++;
          break;
        }
        current += inner;
        i++;
      }
      if (!closed) {
        throw new HcmError(
          "EDITOR_FAILED",
          "В команде редактора не закрыта двойная кавычка.",
          EDITOR_HINT,
        );
      }
      continue;
    }
    if (ch === "\\") {
      if (platform === "win32") {
        let slashes = 0;
        while (i < command.length && command[i] === "\\") {
          slashes++;
          i++;
        }
        if (i < command.length && command[i] === '"') {
          current += "\\".repeat(Math.floor(slashes / 2));
          if (slashes % 2 === 1) {
            current += '"';
            i++;
            hasToken = true;
          } else if (slashes > 0) {
            hasToken = true;
          }
        } else {
          current += "\\".repeat(slashes);
          hasToken = true;
        }
      } else {
        i++;
        if (i < command.length) {
          current += command[i]!;
          i++;
        } else {
          current += "\\";
        }
        hasToken = true;
      }
      continue;
    }
    current += ch;
    hasToken = true;
    i++;
  }

  if (hasToken) tokens.push(current);
  if (tokens.length === 0 || tokens[0] === "") {
    throw new HcmError("EDITOR_FAILED", "Команда редактора не задана или пуста.", EDITOR_HINT);
  }
  return tokens as [string, ...string[]];
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function resolveWindowsExecutable(bin: string, env: NodeJS.ProcessEnv = process.env): string {
  const rawExts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim())
    .filter((ext) => ext.startsWith("."));
  const exts = rawExts.length > 0 ? rawExts : [".COM", ".EXE", ".BAT", ".CMD"];
  const hasExt = extname(bin) !== "";
  const hasPath = /[\\/:]/.test(bin);

  const checkIn = (candidate: string): string | undefined => {
    if (hasExt && isRegularFile(candidate)) return candidate;
    for (const ext of exts) {
      if (hasExt && candidate.toLowerCase().endsWith(ext.toLowerCase())) continue;
      const withExt = `${candidate}${ext}`;
      if (isRegularFile(withExt)) return withExt;
    }
    if (!hasExt && isRegularFile(candidate)) return candidate;
    return undefined;
  };

  if (hasPath) return checkIn(bin) ?? bin;

  const pathVar = env.PATH ?? env.Path ?? "";
  for (const rawDir of pathVar.split(";")) {
    const dir = rawDir.trim().replace(/^"(.*)"$/, "$1");
    if (!dir) continue;
    const found = checkIn(join(dir, bin));
    if (found) return found;
  }
  return bin;
}

function escapeCmdMeta(text: string): string {
  return text.replace(/([()!%^&;"<>|])/g, "^$1");
}

function escapeCmdExe(exe: string): string {
  return exe.replace(/([()!%^&;"<>|\s])/g, "^$1");
}

function quoteForCmdArg(arg: string): string {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return escapeCmdMeta(quoted);
}

/** Запускает внешний редактор на локальном файле без shell-инъекции и возвращает код его выхода. */
export async function launchEditor(
  command: string | undefined,
  filePath: string,
  options?: { readonly redirectStdoutToStderr?: boolean },
): Promise<number> {
  const resolvedCommand = resolveEditorCommand(command);
  const [bin, ...args] = parseEditorCommand(resolvedCommand);
  const fullArgs = [...args, filePath];
  if ([bin, ...fullArgs].some((part) => /[\r\n\0]/.test(part))) {
    throw new HcmError(
      "EDITOR_FAILED",
      "Команда редактора или путь к файлу содержат недопустимые управляющие символы.",
      EDITOR_HINT,
    );
  }

  let spawnExe = bin;
  let spawnArgs = fullArgs;
  let windowsVerbatimArguments = false;
  if (process.platform === "win32") {
    const resolvedBin = resolveWindowsExecutable(bin);
    if (/\.(?:cmd|bat)$/i.test(resolvedBin)) {
      spawnExe = process.env.ComSpec || "cmd.exe";
      const cmdLine = [escapeCmdExe(resolvedBin), ...fullArgs.map(quoteForCmdArg)].join(" ");
      spawnArgs = ["/d", "/s", "/c", cmdLine];
      windowsVerbatimArguments = true;
    } else {
      spawnExe = resolvedBin;
    }
  }

  return await new Promise<number>((resolveCode, reject) => {
    const child = spawn(spawnExe, spawnArgs, {
      stdio: options?.redirectStdoutToStderr ? ["inherit", process.stderr, "inherit"] : "inherit",
      shell: false,
      ...(windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      const safeBin = bin.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
      if (error.code === "ENOENT") {
        reject(
          new HcmError("EDITOR_FAILED", `Не удалось найти редактор "${safeBin}".`, EDITOR_HINT),
        );
      } else {
        reject(
          new HcmError(
            "EDITOR_FAILED",
            `Не удалось запустить редактор "${safeBin}"${error.code ? ` (${error.code})` : ""}.`,
            EDITOR_HINT,
          ),
        );
      }
    });
    child.once("close", (code) => resolveCode(code ?? 1));
  });
}

function terminalColumns(): number | undefined {
  if (typeof process.stdout.columns === "number" && process.stdout.columns > 0)
    return process.stdout.columns;
  const raw = process.env.COLUMNS;
  if (raw !== undefined && /^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (parsed > 0) return parsed;
  }
  return undefined;
}

export function nodeIo(): CliIo {
  const stdoutIsTTY = process.stdout.isTTY === true;
  const stderrIsTTY = process.stderr.isTTY === true;
  const columns = terminalColumns();
  return {
    ...(process.stdin.isTTY && stderrIsTTY ? { prompt: promptLine, confirm: confirmLine } : {}),
    pretty: stdoutIsTTY,
    stdoutIsTTY,
    stderrIsTTY,
    ...(columns === undefined ? {} : { columns }),
    sleep: abortableSleep,
    onInterrupt: (handler) => {
      const onSignal = () => handler();
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
      return () => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      };
    },
    writeOut: (text) => writeStream(process.stdout, text),
    writeBinaryOut: (bytes) => writeStream(process.stdout, bytes),
    writeError: (text) => writeStream(process.stderr, text),
    readFile: (path, maximumBytes) => readBounded(createReadStream(path), maximumBytes),
    readBinaryFile: (path) => readBoundedBytes(createReadStream(path)),
    readBinaryStdin: () => {
      if (process.stdin.isTTY) throw new CliInputError("--stdin ожидает перенаправленный ввод.");
      return readBoundedBytes(process.stdin);
    },
    readStdin: (maximumBytes) => {
      if (process.stdin.isTTY)
        throw new CliInputError(
          "--stdin ожидает перенаправленный ввод.",
          "Нужно передать файл через --input-file или перенаправить текст в stdin.",
        );
      return readBounded(process.stdin, maximumBytes);
    },
    writeFile: writeAtomicOutput,
    writeBinaryFile: writeAtomicBinaryOutput,
    openTextWriter: openAtomicTextWriter,
    writeFileIfUnchanged: writeConfigIfUnchanged,
    launchEditor,
    forceExit: (code) => process.exit(code),
  };
}
