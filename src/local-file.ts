import { randomUUID } from "node:crypto";
import { constants, copyFile, link, open, rename, stat, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { HcmError } from "./errors.js";

/**
 * Файл на этом компьютере: fill пишет содержимое во временный файл рядом, и под своим именем файл
 * появляется только целиком. Путь проверяется до fill, поэтому отказ приходит раньше содержимого.
 * argument — имя аргумента с путём в тексте отказа.
 * @internal
 */
export async function saveLocalFile(
  path: string,
  overwrite: boolean,
  fill: (file: FileHandle) => Promise<void>,
  argument = "path",
): Promise<number> {
  if (path.includes("\0"))
    throw new HcmError("INVALID_ARGUMENT", `${argument}: в пути есть нулевой символ.`);
  const target = resolve(path);
  const existing = await stat(target).catch(() => undefined);
  if (existing?.isDirectory())
    throw new HcmError(
      "INVALID_ARGUMENT",
      `${argument}: по этому пути папка, а нужен путь к файлу.`,
      "К пути нужно добавить имя файла.",
    );
  if (existing && !overwrite) throw fileExists();
  const local = (error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw fileExists();
    if (error.code === "ENOENT")
      throw new HcmError(
        "FOLDER_NOT_FOUND",
        "Папки для файла нет.",
        "Сначала нужно создать папку.",
      );
    throw saveFailed(error);
  };
  const temporary = `${target}.${randomUUID()}.tmp`;
  let file: FileHandle | undefined = await open(temporary, "wx", 0o600).catch(local);
  try {
    // Отказ диска — не дефект клиента; ошибки сервера проходят как есть.
    await fill(file).catch((error: NodeJS.ErrnoException) => {
      throw typeof error?.syscall === "string" ? saveFailed(error) : error;
    });
    await file.close();
    file = undefined;
    const bytes = (await stat(temporary)).size;
    // Эксклюзивная жёсткая ссылка публикует полный файл без гонки, которая есть
    // у переименования без перезаписи.
    if (overwrite) await rename(temporary, target).catch(local);
    else
      await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") local(error);
        return copyFile(temporary, target, constants.COPYFILE_EXCL).catch(local); // ФС без жёстких ссылок.
      });
    return bytes;
  } finally {
    await file?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function fileExists(): HcmError {
  return new HcmError(
    "FILE_EXISTS",
    "Файл по этому пути уже есть.",
    "Нужно разрешить замену файла (overwrite) или выбрать другой путь.",
  );
}

function saveFailed(error: NodeJS.ErrnoException): HcmError {
  return new HcmError(
    "FILE_SAVE_FAILED",
    `Не удалось записать файл на этом компьютере${error.code ? ` (${error.code})` : ""}.`,
    "Проверить права на папку и свободное место на диске или выбрать другой путь.",
  );
}
