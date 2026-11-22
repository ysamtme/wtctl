import process from "node:process";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readlink, realpath, stat, unlink } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { basename, dirname, join, resolve } from "node:path";
import { MAX_CONFIG_BYTES } from "../config.js";
import { HcmError } from "../errors.js";
import { saveLocalFile } from "../local-file.js";
import type { Readable } from "node:stream";
import { CliInputError } from "./arguments.js";
import type { CliIo } from "./types.js";

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

function writeStream(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((done, reject) => {
    stream.write(text, (error?: Error | null) => (error ? reject(error) : done()));
  });
}

export async function writeAtomicOutput(path: string, text: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await saveLocalFile(path, true, (file) => file.writeFile(text, "utf8"));
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

export function nodeIo(): CliIo {
  return {
    ...(process.stdin.isTTY && process.stderr.isTTY ? { prompt: promptLine } : {}),
    pretty: process.stdout.isTTY === true,
    writeOut: (text) => writeStream(process.stdout, text),
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
    writeFileIfUnchanged: writeConfigIfUnchanged,
  };
}
