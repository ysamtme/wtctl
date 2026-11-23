import { basename, resolve } from "node:path";
import { HcmError } from "../errors.js";
import { fileExistsUrl } from "../files.js";
import { ArgumentError } from "../protocol/error.js";
import { resolvePhysicalDocumentLocation } from "../protocol/physical-documents.js";
import {
  CliInputError,
  IDENTIFIER_RE,
  RPC_TARGET_RE,
  enumOption,
  exactPositionals,
  integerOption,
  intervalOption,
  jsonObject,
  listOption,
  optional,
  orderOption,
  orderedOptions,
  parseJson,
  repeatedOption,
  requirePositional,
  stringOption,
  type CliArguments,
} from "./arguments.js";
import { requireCommand } from "./help.js";
import {
  buildCreateData,
  mergePatchInput,
  parseCreateSetFlags,
  parseExecParams,
  parsePatchFlags,
  parseScalarArg,
  parseWhereFlags,
  resolvePositionalSearch,
} from "./input.js";
import type { CliIo } from "./types.js";

export type Invocation = { operationId: string; args: Record<string, unknown> };
export interface CommandOptions {
  /** Разрешено ли интерактивное подтверждение в TTY (для object delete без --permanent). */
  readonly interactive?: boolean;
}
type CommandHandler = (
  args: CliArguments,
  io: CliIo,
  options?: CommandOptions,
) => Promise<Invocation> | Invocation;

function assertObjectId(given: string, hint: string): void {
  try {
    resolvePhysicalDocumentLocation(given);
  } catch (error) {
    if (error instanceof ArgumentError) throw new CliInputError(error.message, hint);
    throw error;
  }
}

function hasInputSource(args: CliArguments): boolean {
  return (
    args.options["input-file"] !== undefined ||
    args.options.stdin === true ||
    args.options.args !== undefined
  );
}

/** Файл с этого компьютера: если он не открылся, это ошибка аргументов с путём к нему. */
async function readLocal<T>(
  flag: string | undefined,
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
    if (flag === undefined) {
      throw new CliInputError(
        code === "ENOENT"
          ? `Файл не найден: ${where}.`
          : code === "EISDIR"
            ? `Указана папка, а нужен файл: ${where}.`
            : `Файл не открывается для чтения: ${where}.`,
      );
    }
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

function encodeBinaryUpload(bytes: Uint8Array): { data: { base64: string } } {
  try {
    return { data: { base64: Buffer.from(bytes).toString("base64") } };
  } catch (error) {
    // Данные идут в вызове строкой base64, а строку длиннее 2^29 − 24 знаков Node.js не создаёт.
    if ((error as { code?: unknown }).code === "ERR_STRING_TOO_LONG")
      throw new CliInputError(
        "Размер ввода для этой команды ограничен 384 МиБ. Файл с диска записывает wtctl files write --input-file.",
      );
    throw error;
  }
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
  return encodeBinaryUpload(bytes);
}

/** files write: файл с диска операция читает сама частями, stdin приходит в память целиком. */
async function fileWriteData(args: CliArguments, io: CliIo): Promise<Record<string, unknown>> {
  const localFile = args.positionals[3];
  if (localFile !== undefined) {
    if (hasInputSource(args))
      throw new CliInputError("Файл задан и аргументом, и через --input-file или --stdin.");
    if (!localFile.trim()) throw new CliInputError("Путь к локальному файлу не может быть пустым.");
    return { file: resolve(localFile) };
  }
  const file = stringOption(args, "input-file");
  if (file !== undefined) return { file: resolve(file) };
  return { base64: ((await putData("file", args, io)).data as { base64: string }).base64 };
}

/** Объект задают [ТИП] ID или --id/--url; --type добавляет к ID без типа проверку типа. */
export function objectTarget(args: CliArguments): Record<string, unknown> {
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
    // Тип, адрес или переполненный ID отклоняются до чтения ввода и настроек.
    assertObjectId(given, "Объект задают [ТИП] ID, --id ID или --url АДРЕС.");
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

function validUploadName(value: string | undefined, message: string): string {
  if (!value || !value.trim() || value === "." || value === "..") throw new CliInputError(message);
  return value;
}

async function uploadFileInvocation(args: CliArguments, io: CliIo): Promise<Invocation> {
  exactPositionals(args, 2, 3);
  const pos = args.positionals[2];
  const name = stringOption(args, "name");
  if (name !== undefined && !name.trim())
    throw new CliInputError("Имя файла в --name не может быть пустым.");
  const inputFile = stringOption(args, "input-file");
  const useStdin = args.options.stdin === true;
  const contentType = optional("contentType", stringOption(args, "content-type"));

  let filename: string;
  let data: Record<string, unknown>;
  if (inputFile !== undefined || useStdin) {
    if (pos !== undefined && name !== undefined)
      throw new CliInputError("Имя файла задано и аргументом, и в --name.");
    filename = validUploadName(
      pos ?? name ?? (inputFile !== undefined ? basename(inputFile) : undefined),
      useStdin
        ? "При --stdin нужно указать имя файла аргументом или в --name."
        : "Не удалось определить имя файла: нужно указать его аргументом или в --name.",
    );
    data = await putData("file", args, io);
  } else {
    if (pos === undefined) throw new CliInputError("Не задан локальный файл для загрузки.");
    if (!pos.trim()) throw new CliInputError("Путь к локальному файлу не может быть пустым.");
    filename = validUploadName(
      name ?? basename(pos),
      "Не удалось определить имя файла из пути: нужно указать его через --name.",
    );
    if (!io.readBinaryFile)
      throw new CliInputError("Нужен файл через --input-file или двоичный ввод через --stdin.");
    data = encodeBinaryUpload(await readLocal(undefined, pos, (path) => io.readBinaryFile!(path)));
  }

  return {
    operationId: "web.pages.uploadFile",
    args: { filename, ...data, ...contentType },
  };
}

async function queryCommand(args: CliArguments, io: CliIo): Promise<Invocation> {
  exactPositionals(args, 1, 2);
  const positional = args.positionals[1];
  const posCatalog =
    positional !== undefined && IDENTIFIER_RE.test(positional) ? positional : undefined;
  const posQuery = posCatalog === undefined ? positional : undefined;
  const flagCatalog = stringOption(args, "catalog");
  if (posCatalog !== undefined && flagCatalog !== undefined)
    throw new CliInputError("Каталог задан и аргументом, и в --catalog.");
  const catalog = posCatalog ?? flagCatalog;
  if (posQuery !== undefined && flagCatalog !== undefined)
    throw new CliInputError("Задан и текст XQuery, и --catalog: нужно что-то одно.");
  const whereFlags = repeatedOption(args, "where");
  const hasSource = hasInputSource(args);
  if (posQuery !== undefined && hasSource)
    throw new CliInputError("Запрос задан и аргументом, и отдельным источником.");
  if (catalog && whereFlags.length > 0 && hasSource)
    throw new CliInputError("Условия заданы и в --where, и отдельным источником.");

  const source = await inputText(args, io);
  // Без каталога JSON-объект из отдельного источника — весь набор аргументов, как у api call.
  const whole = !catalog && source?.trimStart().startsWith("{") ? jsonObject(source) : undefined;
  if (whole && whereFlags.length > 0)
    throw new CliInputError("Условия заданы и в --where, и в файле аргументов.");
  if (whole && whole.catalog === undefined && whole.query === undefined)
    throw new CliInputError(
      "В объекте JSON нет ни catalog, ни query. Условия where передают вместе с --catalog.",
    );
  // С каталогом отдельный источник ввода несёт условия: оболочки портят кавычки в --where.
  const query = catalog || whole ? posQuery : (source ?? posQuery);
  if (!query?.trim() && !catalog && !whole)
    throw new CliInputError(
      "Нужен каталог (аргументом или через --catalog) либо текст запроса XQuery.",
    );
  if (!catalog && whereFlags.length > 0)
    throw new CliInputError("--where требует каталог или --catalog.");
  const where =
    whereFlags.length > 0
      ? parseWhereFlags(whereFlags)
      : catalog && source?.trim()
        ? jsonObject(source)
        : undefined;
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
      "--order работает с каталогом (аргументом или --catalog); в тексте XQuery сортировку пишут сами: order by $e/поле",
    );
  const all = args.options.all === true;
  const pageSize = integerOption(args, "page-size", 1, 1000);
  const maxRows = integerOption(args, "max-rows", 1, 10_000_000);
  const limit = integerOption(args, "limit", 1, 1000);
  const startPositionFlag = integerOption(args, "start-position", 0, 1_000_000);
  if (pageSize !== undefined && !all)
    throw new CliInputError("--page-size работает только вместе с --all.");
  if (maxRows !== undefined && !all)
    throw new CliInputError("--max-rows работает только вместе с --all.");
  if (all && (limit !== undefined || whole?.limit !== undefined))
    throw new CliInputError(
      "--all и --limit вместе не задаются.",
      "Размер страницы задаёт --page-size, а общее ограничение строк — --max-rows.",
    );
  const effectiveQuery = query ?? (typeof whole?.query === "string" ? whole.query : undefined);
  if (all && effectiveQuery !== undefined && /^\s*sql\s*:/i.test(effectiveQuery))
    throw new CliInputError(
      "--all не поддерживается для sql:-запросов: SQL может менять данные и не повторяется автоматически.",
      "Для одного вызова --all не нужен: передаются --limit и --start-position.",
    );
  if (all && startPositionFlag === undefined && whole?.startPosition !== undefined) {
    const start = whole.startPosition;
    if (
      typeof start !== "number" ||
      !Number.isSafeInteger(start) ||
      start < 0 ||
      start > 1_000_000
    ) {
      throw new CliInputError("startPosition должен быть целым числом от 0 до 1000000.");
    }
  }
  return {
    operationId: "runtime.query",
    args: {
      ...whole,
      ...optional("query", query),
      ...optional("catalog", catalog),
      ...optional("where", where),
      ...optional("fields", listOption(args, "fields")),
      ...optional("order", order),
      ...optional("limit", limit),
      ...optional("startPosition", startPositionFlag),
    },
  };
}

async function objectCommand(
  args: CliArguments,
  io: CliIo,
  options?: CommandOptions,
): Promise<Invocation> {
  const action = args.positionals[1];
  if (action === "create") {
    exactPositionals(args, 3);
    const type = requirePositional(args, 2, "тип объекта");
    const sets = parseCreateSetFlags(orderedOptions(args, ["set", "set-json"]));
    const hasInput = hasInputSource(args);
    if (!hasInput && sets.length === 0)
      throw new CliInputError(
        "Для команды нужен объект JSON через --input-file, --stdin или --args, либо --set/--set-json.",
      );
    const base = hasInput ? await inputObject(args, io, true) : undefined;
    const data = sets.length > 0 ? buildCreateData(base, sets) : base!;
    return {
      operationId: "objects.create",
      args: {
        type,
        data,
        ...optional("formUrl", stringOption(args, "form-url")),
        ...optional("dbName", stringOption(args, "db-name")),
      },
    };
  }
  if (action === "get") {
    const ids = listOption(args, "ids");
    const rest = args.positionals.slice(2);
    const id = stringOption(args, "id");
    const url = stringOption(args, "url");
    const type = stringOption(args, "type");
    const dbName = stringOption(args, "db-name");
    const checkTypeAndDb = () => {
      for (const value of [type, dbName])
        if (value !== undefined && !value.trim())
          throw new CliInputError("База и тип объекта должны быть непустыми строками.");
    };
    const validateIds = (list: readonly string[]) => {
      if (list.length === 0) throw new CliInputError("Нужен хотя бы один ID объекта.");
      if (list.length > 100)
        throw new CliInputError("За один вызов можно запросить не больше 100 объектов.");
      for (const given of list)
        assertObjectId(
          given,
          "Объект задают [ТИП] ID [ID …], --id ID, --ids ID,ID или --url АДРЕС.",
        );
    };
    let target: Record<string, unknown>;
    if (ids !== undefined) {
      if (rest.length > 0 || id !== undefined || url !== undefined)
        throw new CliInputError("--ids задаётся без [ТИП] ID, --id и --url.");
      checkTypeAndDb();
      validateIds(ids);
      target = { ids, ...optional("type", type), ...optional("dbName", dbName) };
    } else if (rest.length >= 2 && !(rest.length === 2 && IDENTIFIER_RE.test(rest[0]!))) {
      if (id !== undefined || url !== undefined)
        throw new CliInputError("Объект задан и аргументом, и через --id или --url.");
      checkTypeAndDb();
      const hasPosType = IDENTIFIER_RE.test(rest[0]!);
      const posType = hasPosType ? rest[0]! : undefined;
      const posIds = hasPosType ? rest.slice(1) : rest;
      if (posType !== undefined && type !== undefined)
        throw new CliInputError("Тип задан и аргументом, и в --type.");
      validateIds(posIds);
      target = {
        ids: posIds,
        ...optional("type", posType ?? type),
        ...optional("dbName", dbName),
      };
    } else {
      target = objectTarget(args);
    }
    return {
      operationId: "objects.get",
      args: { ...target, ...optional("fields", listOption(args, "fields")) },
    };
  }
  if (action === "patch") {
    const target = objectTarget(args);
    const flagOps = parsePatchFlags(orderedOptions(args, ["set", "set-json", "remove"]));
    const hasInput = hasInputSource(args);
    const resave = args.options.resave === true;
    if (!hasInput && flagOps.length === 0 && !resave)
      throw new CliInputError(
        "Для команды нужен JSON через --input-file, --stdin или --args, либо флаги --set, --set-json или --remove.",
      );
    const base = hasInput ? await inputJson(args, io) : undefined;
    return {
      operationId: "objects.patch",
      args: {
        ...target,
        ...mergePatchInput(base, flagOps, resave),
        ...optional("expectedFingerprint", stringOption(args, "expected-fingerprint")),
        ...(args.options.preview ? { preview: true } : {}),
        ...(resave ? { resave: true } : {}),
      },
    };
  }
  if (action === "edit") throw new CliInputError("object edit выполняется интерактивно через CLI.");
  // Осталась delete: вложенную команду проверил requireCommand.
  const target = objectTarget(args);
  const permanent = args.options.permanent === true;
  const interactive = options?.interactive === true;
  if (!permanent && !interactive)
    throw new CliInputError(
      "object delete удаляет объект насовсем и требует --permanent.",
      "Корзины нет: удалённый объект не вернуть.",
    );
  return {
    operationId: "objects.delete",
    args: {
      ...target,
      ...(permanent || args.options.yes === true ? { permanent: true } : {}),
      ...optional("catalog", stringOption(args, "catalog")),
    },
  };
}

async function filesCommand(args: CliArguments, io: CliIo): Promise<Invocation> {
  const action = args.positionals[1];
  if (action === "edit") throw new CliInputError("files edit выполняется интерактивно через CLI.");
  if (action === "upload") return uploadFileInvocation(args, io);
  if (action === "list") {
    exactPositionals(args, 3, 4);
    const search = resolvePositionalSearch(
      args.positionals[3],
      stringOption(args, "search"),
      "search",
    );
    return {
      operationId: "files.list",
      args: {
        url: requirePositional(args, 2, "адрес папки на сервере"),
        ...optional("search", search),
      },
    };
  }
  if (action === "write") {
    exactPositionals(args, 3, 4);
    return {
      operationId: "files.write",
      args: {
        url: requirePositional(args, 2, "адрес файла на сервере"),
        ...(await fileWriteData(args, io)),
      },
    };
  }
  exactPositionals(args, 3);
  if (action === "delete")
    return {
      operationId: "files.delete",
      args: { url: requirePositional(args, 2, "адрес файла на сервере") },
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
        url: requirePositional(args, 2, "адрес файла на сервере"),
        ...(args.options.base64 ? { encoding: "base64" } : {}),
        ...(to === undefined ? {} : { file: resolve(to) }),
        ...(args.options.overwrite ? { overwrite: true } : {}),
      },
    };
  }
  let url: string;
  try {
    url = fileExistsUrl(requirePositional(args, 2, "адрес файла на сервере"));
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
    exactPositionals(args, 2, 3);
    const query = resolvePositionalSearch(
      args.positionals[2],
      stringOption(args, "query"),
      "query",
    );
    return {
      operationId: "rpc.list",
      args: {
        ...optional("query", query),
        ...optional("library", stringOption(args, "library")),
        ...optional("method", stringOption(args, "method")),
        ...(args.options.all ? { all: true } : {}),
        ...optional("cursor", integerOption(args, "cursor", 0, Number.MAX_SAFE_INTEGER)),
        ...optional("limit", integerOption(args, "limit", 1, 100)),
      },
    };
  }
  if (action === "describe") {
    exactPositionals(args, 3);
    return {
      operationId: "rpc.describe",
      args: {
        targetId: requirePositional(args, 2, "аргумент БИБЛИОТЕКА.ФУНКЦИЯ"),
        ...(args.options.source ? { source: true } : {}),
      },
    };
  }
  let library: string;
  let method: string;
  let posArgs: string[];
  if (action !== undefined && RPC_TARGET_RE.test(action)) {
    const dot = action.indexOf(".");
    library = action.slice(0, dot);
    method = action.slice(dot + 1);
    posArgs = args.positionals.slice(2);
  } else {
    if (action !== undefined && action.includes("."))
      throw new CliInputError(
        "Неверная запись вызова: нужно БИБЛИОТЕКА.ФУНКЦИЯ или БИБЛИОТЕКА ФУНКЦИЯ.",
      );
    library = requirePositional(args, 1, "аргумент БИБЛИОТЕКА");
    method = requirePositional(args, 2, "аргумент ФУНКЦИЯ");
    posArgs = args.positionals.slice(3);
  }
  if (posArgs.length > 0 && hasInputSource(args))
    throw new CliInputError(
      "Аргументы функции заданы и позиционно, и через --args, --input-file или --stdin.",
    );
  const supplied = posArgs.length > 0 ? posArgs.map(parseScalarArg) : await inputJson(args, io, []);
  if (!Array.isArray(supplied))
    throw new CliInputError(
      "Аргументы функции — массив JSON.",
      "Элемент — строка, true, false, null, целое число; дробное и большое число, дату задают явно: {valueType, lexicalValue}.",
    );
  return {
    operationId: "rpc.call",
    args: {
      library,
      method,
      arguments: supplied,
      ...(args.options.async ? { async: true } : {}),
    },
  };
}

async function execCommand(args: CliArguments, io: CliIo): Promise<Invocation> {
  exactPositionals(args, 1, 2);
  if (hasInputSource(args) && args.positionals[1] !== undefined)
    throw new CliInputError("Код задан и аргументом, и отдельным источником.");
  const paramEntries = orderedOptions(args, ["params", "param-json"]);
  const file = stringOption(args, "params-file");
  if (paramEntries.length > 0 && file !== undefined)
    throw new CliInputError(
      paramEntries.some((entry) => entry.name === "param-json")
        ? "Параметры кода заданы и в --params/--param-json, и в --params-file."
        : "Параметры кода заданы и в --params, и в --params-file.",
    );
  const source = await inputText(args, io);
  const code = source ?? args.positionals[1];
  if (!code?.trim())
    throw new CliInputError("Нужен код SP-XML Script: аргументом, через --input-file или --stdin.");
  const params =
    file !== undefined
      ? jsonObject(await readLocal("params-file", file, (path) => io.readFile(path)))
      : paramEntries.length > 0
        ? parseExecParams(paramEntries)
        : undefined;
  return {
    operationId: "execute.script",
    args: { code, ...(params === undefined ? {} : { params }) },
  };
}

function resultCommand(args: CliArguments): Invocation {
  const exporting = args.positionals[1] === "export";
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
  if (command === "types") {
    exactPositionals(args, 1, 2);
    const search = resolvePositionalSearch(
      args.positionals[1],
      stringOption(args, "search"),
      "search",
    );
    return {
      operationId: "schema.types",
      args: {
        ...optional("search", search),
        ...optional("limit", integerOption(args, "limit", 1, 1000)),
        ...optional("cursor", integerOption(args, "cursor", 0, Number.MAX_SAFE_INTEGER)),
      },
    };
  }
  exactPositionals(args, 1, 3);
  const type = args.positionals[1];
  const posSearch = args.positionals[2];
  const url = stringOption(args, "url");
  if (url !== undefined && posSearch !== undefined)
    throw new CliInputError("С --url поиск задаётся флагом --search, а не аргументом.");
  const search = resolvePositionalSearch(posSearch, stringOption(args, "search"), "search");
  if (type !== undefined && !type.trim()) throw new CliInputError("Не задан тип объекта.");
  if (url !== undefined && !url.trim()) throw new CliInputError("Не задан --url.");
  if (type === undefined && url === undefined)
    throw new CliInputError("Не задан тип объекта или --url.");
  return {
    operationId: "schema.get",
    args: {
      ...optional("type", type),
      ...optional("url", url),
      ...optional("search", search),
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
  exactPositionals(args, 3, action === "search" ? 4 : 3);
  const file = requirePositional(args, 2, "файл или тип лога из logs list");
  if (!file.trim()) throw new CliInputError("Имя файла или типа лога не может быть пустым.");
  if (args.options.full && args.options["tail-bytes"])
    throw new CliInputError("Нужно выбрать --full или --tail-bytes.");
  const tailBytes = integerOption(args, "tail-bytes", 1, Number.MAX_SAFE_INTEGER);
  if (action === "tail") {
    integerOption(args, "lines", 1, 10000);
    const interval = intervalOption(args, "interval", 0.5, 60);
    if (interval !== undefined && args.options.follow !== true)
      throw new CliInputError("--interval в logs tail используется только вместе с -f / --follow.");
  }
  if (action === "follow") {
    const interval = intervalOption(args, "interval", 0.5, 60);
    if (args.options.once === true && interval !== undefined)
      throw new CliInputError("--once и --interval вместе не задаются.");
  }
  const base = {
    file,
    ...optional("tailBytes", tailBytes),
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
  const text = resolvePositionalSearch(args.positionals[3], stringOption(args, "text"), "text");
  return {
    operationId: "logs.search",
    args: {
      ...base,
      ...optional("text", text),
      ...optional("level", level),
      ...optional("context", stringOption(args, "context")),
      ...optional("offset", integerOption(args, "offset", 0, Number.MAX_SAFE_INTEGER)),
      ...optional("limit", integerOption(args, "limit", 1, 1000)),
      ...(args.options["newest-first"] ? { newestFirst: true } : {}),
      ...optional("expectedFingerprint", stringOption(args, "expected-fingerprint")),
    },
  };
}

const TRACKING_ID_RE = /^(?:\d+|0x[0-9a-fA-F]+)$/;

function parseAgentObjectIds(rawFlags: readonly string[]): string[] {
  const result: string[] = [];
  for (const raw of rawFlags) {
    const commaParts = raw.split(",");
    for (const part of commaParts) {
      const trimmed = part.trim();
      if (!trimmed) {
        throw new CliInputError(
          "--objects: список ID не может содержать пустые значения.",
          "Пример: --objects 0x1,0x2.",
        );
      }
      // PowerShell при вызове через обёртку npm склеивает 0x1,0x2 без кавычек через пробел.
      for (const token of trimmed.split(/\s+/)) {
        assertObjectId(
          token,
          "--objects принимает ID строкой 0x… или десятичной записью через запятую.",
        );
        result.push(token);
      }
    }
  }
  if (result.length === 0) throw new CliInputError("--objects: нужен хотя бы один ID.");
  if (result.length > 1000) throw new CliInputError("--objects: можно передать не больше 1000 ID.");
  return result;
}

const AGENT_THREAD_ID_RE = /^-?\d{1,20}$/;
const AGENT_ROLE_UID_RE = /^[^\s\u0000-\u001f\u007f]{0,128}$/;

function assertAgentThreadId(given: string, label: string): void {
  if (!AGENT_THREAD_ID_RE.test(given)) {
    throw new CliInputError(
      `${label} должен быть ID потока агента (десятичным числом).`,
      "ID потока возвращает wtctl agent run и wtctl agent status.",
    );
  }
}

function agentCommand(args: CliArguments): Invocation {
  const action = args.positionals[1];
  if (action === "status") {
    exactPositionals(args, 2, 3);
    const id = args.positionals[2];
    if (id !== undefined) {
      assertObjectId(id, "ID агента передаётся строкой: 0x… или десятичной записью.");
    }
    const threadId = stringOption(args, "thread");
    if (threadId !== undefined) assertAgentThreadId(threadId, "--thread");
    const status = enumOption(
      args,
      "status",
      ["running", "finished", "cancelled"],
      "Для --status допустимы running, finished или cancelled.",
    );
    const limit = integerOption(args, "limit", 1, 200);
    const wait = args.options.wait === true;
    const waitTimeoutMs = integerOption(args, "wait-timeout-ms", 1000, 3_600_000);
    if (wait && threadId === undefined) {
      throw new CliInputError(
        "--wait требует указать --thread ID.",
        "Пример: wtctl agent status --thread 3102754751613348050 --wait.",
      );
    }
    if (!wait && waitTimeoutMs !== undefined) {
      throw new CliInputError(
        "--wait-timeout-ms используется только вместе с --wait.",
        "Добавьте --wait и --thread ID.",
      );
    }
    return {
      operationId: "agents.status",
      args: {
        ...optional("id", id),
        ...optional("threadId", threadId),
        ...optional("status", status),
        ...optional("limit", limit),
        ...(wait ? { wait: true } : {}),
        ...optional("waitTimeoutMs", waitTimeoutMs),
      },
    };
  }

  if (action === "cancel") {
    exactPositionals(args, 3);
    const threadId = requirePositional(args, 2, "ID потока агента");
    assertAgentThreadId(threadId, "ID потока агента");
    const roleUID = stringOption(args, "role");
    if (roleUID !== undefined && !AGENT_ROLE_UID_RE.test(roleUID)) {
      throw new CliInputError(
        "--role должен быть непустым идентификатором роли сервера без пробелов (до 128 знаков).",
      );
    }
    return {
      operationId: "agents.cancel",
      args: {
        threadId,
        ...optional("roleUID", roleUID),
      },
    };
  }

  // Подкоманду `run` уже проверил requireCommand.
  exactPositionals(args, 3);
  const id = requirePositional(args, 2, "ID агента");
  assertObjectId(id, "ID агента передаётся строкой: 0x… или десятичной записью.");
  const objectId = stringOption(args, "object");
  if (objectId !== undefined) {
    if (!objectId.trim()) throw new CliInputError("--object не может быть пустым.");
    assertObjectId(objectId, "--object принимает ID объекта: 0x… или десятичной записью.");
  }
  const rawObjects = repeatedOption(args, "objects");
  if (objectId !== undefined && rawObjects.length > 0) {
    throw new CliInputError(
      "Нужно выбрать --object или --objects, но не оба сразу.",
      "Для одного объекта — --object ID, для списка — --objects ID,ID.",
    );
  }
  const objectIds = rawObjects.length > 0 ? parseAgentObjectIds(rawObjects) : undefined;
  const noWait = args.options["no-wait"] === true;
  const waitTimeoutMs = integerOption(args, "wait-timeout-ms", 1000, 3_600_000);
  if (noWait && waitTimeoutMs !== undefined) {
    throw new CliInputError(
      "--wait-timeout-ms несовместим с --no-wait.",
      "Уберите --wait-timeout-ms или запускайте без --no-wait.",
    );
  }
  if (noWait && args.options.logs === true) {
    throw new CliInputError(
      "--logs несовместим с --no-wait: агент ещё выполняется.",
      "Проверьте логи после завершения через wtctl logs tail xhttp или дождитесь агента через wtctl agent status --thread ID --wait.",
    );
  }
  const allowConcurrent = args.options["allow-concurrent"] === true;
  return {
    operationId: "agents.run",
    args: {
      id,
      ...optional("objectId", objectId),
      ...optional("objectIds", objectIds),
      ...(noWait ? { wait: false } : {}),
      ...optional("waitTimeoutMs", waitTimeoutMs),
      ...(allowConcurrent ? { allowConcurrent: true } : {}),
    },
  };
}

function tasksCommand(args: CliArguments): Invocation {
  const action = args.positionals[1];
  if (action === "list") {
    exactPositionals(args, 2, 4);
    const pos1 = args.positionals[2];
    const pos2 = args.positionals[3];
    const flagLib = stringOption(args, "library");
    const flagMethod = stringOption(args, "method");
    if (pos1 !== undefined && (flagLib !== undefined || flagMethod !== undefined)) {
      throw new CliInputError("Имя функции задано и аргументом, и через --library/--method.");
    }
    if ((flagLib !== undefined) !== (flagMethod !== undefined)) {
      throw new CliInputError(
        "Для поиска задач нужно указать вместе --library и --method.",
        "Формат: wtctl tasks list БИБЛИОТЕКА.ФУНКЦИЯ или --library БИБ --method ФУНКЦИЯ.",
      );
    }
    let libName = "";
    let methodName = "";
    if (flagLib !== undefined && flagMethod !== undefined) {
      if (!flagLib.trim() || !flagMethod.trim()) {
        throw new CliInputError("Имена библиотеки и функции не могут быть пустыми.");
      }
      libName = flagLib;
      methodName = flagMethod;
    } else if (pos1 !== undefined && pos2 !== undefined) {
      if (pos1.includes(".")) {
        throw new CliInputError(
          "Неверная запись имени функции: нужно БИБЛИОТЕКА.ФУНКЦИЯ или БИБЛИОТЕКА ФУНКЦИЯ.",
        );
      }
      if (!pos1.trim() || !pos2.trim()) {
        throw new CliInputError("Имена библиотеки и функции не могут быть пустыми.");
      }
      libName = pos1;
      methodName = pos2;
    } else if (pos1 !== undefined) {
      if (!RPC_TARGET_RE.test(pos1)) {
        throw new CliInputError(
          "Нужно имя функции в формате БИБЛИОТЕКА.ФУНКЦИЯ или БИБЛИОТЕКА ФУНКЦИЯ.",
          "Пример: wtctl tasks list tools.get_version.",
        );
      }
      const dot = pos1.indexOf(".");
      libName = pos1.slice(0, dot);
      methodName = pos1.slice(dot + 1);
    }
    return {
      operationId: "web.spxml.getBackgroundTasksByName",
      args: { libName, methodName },
    };
  }
  exactPositionals(args, 3);
  const trackingId = requirePositional(args, 2, "TrackingID задачи");
  if (!TRACKING_ID_RE.test(trackingId)) {
    throw new CliInputError("TrackingID задачи должен быть строкой 0x… или десятичным числом.");
  }
  return {
    operationId:
      action === "status" ? "web.spxml.getAsyncMethodStatus" : "web.spxml.killAsyncMethod",
    args: { trackingId },
  };
}

const COMMANDS: Record<string, CommandHandler> = {
  check: (args) => {
    exactPositionals(args, 1);
    return { operationId: "runtime.check", args: {} };
  },
  status: (args) => {
    exactPositionals(args, 1);
    return { operationId: "runtime.status", args: {} };
  },
  server: (args) => {
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
    exactPositionals(args, 1);
    return { operationId: "runtime.batch", args: await inputObject(args, io, true) };
  },
  ws: (args) => {
    exactPositionals(args, 2);
    return {
      operationId: "web.websocket.heartbeat",
      args: { ...optional("timeoutMs", integerOption(args, "timeout-ms", 250, 10000)) },
    };
  },
  api: async (args, io) => {
    // api list и api describe runCli выполняет без вызова реестра.
    if (args.positionals[1] !== "call") throw new CliInputError("Команда не определена.");
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
    exactPositionals(args, 3);
    const url = requirePositional(args, 2, "адрес документа на сервере");
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
  agent: agentCommand,
  tasks: tasksCommand,
  result: resultCommand,
  schema: schemaOrTypesCommand,
  types: schemaOrTypesCommand,
  logs: logsCommand,
};

/** Компилирует команду в один явный вызов реестра; без поиска методов клиента по имени. */
export async function commandInvocation(
  args: CliArguments,
  io: CliIo,
  options?: CommandOptions,
): Promise<Invocation> {
  const [command] = args.positionals;
  requireCommand(args.positionals);
  // mcp, config, guide и version runCli выполняет сам.
  if (!command || !Object.hasOwn(COMMANDS, command))
    throw new CliInputError("Команда не определена.");
  return COMMANDS[command]!(args, io, options);
}
