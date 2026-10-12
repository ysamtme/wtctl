import process from "node:process";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { dirname, resolve } from "node:path";
import { writeResultFile } from "../results.js";
import type { Readable } from "node:stream";
import { CliInputError } from "./arguments.js";
import type { CliIo } from "./types.js";

export async function readBoundedBytes(stream: Readable, maximumBytes: number): Promise<Buffer> {
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

export async function readBounded(stream: Readable, maximumBytes: number): Promise<string> {
  const bytes = await readBoundedBytes(stream, maximumBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
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
  await writeResultFile(path, [text], true);
}

/** Questions go to stderr: stdout carries the command's JSON. */
async function promptLine(question: string, secret = false): Promise<string> {
  const lines = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  if (secret) {
    // The line editor echoes every key through this method; keep the question, drop the keys.
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
    readBinaryFile: (path, maximumBytes) => readBoundedBytes(createReadStream(path), maximumBytes),
    readBinaryStdin: (maximumBytes) => {
      if (process.stdin.isTTY) throw new CliInputError("--stdin ожидает перенаправленный ввод.");
      return readBoundedBytes(process.stdin, maximumBytes);
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
  };
}
