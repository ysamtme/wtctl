import { errorInFrontendTerms } from "../frontend-names.js";
import type { MutationOutcome, OperationFilter, OperationResult } from "../contracts.js";
import { HcmError } from "../errors.js";
import {
  CliInputError,
  integerOption,
  jsonObject,
  listOption,
  orderOption,
  parseJson,
  commandOf,
  parseArguments,
  requirePositional,
  stringOption,
  type CliArguments,
} from "./arguments.js";
import { cliHelp, cliHelpText, helpCommand } from "./help.js";
import { discoverOperations, operationHelp } from "../operation-help.js";
import { configExample, defaultConfigPath, parseConfiguration, withConnection } from "../config.js";
import { DeferredRuntime } from "./deferred-runtime.js";
import { VERSION } from "../version.js";
import { guide, type LocalInstall } from "../guide.js";
import { resolve } from "node:path";
import { fileExistsUrl } from "../files.js";
import { describeHcmOperation, listHcmOperations } from "../catalog.js";
import type { CliDependencies, CliIo, RuntimePort } from "./types.js";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const COMMON = ["config", "connection", "json", "output", "help", "password-stdin"];
const INPUT = ["input-file", "stdin", "args"];
const OBJECT_TARGET = ["id", "url", "type"];
type Invocation = { operationId: string; args: Record<string, unknown> };

function frontendResult(operationId: string, connection: string, data: unknown): OperationResult {
  return { ok: true, data, meta: { operationId, connection, durationMs: 0 } };
}

function failure(code: string, message: string, hint?: string): OperationResult {
  return {
    ok: false,
    error: { code, message, ...(hint ? { hint } : {}) },
    meta: { operationId: "cli", connection: "unselected", durationMs: 0 },
  };
}

function frontendFailure(result: OperationResult, diagnostic: OperationResult, flag: string) {
  const error = result.error ?? {
    ...diagnostic.error!,
    retryable: false,
    details: { operationSucceeded: result.ok },
  };
  const meta = { ...result.meta, [flag]: true };
  return { ...result, ok: false, error, meta };
}

/** Одна строка для программ и агентов; с отступами — для человека в терминале или в файле. */
export function serializeResult(value: unknown, pretty = false): string {
  return `${JSON.stringify(value, (_key: string, item: unknown) => (typeof item === "bigint" ? item.toString(10) : item), pretty ? 2 : undefined)}\n`;
}

async function safeDiagnostic(io: CliIo, value: OperationResult): Promise<void> {
  try {
    await io.writeError(serializeResult(value, io.pretty === true));
  } catch {
    /* Закрытая диагностика — не второй сбой. */
  }
}

function allowOptions(args: CliArguments, allowed: readonly string[]): void {
  const set = new Set([...COMMON, ...allowed]);
  const extra = Object.keys(args.options).filter((key) => !set.has(key));
  if (!extra.length) return;
  const [first] = args.positionals;
  const command = first && first !== "help" ? ` ${first}` : "";
  throw new CliInputError(
    `Команда${command} не принимает: ${extra.map((key) => `--${key}`).join(", ")}.`,
  );
}

function exactPositionals(args: CliArguments, minimum: number, maximum = minimum): void {
  if (args.positionals.length < minimum || args.positionals.length > maximum) {
    if (args.positionals.length < minimum)
      throw new CliInputError("Не хватает аргументов команды.");
    throw new CliInputError(
      "Лишние аргументы команды.",
      "Текст с пробелами, например запрос XQuery, берут в кавычки целиком.",
    );
  }
}

async function inputText(args: CliArguments, io: CliIo): Promise<string | undefined> {
  const file = stringOption(args, "input-file");
  const text = file
    ? await io.readFile(file, MAX_INPUT_BYTES)
    : args.options.stdin
      ? await io.readStdin(MAX_INPUT_BYTES)
      : stringOption(args, "args");
  if (text !== undefined && Buffer.byteLength(text, "utf8") > MAX_INPUT_BYTES)
    throw new CliInputError("Ввод превышает 8 МиБ.");
  return text;
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
  if (file && io.readBinaryFile) bytes = await io.readBinaryFile(file, MAX_INPUT_BYTES);
  else if (args.options.stdin && io.readBinaryStdin)
    bytes = await io.readBinaryStdin(MAX_INPUT_BYTES);
  else throw new CliInputError("Нужен файл через --input-file или двоичный ввод через --stdin.");
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new CliInputError("Ввод превышает 8 МиБ.");
  return { data: { base64: Buffer.from(bytes).toString("base64") } };
}

/** Объект задают [ТИП] ID или --id/--url; --type добавляет к ID без типа проверку типа. */
function objectTarget(args: CliArguments): Record<string, unknown> {
  const id = stringOption(args, "id");
  const url = stringOption(args, "url");
  const type = stringOption(args, "type");
  for (const value of [id, url, type])
    if (value !== undefined && !value.trim())
      throw new CliInputError("Адрес и тип объекта должны быть непустыми строками.");
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
    };
  }
  if (args.positionals.length !== 2)
    throw new CliInputError("Объект задан и аргументом, и через --id или --url.");
  if (id !== undefined && url !== undefined)
    throw new CliInputError("Нужен один из --id и --url, а не оба.");
  return { ...optional("id", id), ...optional("url", url), ...optional("type", type) };
}

/** Команда настройки целиком: у MCP-сервера от хоста агента wtctl может не быть в PATH. */
function setupCommand(local: LocalInstall | undefined): string | undefined {
  if (!local) return undefined;
  const command = /[\\/]_npx[\\/]/.test(local.script)
    ? "npx -y wtctl"
    : `"${local.node}" "${local.script}"`;
  return `Файл создаёт человек в своём терминале, полная команда: ${command} config init`;
}

/** Гайд говорит, как команда и программа получают подключение, с которым работает процесс. */
function withSettings(
  local: LocalInstall | undefined,
  args: CliArguments,
): LocalInstall | undefined {
  if (!local) return undefined;
  const configPath = stringOption(args, "config") ?? process.env.WTCTL_CONFIG;
  const connection = stringOption(args, "connection") ?? process.env.WTCTL_CONNECTION;
  return {
    ...local,
    settings: {
      ...(configPath === undefined ? {} : { configPath: resolve(configPath) }),
      ...(connection === undefined ? {} : { connection }),
      environment: configPath === undefined && process.env.WTCTL_URL !== undefined,
    },
  };
}

/** Добавляет подключение в файл подключений, спрашивая у человека то, что не задано. */
async function initConnection(args: CliArguments, io: CliIo): Promise<OperationResult> {
  allowOptions(args, [
    "url",
    "username",
    "name",
    "password-env",
    "allow-write",
    "allow-execute",
    "force",
  ]);
  exactPositionals(args, 2);
  const path = stringOption(args, "config") ?? process.env.WTCTL_CONFIG ?? defaultConfigPath();
  const value = async (option: string, question: string): Promise<string> => {
    const given = stringOption(args, option);
    if (given !== undefined) return given;
    if (!io.prompt)
      throw new CliInputError(
        `Не задан --${option}.`,
        "В терминале команда сама спросит недостающее. Без терминала нужно задать --url, --username и пароль: --password-stdin или --password-env ИМЯ.",
      );
    const answer = (await io.prompt(question)).trim();
    if (!answer) throw new CliInputError("Значение не введено.");
    return answer;
  };
  const baseUrl = await value("url", "Адрес сервера, например http://localhost:8088: ");
  const username = await value("username", "Имя пользователя: ");
  const passwordEnv = stringOption(args, "password-env");
  let password: string | undefined;
  if (passwordEnv !== undefined) {
    if (args.options["password-stdin"])
      throw new CliInputError("Нужно выбрать --password-stdin или --password-env.");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(passwordEnv))
      throw new CliInputError("--password-env: это не имя переменной окружения.");
  } else {
    if (args.options["password-stdin"])
      password = (await io.readStdin(65536)).replace(/\r?\n$/, "");
    else if (io.prompt) password = await io.prompt("Пароль: ", true);
    else
      throw new CliInputError(
        "Не задан пароль.",
        "Нужно передать его через --password-stdin или назвать переменную с паролем: --password-env ИМЯ.",
      );
    if (!password || /[\r\n\0]/.test(password))
      throw new CliInputError("Пароль должен быть одной непустой строкой.");
  }
  let document: Record<string, unknown> = {};
  try {
    document = parseConfiguration(await io.readFile(path, 1024 * 1024), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const name = stringOption(args, "name") ?? "default";
  const write = args.options["allow-write"] === true;
  const execute = args.options["allow-execute"] === true;
  const next = withConnection(
    document,
    {
      name,
      baseUrl,
      username,
      ...optional("password", password),
      ...optional("passwordEnv", passwordEnv),
      write,
      execute,
    },
    args.options.force === true,
  );
  await io.writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  const selected = next.defaultConnection === name;
  // Переменная может появиться позже, например в env записи MCP-сервера: подключение записывается.
  const check =
    passwordEnv !== undefined && !process.env[passwordEnv]
      ? `Переменная ${passwordEnv} сейчас не задана, без неё подключение не откроется. Задать её и проверить подключение`
      : "Проверить подключение";
  return frontendResult("cli.config.init", name, {
    path,
    connection: name,
    defaultConnection: next.defaultConnection,
    permissions: { write, execute },
    next: `${check}: wtctl ${selected ? "" : `--connection ${name} `}check`,
  });
}

/** Компилирует команду в один явный вызов реестра; без поиска методов клиента по имени. */
export async function commandInvocation(args: CliArguments, io: CliIo): Promise<Invocation> {
  const [command, action] = args.positionals;
  switch (command) {
    case "check":
    case "status":
      allowOptions(args, []);
      exactPositionals(args, 1);
      return { operationId: `runtime.${command}`, args: {} };
    case "server": {
      if (action !== "info") throw new CliInputError("Неизвестная команда server.");
      allowOptions(args, ["profile"]);
      exactPositionals(args, 2);
      const profile = stringOption(args, "profile");
      if (profile !== undefined && profile !== "native" && profile !== "web")
        throw new CliInputError("Для --profile допустимы native или web.");
      return { operationId: "server.info", args: { ...optional("profile", profile) } };
    }
    case "run":
      allowOptions(args, INPUT);
      exactPositionals(args, 1);
      return { operationId: "runtime.batch", args: await inputObject(args, io, true) };
    case "ws":
      if (action !== "heartbeat") throw new CliInputError("Неизвестная команда ws.");
      allowOptions(args, ["timeout-ms"]);
      exactPositionals(args, 2);
      return {
        operationId: "web.websocket.heartbeat",
        args: { ...optional("timeoutMs", integerOption(args, "timeout-ms", 250, 10000)) },
      };
    case "api":
      if (action !== "call") throw new CliInputError("Неизвестная команда api.");
      allowOptions(args, INPUT);
      exactPositionals(args, 3);
      return {
        operationId: requirePositional(args, 2, "ID операции"),
        args: await inputObject(args, io),
      };
    case "query": {
      allowOptions(args, [
        ...INPUT,
        "limit",
        "start-position",
        "catalog",
        "where",
        "fields",
        "order",
      ]);
      exactPositionals(args, 1, 2);
      const source = await inputText(args, io);
      if (source !== undefined && args.positionals[1] !== undefined)
        throw new CliInputError("Запрос задан и аргументом, и отдельным источником.");
      const catalog = stringOption(args, "catalog");
      const option = stringOption(args, "where");
      // Без каталога JSON-объект из отдельного источника — весь набор аргументов, как у api call.
      const whole =
        !catalog && source?.trimStart().startsWith("{") ? jsonObject(source) : undefined;
      if (whole && option)
        throw new CliInputError("Условия заданы и в --where, и в файле аргументов.");
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
    case "object": {
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
        if (ids !== undefined && (args.positionals.length !== 2 || stringOption(args, "id")))
          throw new CliInputError("--ids задаётся без [ТИП] ID и без --id.");
        const type = stringOption(args, "type");
        const target = ids === undefined ? objectTarget(args) : { ids, ...optional("type", type) };
        return {
          operationId: "objects.get",
          args: { ...target, ...optional("fields", listOption(args, "fields")) },
        };
      }
      if (action === "patch") {
        allowOptions(args, [
          ...OBJECT_TARGET,
          ...INPUT,
          "expected-fingerprint",
          "preview",
          "resave",
        ]);
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
      if (action === "delete") {
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
      throw new CliInputError("Неизвестная команда object.");
    }
    case "files": {
      if (!["exists", "read", "list", "write", "delete"].includes(action ?? ""))
        throw new CliInputError("Неизвестная команда files.");
      allowOptions(
        args,
        action === "read"
          ? ["base64"]
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
            ...(action === "write"
              ? { base64: ((await putData("file", args, io)).data as { base64: string }).base64 }
              : {}),
            ...optional("search", stringOption(args, "search")),
          },
        };
      if (action === "read")
        return {
          operationId: "files.read",
          args: {
            url: requirePositional(args, 2, "серверный URL"),
            ...(args.options.base64 ? { encoding: "base64" } : {}),
          },
        };
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
    case "file": {
      if (action !== "upload") throw new CliInputError("Неизвестная команда file.");
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
    case "doc": {
      if (!action || !["get", "put", "delete"].includes(action))
        throw new CliInputError("Неизвестная команда doc.");
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
    }
    case "rpc": {
      if (action === "list") {
        allowOptions(args, ["query", "library", "method", "built-in", "all", "cursor", "limit"]);
        exactPositionals(args, 2);
        return {
          operationId: "rpc.list",
          args: {
            ...optional("query", stringOption(args, "query")),
            ...optional("library", stringOption(args, "library")),
            ...optional("method", stringOption(args, "method")),
            ...(args.options["built-in"] ? { builtIn: true } : {}),
            ...(args.options.all ? { all: true } : {}),
            ...optional("cursor", integerOption(args, "cursor", 0, Number.MAX_SAFE_INTEGER)),
            ...optional("limit", integerOption(args, "limit", 1, 100)),
          },
        };
      }
      if (action === "describe") {
        allowOptions(args, ["built-in", "source"]);
        exactPositionals(args, 3);
        return {
          operationId: "rpc.describe",
          args: {
            targetId: requirePositional(args, 2, "аргумент БИБЛИОТЕКА.ФУНКЦИЯ"),
            ...(args.options["built-in"] ? { builtIn: true } : {}),
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
    case "exec": {
      allowOptions(args, [...INPUT, "params", "params-file"]);
      exactPositionals(args, 1, 2);
      const source = await inputText(args, io);
      if (source !== undefined && args.positionals[1] !== undefined)
        throw new CliInputError("Код задан и аргументом, и отдельным источником.");
      const code = source ?? args.positionals[1];
      if (!code?.trim())
        throw new CliInputError(
          "Нужен код SP-XML Script: аргументом, через --input-file или --stdin.",
        );
      const inline = stringOption(args, "params");
      const file = stringOption(args, "params-file");
      if (inline !== undefined && file !== undefined)
        throw new CliInputError("Параметры кода заданы и в --params, и в --params-file.");
      const params = file ? await io.readFile(file, MAX_INPUT_BYTES) : inline;
      return {
        operationId: "execute.script",
        args: { code, ...(params === undefined ? {} : { params: jsonObject(params) }) },
      };
    }
    case "result": {
      const exporting = action === "export";
      allowOptions(args, exporting ? ["to", "format", "overwrite"] : ["offset", "limit", "format"]);
      exactPositionals(args, 3);
      if (action !== "read" && !exporting)
        throw new CliInputError("Неизвестная команда result: есть read и export.");
      const format = stringOption(args, "format");
      if (!exporting && format !== undefined && !["auto", "json", "text"].includes(format))
        throw new CliInputError("--format должен быть auto, json или text.");
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
    case "schema":
    case "types":
      allowOptions(args, [
        "search",
        "limit",
        "cursor",
        ...(command === "schema" ? ["path", "origin", "kind", "include", "language", "deep"] : []),
      ]);
      exactPositionals(args, command === "schema" ? 2 : 1);
      return {
        operationId: command === "schema" ? "schema.get" : "schema.types",
        args: {
          ...optional("search", stringOption(args, "search")),
          ...optional("limit", integerOption(args, "limit", 1, Number.MAX_SAFE_INTEGER)),
          ...optional("cursor", integerOption(args, "cursor", 0, Number.MAX_SAFE_INTEGER)),
          ...(command === "schema"
            ? {
                type: requirePositional(args, 1, "тип объекта"),
                ...optional("path", stringOption(args, "path")),
                ...(args.options.deep ? { deep: true } : {}),
                ...optional("origin", listOption(args, "origin")),
                ...optional("kind", stringOption(args, "kind")),
                ...optional("include", listOption(args, "include")),
                ...optional("language", stringOption(args, "language")),
              }
            : {}),
        },
      };
    case "logs": {
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
      if (!action || !["read", "tail", "search", "follow"].includes(action))
        throw new CliInputError("Неизвестная команда logs: есть list, read, tail, search, follow.");
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
      const level = stringOption(args, "level");
      if (
        level !== undefined &&
        !["normal", "debug", "info", "warning", "error", "critical"].includes(level)
      )
        throw new CliInputError("--level: normal, debug, info, warning, error или critical.");
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
    default:
      throw new CliInputError("Неизвестная команда.");
  }
}

function optional(key: string, value: unknown): Record<string, unknown> {
  return value === undefined ? {} : { [key]: value };
}

function outputDeliveryReceipt(result: OperationResult, savedOutput?: string): OperationResult {
  const text = (value: unknown, maximum: number): string | undefined =>
    typeof value === "string" &&
    value.length <= maximum &&
    Buffer.byteLength(JSON.stringify(value), "utf8") <= maximum
      ? value
      : undefined;
  const outcome = (value: unknown): MutationOutcome | undefined =>
    value === "not_sent" || value === "confirmed" || value === "indeterminate" ? value : undefined;
  const returned =
    result.data !== null && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : {};
  const mutationOutcome =
    outcome(result.error?.mutationOutcome) ?? outcome(returned.mutationOutcome);
  const id = [returned.id, result.error?.details?.objectId].find(
    (value): value is string =>
      typeof value === "string" &&
      /^(?:[0-9]{1,20}|0[xX][0-9a-fA-F]{1,16})$/.test(value) &&
      BigInt(value) <= 0xffffffffffffffffn,
  );
  const uuid = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  const resultId = [result.meta.resultId, returned.resultId].find(uuid);
  const mutationId = [returned.mutationId, result.error?.details?.mutationId].find(uuid);
  const executionId = [returned.executionId, result.error?.details?.executionId].find(
    (value): value is string =>
      typeof value === "string" && /^hcm_inline_[a-f0-9]{32}$/.test(value),
  );
  const tracking = text(returned.TrackingID, 128);
  const TrackingID =
    tracking !== undefined && /^(?:\d+|0x[0-9a-f]+)$/i.test(tracking) ? tracking : undefined;
  const operationId = text(result.meta.operationId, 128);
  const connection = text(result.meta.connection, 256);
  const deliveryHint =
    "Серверную операцию из-за ошибки вывода не повторять; проверить известный ID, resultId или сохранённый файл.";
  return {
    ok: false,
    data: {
      receiptOnly: true,
      operationSucceeded:
        typeof result.error?.details?.operationSucceeded === "boolean"
          ? result.error.details.operationSucceeded
          : result.ok,
      ...optional("mutationOutcome", mutationOutcome),
      ...optional("id", id),
      ...optional("mutationId", mutationId),
      ...optional("resultId", resultId),
      ...optional("executionId", executionId),
      ...(TrackingID ? { TrackingID } : {}),
      ...(savedOutput === undefined
        ? {}
        : {
            saved: true,
            ...(text(savedOutput, 1024) === undefined
              ? { outputOmitted: true }
              : { output: savedOutput }),
          }),
      deliveryHint,
    },
    error: result.error
      ? {
          code: text(result.error.code, 128) ?? "OPERATION_FAILED",
          message:
            text(result.error.message, 512) ??
            "Основная операция вернула ошибку; подробности опущены.",
          ...optional("hint", text(result.error.hint, 256)),
          retryable: result.error.retryable ?? false,
          ...optional("mutationOutcome", outcome(result.error.mutationOutcome)),
        }
      : {
          code: "OUTPUT_WRITE_FAILED",
          message: "Операция завершена, но доставить результат в stdout не удалось.",
          hint: deliveryHint,
          retryable: false,
        },
    meta: {
      operationId: operationId ?? "[omitted]",
      connection: connection ?? "[omitted]",
      durationMs: Number.isFinite(result.meta.durationMs) ? result.meta.durationMs : 0,
      outputDeliveryFailed: true,
      ...(operationId === undefined ? { operationIdOmitted: true } : {}),
      ...(connection === undefined || result.meta.connectionOmitted === true
        ? { connectionOmitted: true }
        : {}),
      ...(result.meta.cleanupFailed === true ? { cleanupFailed: true } : {}),
      ...(result.meta.outputFailed === true ? { outputFailed: true } : {}),
      ...(result.meta.truncated === true ? { truncated: true } : {}),
      ...optional("resultId", resultId),
    },
  };
}

async function deliverOutput(
  result: OperationResult,
  value: OperationResult,
  io: CliIo,
  savedOutput?: string,
): Promise<boolean> {
  try {
    await io.writeOut(serializeResult(value, io.pretty === true));
    return true;
  } catch {
    await safeDiagnostic(io, outputDeliveryReceipt(result, savedOutput));
    return false;
  }
}

async function emit(
  result: OperationResult,
  args: CliArguments,
  io: CliIo,
  runtime?: RuntimePort,
): Promise<number> {
  result = errorInFrontendTerms(result, "cli");
  const output = stringOption(args, "output");
  if (output) {
    let bytes: number | undefined;
    try {
      if (result.meta.truncated && result.meta.resultId) {
        if (!runtime?.results) throw new Error("Хранилище результатов недоступно");
        const input = { resultId: result.meta.resultId, path: output, overwrite: true };
        bytes = (await runtime.results.export(input, result)).bytes;
      } else await io.writeFile(output, serializeResult(result, true));
    } catch {
      const exportFailure = failure(
        "cli.output_failed",
        "Результат команды получен, но сохранить локальный файл не удалось.",
        "Клиент пытается вывести исходные data/meta в stdout; нужно проверить, что вывод получен. Серверную операцию из-за ошибки сохранения файла не повторять.",
      );
      await safeDiagnostic(io, exportFailure);
      const failedExport = frontendFailure(result, exportFailure, "outputFailed");
      await deliverOutput(failedExport, failedExport, io);
      return 1;
    }
    // Файл содержит весь ответ, поэтому сводка не называет его обрезанным; запись называет исход.
    const { truncated: _, ...meta } = result.meta;
    const done = result.data as Record<string, unknown> | null;
    const written =
      done !== null && typeof done === "object" && typeof done.mutationOutcome === "string"
        ? Object.fromEntries(
            ["id", "mutationOutcome", "verification"]
              .filter((key) => done[key] !== undefined)
              .map((key) => [key, done[key]]),
          )
        : {};
    const receipt = {
      ok: result.ok,
      data: { saved: true, output, ...optional("bytes", bytes), ...written },
      ...(result.error ? { error: result.error } : {}),
      meta,
    };
    if (!(await deliverOutput(result, receipt, io, output))) return 1;
  } else if (!(await deliverOutput(result, result, io))) return 1;
  // Код 3: скрипт должен заметить, что в stdout только начало ответа; с --output файл полный.
  return !result.ok ? 1 : result.meta.truncated && !output ? 3 : 0;
}

/** Справка и гайд читаются, а не разбираются: текст уходит как есть в stdout или в --output. */
async function emitText(text: string, args: CliArguments, io: CliIo): Promise<number> {
  const output = stringOption(args, "output");
  if (output) await io.writeFile(output, text);
  else await io.writeOut(text);
  return 0;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo,
  dependencies: CliDependencies,
): Promise<number> {
  let runtime: RuntimePort | undefined;
  let parsed: CliArguments | undefined;
  try {
    parsed = parseArguments(argv);
    const [command, action] = parsed.positionals;
    if (!command || command === "help") {
      if (parsed.options["password-stdin"])
        throw new CliInputError("Ввод пароля не нужен для help.");
      // КОМАНДА … --help: параметры, набранные до --help, относятся к команде и не проверяются.
      if (!parsed.options.help) allowOptions(parsed, []);
      // help logs search: справка группы покрывает её подкоманды.
      exactPositionals(parsed, 0, 3);
      const topic = action === "help" ? undefined : action;
      if (parsed.options.json)
        return await emit(frontendResult("cli.help", "unselected", cliHelp(topic)), parsed, io);
      return await emitText(cliHelpText(topic), parsed, io);
    }
    if (command === "version") {
      allowOptions(parsed, []);
      exactPositionals(parsed, 1);
      return await emit(
        frontendResult("cli.version", "unselected", {
          name: "wtctl",
          version: VERSION,
          node: process.versions.node,
        }),
        parsed,
        io,
      );
    }
    if (command === "guide") {
      allowOptions(parsed, []);
      exactPositionals(parsed, 1, 2);
      const page = guide(action, withSettings(dependencies.local, parsed));
      if (parsed.options.json)
        return await emit(frontendResult("cli.guide", "unselected", page), parsed, io);
      return await emitText(`${page.text}\n`, parsed, io);
    }
    if (command === "config" && action === "init")
      return await emit(await initConnection(parsed, io), parsed, io);
    if (command === "config" && action === "path") {
      allowOptions(parsed, []);
      exactPositionals(parsed, 2);
      const path =
        stringOption(parsed, "config") ?? process.env.WTCTL_CONFIG ?? defaultConfigPath();
      let exists = true;
      try {
        await io.readFile(path, 1024 * 1024);
      } catch {
        exists = false;
      }
      return await emit(
        frontendResult("cli.config.path", "unselected", { path, exists }),
        parsed,
        io,
      );
    }
    if (command === "config" && action === "example") {
      if (parsed.options["password-stdin"])
        throw new CliInputError("Ввод пароля не нужен для примера конфигурации.");
      allowOptions(parsed, []);
      exactPositionals(parsed, 2);
      return await emit(
        frontendResult("cli.config.example", "unselected", configExample()),
        parsed,
        io,
      );
    }
    // Полная команда и её локальные входные данные проверяются до открытия runtime.
    const discovery = command === "api" && (action === "list" || action === "describe");
    let discoveryFilter: OperationFilter = {};
    let invocation: Invocation | undefined;
    if (command === "mcp") {
      allowOptions(parsed, []);
      exactPositionals(parsed, 1);
      if (parsed.options.output)
        throw new CliInputError("wtctl mcp не принимает --output: stdout занят протоколом MCP.");
      if (parsed.options["password-stdin"])
        throw new CliInputError(
          "--password-stdin несовместим с MCP: stdin занят протоколом.",
          "Для MCP пароль задаётся через переменную окружения из конфигурации.",
        );
    } else if (!discovery) invocation = await commandInvocation(parsed, io);
    else if (action === "describe") {
      allowOptions(parsed, ["offline"]);
      exactPositionals(parsed, 3);
    } else {
      allowOptions(parsed, ["query", "topic", "group", "effect", "cursor", "limit", "offline"]);
      exactPositionals(parsed, 2);
      const effect = stringOption(parsed, "effect");
      if (
        effect &&
        effect !== "read" &&
        effect !== "write" &&
        effect !== "execute" &&
        effect !== "unknown"
      )
        throw new CliInputError("--effect должен быть read, write, execute или unknown.");
      discoveryFilter = {
        ...optional("query", stringOption(parsed, "query")),
        ...optional("topic", stringOption(parsed, "topic")),
        ...optional("group", stringOption(parsed, "group")),
        ...optional("effect", effect),
        ...optional("cursor", integerOption(parsed, "cursor", 0, Number.MAX_SAFE_INTEGER)),
        ...optional("limit", integerOption(parsed, "limit", 1, 100)),
      };
    }
    if (discovery && parsed.options.offline) {
      if (parsed.options["password-stdin"])
        throw new CliInputError("Пароль с --offline не нужен: команда не обращается к серверу.");
      const data =
        action === "describe"
          ? operationHelp(describeHcmOperation(requirePositional(parsed, 2, "ID операции")))
          : discoverOperations(listHcmOperations, discoveryFilter);
      return await emit(frontendResult(`api.${action}`, "unselected", data), parsed, io);
    }
    let password: string | undefined;
    if (parsed.options["password-stdin"]) {
      password = (await io.readStdin(65536)).replace(/\r?\n$/, "");
      if (!password || /[\r\n\0]/.test(password) || Buffer.byteLength(password, "utf8") > 65536)
        throw new CliInputError("Пароль из stdin должен быть одной непустой строкой до 64 КиБ.");
    }
    const selected = parsed;
    const load = () =>
      dependencies.loadConfiguration({
        ...optional("configPath", stringOption(selected, "config")),
        ...optional("connection", stringOption(selected, "connection")),
        ...optional("password", password),
      });
    if (command === "mcp") {
      // MCP-сервер без настроек всё равно стартует: его инструменты отвечают, что настроить.
      let name = "unconfigured";
      let serving: RuntimePort;
      try {
        const config = await load();
        name = config.name;
        serving = dependencies.createRuntime(config);
      } catch (error) {
        if (!(error instanceof HcmError)) throw error;
        serving = new DeferredRuntime(
          load,
          dependencies.createRuntime,
          error,
          setupCommand(dependencies.local),
        );
      }
      runtime = serving;
      await dependencies.runMcp(serving, name, io, withSettings(dependencies.local, selected));
      runtime = undefined;
      await serving.close();
      return 0;
    }
    const config = await load();
    runtime = dependencies.createRuntime(config);
    let result: OperationResult;
    if (discovery && action === "describe")
      result = frontendResult(
        "api.describe",
        config.name,
        operationHelp(runtime.describe(requirePositional(parsed, 2, "ID операции"))),
      );
    else if (discovery) {
      result = frontendResult(
        "api.list",
        config.name,
        discoverOperations((filter) => runtime!.listOperations(filter), discoveryFilter),
      );
    } else {
      if (!invocation) throw new CliInputError("Команда не определена.");
      result = await runtime.call(invocation.operationId, invocation.args);
    }
    const closing = runtime;
    runtime = undefined;
    try {
      await closing.close();
    } catch {
      const cleanup = failure(
        "cli.cleanup_failed",
        "Основная операция завершилась, но закрыть подключение не удалось.",
        "Результат основной операции сохранён в data/meta. Её из-за ошибки закрытия не повторять.",
      );
      await safeDiagnostic(io, cleanup);
      result = frontendFailure(result, cleanup, "cleanupFailed");
    }
    return await emit(result, parsed, io, closing);
  } catch (error) {
    const result =
      error instanceof CliInputError
        ? failure(
            error.code,
            error.message,
            [error.hint, `Справка: ${helpCommand(commandOf(argv))}.`].filter(Boolean).join(" "),
          )
        : error instanceof HcmError
          ? {
              ...failure(
                error.code,
                error.message,
                error.hint ?? "Проверить конфигурацию и api describe.",
              ),
              error: error.toJSON(),
            }
          : failure(
              "cli.failed",
              "Команда не завершена.",
              "Проверить конфигурацию и api describe; неизвестные ошибки не выводят реквизиты или серверный ответ.",
            );
    await safeDiagnostic(io, errorInFrontendTerms(result, "cli"));
    return error instanceof CliInputError ? 2 : 1;
  } finally {
    if (runtime) {
      try {
        await runtime.close();
      } catch {
        await safeDiagnostic(
          io,
          failure("cli.cleanup_failed", "Не удалось закрыть сессию подключения."),
        );
      }
    }
  }
}
