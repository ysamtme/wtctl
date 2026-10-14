import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HcmError } from "./errors.js";
import type { ConnectionConfig } from "./contracts.js";

/** Аргументы loadConfig: откуда взять подключение. */
export interface ConfigOptions {
  /** Файл подключений; по умолчанию WTCTL_CONFIG, иначе ~/.wtctl/connections.json. */
  readonly configPath?: string;
  /** Имя подключения в файле; по умолчанию WTCTL_CONNECTION, иначе defaultConnection файла. */
  readonly connection?: string;
  /** Пароль вместо пароля из файла и переменных. */
  readonly password?: string;
  /** Настройки кодом, сильнее переменных и файла; с baseUrl — подключение без файла и переменных. */
  readonly settings?: ConnectionSettings;
}
const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;
const MAX_CONFIG_BYTES = MIB;
const SETUP_HINT =
  "Нужно задать WTCTL_URL, WTCTL_USERNAME и WTCTL_PASSWORD (для MCP-сервера — в env его записи) или создать файл подключений: wtctl config init.";

/** Папка клиента в профиле пользователя: файл подключений и сохранённые результаты. */
export function homeDirectory(): string {
  return resolve(process.env.WTCTL_HOME || join(homedir(), ".wtctl"));
}
/** Где ищется файл подключений, если ни --config, ни WTCTL_CONFIG его не назвали. */
export function defaultConfigPath(): string {
  return join(homeDirectory(), "connections.json");
}

function readConfiguration(path: string): string {
  let file: number;
  try {
    file = openSync(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new HcmError(
        "INVALID_CONFIG",
        `Файл подключений не найден: ${path}.`,
        "Нужно проверить --config и WTCTL_CONFIG или создать файл: wtctl config init.",
      );
    throw new HcmError(
      "INVALID_CONFIG",
      `Файл подключений не открывается: ${path}.`,
      "Проверить права на файл.",
    );
  }
  try {
    const info = fstatSync(file);
    if (!info.isFile())
      throw new HcmError("INVALID_CONFIG", `Файл подключений — не файл: ${path}.`);
    if (info.size > MAX_CONFIG_BYTES)
      throw new HcmError("INVALID_CONFIG", "Файл подключений больше 1 МиБ.");
    // Читается на один байт больше, чтобы ограничить и рост файла после fstat, и его размер.
    const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = readSync(file, bytes, used, bytes.length - used, null);
      if (!count) break;
      used += count;
    }
    if (used > MAX_CONFIG_BYTES)
      throw new HcmError("INVALID_CONFIG", "Файл подключений больше 1 МиБ.");
    // TextDecoder принимает необязательный BOM UTF-8, который ставят редакторы Windows.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used));
  } finally {
    closeSync(file);
  }
}
/** Файл как объект. Ошибка синтаксиса называется только позицией: в тексте может быть пароль. */
export function parseConfiguration(text: string, path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const position = /position (\d+)/.exec(error instanceof Error ? error.message : "")?.[1];
    const line =
      position === undefined ? undefined : text.slice(0, Number(position)).split("\n").length;
    throw new HcmError(
      "INVALID_CONFIG",
      `Файл подключений ${path} — не JSON${line === undefined ? "" : `: ошибка в строке ${line}`}.`,
      "Образец файла показывает wtctl config example.",
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new HcmError(
      "INVALID_CONFIG",
      `Файл подключений ${path} должен содержать объект JSON.`,
      "Образец файла показывает wtctl config example.",
    );
  return value as Record<string, unknown>;
}
function bool(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new HcmError("INVALID_CONFIG", `${field}: нужно true или false.`);
}
function string(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0)
    throw new HcmError("INVALID_CONFIG", `${field}: нужна непустая строка.`);
  return value;
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new HcmError("INVALID_CONFIG", `${field}: нужен объект.`);
  return value as Record<string, unknown>;
}

type Parse<T> = (value: unknown, field: string) => T;
/** Целое число; строка переменной окружения — только цифрами. unlimited допускает и 0. */
function integer(
  fallback: number,
  minimum: number,
  maximum: number,
  unlimited = false,
): Parse<number> {
  return (value, field) => {
    if (value === undefined) return fallback;
    const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    if (
      typeof parsed !== "number" ||
      !Number.isSafeInteger(parsed) ||
      (parsed < minimum && !(unlimited && parsed === 0)) ||
      parsed > maximum
    )
      throw new HcmError(
        "INVALID_CONFIG",
        `${field}: нужно целое число от ${minimum} до ${maximum}${unlimited ? "; 0 — без предела" : ""}.`,
      );
    return parsed;
  };
}
const folder: Parse<string> = (value, field) =>
  resolve(string(value, field) ?? join(homeDirectory(), "runtime"));

/** Умолчания пределов локальных файлов; их же берёт подключение, собранное без loadConfig. */
export const LOCAL_LIMITS = {
  resultsMaxBytes: GIB,
  resultsMaxAgeDays: 7,
  journalMaxBytes: 10 * MIB,
} as const;
/** Поля подключения, которые одинаково задают поле файла, переменная окружения и settings. */
type SettingField =
  | "timeoutMs"
  | "maxResponseBytes"
  | "outputLimitBytes"
  | "runtimeDir"
  | "resultsMaxBytes"
  | "resultsMaxAgeDays"
  | "journalMaxBytes";
/**
 * Переменная и разбор с умолчанием и границами каждого такого поля. Переменные действуют и при файле
 * с connections.
 */
const SETTINGS = {
  timeoutMs: ["WTCTL_TIMEOUT_MS", integer(30000, 1, 600000)],
  maxResponseBytes: ["WTCTL_MAX_RESPONSE_BYTES", integer(32 * MIB, KIB, 512 * MIB)],
  outputLimitBytes: ["WTCTL_OUTPUT_LIMIT_BYTES", integer(24 * KIB, KIB, MIB)],
  runtimeDir: ["WTCTL_RUNTIME_DIR", folder],
  resultsMaxBytes: [
    "WTCTL_RESULTS_MAX_BYTES",
    integer(LOCAL_LIMITS.resultsMaxBytes, KIB, 1024 * GIB, true),
  ],
  resultsMaxAgeDays: [
    "WTCTL_RESULTS_MAX_AGE_DAYS",
    integer(LOCAL_LIMITS.resultsMaxAgeDays, 1, 3650, true),
  ],
  journalMaxBytes: [
    "WTCTL_JOURNAL_MAX_BYTES",
    integer(LOCAL_LIMITS.journalMaxBytes, KIB, GIB, true),
  ],
} as const satisfies Record<SettingField, readonly [string, Parse<unknown>]>;
/** Адрес, учётные данные и права: в settings они задают отдельное подключение. */
const OWN_FIELDS = ["baseUrl", "username", "password", "permissions"] as const;

/**
 * Поля подключения кодом: loadConfig({ settings }). Сильнее переменных и файла; с baseUrl —
 * отдельное подключение без файла и переменных, права по умолчанию выключены.
 */
export type ConnectionSettings = Partial<
  Pick<ConnectionConfig, "baseUrl" | "username" | "password" | SettingField>
> & {
  /** Права отдельного подключения (с baseUrl); по умолчанию выключены. */
  readonly permissions?: Partial<ConnectionConfig["permissions"]>;
};
function credential(
  profile: Record<string, unknown>,
  field: "username" | "password",
  globalOverrides: boolean,
): string | undefined {
  const envName = string(profile[`${field}Env`], `${field}Env`);
  if (envName !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName))
    throw new HcmError("INVALID_CONFIG", `${field}Env: это не имя переменной окружения.`);
  return string(
    (globalOverrides ? process.env[`WTCTL_${field.toUpperCase()}`] : undefined) ??
      (envName === undefined ? profile[field] : process.env[envName]),
    field,
  );
}

/**
 * Подключение из файла подключений или переменных WTCTL_*, как у CLI. settings сильнее и того
 * и другого; settings с baseUrl — подключение целиком, без файла. Бросает HcmError INVALID_CONFIG
 * при ошибке в настройках.
 */
export function loadConfig(options: ConfigOptions = {}): ConnectionConfig {
  const settings = object(options.settings ?? {}, "settings");
  for (const key of Object.keys(settings))
    if (!Object.hasOwn(SETTINGS, key) && !(OWN_FIELDS as readonly string[]).includes(key))
      throw new HcmError(
        "INVALID_CONFIG",
        `settings.${key}: такого поля нет.`,
        `Поля settings: ${[...OWN_FIELDS, ...Object.keys(SETTINGS)].join(", ")}.`,
      );
  const standalone = settings.baseUrl !== undefined;
  // WTCTL_CONFIG приходит из окружения, а не из вызова: при settings.baseUrl он, как и переменные
  // адреса, учётных данных и прав, не действует. configPath в том же вызове — противоречие.
  if (standalone && options.configPath !== undefined)
    throw new HcmError(
      "INVALID_CONFIG",
      "settings.baseUrl задаёт подключение целиком, а configPath называет файл подключений.",
      "Нужно оставить что-то одно: settings.baseUrl или configPath.",
    );
  const explicit = options.configPath ?? process.env.WTCTL_CONFIG;
  const own = standalone ? undefined : OWN_FIELDS.find((key) => settings[key] !== undefined);
  // Иначе код, который пишет агент, поднимал бы права подключения, запрещающего запись.
  if (own !== undefined)
    throw new HcmError(
      "INVALID_CONFIG",
      `settings.${own}: адрес, учётные данные и права подключения из файла или переменных кодом не меняются.`,
      "Отдельное подключение задаёт settings с baseUrl, а с ним username, password и permissions.",
    );
  // Подключение из переменных самодостаточно; файл пользователя — запасной вариант.
  const path = standalone
    ? undefined
    : (explicit ??
      (process.env.WTCTL_URL === undefined && existsSync(defaultConfigPath())
        ? defaultConfigPath()
        : undefined));
  let document: Record<string, unknown> = {};
  if (path !== undefined) {
    let text: string;
    try {
      text = readConfiguration(path);
    } catch (error) {
      if (error instanceof HcmError) throw error;
      throw new HcmError(
        "INVALID_CONFIG",
        `Файл подключений не читается: ${path}.`,
        "Файл должен быть текстом UTF-8.",
      );
    }
    document = parseConfiguration(text, path);
  }
  // Отказ выбора называет источник имени: иначе имя из забытой переменной не объяснить.
  let name = options.connection;
  let chosen = "Имя задано в --connection или аргументе connection.";
  if (name === undefined && !standalone) {
    name = process.env.WTCTL_CONNECTION;
    chosen = "Имя взято из переменной WTCTL_CONNECTION.";
    if (name === undefined) {
      name = string(document.defaultConnection, "defaultConnection");
      chosen = "Имя взято из defaultConnection файла.";
    }
  }
  if (name === undefined) {
    name = "default";
    chosen = "Имя по умолчанию: --connection, WTCTL_CONNECTION и defaultConnection не заданы.";
  }
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name))
    throw new HcmError(
      "INVALID_CONFIG",
      "Имя подключения: до 64 латинских букв, цифр и знаков . _ -",
      chosen,
    );
  let profile: Record<string, unknown> = standalone ? settings : {};
  const globalOverrides = !standalone && document.connections === undefined;
  if (document.connections !== undefined) {
    const connections = object(document.connections, "connections");
    if (connections[name] === undefined)
      throw new HcmError(
        "UNKNOWN_CONNECTION",
        `В файле подключений ${path} нет подключения ${name}. ${chosen}`,
        `Есть: ${Object.keys(connections).slice(0, 20).join(", ") || "ни одного"}. Имя задают --connection, WTCTL_CONNECTION или defaultConnection файла; первое заданное сильнее.`,
        { connection: name },
      );
    profile = object(connections[name], "connection");
  } else if (Object.keys(document).length > 0) profile = document;
  const baseUrl = string(
    (globalOverrides ? process.env.WTCTL_URL : undefined) ?? profile.baseUrl,
    "baseUrl",
  );
  if (baseUrl === undefined)
    throw path === undefined
      ? new HcmError("NOT_CONFIGURED", "Подключение к серверу не настроено.", SETUP_HINT)
      : new HcmError(
          "INVALID_CONFIG",
          `В подключении ${name} не задан адрес сервера (baseUrl).`,
          "Образец файла показывает wtctl config example.",
        );
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new HcmError(
      "INVALID_CONFIG",
      "Адрес сервера должен быть полным: http://сервер:порт или https://сервер.",
    );
  }
  if (!/^(https?:)$/.test(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new HcmError(
      "INVALID_CONFIG",
      "Адрес сервера: только http или https, без имени и пароля, без ? и #.",
    );
  const username = credential(profile, "username", globalOverrides);
  const password = options.password ?? credential(profile, "password", globalOverrides);
  if ((username === undefined) !== (password === undefined))
    throw new HcmError(
      "INVALID_CONFIG",
      `Имя пользователя и пароль задают вместе: не задан${username === undefined ? "о имя пользователя" : " пароль"}.`,
      globalOverrides
        ? "Переменные WTCTL_USERNAME и WTCTL_PASSWORD."
        : standalone
          ? "Поля username и password в settings."
          : "Поля username и password подключения либо переменные, названные в usernameEnv и passwordEnv.",
    );
  const permissions =
    profile.permissions === undefined ? {} : object(profile.permissions, "permissions");
  // Сообщение об ошибке называет и поле, и переменную: оно одно, откуда бы ни пришло значение.
  const values = Object.fromEntries(
    Object.entries(SETTINGS).map(([field, [variable, parse]]) => [
      field,
      parse(settings[field] ?? process.env[variable] ?? profile[field], `${field} (${variable})`),
    ]),
  ) as { [K in SettingField]: ReturnType<(typeof SETTINGS)[K][1]> };
  const config: ConnectionConfig = {
    name,
    baseUrl: url.href,
    ...(username === undefined ? {} : { username }),
    ...(password === undefined ? {} : { password }),
    ...values,
    permissions: {
      write: bool(
        (globalOverrides ? process.env.WTCTL_ALLOW_WRITE : undefined) ?? permissions.write,
        false,
        "permissions.write",
      ),
      execute: bool(
        (globalOverrides ? process.env.WTCTL_ALLOW_EXECUTE : undefined) ?? permissions.execute,
        false,
        "permissions.execute",
      ),
    },
  };
  origins.set(
    config,
    standalone
      ? "settings"
      : path === undefined
        ? "environment"
        : { listed: !globalOverrides, named: explicit !== undefined },
  );
  return config;
}

/**
 * Откуда loadConfig взял подключение: из settings, из переменных или из файла; у файла — есть ли
 * в нём connections и назван ли он в --config или WTCTL_CONFIG. По нему отказ прав говорит, где
 * право включается.
 */
const origins = new WeakMap<
  ConnectionConfig,
  "settings" | "environment" | { readonly listed: boolean; readonly named: boolean }
>();

/**
 * Подсказка WRITE_DISABLED и EXECUTE_DISABLED: где подключению включают это право. Путь файла
 * не называется: ответ прячет локальные пути.
 */
export function permissionHint(config: ConnectionConfig, right: "write" | "execute"): string {
  const origin = origins.get(config);
  const field = `permissions.${right}: true`;
  const variable = `WTCTL_ALLOW_${right.toUpperCase()}=true`;
  // Имя называется только у подключения из loadConfig: там оно проверено и коротко.
  if (origin === undefined)
    return `Право ${right} включает владелец подключения в его настройках (permissions.${right}).`;
  if (origin === "settings")
    return `Право ${right} подключению из settings даёт settings.${field} в loadConfig.`;
  let where = `переменная ${variable} рядом с WTCTL_URL (у MCP-сервера — в env его записи)`;
  if (origin !== "environment") {
    // У MCP-сервера с --config команда в терминале покажет другой файл.
    const file = origin.named
      ? "в файле подключений из --config или WTCTL_CONFIG"
      : "в файле подключений (путь показывает wtctl config path)";
    where = origin.listed
      ? `${field} у подключения ${config.name} ${file}`
      : `${field} ${file} или переменная ${variable}`;
  }
  return `Право ${right} включает владелец подключения: ${where}. MCP-сервер видит правку после перезапуска.`;
}

/** Образец подключения без учётных данных, который можно коммитить. */
export function configExample(): Record<string, unknown> {
  return {
    defaultConnection: "dev",
    connections: {
      dev: {
        baseUrl: "http://localhost:8088/",
        usernameEnv: "WTCTL_USERNAME",
        passwordEnv: "WTCTL_PASSWORD",
        permissions: { write: false, execute: false },
      },
    },
  };
}

export interface NewConnection {
  readonly name: string;
  readonly baseUrl: string;
  readonly username: string;
  /** Сам пароль, хранимый в файле, или имя переменной, в которой он лежит. */
  readonly password?: string;
  readonly passwordEnv?: string;
  readonly write: boolean;
  readonly execute: boolean;
}

/** Документ подключений с добавленным подключением; первое становится подключением по умолчанию. */
export function withConnection(
  document: Record<string, unknown>,
  connection: NewConnection,
  replace: boolean,
): Record<string, unknown> {
  const connections =
    document.connections === undefined ? {} : object(document.connections, "connections");
  if (document.connections === undefined && Object.keys(document).length > 0)
    throw new HcmError(
      "INVALID_CONFIG",
      "Файл подключений записан в старом виде, без списка connections.",
      "Нужно перенести его содержимое в connections по образцу wtctl config example или указать другой файл.",
    );
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(connection.name))
    throw new HcmError(
      "INVALID_CONFIG",
      "Имя подключения: до 64 латинских букв, цифр и знаков . _ -",
    );
  if (connections[connection.name] !== undefined && !replace)
    throw new HcmError(
      "CONNECTION_EXISTS",
      `Подключение ${connection.name} уже есть в файле.`,
      "Нужно выбрать другое имя (--name) или заменить подключение: --force.",
    );
  let url: URL;
  try {
    url = new URL(connection.baseUrl);
  } catch {
    throw new HcmError(
      "INVALID_CONFIG",
      "Адрес сервера должен быть полным: http://сервер:порт или https://сервер.",
    );
  }
  if (!/^(https?:)$/.test(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new HcmError(
      "INVALID_CONFIG",
      "Адрес сервера: только http или https, без имени и пароля, без ? и #.",
    );
  return {
    defaultConnection:
      typeof document.defaultConnection === "string" ? document.defaultConnection : connection.name,
    ...Object.fromEntries(
      Object.entries(document).filter(
        ([key]) => key !== "defaultConnection" && key !== "connections",
      ),
    ),
    connections: {
      ...connections,
      [connection.name]: {
        baseUrl: url.href,
        username: connection.username,
        ...(connection.passwordEnv === undefined
          ? { password: connection.password }
          : { passwordEnv: connection.passwordEnv }),
        permissions: { write: connection.write, execute: connection.execute },
      },
    },
  };
}
