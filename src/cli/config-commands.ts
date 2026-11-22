import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  MAX_CONFIG_BYTES,
  configExample,
  defaultConfigPath,
  listConnections,
  parseConfiguration,
  updateConnection,
  withConnection,
} from "../config.js";
import type { OperationResult } from "../contracts.js";
import { HcmError } from "../errors.js";
import {
  CliInputError,
  allowOptions,
  exactPositionals,
  optional,
  rejectPasswordStdin,
  stringOption,
  type CliArguments,
} from "./arguments.js";
import { frontendResult } from "./output.js";
import type { CliIo } from "./types.js";

function configPathOption(args: CliArguments): string {
  return stringOption(args, "config") ?? process.env.WTCTL_CONFIG ?? defaultConfigPath();
}

/** Разыменовывает ближайшего существующего предка и дописывает несуществующий хвост пути. */
function canonicalAncestor(path: string): string {
  const tail: string[] = [];
  let current = path;
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      tail.push(basename(current));
      current = parent;
    }
  }
}

function canonicalPath(path: string): string {
  let current = resolve(path);
  for (let hop = 0; hop < 32; hop++) {
    try {
      return realpathSync(current);
    } catch {
      try {
        if (lstatSync(current).isSymbolicLink()) {
          current = resolve(canonicalAncestor(dirname(current)), readlinkSync(current));
          continue;
        }
      } catch {
        // Обычный несуществующий файл.
      }
      return canonicalAncestor(current);
    }
  }
  return current;
}

function sameLocalPath(first: string, second: string): boolean {
  const a = canonicalPath(first);
  const b = canonicalPath(second);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function rejectOutputOnConfigPath(args: CliArguments, configPath: string): void {
  const output = stringOption(args, "output");
  if (output !== undefined && sameLocalPath(output, configPath))
    throw new CliInputError(
      "--output не может указывать на сам файл подключений: это перезапишет подключения ответом команды.",
    );
}

async function saveConfigDocument(
  io: CliIo,
  path: string,
  beforeText: string | undefined,
  document: Record<string, unknown>,
): Promise<void> {
  const nextText = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(nextText, "utf8") > MAX_CONFIG_BYTES)
    throw new HcmError("INVALID_CONFIG", "Файл подключений больше 1 МиБ.");
  if (io.writeFileIfUnchanged) {
    await io.writeFileIfUnchanged(path, beforeText, nextText);
    return;
  }
  const conflict = () =>
    new HcmError(
      "CONFIG_CONFLICT",
      "Файл подключений изменился за время выполнения команды.",
      "Повторить команду, чтобы не перезаписать чужую правку.",
    );
  if (beforeText === undefined) {
    let exists = true;
    try {
      await io.readFile(path, MAX_CONFIG_BYTES);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false;
      else throw error;
    }
    if (exists) throw conflict();
  } else {
    let currentText: string;
    try {
      currentText = await io.readFile(path, MAX_CONFIG_BYTES);
    } catch (error) {
      if (error instanceof CliInputError || (error as NodeJS.ErrnoException).code === "ENOENT")
        throw conflict();
      throw error;
    }
    if (currentText !== beforeText) throw conflict();
  }
  await io.writeFile(path, nextText);
}

async function readExistingConfig(
  path: string,
  io: CliIo,
): Promise<{ readonly text: string; readonly document: Record<string, unknown> }> {
  let text: string;
  try {
    text = await io.readFile(path, MAX_CONFIG_BYTES);
  } catch (error) {
    const { code, syscall } = (error ?? {}) as NodeJS.ErrnoException;
    if (code === "ENOENT")
      throw new HcmError(
        "INVALID_CONFIG",
        `Файл подключений не найден: ${path}.`,
        "Нужно проверить --config и WTCTL_CONFIG или создать файл: wtctl config init.",
      );
    throw syscall === undefined
      ? error
      : new CliInputError(`Файл подключений не открывается для чтения: ${resolve(path)}.`);
  }
  return { text, document: parseConfiguration(text, path) };
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
  const path = configPathOption(args);
  rejectOutputOnConfigPath(args, path);
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
  let beforeText: string | undefined;
  let document: Record<string, unknown> = {};
  try {
    beforeText = await io.readFile(path, MAX_CONFIG_BYTES);
    document = parseConfiguration(beforeText, path);
  } catch (error) {
    const { code, syscall } = (error ?? {}) as NodeJS.ErrnoException;
    // Файла ещё нет — init его создаст; другой отказ файловой системы называет файл.
    if (code !== "ENOENT")
      throw syscall === undefined
        ? error
        : new CliInputError(`Файл подключений не открывается для чтения: ${resolve(path)}.`);
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
  await saveConfigDocument(io, path, beforeText, next);
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

async function listConfigConnections(args: CliArguments, io: CliIo): Promise<OperationResult> {
  rejectPasswordStdin(args, "Ввод пароля не нужен для config list.");
  allowOptions(args, []);
  exactPositionals(args, 2);
  const path = configPathOption(args);
  rejectOutputOnConfigPath(args, path);
  const { document } = await readExistingConfig(path, io);
  return frontendResult("cli.config.list", "unselected", {
    path,
    ...listConnections(document),
  });
}

function booleanValueOption(args: CliArguments, name: string): boolean | undefined {
  const value = stringOption(args, name);
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CliInputError(`--${name}: нужно true или false.`);
}

async function setConfigConnection(args: CliArguments, io: CliIo): Promise<OperationResult> {
  if (stringOption(args, "output") !== undefined)
    throw new CliInputError(
      "wtctl config set не принимает --output: команда изменяет файл подключений, путь файла задаёт --config.",
    );
  rejectPasswordStdin(
    args,
    "--password-stdin не нужен для config set: учётные данные меняет wtctl config init --force.",
  );
  allowOptions(args, [
    "write",
    "execute",
    "default",
    "url",
    "timeout-ms",
    "max-response-bytes",
    "output-limit-bytes",
    "runtime-dir",
    "results-max-bytes",
    "results-max-age-days",
    "journal-max-bytes",
  ]);
  exactPositionals(args, 2, 3);
  const positionalName = args.positionals[2];
  const optionName = stringOption(args, "connection");
  if (positionalName !== undefined && optionName !== undefined)
    throw new CliInputError("Имя подключения задано и аргументом, и в --connection.");
  const name = positionalName ?? optionName ?? process.env.WTCTL_CONNECTION;
  const patch = {
    ...optional("baseUrl", stringOption(args, "url")),
    ...optional("write", booleanValueOption(args, "write")),
    ...optional("execute", booleanValueOption(args, "execute")),
    ...(args.options.default === true ? { makeDefault: true } : {}),
    ...optional("timeoutMs", stringOption(args, "timeout-ms")),
    ...optional("maxResponseBytes", stringOption(args, "max-response-bytes")),
    ...optional("outputLimitBytes", stringOption(args, "output-limit-bytes")),
    ...optional("runtimeDir", stringOption(args, "runtime-dir")),
    ...optional("resultsMaxBytes", stringOption(args, "results-max-bytes")),
    ...optional("resultsMaxAgeDays", stringOption(args, "results-max-age-days")),
    ...optional("journalMaxBytes", stringOption(args, "journal-max-bytes")),
  };
  if (Object.keys(patch).length === 0)
    throw new CliInputError(
      "Не указано, что изменить: например --write true, --execute false, --default или --timeout-ms.",
    );
  const path = configPathOption(args);
  const { text: beforeText, document } = await readExistingConfig(path, io);
  const updated = updateConnection(document, name, patch, path);
  await saveConfigDocument(io, path, beforeText, updated.document);
  return frontendResult("cli.config.set", updated.connection.name, {
    path,
    ...(updated.defaultConnection === undefined
      ? {}
      : { defaultConnection: updated.defaultConnection }),
    connection: updated.connection,
  });
}

async function configPathCommand(args: CliArguments, io: CliIo): Promise<OperationResult> {
  rejectPasswordStdin(args, "Ввод пароля не нужен для config path.");
  allowOptions(args, []);
  exactPositionals(args, 2);
  const path = configPathOption(args);
  rejectOutputOnConfigPath(args, path);
  let exists = true;
  try {
    await io.readFile(path, MAX_CONFIG_BYTES);
  } catch (error) {
    // Файл без доступа или больше предела тоже есть.
    exists = (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
  return frontendResult("cli.config.path", "unselected", { path, exists });
}

function configExampleCommand(args: CliArguments): OperationResult {
  rejectPasswordStdin(args, "Ввод пароля не нужен для примера конфигурации.");
  allowOptions(args, []);
  exactPositionals(args, 2);
  return frontendResult("cli.config.example", "unselected", configExample());
}

/** Локальные подкоманды `wtctl config`; неизвестную подкоманду оставляет общему разбору. */
export async function runConfigCommand(
  action: string | undefined,
  args: CliArguments,
  io: CliIo,
): Promise<OperationResult | undefined> {
  if (action === "init") return initConnection(args, io);
  if (action === "list") return listConfigConnections(args, io);
  if (action === "set") return setConfigConnection(args, io);
  if (action === "path") return configPathCommand(args, io);
  if (action === "example") return configExampleCommand(args);
  return undefined;
}
