import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { WsHcmApiError } from "../protocol/error.js";

const inFlight = new Map<string, Promise<string>>();
const validIdentity = /^[0-9A-Fa-f]{16}(?:\r?\n)?$/;

/** Client-machine licensing identity, independent of HTTP authentication and LDS frame IDs. */
export function loadOrCreateLegacyInstallationId(filename: string): Promise<string> {
  const path = resolve(filename);
  const pending = inFlight.get(path);
  if (pending) return pending;
  const created = readOrCreate(path)
    .catch((cause) => {
      if (cause instanceof WsHcmApiError) throw cause;
      throw new WsHcmApiError(
        "protocol",
        "Не удалось прочитать или создать файл с installationId старого клиента.",
        { requestSent: false, cause },
      );
    })
    .finally(() => {
      inFlight.delete(path);
    });
  inFlight.set(path, created);
  return created;
}

async function readIdentity(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 16 || info.size > 18) {
    throw new WsHcmApiError(
      "protocol",
      "Файл с installationId старого клиента должен быть обычным файлом из 16 шестнадцатеричных цифр.",
      { requestSent: false },
    );
  }
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await file.stat();
    if (!current.isFile() || current.size < 16 || current.size > 18) {
      throw new WsHcmApiError(
        "protocol",
        "В файле с installationId старого клиента не 16 шестнадцатеричных цифр.",
        {
          requestSent: false,
        },
      );
    }
    // A bounded read also protects against a file that grows between stat and read.
    const buffer = Buffer.alloc(19);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const value = buffer.subarray(0, bytesRead).toString("utf8");
    if (!validIdentity.test(value))
      throw new WsHcmApiError(
        "protocol",
        "В файле с installationId старого клиента не 16 шестнадцатеричных цифр.",
        {
          requestSent: false,
        },
      );
    return value.slice(0, 16);
  } finally {
    await file.close();
  }
}

async function readOrCreate(path: string): Promise<string> {
  try {
    return await readIdentity(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Publish a fully written file atomically. A hard link never overwrites another process's ID.
  const candidate = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const file = await open(candidate, "wx", 0o600);
  try {
    try {
      await file.writeFile(`${randomBytes(8).toString("hex").toUpperCase()}\n`, "ascii");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(candidate, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return await readIdentity(path);
  } finally {
    await unlink(candidate);
  }
}
