import { resolve } from "node:path";
import { HcmError } from "../errors.js";
import { fileExistsUrl } from "../files.js";
import {
  CliInputError,
  allowOptions,
  enumOption,
  exactPositionals,
  integerOption,
  jsonObject,
  listOption,
  optional,
  orderOption,
  parseJson,
  requirePositional,
  stringOption,
  type CliArguments,
} from "./arguments.js";
import { requireCommand } from "./help.js";
import type { CliIo } from "./types.js";

const INPUT = ["input-file", "stdin", "args"];
const OBJECT_TARGET = ["id", "url", "type", "db-name"];

export type Invocation = { operationId: string; args: Record<string, unknown> };
type CommandHandler = (args: CliArguments, io: CliIo) => Promise<Invocation> | Invocation;

/** Файл с этого компьютера из флага: если он не открылся, это ошибка аргументов с путём к нему. */
async function readLocal<T>(
  flag: string,
  path: string,
  read: (path: string) => Promise<T>,
): Promise<T> {
  try {
    return await read(path);
  } catch (error) {
    const { code, syscall } = (error ?? {}) as NodeJS.ErrnoException;
    // Размер и кодировку проверяет само чтение, здесь — только отказ файловой системы.
    if (syscall === undefined) throw error;
    const where = resolve(path);
    throw new CliInputError(
      code === "ENOENT"
        ? `Файл из --${flag} не найден: ${where}.`
        : code === "EISDIR"
          ? `В --${flag} указана папка, а нужен файл: ${where}.`
          : `Файл из --${flag} не открывается для чтения: ${where}.`,
    );
  }
}

async function inputText(args: CliArguments, io: CliIo): Promise<string | undefined> {
  const file = stringOption(args, "input-file");
  return file
    ? await readLocal("input-file", file, (path) => io.readFile(path))
    : args.options.stdin
      ? await io.readStdin()
      : stringOption(args, "args");
}

async function inputObject(
  args: CliArguments,
  io: CliIo,
  required = false,
): Promise<Record<string, unknown>> {
  const text = await inputText(args, io);
  if (text === undefined) {
    if (required)
      throw new CliInputError(
        "Для команды нужен объект JSON через --input-file, --stdin или --args.",
      );
    return {};
  }
  return jsonObject(text);
}

async function inputJson(args: CliArguments, io: CliIo, fallback?: unknown): Promise<unknown> {
  const text = await inputText(args, io);
  if (text === undefined) {
    if (fallback !== undefined) return fallback;
    throw new CliInputError("Для команды нужен JSON через --input-file, --stdin или --args.");
  }
  return parseJson(text);
}

async function putData(
  command: "doc" | "file",
  args: CliArguments,
  io: CliIo,
): Promise<Record<string, unknown>> {
  if (stringOption(args, "args") !== undefined) return inputObject(args, io, true);
  if (command === "doc") {
    const data = await inputText(args, io);
    if (!data?.trim())
      throw new CliInputError("Для doc put нужен XML через --input-file или --stdin.");
    return { data };
  }
  const file = stringOption(args, "input-file");
  let bytes: Uint8Array;
  if (file && io.readBinaryFile)
    bytes = await readLocal("input-file", file, (path) => io.readBinaryFile!(path));
  else if (args.options.stdin && io.readBinaryStdin) bytes = await io.readBinaryStdin();
  else throw new CliInputError("Нужен файл через --input-file или двоичный ввод через --stdin.");
  try {
    return { data: { base64: Buffer.from(bytes).toString("base64") } };
  } catch (error) {
    // Данные идут в вызове строкой base64, а строку длиннее 2^29 − 24 знаков Node.js не создаёт.
    if ((error as { code?: unknown }).code === "ERR_STRING_TOO_LONG")
      throw new CliInputError(
        "Ввод больше 384 МиБ в вызов не помещается. Файл с диска записывает wtctl files write --input-file.",
      );
    throw error;
  }
}

/** files write: файл с диска операция читает сама частями, stdin приходит в память целиком. */
async function fileWriteData(args: CliArguments, io: CliIo): Promise<Record<string, unknown>> {
  const file = stringOption(args, "input-file");
  if (file !== undefined) return { file: resolve(file) };
  return { base64: ((await putData("file", args, io)).data as { base64: string }).base64 };
}

/** Объект задают [ТИП] ID или --id/--url; --type добавляет к ID без типа проверку типа. */
function objectTarget(args: CliArguments): Record<string, unknown> {
  const id = stringOption(args, "id");
  const url = stringOption(args, "url");
  const type = stringOption(args, "type");
  const dbName = stringOption(args, "db-name");
  for (const value of [id, url, type, dbName])
    if (value !== undefined && !value.trim())
      throw new CliInputError("Адрес, база и тип объекта должны быть непустыми строками.");
  if (id === undefined && url === undefined) {
    if (args.positionals.length === 2)
      throw new CliInputError("Не задан объект: ID, ТИП ID, --id ID или --url АДРЕС.");
    exactPositionals(args, 3, 4);
    const typed = args.positionals.length === 4;
    if (typed && type !== undefined) throw new CliInputError("Тип задан и аргументом, и в --type.");
    const given = args.positionals.at(-1)!;
    // Тип или адрес на месте ID отклоняется до чтения ввода и настроек; точную запись ID проверяет операция.
    if (!/^(?:\d+|0x[0-9a-f]+)$/i.test(given))
      throw new CliInputError(
        "ID объекта записан неверно: нужна строка 0x… или десятичное число без знака.",
        "Объект задают [ТИП] ID, --id ID или --url АДРЕС.",
      );
    return {
      id: given,
      ...optional("type", typed ? requirePositional(args, 2, "тип объекта") : type),
      ...optional("dbName", dbName),
    };
  }
  if (args.positionals.length !== 2)
    throw new CliInputError("Объект задан и аргументом, и через --id или --url.");
  if (id !== undefined && url !== undefined)
    throw new CliInputError("Нужен один из --id и --url, а не оба.");
  if (url !== undefined && dbName !== undefined)
    throw new CliInputError("--db-name не нужен вместе с --url: адрес уже называет базу.");
  return {
    ...optional("id", id),
    ...optional("url", url),
    ...optional("type", type),
    ...optional("dbName", dbName),
  };
}

async function uploadFileInvocation(args: CliArguments, io: CliIo): Promise<Invocation> {
  allowOptions(args, ["input-file", "stdin", "content-type"]);
  exactPositionals(args, 3);
  return {
    operationId: "web.pages.uploadFile",
    args: {
      filename: requirePositional(args, 2, "имя файла без пути"),
      ...(await putData("file", args, io)),
      ...optional("contentType", stringOption(args, "content-type")),
    },
  };
}

async function queryCommand(args: CliArguments, io: CliIo): Promise<Invocation> {
  allowOptions(args, [...INPUT, "limit", "start-position", "catalog", "where", "fields", "order"]);
  exactPositionals(args, 1, 2);
  const source = await inputText(args, io);
  if (source !== undefined && args.positionals[1] !== undefined)
    throw new CliInputError("Запрос задан и аргументом, и отдельным источником.");
  const catalog = stringOption(args, "catalog");
  const option = stringOption(args, "where");
  // Без каталога JSON-объект из отдельного источника — весь набор аргументов, как у api call.
  const whole = !catalog && source?.trimStart().startsWith("{") ? jsonObject(source) : undefined;
  if (whole && option) throw new CliInputError("Условия заданы и в --where, и в файле аргументов.");
  if (whole && whole.catalog === undefined && whole.query === undefined)
    throw new CliInputError(
      "В объекте JSON нет ни catalog, ни query. Условия where передают вместе с --catalog.",
    );
  // С каталогом отдельный источник ввода несёт условия: оболочки портят кавычки в --where.
  const query = catalog || whole ? args.positionals[1] : (source ?? args.positionals[1]);
  if (!query?.trim() && !catalog && !whole)
    throw new CliInputError("Нужен --catalog или текст запроса XQuery.");
  if (query && catalog)
    throw new CliInputError("Задан и текст XQuery, и --catalog: нужно что-то одно.");
  if (catalog && option && source !== undefined)
    throw new CliInputError("Условия заданы и в --where, и отдельным источником.");
  const whereText = option ?? (catalog ? source : undefined);
  if (!catalog && whereText) throw new CliInputError("--where требует --catalog.");
  const where = whereText ? jsonObject(whereText) : undefined;
  // Весь набор аргументов рядом с --catalog читался бы как условие на поле "where".
  const nested = where?.where;
  if (
    Array.isArray(where?.fields) ||
    Array.isArray(where?.order) ||
    (nested !== null &&
      typeof nested === "object" &&
      !Array.isArray(nested) &&
      !Object.keys(nested).some((key) =>
        ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in"].includes(key),
      ))
  )
    throw new CliInputError(
      'С --catalog в источнике пишут сами условия: {"поле": значение}. Набор {catalog, where, fields} передают без --catalog.',
    );
  const order = orderOption(args);
  if (order && !catalog && whole?.catalog === undefined)
    throw new CliInputError(
      "--order работает с --catalog; в тексте XQuery сортировку пишут сами: order by $e/поле",
    );
  return {
    operationId: "runtime.query",
    args: {
      ...whole,
      ...optional("query", query),
      ...optional("catalog", catalog),
      ...optional("where", where),
      ...optional("fields", listOption(args, "fields")),
      ...optional("order", order),
      ...optional("limit", integerOption(args, "limit", 1, 1000)),
      ...optional("startPosition", integerOption(args, "start-position", 0, 1_000_000)),
    },
  };
}

async function objectCommand(args: CliArguments, io: CliIo): Promise<Invocation> {
  const action = args.positionals[1];
  if (action === "create") {
    allowOptions(args, [...INPUT, "form-url", "db-name"]);
    exactPositionals(args, 3);
    const type = requirePositional(args, 2, "тип объекта");
    return {
      operationId: "objects.create",
      args: {
        type,
        data: await inputObject(args, io, true),
        ...optional("formUrl", stringOption(args, "form-url")),
        ...optional("dbName", stringOption(args, "db-name")),
      },
    };
  }
  if (action === "get") {
    allowOptions(args, [...OBJECT_TARGET, "ids", "fields"]);
    const ids = listOption(args, "ids");
    if (
      ids !== undefined &&
      (args.positionals.length !== 2 ||
        stringOption(args, "id") !== undefined ||
        stringOption(args, "url") !== undefined)
    )
      throw new CliInputError("--ids задаётся без [ТИП] ID, --id и --url.");
    const type = stringOption(args, "type");
    const dbName = stringOption(args, "db-name");
    if (ids !== undefined) {
      for (const value of [type, dbName])
        if (value !== undefined && !value.trim())
          throw new CliInputError("База и тип объекта должны быть непустыми строками.");
    }
    const target =
      ids === undefined
        ? objectTarget(args)
        : { ids, ...optional("type", type), ...optional("dbName", dbName) };
    return {
      operationId: "objects.get",
      args: { ...target, ...optional("fields", listOption(args, "fields")) },
    };
  }
  if (action === "patch") {
    allowOptions(args, [...OBJECT_TARGET, ...INPUT, "expected-fingerprint", "preview", "resave"]);
    const target = objectTarget(args);
    const resave = args.options.resave ? { resave: true } : {};
    // Один --resave сохраняет документ как есть.
    const input = await inputJson(args, io, args.options.resave ? {} : undefined);
    if (input === null || typeof input !== "object")
      throw new CliInputError("Правка — объект {поле: значение} или массив операций.");
    // Тот же файл, что аргументы инструмента MCP: {patch: {…}, remove: […]}.
    const whole =
      !Array.isArray(input) &&
      Object.keys(input).length > 0 &&
      Object.keys(input).every((key) => key === "patch" || key === "remove") &&
      (!("patch" in input) || (input.patch !== null && typeof input.patch === "object")) &&
      (!("remove" in input) || Array.isArray(input.remove));
    return {
      operationId: "objects.patch",
      args: {
        ...target,
        ...(whole
          ? input
          : Object.keys(input).length || !args.options.resave
            ? { patch: input }
            : {}),
        ...optional("expectedFingerprint", stringOption(args, "expected-fingerprint")),
        ...(args.options.preview ? { preview: true } : {}),
        ...resave,
      },
    };
  }
  // Осталась delete: вложенную команду проверил requireCommand.
  allowOptions(args, [...OBJECT_TARGET, "permanent", "catalog"]);
  const target = objectTarget(args);
  if (!args.options.permanent)
    throw new CliInputError(
      "object delete удаляет объект насовсем и требует --permanent.",
      "Корзины нет: удалённый объект не вернуть.",
    );
  return {
    operationId: "objects.delete",
    args: {
      ...target,
      permanent: true,
      ...optional("catalog", stringOption(args, "catalog")),
    },
  };
}

async function filesCommand(args: CliArguments, io: CliIo): Promise<Invocation> {
  const action = args.positionals[1];
  if (action === "upload") return uploadFileInvocation(args, io);
  allowOptions(
    args,
    action === "read"
      ? ["base64", "to", "overwrite"]
      : action === "write"
        ? ["input-file", "stdin"]
        : action === "list"
          ? ["search"]
          : [],
  );
  exactPositionals(args, 3);
  if (action === "write" || action === "delete" || action === "list")
    return {
      operationId: `files.${action}`,
      args: {
        url: requirePositional(args, 2, "серверный URL"),
        ...(action === "write" ? await fileWriteData(args, io) : {}),
        ...optional("search", stringOption(args, "search")),
      },
    };
  if (action === "read") {
    const to = stringOption(args, "to");
    if (to === undefined && args.options.overwrite)
      throw new CliInputError("--overwrite действует только вместе с --to.");
    if (to !== undefined && args.options.base64)
      throw new CliInputError("--base64 не нужен вместе с --to: файл сохраняется байт в байт.");
    return {
      operationId: "files.read",
      args: {
        url: requirePositional(args, 2, "серверный URL"),
        ...(args.options.base64 ? { encoding: "base64" } : {}),
        ...(to === undefined ? {} : { file: resolve(to) }),
        ...(args.options.overwrite ? { overwrite: true } : {}),
      },
    };
  }
  let url: string;
  try {
    url = fileExistsUrl(requirePositional(args, 2, "серверный URL"));
  } catch (error) {
    if (error instanceof HcmError && error.code === "INVALID_ARGUMENT")
      throw new CliInputError(error.message, error.hint);
    throw error;
  }
  return { operationId: "files.exists", args: { url } };
}

async function rpcCommand(args: CliArguments, io: CliIo): Promise<Invocation> {
  const action = args.positionals[1];
  if (action === "list") {
    allowOptions(args, ["query", "library", "method", "all", "cursor", "limit"]);
    exactPositionals(args, 2);
    return {
      operationId: "rpc.list",
      args: {
        ...optional("query", stringOption(args, "query")),
        ...optional("library", stringOption(args, "library")),
        ...optional("method", stringOption(args, "method")),
        ...(args.options.all ? { all: true } : {}),
        ...optional("cursor", integerOption(args, "cursor", 0, Number.MAX_SAFE_INTEGER)),
        ...optional("limit", integerOption(args, "limit", 1, 100)),
      },
    };
  }
  if (action === "describe") {
    allowOptions(args, ["source"]);
    exactPositionals(args, 3);
    return {
      operationId: "rpc.describe",
      args: {
        targetId: requirePositional(args, 2, "аргумент БИБЛИОТЕКА.ФУНКЦИЯ"),
        ...(args.options.source ? { source: true } : {}),
      },
    };
  }
  allowOptions(args, [...INPUT, "async"]);
  exactPositionals(args, 3);
  const supplied = await inputJson(args, io, []);
  if (!Array.isArray(supplied))
    throw new CliInputError(
      "Аргументы функции — массив JSON.",
      "Элемент — строка, true, false, null, целое число; дробное и большое число, дату задают явно: {valueType, lexicalValue}.",
    );
  return {
    operationId: "rpc.call",
    args: {
      library: requirePositional(args, 1, "библиотека"),
      method: requirePositional(args, 2, "метод"),
      arguments: supplied,
      ...(args.options.async ? { async: true } : {}),
    },
  };
}

async function execCommand(args: CliArguments, io: CliIo): Promise<Invocation> {
  allowOptions(args, [...INPUT, "params", "params-file"]);
  exactPositionals(args, 1, 2);
  const source = await inputText(args, io);
  if (source !== undefined && args.positionals[1] !== undefined)
    throw new CliInputError("Код задан и аргументом, и отдельным источником.");
  const code = source ?? args.positionals[1];
  if (!code?.trim())
    throw new CliInputError("Нужен код SP-XML Script: аргументом, через --input-file или --stdin.");
  const inline = stringOption(args, "params");
  const file = stringOption(args, "params-file");
  if (inline !== undefined && file !== undefined)
    throw new CliInputError("Параметры кода заданы и в --params, и в --params-file.");
  const params = file ? await readLocal("params-file", file, (path) => io.readFile(path)) : inline;
  return {
    operationId: "execute.script",
    args: { code, ...(params === undefined ? {} : { params: jsonObject(params) }) },
  };
}

function resultCommand(args: CliArguments): Invocation {
  const exporting = args.positionals[1] === "export";
  allowOptions(args, exporting ? ["to", "format", "overwrite"] : ["offset", "limit", "format"]);
  exactPositionals(args, 3);
  const format = exporting
    ? stringOption(args, "format")
    : enumOption(
        args,
        "format",
        ["auto", "json", "text"],
        "--format должен быть auto, json или text.",
      );
  const path = stringOption(args, "to");
  if (exporting && !path) throw new CliInputError("result export требует --to ФАЙЛ.");
  return {
    operationId: exporting ? "results.export" : "results.read",
    args: {
      resultId: requirePositional(args, 2, "id результата"),
      ...(exporting
        ? { path, overwrite: args.options.overwrite === true }
        : {
            ...optional("offset", integerOption(args, "offset", 0, Number.MAX_SAFE_INTEGER)),
            ...optional("limit", integerOption(args, "limit", 1, 65536)),
          }),
      ...optional("format", format),
    },
  };
}

function schemaOrTypesCommand(args: CliArguments): Invocation {
  const command = args.positionals[0];
  allowOptions(args, [
    "search",
    "limit",
    "cursor",
    ...(command === "schema"
      ? ["url", "path", "origin", "kind", "include", "language", "deep"]
      : []),
  ]);
  exactPositionals(args, 1, command === "schema" ? 2 : 1);
  if (command === "types") {
    return {
      operationId: "schema.types",
      args: {
        ...optional("search", stringOption(args, "search")),
        ...optional("limit", integerOption(args, "limit", 1, 1000)),
        ...optional("cursor", integerOption(args, "cursor", 0, Number.MAX_SAFE_INTEGER)),
      },
    };
  }
  const type = args.positionals[1];
  const url = stringOption(args, "url");
  if (type !== undefined && !type.trim()) throw new CliInputError("Не задан тип объекта.");
  if (url !== undefined && !url.trim()) throw new CliInputError("Не задан --url.");
  if (type === undefined && url === undefined)
    throw new CliInputError("Не задан тип объекта или --url.");
  return {
    operationId: "schema.get",
    args: {
      ...optional("type", type),
      ...optional("url", url),
      ...optional("search", stringOption(args, "search")),
      ...optional("limit", integerOption(args, "limit", 1, 1000)),
      ...optional("cursor", integerOption(args, "cursor", 0, Number.MAX_SAFE_INTEGER)),
      ...optional("path", stringOption(args, "path")),
      ...(args.options.deep ? { deep: true } : {}),
      ...optional("origin", listOption(args, "origin")),
      ...optional("kind", stringOption(args, "kind")),
      ...optional("include", listOption(args, "include")),
      ...optional("language", stringOption(args, "language")),
    },
  };
}

function logsCommand(args: CliArguments): Invocation {
  const action = args.positionals[1];
  if (action === "list") {
    allowOptions(args, [
      "type",
      "date",
      "start-date",
      "end-date",
      "name-contains",
      "offset",
      "limit",
    ]);
    exactPositionals(args, 2);
    const date = stringOption(args, "date");
    if (date !== undefined && (args.options["start-date"] || args.options["end-date"]))
      throw new CliInputError("--date и --start-date или --end-date вместе не задаются.");
    return {
      operationId: "logs.list",
      args: {
        ...optional("type", stringOption(args, "type")),
        ...optional("nameContains", stringOption(args, "name-contains")),
        ...optional("startDate", date ?? stringOption(args, "start-date")),
        ...optional("endDate", date ?? stringOption(args, "end-date")),
        ...optional("offset", integerOption(args, "offset", 0, Number.MAX_SAFE_INTEGER)),
        ...optional("limit", integerOption(args, "limit", 1, 1000)),
      },
    };
  }
  const options =
    action === "search"
      ? [
          "tail-bytes",
          "full",
          "text",
          "level",
          "context",
          "offset",
          "limit",
          "newest-first",
          "expected-fingerprint",
        ]
      : action === "follow"
        ? ["tail-bytes", "full", "cursor"]
        : action === "tail"
          ? ["tail-bytes"]
          : ["tail-bytes", "full"];
  allowOptions(args, options);
  exactPositionals(args, 3);
  if (args.options.full && args.options["tail-bytes"])
    throw new CliInputError("Нужно выбрать --full или --tail-bytes.");
  const base = {
    file: requirePositional(args, 2, "имя файла или URL из logs list"),
    ...optional("tailBytes", integerOption(args, "tail-bytes", 1, Number.MAX_SAFE_INTEGER)),
    ...(args.options.full ? { full: true } : {}),
  };
  if (action === "read" || action === "tail") return { operationId: "logs.read", args: base };
  if (action === "follow")
    return {
      operationId: "logs.follow",
      args: { ...base, ...optional("cursor", stringOption(args, "cursor")) },
    };
  const level = enumOption(
    args,
    "level",
    ["normal", "debug", "info", "warning", "error", "critical"],
    "--level: normal, debug, info, warning, error или critical.",
  );
  return {
    operationId: "logs.search",
    args: {
      ...base,
      ...optional("text", stringOption(args, "text")),
      ...optional("level", level),
      ...optional("context", stringOption(args, "context")),
      ...optional("offset", integerOption(args, "offset", 0, Number.MAX_SAFE_INTEGER)),
      ...optional("limit", integerOption(args, "limit", 1, 1000)),
      ...(args.options["newest-first"] ? { newestFirst: true } : {}),
      ...optional("expectedFingerprint", stringOption(args, "expected-fingerprint")),
    },
  };
}

const COMMANDS: Record<string, CommandHandler> = {
  check: (args) => {
    allowOptions(args, []);
    exactPositionals(args, 1);
    return { operationId: "runtime.check", args: {} };
  },
  status: (args) => {
    allowOptions(args, []);
    exactPositionals(args, 1);
    return { operationId: "runtime.status", args: {} };
  },
  server: (args) => {
    allowOptions(args, ["profile"]);
    exactPositionals(args, 2);
    const profile = enumOption(
      args,
      "profile",
      ["native", "web"],
      "Для --profile допустимы native или web.",
    );
    return { operationId: "server.info", args: { ...optional("profile", profile) } };
  },
  run: async (args, io) => {
    allowOptions(args, INPUT);
    exactPositionals(args, 1);
    return { operationId: "runtime.batch", args: await inputObject(args, io, true) };
  },
  ws: (args) => {
    allowOptions(args, ["timeout-ms"]);
    exactPositionals(args, 2);
    return {
      operationId: "web.websocket.heartbeat",
      args: { ...optional("timeoutMs", integerOption(args, "timeout-ms", 250, 10000)) },
    };
  },
  api: async (args, io) => {
    // api list и api describe runCli выполняет без вызова реестра.
    if (args.positionals[1] !== "call") throw new CliInputError("Команда не определена.");
    allowOptions(args, INPUT);
    exactPositionals(args, 3);
    return {
      operationId: requirePositional(args, 2, "ID операции"),
      args: await inputObject(args, io),
    };
  },
  query: queryCommand,
  object: objectCommand,
  files: filesCommand,
  file: uploadFileInvocation,
  doc: async (args, io) => {
    const action = args.positionals[1];
    allowOptions(args, action === "put" ? INPUT : []);
    exactPositionals(args, 3);
    const url = requirePositional(args, 2, "серверный URL");
    const native = {
      get: "native.lds.loadDoc",
      put: "native.lds.putDoc",
      delete: "native.lds.deleteDoc",
    };
    return {
      operationId: native[action as "get" | "put" | "delete"],
      args: { ...(action === "put" ? await putData("doc", args, io) : {}), url },
    };
  },
  rpc: rpcCommand,
  exec: execCommand,
  result: resultCommand,
  schema: schemaOrTypesCommand,
  types: schemaOrTypesCommand,
  logs: logsCommand,
};

/** Компилирует команду в один явный вызов реестра; без поиска методов клиента по имени. */
export async function commandInvocation(args: CliArguments, io: CliIo): Promise<Invocation> {
  const [command] = args.positionals;
  requireCommand(args.positionals);
  // mcp, config, guide и version runCli выполняет сам.
  if (!command || !Object.hasOwn(COMMANDS, command))
    throw new CliInputError("Команда не определена.");
  return COMMANDS[command]!(args, io);
}
