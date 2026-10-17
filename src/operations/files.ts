import { FILE_EXISTS_URL_MAX_LENGTH } from "../files.js";
import { boolean, operation, schema, string } from "../operation.js";

export const fileOperations = [
  operation({
    id: "files.exists",
    effect: "read",
    description:
      "Есть ли файл или папка по адресу x-local://…. Ответ ничего не говорит о содержимом, размере и правах на чтение. Адрес — до 256 знаков.",
    inputSchema: schema(
      {
        url: {
          type: "string",
          minLength: 1,
          maxLength: FILE_EXISTS_URL_MAX_LENGTH,
          pattern: "^x-local://",
        },
      },
      ["url"],
    ),
    summary: "Есть ли файл или папка по адресу.",
    run: (context, args) => context.files.exists(args),
  }),
  operation({
    id: "files.read",
    effect: "read",
    description:
      'Прочитать файл по адресу сервера: text, если содержимое — текст в UTF-8, иначе base64. encoding:"base64" отдаёт base64 и для текста. file — полный путь на этом компьютере: файл любого размера сохраняется туда байт в байт, overwrite заменяет существующий. Документы объектов читает objects.get.',
    inputSchema: schema(
      {
        url: string,
        encoding: { type: "string", enum: ["base64"] },
        file: string,
        overwrite: boolean,
      },
      ["url"],
    ),
    summary: "Прочитать файл: текст в UTF-8 или base64; с file — сохранить на этот компьютер.",
    usualCause: "по этому адресу ничего нет",
    // Содержимое сохраняется всегда: results.export пишет его в файл. Ответ о файле на диске — нет.
    reply: { store: (data) => (data as { file?: unknown }).file === undefined },
    run: (context, args) => context.files.read(args),
  }),
  operation({
    id: "files.list",
    effect: "execute",
    description:
      "Один уровень папки x-local://папка или x-local://папка/путь: items — файлы с размером (bytes) и вложенные папки (folder:true), по имени. search оставляет имена с этой частью, регистр не важен. Список даёт код на сервере: нужно право execute.",
    inputSchema: schema({ url: string, search: string }, ["url"]),
    summary: "Показать один уровень папки: файлы с размером и вложенные папки.",
    run: (context, args, call) => context.files.list(args, call),
  }),
  operation({
    id: "files.write",
    effect: "write",
    description:
      "Записать файл любого размера по адресу x-local://…: text — текст (пишется в UTF-8), base64 — двоичные данные, file — полный путь к файлу на этом компьютере, без передачи данных в вызове. Файл заменяется целиком, вложенные папки сервер создаёт сам. confirmed — файл прочитан назад и совпал с отправленным. Папке кода (wt, wtv, custom…) нужно ещё право execute: файл в ней — код сервера. Какие папки принимают запись, показывает server.info.",
    inputSchema: schema({ url: string, text: string, base64: string, file: string }, ["url"]),
    summary:
      "Записать файл: text, base64 или file с этого компьютера; после записи файл сверяется.",
    run: (context, args, call) => context.files.write(args, call),
  }),
  operation({
    id: "files.delete",
    effect: "write",
    description:
      "Удалить файл по адресу x-local://…. В папке данных так же удаляется пустая папка; в папке кода — только файл, и нужно ещё право execute.",
    inputSchema: schema({ url: string }, ["url"]),
    summary: "Удалить файл (в папке данных — и пустую папку).",
    usualCause:
      "в папке есть файлы; если сервер не сообщил, какие папки принимают запись, это может быть папка кода, где файл удаляет код на сервере",
    run: (context, args, call) => context.files.delete(args, call),
  }),
] as const;
