import { createRequire as __wtctlRequire } from "node:module";
const require = __wtctlRequire(import.meta.url);
import {
  boolean,
  definitionOf,
  fields,
  freezeRegistry,
  getEffectiveNativeEffect,
  getNativeOperations,
  integer,
  isStepReference,
  loginFailed,
  object,
  operation,
  prepare,
  schema,
  string
} from "./chunk-OJZZGCO7.js";
import {
  ArgumentError,
  WebSocketHeartbeatError,
  WsHcmApiError,
  assertXmlCharacters,
  createPhysicalDocument,
  createPlatformXmlBuilder,
  createPlatformXmlParser,
  escapeXml,
  findXmlNode,
  localName,
  parsePhysicalDocumentId,
  parseValidatedXml,
  parseXml,
  rawXml,
  validateDbName,
  validatePlatformXmlSource
} from "./chunk-VYMNGZ3Z.js";

// src/errors.ts
var HcmError = class extends Error {
  constructor(code, message, hint, details, mutationOutcome) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.details = details;
    this.mutationOutcome = mutationOutcome;
    this.name = new.target.name;
  }
  /** Ошибка в виде error ответа. */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: false,
      ...this.hint === void 0 ? {} : { hint: this.hint },
      ...this.details === void 0 ? {} : { details: this.details },
      ...this.mutationOutcome === void 0 ? {} : { mutationOutcome: this.mutationOutcome }
    };
  }
};
function inputObject(value, label = "args") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new HcmError(
      "INVALID_ARGUMENT",
      `${label}: нужен объект.`,
      "Нужно передать объект JSON."
    );
  return value;
}
function requiredString(value, path) {
  if (typeof value !== "string" || value.length === 0)
    throw new HcmError(
      "INVALID_ARGUMENT",
      `${path}: нужна непустая строка.`,
      "Аргументы операции описывает api.describe.",
      { path }
    );
  return value;
}
function boundedInteger(value, fallback, max, path) {
  if (value === void 0) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new HcmError(
      "INVALID_ARGUMENT",
      `${path}: нужно целое число от 0 до ${max}.`,
      void 0,
      { path }
    );
  return value;
}
function scalar(value, label) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value)
    return String(value["#text"]);
  throw new HcmError("PLATFORM_RESPONSE", `В ответе сервера нет ${label}.`);
}
function oneEditApart(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;
  const restA = a.slice(start, endA);
  const restB = b.slice(start, endB);
  return Math.max(restA.length, restB.length) <= 1 || restA.length === 2 && restB.length === 2 && restA === restB[1] + restB[0];
}
function isSimilarName(known, asked) {
  return !!known && (asked.length >= 3 && known.includes(asked) || known.length >= 3 && asked.includes(known) || oneEditApart(known, asked));
}
function similarHint(names) {
  const near = [...new Set(names)].filter(Boolean).slice(0, 5);
  return near.length ? `Похожие: ${near.join(", ")}. ` : "";
}

// src/config.ts
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
var KIB = 1024;
var MIB = 1024 * KIB;
var GIB = 1024 * MIB;
var MAX_CONFIG_BYTES = MIB;
var SETUP_HINT = "Нужно задать WTCTL_URL, WTCTL_USERNAME и WTCTL_PASSWORD (для MCP-сервера — в env его записи) или создать файл подключений: wtctl config init.";
function homeDirectory() {
  return resolve(process.env.WTCTL_HOME || join(homedir(), ".wtctl"));
}
function defaultConfigPath() {
  return join(homeDirectory(), "connections.json");
}
function readConfiguration(path) {
  let file;
  try {
    file = openSync(path, "r");
  } catch (error) {
    if (error.code === "ENOENT")
      throw new HcmError(
        "INVALID_CONFIG",
        `Файл подключений не найден: ${path}.`,
        "Нужно проверить --config и WTCTL_CONFIG или создать файл: wtctl config init."
      );
    throw new HcmError(
      "INVALID_CONFIG",
      `Файл подключений не открывается: ${path}.`,
      "Проверить права на файл."
    );
  }
  try {
    const info = fstatSync(file);
    if (!info.isFile())
      throw new HcmError("INVALID_CONFIG", `Файл подключений — не файл: ${path}.`);
    if (info.size > MAX_CONFIG_BYTES)
      throw new HcmError("INVALID_CONFIG", "Файл подключений больше 1 МиБ.");
    const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = readSync(file, bytes, used, bytes.length - used, null);
      if (!count) break;
      used += count;
    }
    if (used > MAX_CONFIG_BYTES)
      throw new HcmError("INVALID_CONFIG", "Файл подключений больше 1 МиБ.");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used));
  } finally {
    closeSync(file);
  }
}
function parseConfiguration(text3, path) {
  let value;
  try {
    value = JSON.parse(text3);
  } catch (error) {
    const position = /position (\d+)/.exec(error instanceof Error ? error.message : "")?.[1];
    const line = position === void 0 ? void 0 : text3.slice(0, Number(position)).split("\n").length;
    throw new HcmError(
      "INVALID_CONFIG",
      `Файл подключений ${path} — не JSON${line === void 0 ? "" : `: ошибка в строке ${line}`}.`,
      "Образец файла показывает wtctl config example."
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new HcmError(
      "INVALID_CONFIG",
      `Файл подключений ${path} должен содержать объект JSON.`,
      "Образец файла показывает wtctl config example."
    );
  return value;
}
function bool(value, fallback, field) {
  if (value === void 0) return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new HcmError("INVALID_CONFIG", `${field}: нужно true или false.`);
}
function string2(value, field) {
  if (value === void 0) return void 0;
  if (typeof value !== "string" || value.length === 0)
    throw new HcmError("INVALID_CONFIG", `${field}: нужна непустая строка.`);
  return value;
}
function object2(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new HcmError("INVALID_CONFIG", `${field}: нужен объект.`);
  return value;
}
function integer2(fallback, minimum, maximum, unlimited = false) {
  return (value, field) => {
    if (value === void 0) return fallback;
    const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum && !(unlimited && parsed === 0) || parsed > maximum)
      throw new HcmError(
        "INVALID_CONFIG",
        `${field}: нужно целое число от ${minimum} до ${maximum}${unlimited ? "; 0 — без предела" : ""}.`
      );
    return parsed;
  };
}
var folder = (value, field) => resolve(string2(value, field) ?? join(homeDirectory(), "runtime"));
var LOCAL_LIMITS = {
  resultsMaxBytes: GIB,
  resultsMaxAgeDays: 7,
  journalMaxBytes: 10 * MIB
};
var SETTINGS = {
  timeoutMs: ["WTCTL_TIMEOUT_MS", integer2(3e4, 1, 6e5)],
  maxResponseBytes: ["WTCTL_MAX_RESPONSE_BYTES", integer2(32 * MIB, KIB, 512 * MIB)],
  outputLimitBytes: ["WTCTL_OUTPUT_LIMIT_BYTES", integer2(24 * KIB, KIB, MIB)],
  runtimeDir: ["WTCTL_RUNTIME_DIR", folder],
  resultsMaxBytes: [
    "WTCTL_RESULTS_MAX_BYTES",
    integer2(LOCAL_LIMITS.resultsMaxBytes, KIB, 1024 * GIB, true)
  ],
  resultsMaxAgeDays: [
    "WTCTL_RESULTS_MAX_AGE_DAYS",
    integer2(LOCAL_LIMITS.resultsMaxAgeDays, 1, 3650, true)
  ],
  journalMaxBytes: [
    "WTCTL_JOURNAL_MAX_BYTES",
    integer2(LOCAL_LIMITS.journalMaxBytes, KIB, GIB, true)
  ]
};
var OWN_FIELDS = ["baseUrl", "username", "password", "permissions"];
function parseBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new HcmError(
      "INVALID_CONFIG",
      "Адрес сервера должен быть полным: http://сервер:порт или https://сервер."
    );
  }
  if (!/^(https?:)$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.href.includes("?") || url.href.includes("#"))
    throw new HcmError(
      "INVALID_CONFIG",
      "Адрес сервера: только http или https, без имени и пароля, без ? и #."
    );
  return url.href;
}
function validateConnectionName(name2, hint) {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name2))
    throw new HcmError(
      "INVALID_CONFIG",
      "Имя подключения: до 64 латинских букв, цифр и знаков . _ -",
      hint
    );
  return name2;
}
function parseEnvName(value, field) {
  const envName = string2(value, field);
  if (envName !== void 0 && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName))
    throw new HcmError("INVALID_CONFIG", `${field}: это не имя переменной окружения.`);
  return envName;
}
function credential(profile, field, globalOverrides) {
  const envName = parseEnvName(profile[`${field}Env`], `${field}Env`);
  const global = globalOverrides ? process.env[`WTCTL_${field.toUpperCase()}`] : void 0;
  if (global !== void 0 || envName === void 0) return string2(global ?? profile[field], field);
  const value = process.env[envName];
  if (!value)
    throw new HcmError(
      "INVALID_CONFIG",
      `Переменная ${envName} из ${field}Env не задана или пуста.`,
      "Нужно задать её в окружении процесса; у MCP-сервера — в env его записи."
    );
  return value;
}
function loadConfig(options = {}) {
  return loadConfigWithDefaults(options);
}
function loadConfigWithDefaults(options = {}, defaults = {}) {
  const settings = object2(options.settings ?? {}, "settings");
  for (const key of Object.keys(settings))
    if (!Object.hasOwn(SETTINGS, key) && !OWN_FIELDS.includes(key))
      throw new HcmError(
        "INVALID_CONFIG",
        `settings.${key}: такого поля нет.`,
        `Поля settings: ${[...OWN_FIELDS, ...Object.keys(SETTINGS)].join(", ")}.`
      );
  const standalone = settings.baseUrl !== void 0;
  if (standalone && options.configPath !== void 0)
    throw new HcmError(
      "INVALID_CONFIG",
      "settings.baseUrl задаёт подключение целиком, а configPath называет файл подключений.",
      "Нужно оставить что-то одно: settings.baseUrl или configPath."
    );
  const explicit = options.configPath ?? process.env.WTCTL_CONFIG;
  const own = standalone ? void 0 : OWN_FIELDS.find((key) => settings[key] !== void 0);
  if (own !== void 0)
    throw new HcmError(
      "INVALID_CONFIG",
      `settings.${own}: адрес, учётные данные и права подключения из файла или переменных кодом не меняются.`,
      "Отдельное подключение задаёт settings с baseUrl, а с ним username, password и permissions."
    );
  const path = standalone ? void 0 : explicit ?? (process.env.WTCTL_URL === void 0 && existsSync(defaultConfigPath()) ? defaultConfigPath() : void 0);
  let document = {};
  if (path !== void 0) {
    let text3;
    try {
      text3 = readConfiguration(path);
    } catch (error) {
      if (error instanceof HcmError) throw error;
      throw new HcmError(
        "INVALID_CONFIG",
        `Файл подключений не читается: ${path}.`,
        "Файл должен быть текстом UTF-8."
      );
    }
    document = parseConfiguration(text3, path);
  }
  let name2 = options.connection;
  let chosen = "Имя задано в --connection или аргументе connection.";
  if (name2 === void 0 && !standalone) {
    name2 = process.env.WTCTL_CONNECTION;
    chosen = "Имя взято из переменной WTCTL_CONNECTION.";
    if (name2 === void 0) {
      name2 = string2(document.defaultConnection, "defaultConnection");
      chosen = "Имя взято из defaultConnection файла.";
    }
  }
  if (name2 === void 0) {
    name2 = "default";
    chosen = "Имя по умолчанию: --connection, WTCTL_CONNECTION и defaultConnection не заданы.";
  }
  validateConnectionName(name2, chosen);
  let profile = standalone ? settings : {};
  const globalOverrides = !standalone && document.connections === void 0;
  if (document.connections !== void 0) {
    const connections = object2(document.connections, "connections");
    if (!Object.hasOwn(connections, name2) || connections[name2] === void 0)
      throw new HcmError(
        "UNKNOWN_CONNECTION",
        `В файле подключений ${path} нет подключения ${name2}. ${chosen}`,
        `Есть: ${Object.keys(connections).slice(0, 20).join(", ") || "ни одного"}. Имя задают --connection, WTCTL_CONNECTION или defaultConnection файла; первое заданное сильнее.`,
        { connection: name2 }
      );
    profile = object2(connections[name2], "connection");
  } else if (Object.keys(document).length > 0) profile = document;
  const baseUrl = string2(
    (globalOverrides ? process.env.WTCTL_URL : void 0) ?? profile.baseUrl,
    "baseUrl"
  );
  if (baseUrl === void 0)
    throw path === void 0 ? new HcmError("NOT_CONFIGURED", "Подключение к серверу не настроено.", SETUP_HINT) : new HcmError(
      "INVALID_CONFIG",
      `В подключении ${name2} не задан адрес сервера (baseUrl).`,
      "Образец файла показывает wtctl config example."
    );
  const normalizedUrl = parseBaseUrl(baseUrl);
  const username = credential(profile, "username", globalOverrides);
  const password = options.password ?? credential(profile, "password", globalOverrides);
  if (username === void 0 !== (password === void 0))
    throw new HcmError(
      "INVALID_CONFIG",
      `Имя пользователя и пароль задают вместе: не задан${username === void 0 ? "о имя пользователя" : " пароль"}.`,
      globalOverrides ? "Переменные WTCTL_USERNAME и WTCTL_PASSWORD." : standalone ? "Поля username и password в settings." : "Поля username и password подключения либо переменные, названные в usernameEnv и passwordEnv."
    );
  const permissions = profile.permissions === void 0 ? {} : object2(profile.permissions, "permissions");
  const values = Object.fromEntries(
    Object.entries(SETTINGS).map(([field, [variable, parse]]) => {
      const explicitValue = settings[field] ?? process.env[variable] ?? profile[field];
      const fallback = field === "outputLimitBytes" ? defaults.outputLimitBytes : void 0;
      return [field, parse(explicitValue ?? fallback, `${field} (${variable})`)];
    })
  );
  const config = {
    name: name2,
    baseUrl: normalizedUrl,
    ...username === void 0 ? {} : { username },
    ...password === void 0 ? {} : { password },
    ...values,
    permissions: {
      write: bool(
        (globalOverrides ? process.env.WTCTL_ALLOW_WRITE : void 0) ?? permissions.write,
        false,
        "permissions.write"
      ),
      execute: bool(
        (globalOverrides ? process.env.WTCTL_ALLOW_EXECUTE : void 0) ?? permissions.execute,
        false,
        "permissions.execute"
      )
    }
  };
  const origin = standalone ? "settings" : path === void 0 ? "environment" : { listed: !globalOverrides, named: explicit !== void 0 };
  origins.set(config, origin);
  rememberCopy(copyKey(config), origin);
  return config;
}
var origins = /* @__PURE__ */ new WeakMap();
var MAX_COPIES = 256;
var copies = /* @__PURE__ */ new Map();
var copyKey = (config) => `${config.name}
${config.baseUrl}`;
function rememberCopy(key, origin) {
  copies.delete(key);
  copies.set(key, origin);
  if (copies.size > MAX_COPIES) {
    const oldest = copies.keys().next().value;
    if (oldest !== void 0) copies.delete(oldest);
  }
}
var servedByMcp = /* @__PURE__ */ new WeakSet();
function markServedByMcp(config) {
  servedByMcp.add(config);
  return config;
}
function permissionHint(config, right) {
  const origin = origins.get(config) ?? copies.get(copyKey(config));
  const field = `permissions.${right}: true`;
  const variable = `WTCTL_ALLOW_${right.toUpperCase()}=true`;
  const restart = servedByMcp.has(config) ? " MCP-сервер видит правку после перезапуска." : "";
  if (origin === void 0)
    return `Право ${right} включает владелец подключения в его настройках (permissions.${right}).${restart}`;
  if (origin === "settings")
    return `Право ${right} подключению из settings даёт settings.${field} в loadConfig.`;
  let where = `переменная ${variable} рядом с WTCTL_URL (у MCP-сервера — в env его записи)`;
  if (origin !== "environment") {
    const file = origin.named ? "в файле подключений из --config или WTCTL_CONFIG" : "в файле подключений (путь показывает wtctl config path)";
    const target2 = config.name.startsWith("-") ? `--connection=${config.name}` : config.name;
    const command = origin.named ? `wtctl --config ФАЙЛ config set ${target2} --${right} true` : `wtctl config set ${target2} --${right} true`;
    where = origin.listed ? `${command} или ${field} у подключения ${config.name} ${file}` : `${field} ${file} или переменная ${variable}`;
  }
  return `Право ${right} включает владелец подключения: ${where}.${restart}`;
}
function configExample() {
  return {
    defaultConnection: "dev",
    connections: {
      dev: {
        baseUrl: "http://localhost:8088/",
        usernameEnv: "WTCTL_USERNAME",
        passwordEnv: "WTCTL_PASSWORD",
        permissions: { write: false, execute: false }
      }
    }
  };
}
function withConnection(document, connection, replace) {
  const connections = document.connections === void 0 ? {} : object2(document.connections, "connections");
  if (document.connections === void 0 && Object.keys(document).length > 0)
    throw new HcmError(
      "INVALID_CONFIG",
      "Файл подключений записан в старом виде, без списка connections.",
      "Нужно перенести его содержимое в connections по образцу wtctl config example или указать другой файл."
    );
  validateConnectionName(connection.name);
  if (Object.hasOwn(connections, connection.name) && connections[connection.name] !== void 0 && !replace)
    throw new HcmError(
      "CONNECTION_EXISTS",
      `Подключение ${connection.name} уже есть в файле.`,
      "Нужно выбрать другое имя (--name) или заменить подключение: --force."
    );
  const normalizedUrl = parseBaseUrl(connection.baseUrl);
  return {
    defaultConnection: typeof document.defaultConnection === "string" ? document.defaultConnection : connection.name,
    ...Object.fromEntries(
      Object.entries(document).filter(
        ([key]) => key !== "defaultConnection" && key !== "connections"
      )
    ),
    connections: {
      ...connections,
      [connection.name]: {
        baseUrl: normalizedUrl,
        username: connection.username,
        ...connection.passwordEnv === void 0 ? { password: connection.password } : { passwordEnv: connection.passwordEnv },
        permissions: { write: connection.write, execute: connection.execute }
      }
    }
  };
}
function credentialSource(profile, field) {
  const envName = parseEnvName(profile[`${field}Env`], `${field}Env`);
  if (envName !== void 0) return { source: "env", envName };
  if (string2(profile[field], field) !== void 0) return { source: "file" };
  return { source: "none" };
}
function summarizeConnection(name2, profile, isDefault) {
  validateConnectionName(name2);
  const rawBaseUrl = string2(profile.baseUrl, `${name2}.baseUrl`);
  if (rawBaseUrl === void 0)
    throw new HcmError(
      "INVALID_CONFIG",
      `В подключении ${name2} не задан адрес сервера (baseUrl).`,
      "Образец файла показывает wtctl config example."
    );
  const baseUrl = parseBaseUrl(rawBaseUrl);
  const permissions = profile.permissions === void 0 ? {} : object2(profile.permissions, `${name2}.permissions`);
  const user = credentialSource(profile, "username");
  const pass = credentialSource(profile, "password");
  return {
    name: name2,
    default: isDefault,
    baseUrl,
    permissions: {
      write: bool(permissions.write, false, `${name2}.permissions.write`),
      execute: bool(permissions.execute, false, `${name2}.permissions.execute`)
    },
    credentials: {
      username: user.source,
      ...user.envName === void 0 ? {} : { usernameEnv: user.envName },
      password: pass.source,
      ...pass.envName === void 0 ? {} : { passwordEnv: pass.envName }
    }
  };
}
function listConnections(document) {
  if (document.connections === void 0) {
    if (Object.keys(document).length === 0) return { connections: [] };
    const legacyName = string2(document.defaultConnection, "defaultConnection") ?? "default";
    return {
      defaultConnection: legacyName,
      legacy: true,
      connections: [summarizeConnection(legacyName, document, true)]
    };
  }
  const connections = object2(document.connections, "connections");
  const configuredDefault = string2(document.defaultConnection, "defaultConnection");
  const effectiveDefault = configuredDefault ?? "default";
  const hasDefault = Object.hasOwn(connections, effectiveDefault) && connections[effectiveDefault] !== void 0;
  return {
    ...hasDefault ? { defaultConnection: effectiveDefault } : {},
    connections: Object.entries(connections).map(
      ([name2, raw]) => summarizeConnection(
        name2,
        object2(raw, `connections.${name2}`),
        hasDefault && name2 === effectiveDefault
      )
    )
  };
}
function updateConnection(document, name2, patch, path) {
  if (document.connections === void 0)
    throw new HcmError(
      "INVALID_CONFIG",
      "Файл подключений записан в старом виде, без списка connections.",
      "Нужно перенести его содержимое в connections по образцу wtctl config example или указать другой файл."
    );
  const connections = object2(document.connections, "connections");
  const existingDefault = string2(document.defaultConnection, "defaultConnection");
  const target2 = name2 ?? existingDefault ?? (Object.hasOwn(connections, "default") && connections.default !== void 0 ? "default" : void 0);
  if (target2 === void 0)
    throw new HcmError(
      "INVALID_CONFIG",
      "Не указано имя подключения.",
      `Есть: ${Object.keys(connections).slice(0, 20).join(", ") || "ни одного"}. Нужно передать имя подключения аргументом или через --connection.`
    );
  validateConnectionName(target2);
  if (!Object.hasOwn(connections, target2) || connections[target2] === void 0)
    throw new HcmError(
      "UNKNOWN_CONNECTION",
      `В файле подключений ${path} нет подключения ${target2}.`,
      `Есть: ${Object.keys(connections).slice(0, 20).join(", ") || "ни одного"}.`,
      { connection: target2 }
    );
  const current = object2(connections[target2], `connections.${target2}`);
  const currentPermissions = current.permissions === void 0 ? {} : object2(current.permissions, `${target2}.permissions`);
  const nextProfile = { ...current };
  if (patch.baseUrl !== void 0) nextProfile.baseUrl = parseBaseUrl(patch.baseUrl);
  if (patch.write !== void 0 || patch.execute !== void 0) {
    nextProfile.permissions = {
      ...currentPermissions,
      ...patch.write === void 0 ? {} : { write: patch.write },
      ...patch.execute === void 0 ? {} : { execute: patch.execute }
    };
  }
  const updatedSettings = {};
  for (const [field, [variable, parse]] of Object.entries(SETTINGS)) {
    const given = patch[field];
    if (given === void 0) continue;
    const parsed = field === "runtimeDir" ? string2(given, `runtimeDir (${variable})`) : parse(given, `${field} (${variable})`);
    nextProfile[field] = parsed;
    updatedSettings[field] = parsed;
  }
  const nextDefault = patch.makeDefault ? target2 : existingDefault;
  const nextConnections = {
    ...connections,
    [target2]: nextProfile
  };
  const nextDocument = {
    ...document,
    ...nextDefault === void 0 ? {} : { defaultConnection: nextDefault },
    connections: nextConnections
  };
  const effectiveDefault = nextDefault ?? "default";
  const hasDefault = Object.hasOwn(nextConnections, effectiveDefault) && nextConnections[effectiveDefault] !== void 0;
  const summary2 = {
    ...summarizeConnection(target2, nextProfile, hasDefault && target2 === effectiveDefault),
    ...updatedSettings
  };
  return {
    document: nextDocument,
    connection: summary2,
    ...hasDefault ? { defaultConnection: effectiveDefault } : {}
  };
}
function removeConnection(document, name2, path) {
  if (document.connections === void 0)
    throw new HcmError(
      "INVALID_CONFIG",
      "Файл подключений записан в старом виде, без списка connections.",
      "Нужно перенести его содержимое в connections по образцу wtctl config example или указать другой файл."
    );
  const connections = object2(document.connections, "connections");
  validateConnectionName(name2);
  if (!Object.hasOwn(connections, name2) || connections[name2] === void 0)
    throw new HcmError(
      "UNKNOWN_CONNECTION",
      `В файле подключений ${path} нет подключения ${name2}.`,
      `Есть: ${Object.keys(connections).slice(0, 20).join(", ") || "ни одного"}.`,
      { connection: name2 }
    );
  const existingDefault = string2(document.defaultConnection, "defaultConnection");
  const effectiveBefore = existingDefault ?? "default";
  const wasDefault = effectiveBefore === name2;
  const removed = summarizeConnection(
    name2,
    object2(connections[name2], `connections.${name2}`),
    wasDefault
  );
  const nextConnections = {};
  for (const [key, value] of Object.entries(connections)) {
    if (key === name2 || value === void 0) continue;
    if (key === "__proto__") {
      Object.defineProperty(nextConnections, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true
      });
    } else {
      nextConnections[key] = value;
    }
  }
  const remaining = Object.keys(nextConnections);
  let nextDefault;
  if (remaining.length === 0) {
    nextDefault = void 0;
  } else if (existingDefault !== void 0 && (!Object.hasOwn(nextConnections, existingDefault) || nextConnections[existingDefault] === void 0) || existingDefault === void 0 && name2 === "default") {
    nextDefault = remaining[0];
  } else {
    nextDefault = existingDefault;
  }
  const restDocument = Object.fromEntries(
    Object.entries(document).filter(
      ([key]) => key !== "defaultConnection" && key !== "connections"
    )
  );
  const nextDocument = {
    ...nextDefault === void 0 ? {} : { defaultConnection: nextDefault },
    ...restDocument,
    connections: nextConnections
  };
  const effectiveDefault = nextDefault ?? "default";
  const hasDefault = Object.hasOwn(nextConnections, effectiveDefault) && nextConnections[effectiveDefault] !== void 0;
  return {
    document: nextDocument,
    removed,
    ...hasDefault ? { defaultConnection: effectiveDefault } : {},
    remaining
  };
}

// src/server-value.ts
function rpcArgument(value) {
  if (value === null) return { valueType: "null", lexicalValue: "" };
  if (typeof value === "string") return { valueType: "string", lexicalValue: value };
  if (typeof value === "boolean") return { valueType: "bool", lexicalValue: value ? "1" : "0" };
  if (typeof value === "number" && Number.isSafeInteger(value))
    return { valueType: "integer", lexicalValue: String(value) };
  throw new HcmError(
    "INVALID_RPC_ARGUMENT",
    "Такой аргумент функции задаётся явно: {valueType, lexicalValue}. Так передают дробные и большие числа, даты, объекты и XML."
  );
}
function object3(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
  return value;
}
function blank(value) {
  return value === void 0 || typeof value === "string" && value.trim() === "";
}
function exactKeys(node, allowed) {
  if (Object.keys(node).some((key) => !allowed.includes(key))) throw new Error();
}
function isType(value, type) {
  return typeof value === "string" && value.toLowerCase() === type;
}
function wrapper(value, child) {
  const node = object3(value);
  if (!blank(node["#text"]) || Object.keys(node).some((key) => {
    if (key === child || key === "#text") return false;
    return !/^@_xmlns(?::[A-Za-z_][\w.-]*)?$/.test(key) || typeof node[key] !== "string" || node[key].length > 1024;
  }))
    throw new Error();
  return node[child];
}
function typedText(value, type) {
  const node = object3(value);
  exactKeys(node, ["@_VALUE-TYPE", "#text"]);
  if (!isType(node["@_VALUE-TYPE"], type)) throw new Error();
  const text3 = node["#text"] ?? "";
  if (typeof text3 !== "string") throw new Error();
  return text3;
}
function strictResponse(response) {
  const rpc = object3(response);
  exactKeys(rpc, ["xml", "valueType", "lexicalValue"]);
  return { rpc, result: object3(wrapper(wrapper(rpc.xml, "ResultData"), "Result")) };
}
function decodeRpcValue(value, depth = 0) {
  if (depth > 64) throw new HcmError("SCRIPT_RESPONSE", "Результат вложен глубже 64 уровней.");
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new HcmError("SCRIPT_RESPONSE", "В результате нет элемента с VALUE-TYPE.");
  const node = value;
  const typeValue = node["@_VALUE-TYPE"];
  if (typeof typeValue !== "string" || typeValue === "")
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "В результате есть элемент XML без типа.",
      "Возвращать можно простые значения, массивы и обычные объекты. Элементы и документы XML (XmElem, XmDoc) нужно превращать в строку в самом коде. Ответ сервера как есть покажет web.rpc.call."
    );
  const type = typeValue.toLowerCase();
  const children2 = Object.keys(node).filter((key) => !key.startsWith("@_") && key !== "#text");
  const text3 = node["#text"] ?? "";
  if (typeof text3 !== "string")
    throw new HcmError("SCRIPT_RESPONSE", "Значение в результате — не текст.");
  if (["array", "object", "null", "undefined"].includes(type) && text3.trim() !== "")
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "В массиве, объекте или null результата есть посторонний текст."
    );
  if (type === "array") {
    if (children2.some((key) => key !== "e"))
      throw new HcmError("SCRIPT_RESPONSE", "В массиве результата есть посторонние элементы.");
    const items = node.e === void 0 ? [] : Array.isArray(node.e) ? node.e : [node.e];
    return items.map((item) => decodeRpcValue(item, depth + 1));
  }
  if (type === "object") {
    return Object.fromEntries(children2.map((key) => [key, decodeRpcValue(node[key], depth + 1)]));
  }
  if (type === "null" || type === "undefined") {
    if (children2.length !== 0)
      throw new HcmError("SCRIPT_RESPONSE", "В значении null результата есть вложенные элементы.");
    return null;
  }
  if (!["string", "integer", "real", "bool", "date"].includes(type))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "В результате есть значение неподдерживаемого типа (VALUE-TYPE).",
      "Возвращать можно простые значения, массивы и обычные объекты. Элементы и документы XML (XmElem, XmDoc) нужно превращать в строку в самом коде. Ответ сервера как есть покажет web.rpc.call."
    );
  if (children2.length !== 0)
    throw new HcmError("SCRIPT_RESPONSE", "В простом значении результата есть вложенные элементы.");
  return text3;
}
function rpcValue(response) {
  try {
    return { value: decodeRpcValue(findXmlNode(response, "Result")) };
  } catch (error) {
    if (error instanceof HcmError && error.code === "SCRIPT_RESPONSE") return response;
    throw error;
  }
}

// src/write-outcome.ts
function refusedAtDoor(error) {
  return error instanceof WsHcmApiError && error.status === 401 || loginFailed(error);
}
var WriteOutcome = class {
  marks = 0;
  ids = {};
  /** Перед запросом, способным изменить сервер; возвращает снятие этой отметки. */
  sending() {
    this.marks++;
    let withdrawn = false;
    return () => {
      if (!withdrawn) this.marks--;
      withdrawn = true;
    };
  }
  /** Значение undefined ничего не стирает. */
  note(ids) {
    for (const [key, value] of Object.entries(ids))
      if (value !== void 0) this.ids[key] = value;
  }
  /**
   * Первая подходящая строка: нет ошибки или чтение — исхода нет; отказ на входе, неснятая
   * отметка; иначе not_sent.
   */
  verdict(effect, error) {
    const { mutationId, objectId, executionId } = this.ids;
    const exactIds = {
      ...mutationId !== void 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(mutationId) ? { mutationId } : {},
      ...objectId !== void 0 && /^(?:[0-9]{1,20}|0[xX][0-9a-fA-F]{1,16})$/.test(objectId) && BigInt(objectId) <= 0xffffffffffffffffn ? { objectId } : {},
      ...executionId !== void 0 && /^hcm_inline_[a-f0-9]{32}$/.test(executionId) ? { executionId } : {}
    };
    const sent = effect !== "read" && this.marks > 0;
    const verdict = { sent, ids: { ...this.ids }, exactIds };
    if (error === void 0 || effect === "read") return verdict;
    const turnedAway = error instanceof HcmError && (error.code === "RPC_SERVER_ONLY" || error.code === "UNKNOWN_RPC_TARGET");
    const mutationOutcome = sent && !turnedAway ? "indeterminate" : "not_sent";
    const refusedAfterSend = mutationOutcome === "indeterminate" && refusedAtDoor(error);
    return { ...verdict, mutationOutcome, ...refusedAfterSend && { refusedAfterSend } };
  }
};

// src/operations/native.ts
function setOwnProperty(target2, key, value) {
  if (key === "__proto__")
    Object.defineProperty(target2, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true
    });
  else target2[key] = value;
}
function withoutXmlFormatting(value) {
  if (Array.isArray(value)) {
    let copy2;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const next = withoutXmlFormatting(item);
      if (copy2 !== void 0) {
        copy2[i] = next;
      } else if (next !== item) {
        copy2 = value.slice(0, i);
        copy2.push(next);
      }
    }
    return copy2 ?? value;
  }
  if (!value || typeof value !== "object" || value instanceof Uint8Array) return value;
  const record = value;
  let copy;
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const child = record[key];
    if (key === "@_xmlns" || key === "#text" && typeof child === "string" && child.trim() === "") {
      if (copy === void 0) {
        copy = {};
        for (let j = 0; j < i; j++) {
          const prevKey = keys[j];
          setOwnProperty(copy, prevKey, record[prevKey]);
        }
      }
      continue;
    }
    const next = typeof child === "string" && /^\s*\n[ \t]+$/.test(child) ? "" : withoutXmlFormatting(child);
    if (copy !== void 0) {
      setOwnProperty(copy, key, next);
    } else if (next !== child) {
      copy = {};
      for (let j = 0; j < i; j++) {
        const prevKey = keys[j];
        setOwnProperty(copy, prevKey, record[prevKey]);
      }
      setOwnProperty(copy, key, next);
    }
  }
  return copy ?? value;
}
function uploadedFile(answer) {
  if (answer === null || typeof answer !== "object" || Array.isArray(answer)) return answer;
  const data2 = answer;
  if (typeof data2.Url === "string" && data2.Url) {
    const url = `x-local://share/uploaded_files/${data2.Url}`;
    const { Url: _, ...rest } = data2;
    return { ...rest, url, folderUrl: url.slice(0, url.lastIndexOf("/")) };
  }
  return answer;
}
function uploadFailure(error) {
  if (!(error instanceof WsHcmApiError)) return error;
  if (error.details?.chunkFailed === true) {
    const joining = error.status === 503;
    return new HcmError(
      "PLATFORM_HTTP",
      joining ? "Сервер не собрал файл из частей (HTTP 503)." : `Сервер не записал часть файла (HTTP ${error.status}).`,
      `Загрузку повторить целиком.${joining ? " Если сборка упала, причина — в строке ERROR[upload_big_file] лога xhttp: последние строки показывает logs.follow." : ""}`,
      { status: error.status }
    );
  }
  if (error.details?.uploadRefused !== true) return error;
  const reason = error.details.reason;
  return new HcmError(
    "UPLOAD_REFUSED",
    typeof reason === "string" ? reason : `Сервер не принял файл в загрузку (HTTP ${error.status}). Причину он пишет только в свой лог xhttp за сегодня: последние строки показывает logs.follow.`,
    "Сервер принимает в загрузку только имена из своей политики загрузки (resource_sec.json): обычно .txt, .xml, .zip, документы и картинки; .js, .json, .css, .html, .svg, .bin и имена без расширения — нет. Файл по своему адресу записывает files.write."
  );
}
function asyncStatus(answer) {
  if (answer === null || typeof answer !== "object" || Array.isArray(answer)) return answer;
  const data2 = answer;
  if (data2.ResultData !== void 0)
    try {
      const decoded = rpcValue(data2);
      if (decoded !== data2) {
        const { ResultData: _typed, ...state } = data2;
        return { ...state, ...decoded };
      }
    } catch {
    }
  return answer;
}
var createFromXml = async ({ server }, args, { outcome }) => {
  const aside = new WriteOutcome();
  const created = await createPhysicalDocument(
    {
      getNewObjectId: async (request) => ({
        data: await server.call("native.lds.getNewObjectId", request, aside)
      }),
      putDoc: async ({ data: data2, ...request }) => {
        outcome.note({ url: request.url, objectId: parsePhysicalDocumentId(request.url) });
        return {
          data: await server.call("native.lds.putDoc", { ...request, data: data2.xml }, outcome)
        };
      },
      loadDoc: async (request) => ({ data: await server.call("native.lds.loadDoc", request) }),
      deleteDoc: (request) => server.call("native.lds.deleteDoc", request, aside)
    },
    {
      ...args.dbName === void 0 ? {} : { dbName: args.dbName },
      ...args.writeDocInfo === void 0 ? {} : { writeDocInfo: args.writeDocInfo },
      ...args.skipActions === void 0 ? {} : { skipActions: args.skipActions },
      ...args.neverSaved === void 0 ? {} : { neverSaved: args.neverSaved },
      document: ({ objectId }) => rawXml(args.documentXmlTemplate.replaceAll("{{objectId}}", objectId))
    }
  );
  return { objectId: created.objectId, url: created.url, document: created.loadResponse.data };
};
var inRuntime = [
  {
    id: "native.physicalDocuments.createFromXml",
    profile: "native",
    group: "physicalDocuments",
    method: "createFromXml",
    title: "Создать документ из XML",
    description: "Выделить ID, подставить его вместо {{objectId}} в documentXmlTemplate, сохранить через PutDoc и сверить ID корня через LoadDoc. Обработка XMD, как в клиенте администратора, не воспроизводится.",
    effect: "write",
    inputSchema: {
      type: "object",
      properties: {
        documentXmlTemplate: { type: "string" },
        dbName: { type: "string" },
        writeDocInfo: { type: "boolean" },
        skipActions: { type: "boolean" },
        neverSaved: { type: "boolean" }
      },
      required: ["documentXmlTemplate"],
      additionalProperties: false
    }
  }
];
var FACES = {
  // Тема tasks.
  "web.spxml.callMethodAsync": {
    summary: "Запустить функцию библиотеки фоновой задачей; ответ содержит TrackingID.",
    details: "target — «библиотека.функция». Удобнее rpc.call с async:true: он принимает обычные значения аргументов."
  },
  "web.spxml.getAsyncMethodStatus": {
    summary: "Состояние задачи по TrackingID. Итог выдаётся один раз: его нужно сохранить и больше не опрашивать.",
    details: "trackingId — как в ответе запуска: 0x… или десятичный. Пока задача идёт, IsRunning «1»; у завершённой IsRunning «0» и value — её результат, как у обычного rpc.call. После такого ответа сервер запись о задаче удаляет: второй раз результат не получить. Опрашивать не чаще четырёх раз в секунду.",
    answer: asyncStatus
  },
  "web.spxml.getBackgroundTasksByName": {
    summary: "Найти задачи по имени библиотеки и функции.",
    details: "В списке бывают задачи других пользователей: совпадение имени не значит, что задача своя. Недавно завершённые задачи остаются в списке вместе с итогом."
  },
  "web.spxml.killAsyncMethod": {
    summary: "Попросить сервер остановить задачу.",
    details: "Уже сделанные изменения не откатываются. Остановка завершённой задачи не гарантирована."
  },
  // Тема files.
  "web.pages.uploadFile": {
    summary: "Загрузить файл в папку загрузок сервера; ответ содержит его адрес.",
    details: 'filename — имя без пути; data — текст или {base64:"…"}. Ответ: url — адрес файла, folderUrl — папка, которую сервер создал для него.',
    answer: uploadedFile,
    failure: uploadFailure
  },
  "web.pages.uploadChunk": {
    summary: "Загрузить одну часть большого файла.",
    details: "fileId — 32 шестнадцатеричных знака, его выбирает вызывающий. Части идут по порядку, последняя собирает файл. Ответ сервера не доказывает, что часть сохранена. При ошибке на последней части вслепую повторять нельзя: адрес итогового файла может остаться неизвестным.",
    failure: uploadFailure
  },
  "web.pages.clearUploadChunks": {
    summary: "Удалить загруженные части файла.",
    details: "Удаляет части с 0 по chunksTotal − 1 для заданного fileId. Сервер не проверяет, кто создал этот ID; пустой ответ не доказывает, что части удалены."
  },
  // Тема documents.
  "native.lds.loadDoc": {
    summary: "Прочитать документ по адресу; приходит разобранным в JSON.",
    details: "Документ приходит разобранным: data.Data.<тип объекта>. Повторяемый элемент из одного элемента здесь объект, а не список. Даты записаны как на сервере, со смещением +00:00: это местное время сервера. tryLock:true меняет состояние блокировки документа и требует права write. Текст XML того же документа отдаёт files.read по тому же адресу.",
    usualCause: "по этому адресу ничего нет"
  },
  "native.lds.putDoc": {
    summary: "Сохранить документ по адресу из текста XML.",
    details: "data — текст XML всего документа; он заменяет документ целиком. writeDocInfo:true — сервер обновляет дату и автора изменения; без него они остаются как в тексте, и поиск по modification_date правку не видит. neverSaved:true — документ записывается впервые (так пишет новый объект objects.create). skipActions:true отключает обработку, которую сервер выполняет перед сохранением. Чужую правку операция не замечает: fingerprint из objects.get нужно сверять до записи самому."
  },
  "native.lds.deleteDoc": {
    summary: "Удалить документ по адресу.",
    details: "strictDelete:true требует, чтобы документ существовал."
  },
  "native.lds.getNewObjectId": {
    summary: "Выделить новый ID объекта; каждый вызов расходует ID.",
    details: "ObjectID — новый ID десятичной записью; остальные операции принимают его и так, и в записи 0x…."
  },
  "native.physicalDocuments.createFromXml": {
    run: createFromXml,
    summary: "Создать документ из готового XML; новый ID подставляется вместо {{objectId}}.",
    details: "documentXmlTemplate — текст XML документа с {{objectId}} на месте ID. После записи документ перечитывается, и его ID сверяется. Обработчики, которые админка выполняет при создании, не запускаются."
  },
  // Тема server.
  "native.spxml2.getAppInfo": {
    summary: "Каталоги, типы объектов, общие документы и настройки приложения.",
    details: "Ответ большой и сохраняется целиком. Каталоги — databases[i].catalogs: {id, form_url, object_type}; основная база названа в default_db_name. Типы и их каталоги короче показывает schema.types."
  },
  "anonymous.diagnostics.portal": {
    summary: "Отвечает ли портал."
  },
  "anonymous.diagnostics.xhttpInfo": {
    summary: "Служебная страница /xhttp_info.",
    details: "Ответ — страница HTML со сведениями о сборке сервера."
  },
  "web.websocket.heartbeat": {
    summary: "Отвечает ли служба WebSocket.",
    details: "Одна проверка: соединение, служебное сообщение, ответ. heartbeatObserved:true — служба ответила.",
    // Коды WS_* переводятся здесь; основные операции должны вызывать heartbeat через pipeline.invoke.
    failure: (error) => error instanceof WebSocketHeartbeatError ? new HcmError(error.errorCode, error.message, error.hint, error.details) : error
  },
  // Тема forms.
  "native.spxml2.getForm": {
    summary: "Текст формы (.xmd, .xms) по адресу."
  },
  "web.pages.getScreenForm": {
    summary: "Текст экранной формы по адресу."
  },
  "web.pages.getUiText": {
    summary: "Тексты интерфейса."
  },
  "native.resources.getImage": {
    summary: "Картинка ресурса по ID."
  },
  "native.resources.getCompoundResource": {
    summary: "Вложение составного документа.",
    details: "Источник — url (адрес HTML-файла: x-local:// или x-app://) либо docUrl (x-local://, x-app:// или x-db-obj://) вместе с elemPath (строковое поле документа; начинается с имени корневого элемента: presence_state.name). resId — обязательный ID вложения compound-attc."
  }
};
var nativeOperations = [...getNativeOperations(), ...inRuntime].map(
  (native) => {
    const { answer, failure, run, ...texts } = FACES[native.id] ?? {};
    return operation({
      id: native.id,
      effect: native.effect,
      effectFor: (args) => getEffectiveNativeEffect(native, args),
      description: native.description,
      ...texts,
      inputSchema: native.inputSchema,
      native,
      run: async (context, args, call) => {
        const raw = withoutXmlFormatting(
          await (run ? run(context, args, call) : context.server.call(
            native.id,
            args,
            call.effect === "read" ? void 0 : call.outcome
          )).catch((error) => {
            throw failure ? failure(error) : error;
          })
        );
        return answer ? answer(raw) : raw;
      }
    });
  }
);
for (const id of Object.keys(FACES))
  if (!nativeOperations.some((item) => item.id === id))
    throw new Error(`Строка таблицы для неизвестной низкоуровневой операции: ${id}`);

// src/query.ts
var IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
function identifier(value, field) {
  const text3 = requiredString(value, field);
  if (!IDENTIFIER.test(text3))
    throw new HcmError(
      "INVALID_IDENTIFIER",
      `${field}: «${text3.slice(0, 64)}» не подходит — нужно имя из латинских букв, цифр и _, первой не цифра.`,
      void 0,
      {
        path: field
      }
    );
  return text3;
}
function looksLikeDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2})/.test(value);
}
var MIN_INT64 = -(1n << 63n);
var MAX_INT64 = (1n << 63n) - 1n;
function looksLikeInteger(value) {
  if (typeof value !== "string" || !/^(?:0|-?[1-9]\d{0,18})$/.test(value)) return false;
  const parsed = BigInt(value);
  return parsed >= MIN_INT64 && parsed <= MAX_INT64;
}
function looksLikeReal(value) {
  return typeof value === "string" && value.length <= 40 && /^(?:(?:0|-?[1-9]\d*)(?:\.\d+)?|-0\.\d+)$/.test(value);
}
function looksLikeHexId(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(value);
}
function literal(value, type) {
  if (type === "integer" && looksLikeInteger(value)) return value;
  if (type === "real" && looksLikeReal(value)) return value;
  if (type === "date" && looksLikeDate(value) && value.length <= 40 && !value.includes("'"))
    return `date('${value}')`;
  if (value === null) return "null()";
  if (typeof value === "boolean") return value ? "true()" : "false()";
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))
    return decimalLiteral(value);
  if ((type === void 0 || type === "integer") && looksLikeHexId(value)) {
    const id = BigInt(value);
    return id < 1n << 63n ? id.toString(10) : value;
  }
  if (typeof value === "string" && value.length <= 1e4 && !/[\u0000-\u001F]/.test(value))
    return `'${value.replaceAll("'", "''")}'`;
  throw new HcmError(
    "INVALID_FILTER_VALUE",
    "Значение в условии — это строка, число, true, false или null.",
    "ID передаётся строкой: число такой величины теряет последние цифры."
  );
}
function decimalLiteral(value) {
  const source = String(value);
  const scientific = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(source);
  if (!scientific) return source;
  const [, sign, integral, fractional = "", exponent] = scientific;
  const digits = integral + fractional;
  const point = integral.length + Number(exponent);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}
var OPERATOR_HINT = 'Условие пишется как {поле: {оператор: значение}}, например {fullname: {contains: "Иван"}}; равенство — {поле: значение}.';
function catalogQuery(catalog, where = {}, order, types) {
  const name2 = identifier(catalog, "catalog");
  const conditions = [];
  for (const [field, condition] of Object.entries(inputObject(where, "where"))) {
    const path = `$elem/${identifier(field, "поле условия")}`;
    const type = types?.get(field);
    const equals = (value) => value === "" || value === null ? `(${path} = '' or IsEmpty(${path}) = true())` : `${path} = ${literal(value, type)}`;
    if (condition !== null && typeof condition === "object") {
      const operators = Object.entries(inputObject(condition, "условие"));
      if (operators.length === 0)
        throw new HcmError(
          "INVALID_FILTER_OPERATOR",
          "В условии по полю нет оператора.",
          OPERATOR_HINT,
          { field }
        );
      for (const [operation2, value] of operators) {
        if (operation2 === "eq" || operation2 === "ne" || operation2 === "gt" || operation2 === "gte" || operation2 === "lt" || operation2 === "lte") {
          const operator = { eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[operation2];
          if (operation2 === "eq") conditions.push(equals(value));
          else if (operation2 === "ne" && (value === "" || value === null))
            conditions.push(`IsEmpty(${path}) = false()`);
          else conditions.push(`${path} ${operator} ${literal(value, type)}`);
        } else if (operation2 === "contains")
          conditions.push(`contains(${path}, ${literal(value, "string")})`);
        else if (operation2 === "in" && Array.isArray(value) && value.length > 0 && value.length <= 100)
          conditions.push(`(${value.map(equals).join(" or ")})`);
        else
          throw new HcmError(
            "INVALID_FILTER_OPERATOR",
            "Операторы условия: eq, ne, gt, gte, lt, lte, contains, in. Для in нужен массив от 1 до 100 значений.",
            operation2 === "in" ? 'Пример: {role_id: {in: ["admin", "user"]}}.' : /^\$?(starts?_?with|begins?_?with|prefix|ends?_?with|suffix|i?like|regexp?|match(es)?)$/i.test(
              operation2
            ) ? "Условий «начинается с» и шаблонов нет: формы, которая работает на обеих базах данных, сервер не даёт. Подходит contains, а строки по началу значения отбираются после ответа." : OPERATOR_HINT,
            { field, operation: operation2 }
          );
      }
    } else conditions.push(equals(condition));
  }
  const sorted = orderFields(order).map(
    ({ field, descending }) => `$elem/${field}${descending ? " descending" : ""}`
  );
  return `for $elem in ${name2}${conditions.length ? ` where ${conditions.map((condition) => `(${condition})`).join(" and ")}` : ""}${sorted.length ? ` order by ${sorted.join(", ")}` : ""} return $elem`;
}
function orderFields(order) {
  if (order === void 0) return [];
  const items = typeof order === "string" ? [order] : order;
  const wrong = () => {
    throw new HcmError(
      "INVALID_ARGUMENT",
      "order: поле каталога или список до пяти полей; по убыванию — «поле desc»."
    );
  };
  if (!Array.isArray(items) || items.length === 0 || items.length > 5) return wrong();
  return items.map((item) => {
    if (typeof item !== "string") return wrong();
    const [field = "", direction, ...rest] = item.trim().split(/\s+/);
    if (rest.length || direction !== void 0 && !/^(asc|desc)$/i.test(direction))
      return wrong();
    return {
      field: identifier(field, "поле сортировки"),
      descending: direction?.toLowerCase() === "desc"
    };
  });
}
function withoutFalseOffset(value) {
  if (typeof value === "string")
    return /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?\+00:00$/.test(value) ? value.slice(0, -6) : value;
  if (Array.isArray(value)) return value.map(withoutFalseOffset);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, withoutFalseOffset(child)])
  );
}
function xqueryNames(query) {
  const names = [];
  for (const [, variable, catalog] of query.matchAll(/\$(\w+)\s+in\s+([A-Za-z_]\w*)/g)) {
    const fields3 = /* @__PURE__ */ new Set();
    for (const [, field] of query.matchAll(new RegExp(`\\$${variable}/([A-Za-z_]\\w*)`, "g")))
      fields3.add(field);
    names.push([catalog, [...fields3]]);
  }
  return names;
}
function cleanXmlValue(value) {
  if (Array.isArray(value)) return value.map(cleanXmlValue);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value);
  const elements = entries.filter(
    ([key]) => !key.startsWith("@_") && !key.startsWith("#") && !key.startsWith("?")
  );
  if (!elements.length) return value["#text"] ?? "";
  return Object.fromEntries(elements.map(([key, child]) => [key, cleanXmlValue(child)]));
}
function projectFields(data2, fields3) {
  if (fields3 === void 0) return data2;
  if (!Array.isArray(fields3) || fields3.some((field) => typeof field !== "string" || !IDENTIFIER.test(field)))
    throw new HcmError("INVALID_FIELDS", "fields: нужен массив имён полей верхнего уровня.");
  return Object.fromEntries(
    fields3.filter((field) => Object.hasOwn(data2, field)).map((field) => [field, data2[field]])
  );
}
function elementEntries(value) {
  return Object.entries(value).filter(
    ([key]) => !key.startsWith("@_") && !key.startsWith("#") && !key.startsWith("?")
  );
}
function responseChild(response, name2) {
  const matches2 = elementEntries(response).filter(([key]) => localName(key) === name2);
  if (matches2.length > 1 || matches2.length === 1 && Array.isArray(matches2[0][1]))
    throw new HcmError(
      "PLATFORM_RESPONSE",
      `В ответе на запрос XQuery элемент ${name2} повторяется.`
    );
  return matches2[0]?.[1];
}
function responseScalar(value, name2) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const node = value;
    if (elementEntries(node).length === 0 && typeof node["#text"] === "string")
      return node["#text"];
  }
  throw new HcmError("PLATFORM_RESPONSE", `В ответе на запрос XQuery ${name2} — не текст.`);
}
function representationError() {
  throw new HcmError(
    "QUERY_REPRESENTATION",
    "Запрос вернул не строки каталога целиком.",
    "Запрос должен возвращать строки каталога целиком (например `return $e`), а поля выбираются аргументом fields. Запрос, который возвращает отдельные значения или разные элементы, читает native.lds.xQuery."
  );
}
function hasMixedText(value) {
  if (Array.isArray(value)) return value.some(hasMixedText);
  if (!value || typeof value !== "object") return false;
  const node = value;
  const children2 = elementEntries(node);
  return children2.length > 0 && node["#text"] !== void 0 && responseScalar(node["#text"], "содержимое строки").trim() !== "" || children2.some(([, child]) => hasMixedText(child));
}
function objectRows(data2, blankIsEmpty) {
  if (typeof data2 === "string") {
    if (data2 === "" || blankIsEmpty && data2.trim() === "") return [];
    return representationError();
  }
  if (!data2 || typeof data2 !== "object" || Array.isArray(data2)) return representationError();
  const node = data2;
  if (node["#text"] !== void 0 && responseScalar(node["#text"], "содержимое Data").trim() !== "")
    return representationError();
  const entries = elementEntries(node);
  if (entries.length > 1) return representationError();
  if (entries.length === 0) {
    if (!blankIsEmpty && node["#text"] !== void 0 && node["#text"] !== "")
      return representationError();
    return [];
  }
  const children2 = entries[0][1];
  return (Array.isArray(children2) ? children2 : [children2]).map((child) => {
    if (typeof child === "string" && child.trim() === "") return {};
    if (!child || typeof child !== "object" || Array.isArray(child)) return representationError();
    if (hasMixedText(child)) return representationError();
    const row = cleanXmlValue(child);
    if (row === "") return {};
    if (!row || typeof row !== "object" || Array.isArray(row)) return representationError();
    return row;
  });
}
function rowTag(response) {
  const data2 = responseChild(inputObject(response, "ответ на запрос XQuery"), "Data");
  if (!data2 || typeof data2 !== "object" || Array.isArray(data2)) return void 0;
  const entries = elementEntries(data2);
  return entries.length === 1 ? localName(entries[0][0]) : void 0;
}
function queryPage(response, start, limit, fields3, rawQuery) {
  const root = inputObject(response, "ответ на запрос XQuery");
  const data2 = responseChild(root, "Data");
  if (data2 === void 0)
    throw new HcmError("PLATFORM_RESPONSE", "В ответе на запрос XQuery нет Data.");
  const totalNode = responseChild(root, "TotalCount");
  const eofNode = responseChild(root, "EOF");
  const total = totalNode === void 0 ? void 0 : responseScalar(totalNode, "TotalCount");
  if (total !== void 0 && (total.trim().length > 64 || !/^\d+$/.test(total.trim())))
    throw new HcmError(
      "PLATFORM_RESPONSE",
      "В ответе на запрос XQuery TotalCount — не целое неотрицательное число."
    );
  const count = total === void 0 ? void 0 : BigInt(total.trim());
  const serverEOF = eofNode === void 0 ? void 0 : responseScalar(eofNode, "EOF");
  if (serverEOF !== void 0 && !/^(?:0|1|false|true)$/.test(serverEOF.trim()))
    throw new HcmError(
      "PLATFORM_RESPONSE",
      "В ответе на запрос XQuery EOF — не 0, 1, false или true."
    );
  const ended = serverEOF !== void 0 && /^(?:1|true)$/.test(serverEOF.trim());
  const rows = objectRows(data2, !rawQuery || count === 0n || count === void 0 && ended);
  const items = rows.slice(0, limit).map((row) => projectFields(row, fields3));
  const next = start + items.length;
  const inconsistentTotal = count !== void 0 && (rows.length > 0 && BigInt(start + rows.length) > count || ended && BigInt(start + rows.length) < count);
  const hints = [];
  if (inconsistentTotal)
    hints.push(
      "Число строк, которое назвал сервер, не сходится с полученной страницей, поэтому total не показан."
    );
  let more = false;
  let incomplete = false;
  if (items.length === 0) {
    const refused = ended && count === void 0 && start === 0;
    incomplete = refused || !(ended || count !== void 0 && !inconsistentTotal && BigInt(start) >= count);
    if (refused)
      hints.push(
        "Страница пуста, а числа строк сервер не назвал: так он отвечает, когда запрос отвергла база данных, а не когда строк нет. " + (rawQuery ? "Сверить значения с типами полей: дата — через date('…'), ID — без кавычек, строка — в кавычках." : "Сверить значения условий с типами полей каталога.") + " Причину база пишет в лог spxml_unibridge."
      );
    else if (incomplete)
      hints.push(
        "Страница пуста, но сервер не подтвердил, что строки кончились. Следующей позиции нет."
      );
  } else if (items.length === rows.length && (ended || count !== void 0 && !inconsistentTotal && BigInt(next) >= count)) {
  } else if (next > 1e6) {
    incomplete = true;
    hints.push("Следующая позиция больше предела startPosition (1000000): запрос нужно сузить.");
  } else {
    more = true;
  }
  const known = count !== void 0 && !inconsistentTotal && count <= BigInt(Number.MAX_SAFE_INTEGER);
  return {
    items,
    ...known ? { total: Number(count) } : {},
    ...more ? { nextStartPosition: next } : {},
    ...incomplete ? { incomplete: true } : {},
    ...hints.length ? { hint: hints.join(" ") } : {}
  };
}
function hasStructure(data2) {
  return Object.values(data2).some((value) => value !== null && typeof value === "object");
}

// src/operations/batch.ts
var batchEffect = (args, effectOf2) => {
  const steps = args.steps;
  if (!Array.isArray(steps)) return "unknown";
  const effects = steps.map((raw) => {
    const step = inputObject(raw, "step");
    const id = requiredString(step.id, "step.id");
    if (id === "runtime.batch")
      throw new HcmError("NESTED_BATCH", "Пакет внутри пакета не поддерживается.");
    return effectOf2(id)(step.args === void 0 ? {} : inputObject(step.args));
  });
  if (effects.includes("unknown") || effects.includes("write") && effects.includes("execute"))
    return "unknown";
  return effects.includes("execute") ? "execute" : effects.includes("write") ? "write" : "read";
};
var batchFailed = (data2, stored) => {
  if (data2 === null || typeof data2 !== "object" || !("ok" in data2) || data2.ok !== false)
    return void 0;
  const batch = data2;
  const failedSteps = batch.results.flatMap(
    (result, index) => result.ok ? [] : [{ index, id: result.meta.operationId, code: result.error?.code ?? "UNKNOWN" }]
  );
  return {
    code: "BATCH_FAILED",
    message: `Отказало шагов пакета: ${failedSteps.length} из ${batch.requested}${batch.requested > batch.completed ? `; после отказа не запускались: ${batch.requested - batch.completed}` : ""}. До повтора нужно посмотреть исход каждого шага.`,
    hint: stored ? "Номера и коды отказавших шагов — в error.details.failed; ответы шагов сохранены, их читает results.read." : "Номера и коды отказавших шагов — в error.details.failed, ответы шагов — в data.results.",
    retryable: false,
    details: {
      failed: failedSteps.slice(0, 20),
      ...failedSteps.length > 20 ? { failedTotal: failedSteps.length } : {}
    }
  };
};
function stepSummary(step) {
  const { as, ok, data: data2, error } = step;
  return {
    ...as === void 0 ? {} : { as },
    ok,
    ...error?.code ? { code: error.code } : {},
    ...typeof data2?.total === "number" ? { total: data2.total } : {},
    ...Array.isArray(data2?.items) ? { rows: data2.items.length } : {},
    ...data2?.incomplete ? { incomplete: true } : {}
  };
}
var batchOperations = [
  operation({
    id: "runtime.batch",
    effect: "unknown",
    effectFor: batchEffect,
    writesLocalDisk: (args, _inBatch, writes) => {
      if (args === null || typeof args !== "object" || Array.isArray(args)) return false;
      const steps = args.steps;
      return Array.isArray(steps) && steps.some(
        (step) => step !== null && typeof step === "object" && !Array.isArray(step) && typeof step.id === "string" && writes(
          step.id,
          step.args
        )
      );
    },
    reply: { failed: batchFailed, list: { key: "results", summary: stepSummary } },
    description: "Несколько операций одним вызовом: steps — список {id, args, as}. Значение из прошлого шага: {$ref:'имя.data.items.0.id'}, где имя — as того шага, дальше путь по его ответу. Класс вызова — по самому сильному шагу: все шаги читают — чтение, есть запись на сервер — запись (сохранение только на диск — files.read с file, results.export — не требует серверного права write, но в MCP вызывается через hcm_api_write), есть выполнение кода — выполнение. Права проверяются для каждого шага. Это не транзакция: выполненные шаги не откатываются; первый сбой останавливает остальные, если не задано stopOnError:false.",
    inputSchema: schema(
      {
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "ID операции шага." },
              args: {
                type: "object",
                description: "Аргументы операции; значение из прошлого шага — {$ref:'имя.путь'}."
              },
              as: {
                type: "string",
                description: "Имя шага для ссылок из следующих шагов: латинские буквы, цифры и _, первой не цифра."
              }
            },
            required: ["id"],
            additionalProperties: false
          }
        },
        stopOnError: boolean
      },
      ["steps"]
    ),
    run: async (context, args, call) => {
      if (!Array.isArray(args.steps) || args.steps.length === 0 || args.steps.length > 100)
        throw new HcmError("INVALID_BATCH", "steps: в пакете должно быть от 1 до 100 шагов.");
      const labels = /* @__PURE__ */ new Set();
      for (const [index, raw] of args.steps.entries()) {
        const at = `steps[${index}]`;
        const step = inputObject(raw, at);
        const stepId = requiredString(step.id, `${at}.id`);
        if (stepId === "runtime.batch")
          throw new HcmError("NESTED_BATCH", "Пакет внутри пакета не поддерживается.");
        context.pipeline.describe(stepId);
        if (step.args !== void 0) inputObject(step.args, `${at}.args`);
        if (step.as !== void 0) {
          const label = identifier(step.as, `${at}.as`);
          if (labels.has(label))
            throw new HcmError(
              "DUPLICATE_STEP",
              `${at}.as: имя ${label} уже дано другому шагу; имена шагов пакета не повторяются.`,
              void 0,
              { path: `${at}.as` }
            );
          labels.add(label);
        }
      }
      const named = /* @__PURE__ */ new Map();
      const results = [];
      const recovery = {
        completed: 0,
        requested: args.steps.length,
        sentMutationSteps: 0,
        receipts: []
      };
      call.batchRecovery = recovery;
      const resolveRefs = (value, depth = 0) => {
        if (depth > 32)
          throw new HcmError("REFERENCE_DEPTH", "Аргументы шага вложены глубже 32 уровней.");
        if (Array.isArray(value)) return value.map((item) => resolveRefs(item, depth + 1));
        if (value === null || typeof value !== "object") return value;
        const record = inputObject(value);
        if (isStepReference(record)) {
          const [stepName, ...path] = record.$ref.split(".");
          let result = named.get(stepName);
          for (const key of path) {
            if (["__proto__", "constructor", "prototype"].includes(key) || result === null || typeof result !== "object" || !Object.hasOwn(result, key))
              throw new HcmError(
                "INVALID_REFERENCE",
                "Ссылка $ref не находит значение: такого шага раньше не было, или в его результате нет такого поля."
              );
            result = result[key];
          }
          if (result === void 0)
            throw new HcmError(
              "INVALID_REFERENCE",
              "Ссылка $ref называет шаг, которого раньше в пакете не было."
            );
          return result;
        }
        return Object.fromEntries(
          Object.entries(record).map(([key, item]) => [key, resolveRefs(item, depth + 1)])
        );
      };
      for (const raw of args.steps) {
        const step = inputObject(raw, "step");
        const stepId = requiredString(step.id, "step.id");
        let result;
        const childState = { outcome: new WriteOutcome(), effect: "read" };
        try {
          const resolved = step.args === void 0 ? {} : inputObject(resolveRefs(step.args), "step.args");
          result = await context.pipeline.step(stepId, resolved, childState);
        } catch (error) {
          result = context.pipeline.failure(stepId, error);
        }
        const written = childState.outcome.verdict(childState.effect);
        if (written.sent) {
          call.outcome.sending();
          recovery.sentMutationSteps++;
        }
        results.push(
          typeof step.as === "string" ? { as: step.as, ...result } : result
        );
        recovery.completed = results.length;
        const returned = result.data !== null && typeof result.data === "object" ? result.data : void 0;
        recovery.receipts.push({
          index: results.length - 1,
          operationId: stepId,
          ok: result.ok,
          ...result.error === void 0 ? {} : {
            errorCode: result.error.code,
            ...result.error.mutationOutcome === void 0 ? {} : { mutationOutcome: result.error.mutationOutcome }
          },
          ...returned?.mutationOutcome === "confirmed" ? { mutationOutcome: "confirmed" } : {},
          ...written.ids.mutationId === void 0 ? {} : { mutationId: written.ids.mutationId },
          ...written.ids.objectId === void 0 ? {} : { objectId: written.ids.objectId },
          ...written.ids.executionId === void 0 ? {} : { executionId: written.ids.executionId },
          ...written.ids.url === void 0 ? {} : { url: written.ids.url }
        });
        if (step.as !== void 0) named.set(identifier(step.as, "step.as"), result);
        if (!result.ok && args.stopOnError !== false) break;
      }
      return {
        results,
        completed: results.length,
        requested: args.steps.length,
        atomic: false,
        ok: results.every((result) => result.ok)
      };
    }
  })
];

// src/documents.ts
import { createHash } from "node:crypto";
var parser = createPlatformXmlParser({
  preserveOrder: true,
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  commentPropName: "#comment",
  cdataPropName: "#cdata"
});
var builder = createPlatformXmlBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  format: false,
  commentPropName: "#comment",
  cdataPropName: "#cdata",
  suppressEmptyNode: false
});
var IDENTIFIER2 = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
var TYPE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
function name(node) {
  return Object.keys(node).find(
    (key) => !key.startsWith("#") && !key.startsWith("?") && key !== ":@"
  );
}
function local(value) {
  return value.split(":").at(-1);
}
function children(node, key = name(node)) {
  if (key === void 0 || !Array.isArray(node[key])) return [];
  return node[key];
}
function hasExternalData(node, descendants = true) {
  const attributes = node[":@"];
  return !!attributes && typeof attributes === "object" && Object.keys(attributes).some((key) => /^@_EXT-OBJECT-ID$/i.test(key)) || descendants && children(node).some((child) => hasExternalData(child));
}
function assertXmlCharacters2(source) {
  try {
    assertXmlCharacters(source);
  } catch {
    throw new HcmError(
      "INVALID_XML",
      "В значении есть недопустимый символ: XML не принимает управляющие символы и непарные суррогаты."
    );
  }
}
function assertXml(source) {
  try {
    validatePlatformXmlSource(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "XML документа составлен с ошибкой.";
    throw new HcmError(
      "INVALID_XML",
      message.includes("DOCTYPE") ? "DOCTYPE и объявления ENTITY в XML документа не поддерживаются." : message.startsWith("Неверный XML:") ? "XML документа составлен с ошибкой." : message
    );
  }
}
function compact(nodes, depth = 0) {
  if (depth > 64) throw new HcmError("XML_DEPTH_LIMIT", "Вложенность документа больше 64 уровней.");
  const elements = nodes.filter((node) => name(node) !== void 0);
  if (elements.length === 0)
    return nodes.map(
      (node) => node["#text"] ?? (Array.isArray(node["#cdata"]) ? compact(node["#cdata"], depth + 1) : "")
    ).join("");
  const text3 = nodes.map((node) => String(node["#text"] ?? "")).join("").trim();
  if (text3 !== "" || elements.every((node) => name(node) === "sd")) return text3;
  const result = /* @__PURE__ */ Object.create(null);
  for (const node of elements) {
    const key = name(node);
    const value = compact(children(node), depth + 1);
    if (Object.hasOwn(result, key)) {
      const existing = result[key];
      result[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else result[key] = value;
  }
  return result;
}
function withoutIndentation(nodes) {
  const elements = nodes.some((node) => name(node) !== void 0);
  return nodes.flatMap((node) => {
    const key = name(node);
    if (key !== void 0) return [{ ...node, [key]: withoutIndentation(children(node)) }];
    if (!elements || !Object.hasOwn(node, "#text")) return [node];
    const text3 = String(node["#text"]).replace(/^\s*\n\s*/, "").replace(/\s*\n\s*$/, "");
    return text3 ? [{ ...node, "#text": text3 }] : [];
  });
}
function semantic(nodes) {
  const structural = nodes.some((node) => name(node) !== void 0) && nodes.every((node) => !Object.hasOwn(node, "#text") || /^\s*$/.test(String(node["#text"])));
  return nodes.filter(
    (node) => !(structural && Object.hasOwn(node, "#text") && /^\s*$/.test(String(node["#text"])))
  ).map((node) => {
    const out = /* @__PURE__ */ Object.create(null);
    for (const [key, value] of Object.entries(node))
      out[key] = Array.isArray(value) ? semantic(value) : value;
    return out;
  });
}
function preserveComments(existing, next) {
  const hasComment = existing.some((node) => Object.hasOwn(node, "#comment"));
  if (!hasComment) return next;
  let splitIndex = existing.findIndex(
    (node) => Object.hasOwn(node, "#text") && String(node["#text"]).trim() !== "" || Object.hasOwn(node, "#cdata") || name(node) !== void 0
  );
  if (splitIndex < 0) splitIndex = existing.length;
  const before = existing.slice(0, splitIndex).filter((node) => Object.hasOwn(node, "#comment"));
  const after = existing.slice(splitIndex).filter((node) => Object.hasOwn(node, "#comment"));
  return [...before, ...next, ...after];
}
function encodeValue(key, value, depth = 0) {
  if (!IDENTIFIER2.test(key) || depth > 64)
    throw new HcmError(
      "INVALID_FIELD",
      "Недопустимое имя поля или вложенность больше 64 уровней.",
      void 0,
      {
        path: key
      }
    );
  if (value === null) return { [key]: [] };
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new HcmError(
        "INVALID_FIELD_VALUE",
        "Число нельзя записать точно: оно не конечное или слишком большое. Большое целое передаётся строкой.",
        void 0,
        { path: key }
      );
    const text3 = String(value);
    assertXmlCharacters2(text3);
    return { [key]: [{ "#text": text3 }] };
  }
  if (value === void 0 || Array.isArray(value))
    throw new HcmError(
      "INVALID_FIELD_VALUE",
      "Значение поля не задано или это массив в массиве. Вложенные поля задаёт объект, повторяющееся поле — массив значений.",
      void 0,
      { path: key }
    );
  const data2 = inputObject(value, key);
  const nested = [];
  for (const [childKey, childValue] of Object.entries(data2)) {
    if (Array.isArray(childValue))
      for (const item of childValue) nested.push(encodeValue(childKey, item, depth + 1));
    else nested.push(encodeValue(childKey, childValue, depth + 1));
  }
  return { [key]: nested };
}
var ID_TEXT = /^(?:0x[0-9a-f]{1,16}|[1-9]\d{0,19})$/i;
function sameKey(stored, key, type) {
  const text3 = String(stored);
  return text3 === key || (type === void 0 || type === "integer") && ID_TEXT.test(text3) && ID_TEXT.test(key) && BigInt(text3) === BigInt(key);
}
function sameData(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameData(item, right[index]));
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every(
    (key) => Object.hasOwn(right, key) && sameData(left[key], right[key])
  );
}
function sameValue(stored, value, replacement, type) {
  if (typeof value === "boolean") return stored === String(value) || stored === (value ? "1" : "0");
  if (typeof value === "string" || typeof value === "number")
    return typeof stored === "string" && sameKey(stored, String(withoutFalseOffset(String(value))), type);
  const encoded = replacement.length === 1 ? withoutFalseOffset(compact(children(replacement[0]))) : replacement.map((node) => withoutFalseOffset(compact(children(node))));
  return sameData(encoded, stored);
}
function brief(value, nested = false) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  const entries = Object.entries(value);
  if (!nested) return Object.fromEntries(entries.map(([key, item]) => [key, brief(item, true)]));
  const keys = entries.map(
    ([key, item]) => Array.isArray(item) ? `${key}: ${item.length} items` : key
  );
  return `{${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""}}`;
}
function patchSegments(path) {
  const parts = path.match(/[^.[\]]+(?:\[[^\]]*\])?/g) ?? [];
  const matches2 = parts.map(
    (part) => /^([A-Za-z_][A-Za-z0-9_:-]*)(?:\[(?:(\d+)|([A-Za-z_][A-Za-z0-9_:-]*)=([^\]]*))\])?$/.exec(part)
  );
  if (parts.join(".") !== path || matches2.some((match) => match === null))
    throw new HcmError("INVALID_PATCH_PATH", "Путь к полю записан неверно.", void 0, { path });
  return matches2;
}
var XmlDocument = class _XmlDocument {
  constructor(root) {
    this.root = root;
  }
  static parse(source) {
    assertXml(source);
    let nodes;
    try {
      nodes = parseValidatedXml(parser, source);
    } catch {
      throw new HcmError(
        "INVALID_XML",
        "Не удалось разобрать XML документа: превышены ограничения разбора."
      );
    }
    let roots = nodes.filter((node) => name(node) !== void 0);
    if (roots.length === 1 && local(name(roots[0])) === "Envelope") {
      const body = children(roots[0]).find((node) => local(name(node) ?? "") === "Body");
      const response = body && children(body).find((node) => /(?:LoadDoc|GetDoc)Response$/.test(local(name(node) ?? "")));
      const data2 = response && children(response).find((node) => local(name(node) ?? "") === "Data");
      if (!data2) throw new HcmError("DOCUMENT_RESPONSE", "В ответе сервера нет данных документа.");
      roots = children(data2).filter((node) => name(node) !== void 0);
    }
    if (roots.length !== 1 || local(name(roots[0])) === "Envelope")
      throw new HcmError("DOCUMENT_RESPONSE", "В ответе сервера не один документ XML.");
    return new _XmlDocument(roots[0]);
  }
  static create(type, data2, formUrl) {
    if (!TYPE_IDENTIFIER.test(type))
      throw new HcmError("INVALID_TYPE", "Недопустимое имя типа объекта.");
    const root = encodeValue(type, data2);
    if (formUrl !== void 0) {
      const url = requiredString(formUrl, "formUrl");
      assertXmlCharacters2(url);
      root[":@"] = { "@_SPXML-FORM": url };
    }
    return new _XmlDocument(root);
  }
  /** Тип и адрес формы — без сборки XML, которую делает snapshot. */
  form() {
    const formUrl = this.root[":@"]?.["@_SPXML-FORM"];
    return { type: local(name(this.root)), ...typeof formUrl === "string" ? { formUrl } : {} };
  }
  snapshot() {
    const xml = builder.build(withoutIndentation([this.root]));
    assertXml(xml);
    const data2 = inputObject(compact(children(this.root)), "содержимое документа");
    return {
      ...this.form(),
      xml,
      data: data2,
      fingerprint: createHash("sha256").update(JSON.stringify(semantic([this.root]))).digest("hex")
    };
  }
  /** types — TYPE полей формы по пути, как DataShape.types; без него ID узнаётся по виду. */
  patch(input, types) {
    const before = this.snapshot();
    const workingRoot = structuredClone(this.root);
    const operations2 = Array.isArray(input) ? input : Object.entries(inputObject(input, "patch")).map(([path, value]) => ({
      op: "set",
      path,
      value
    }));
    if (operations2.length > 1e3)
      throw new HcmError("PATCH_LIMIT", "В одном patch не больше 1000 изменений.");
    const changes = [];
    const written = [];
    for (const raw of operations2) {
      const operation2 = inputObject(raw, "элемент patch");
      const path = requiredString(operation2.path, "path");
      const segments = patchSegments(path);
      const upTo = (count) => segments.slice(0, count).map((part) => part[0]).join(".");
      const typeOf = (count, child) => types?.get(
        [
          ...segments.slice(0, count).map((part) => part[1]),
          ...child === void 0 ? [] : [child]
        ].join(".")
      );
      let createdKeyedElement = false;
      let created = false;
      if (operation2.op !== "set" && operation2.op !== "remove")
        throw new HcmError("INVALID_PATCH", "op: поддерживаются set и remove.");
      const absent = () => new HcmError(
        "PATCH_PATH_MISSING",
        `remove: в документе нет ${path}.`,
        "Ничего не записано. Что есть в документе, показывает objects.get.",
        { path }
      );
      let parent = children(workingRoot);
      for (let index = 0; index < segments.length; index++) {
        const match = segments[index];
        const field = match[1];
        const position = match[2] === void 0 ? void 0 : Number(match[2]);
        const key = match[3];
        const keyValue = match[4];
        if (index === 0 && local(field) === "id")
          throw new HcmError("IMMUTABLE_ID", "ID объекта изменить нельзя.");
        const matches2 = parent.map((node, i) => ({ node, i })).filter(
          (item) => name(item.node) === field && (key === void 0 || children(item.node).some(
            (child) => name(child) === key && sameKey(compact(children(child)), keyValue, typeOf(index + 1, key))
          ))
        );
        if (position === void 0 && matches2.length > 1)
          throw new HcmError(
            "AMBIGUOUS_PATCH",
            "Таких полей несколько: нужно указать номер элемента, например [0], или ключ [имя=значение], который есть только у одного.",
            operation2.op === "remove" && key === void 0 && index > 0 && index === segments.length - 1 ? `Чтобы убрать все элементы, нужно удалить сам список: remove ["${upTo(index)}"].` : void 0,
            { path }
          );
        let chosen = matches2[position ?? 0];
        if (chosen && hasExternalData(chosen.node, index === segments.length - 1))
          throw new HcmError(
            "EXTERNAL_FIELD_REQUIRES_API",
            "Поле хранится отдельно от документа как большое поле.",
            "Клиент большие поля не меняет; обычное изменение документа сведения о таком поле не переписывает.",
            { path }
          );
        if (index < segments.length - 1) {
          if (!chosen && operation2.op === "remove") throw absent();
          if (!chosen && position === void 0 && (createdKeyedElement || segments.slice(index).some((part) => part[3] !== void 0))) {
            const node = encodeValue(field, key === void 0 ? {} : { [key]: keyValue });
            chosen = { node, i: parent.length };
            parent.push(node);
            created = true;
            createdKeyedElement ||= key !== void 0;
          }
          if (!chosen)
            throw new HcmError(
              "PATCH_PATH_MISSING",
              "В документе нет родительского поля.",
              `В документе нет ${upTo(index + 1)}: пустую структуру сервер не хранит. Нужно записать её целиком — {"${upTo(index + 1)}": {…}}; путь с ключом элемента списка, [ключ=значение], создаёт её сам.`,
              {
                path
              }
            );
          parent = children(chosen.node);
          continue;
        }
        const stored = chosen && !created ? withoutFalseOffset(compact(children(chosen.node))) : void 0;
        if (operation2.op === "remove") {
          if (!chosen) throw absent();
          parent.splice(chosen.i, 1);
        } else {
          if (!Object.hasOwn(operation2, "value"))
            throw new HcmError("INVALID_PATCH", "Для set нужно value.", void 0, { path });
          if (key !== void 0) inputObject(operation2.value, "значение элемента с ключом");
          const made = segments[index - 1];
          if (created && made?.[3] === field && !sameKey(operation2.value, made[4], typeOf(index + 1)))
            throw new HcmError(
              "INVALID_PATCH",
              "Ключ в значении не совпадает с ключом в пути.",
              "Элемент создан с ключом из пути: в значение нужно записать его же.",
              { path }
            );
          const replacement = Array.isArray(operation2.value) ? operation2.value.map((value) => encodeValue(field, value)) : [encodeValue(field, operation2.value)];
          if (key !== void 0 && !sameKey(
            inputObject(compact(children(replacement[0])), "значение элемента с ключом")[key],
            keyValue,
            typeOf(index + 1, key)
          ))
            throw new HcmError(
              "INVALID_PATCH",
              "Ключ в значении не совпадает с ключом в пути.",
              void 0,
              {
                path
              }
            );
          if (stored !== void 0 && sameValue(stored, operation2.value, replacement, typeOf(index + 1)))
            continue;
          if (chosen) {
            if (replacement.length === 1) {
              if (chosen.node[":@"] !== void 0) replacement[0][":@"] = chosen.node[":@"];
              const nextChildren = preserveComments(
                children(chosen.node),
                children(replacement[0])
              );
              if (nextChildren !== children(replacement[0])) replacement[0][field] = nextChildren;
            }
            parent.splice(chosen.i, 1, ...replacement);
          } else {
            if (position !== void 0)
              throw new HcmError(
                "PATCH_INDEX_MISSING",
                "Элемента с таким номером нет.",
                void 0,
                {
                  path
                }
              );
            parent.push(...replacement);
          }
        }
        changes.push({
          op: operation2.op,
          path,
          ...stored === void 0 ? {} : { before: brief(stored) },
          ...operation2.op === "set" ? { after: brief(operation2.value) } : {}
        });
        if (operation2.op === "set") written.push({ path, value: operation2.value });
      }
    }
    const after = new _XmlDocument(workingRoot).snapshot();
    this.root = workingRoot;
    return { before, after, changes, written };
  }
};

// src/protocol/library-functions.ts
function normalizeFormParams(source, library = false) {
  return source.replace(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^<>"']|"[^"]*"|'[^']*')+>/g,
    (tag) => {
      if (/^<[!?\/]/.test(tag)) return tag;
      const counts = /* @__PURE__ */ new Map();
      return tag.replace(/\s+([^\s=/>]+)\s*=\s*(?:"[^"]*"|'[^']*')/g, (attribute, name2) => {
        const key = name2.toUpperCase();
        const count = counts.get(key) ?? 0;
        counts.set(key, count + 1);
        if (key === "PARAM") return attribute.replace(name2, `PARAM__${count}`);
        if (library && count) attribute = attribute.replace(name2, `${name2}__${count}`);
        return key === "EXPR" ? attribute.replace(/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);)/g, "&amp;") : attribute;
      });
    }
  );
}
function decodeLibrary(bytes) {
  const [first, second, third] = bytes;
  const encoding = first === 239 && second === 187 && third === 191 ? "utf-8" : first === 255 && second === 254 ? "utf-16le" : first === 254 && second === 255 ? "utf-16be" : /^\s*<\?xml\s[^>]*?\bencoding\s*=\s*["']([^"']+)["']/.exec(
    bytes.subarray(0, 256).toString("latin1")
  )?.[1] ?? "utf-8";
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}
var LibraryReader = class _LibraryReader {
  constructor(applicationInfo, readFile, ttlMs = _LibraryReader.TTL_MS, now = Date.now) {
    this.applicationInfo = applicationInfo;
    this.readFile = readFile;
    this.ttlMs = ttlMs;
    this.now = now;
  }
  static TTL_MS = 6e4;
  /** Общие документы сервера: библиотеки, которые клиент читает, и ID остальных. */
  shared;
  files = /* @__PURE__ */ new Map();
  /** Сбросить кэш общих документов и прочитанных файлов библиотек. */
  invalidate() {
    this.shared = void 0;
    this.files.clear();
  }
  file({ url }, fresh = false) {
    const cached = !fresh ? this.files.get(url) : void 0;
    if (cached && cached.expires > this.now()) return cached.value;
    const reading = this.readFile(url).then((response) => {
      const encoded = findXmlNode(response, "Data");
      if (typeof encoded !== "string") throw new Error();
      const source = decodeLibrary(Buffer.from(encoded, "base64"));
      const root = findXmlNode(parseXml(normalizeFormParams(source, true)), "SPXML-INLINE-FORM");
      if (root === void 0) return [];
      if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error();
      return Object.values(root).flatMap((library) => {
        if (!library || typeof library !== "object" || Array.isArray(library)) return [];
        return Object.entries(library).flatMap(([method, value]) => {
          const attributes = value;
          const gate = attributes?.["@_ALLOW-CALL-FROM-CLIENT"];
          const serverOnly = gate === void 0 && attributes?.["@_PROPERTY"] === "1" && attributes["@_EXPR"] !== void 0;
          if (gate === void 0 && !serverOnly) return [];
          return [
            {
              id: method,
              parameters: Object.entries(attributes).filter(([key]) => /^@_PARAM__\d+$/.test(key)).map(([, value2]) => String(value2)),
              allowed: gate === "1",
              ...serverOnly ? { serverOnly: true } : {},
              code: String(attributes?.["@_EXPR"] ?? "")
            }
          ];
        });
      });
    }).catch(() => {
      if (this.files.get(url)?.value === reading) this.files.delete(url);
      return void 0;
    });
    this.files.set(url, { expires: this.now() + this.ttlMs, value: reading });
    return reading;
  }
  /**
   * Функции библиотек. skipped — библиотеки, файл которых не прочитан; excluded — общие документы
   * с этим ID, которые клиент как библиотеки не читает: они лежат в базе данных.
   */
  async read(library, options) {
    const fresh = options?.fresh === true;
    if (fresh || !this.shared || this.shared.expires <= this.now()) {
      const reading = this.applicationInfo(fresh).then((info) => {
        if (!Array.isArray(info.shared_docs)) throw new Error();
        const files2 = [];
        const excluded = /* @__PURE__ */ new Set();
        for (const file of info.shared_docs) {
          if (!file || typeof file.id !== "string" || typeof file.url !== "string") continue;
          let read = true;
          try {
            const url = new URL(file.url);
            read = url.hostname.toLowerCase() !== String(info.default_db_name).toLowerCase() && !(url.protocol === "x-local:" && url.hostname === "data_local");
          } catch {
          }
          if (read) files2.push(file);
          else excluded.add(file.id);
        }
        return { files: files2, excluded };
      }).catch(() => {
        if (this.shared?.value === reading) this.shared = void 0;
        return void 0;
      });
      this.shared = { expires: this.now() + this.ttlMs, value: reading };
    }
    const shared = await this.shared.value;
    if (!shared) return void 0;
    const wanted = (id) => library === void 0 || id === library;
    const files = shared.files.filter((file) => wanted(file.id));
    const targets = /* @__PURE__ */ new Map();
    const skipped = /* @__PURE__ */ new Set();
    for (const file of files) {
      const result = await this.file(file, fresh);
      if (result === void 0) skipped.add(file.id);
      else
        for (const fn of result) {
          const id = `${file.id}.${fn.id}`;
          targets.set(id, { ...fn, id });
        }
    }
    return {
      targets: [...targets.values()].sort((a, b) => a.id.localeCompare(b.id)),
      skipped: [...skipped],
      excluded: [...shared.excluded].filter(wanted)
    };
  }
};

// src/schema-form.ts
function withRepeated(value, repeated, prefix = "") {
  if (Array.isArray(value)) return value.map((item) => withRepeated(item, repeated, prefix));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      const shaped = withRepeated(child, repeated, path);
      return [key, repeated.has(path) && !Array.isArray(shaped) ? [shaped] : shaped];
    })
  );
}
var PRIMITIVE_FORM_TYPES = /^(string|integer|real|bool|date|variant|record|attr)$/;
var parser2 = createPlatformXmlParser({
  preserveOrder: true,
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false
});
var text = (value) => typeof value === "string" ? value : "";
var attrsObject = (node) => {
  const raw = node[":@"];
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
};
var nodeName = (node) => Object.keys(node).find((key) => !/^[#?:]/.test(key)) ?? "";
var nodeChildren = (node) => {
  const value = node[nodeName(node)];
  return Array.isArray(value) ? value : [];
};
var nodeAttr = (node, key) => text(attrsObject(node)[`@_${key}`]);
var findNode = (nodes, target2) => {
  for (const node of nodes) {
    if (nodeName(node) === target2) return node;
    const found = findNode(nodeChildren(node), target2);
    if (found) return found;
  }
  return void 0;
};
function parseForm(source) {
  const normalized = normalizeFormParams(source);
  try {
    validatePlatformXmlSource(normalized);
    const root = findNode(parseValidatedXml(parser2, normalized), "SPXML-FORM");
    if (root) return nodeChildren(root).filter((node) => nodeName(node));
  } catch {
    throw new HcmError("FORM_RESPONSE", "Сервер вернул форму с ошибкой в XML.");
  }
  throw new HcmError("FORM_RESPONSE", "В ответе сервера нет формы (SPXML-FORM).");
}
function* formIncludeUrls(nodes, baseUrl) {
  for (const node of nodes) {
    if (["USE", "INCLUDE"].includes(nodeName(node)) && nodeAttr(node, "FORM")) {
      const target2 = nodeAttr(node, "FORM");
      yield target2.startsWith("//") ? `x-local:${target2}` : new URL(target2, baseUrl).href;
    }
  }
}
function registerFormSamples(nodes, samples) {
  for (const node of nodes)
    if (!/^(USE|INCLUDE|On|DocDesc)/.test(nodeName(node))) samples.set(nodeName(node), node);
}
function extractRowType(nodes, catalogId) {
  const root = nodes.find((node) => nodeName(node) === catalogId);
  const row = root && nodeChildren(root).find((node) => nodeAttr(node, "MULTIPLE") === "1");
  return row ? nodeName(row) : "";
}
function findFormRoot(roots, requestedType) {
  const candidates = roots.filter(
    (node) => nodeAttr(node, "SAMPLE") !== "1" && !/^(USE|INCLUDE|On|DocDesc)/.test(nodeName(node))
  );
  if (requestedType === void 0) return candidates.length === 1 ? candidates[0] : void 0;
  return candidates.find((node) => nodeName(node) === requestedType);
}
function walkFormTree(rootNodes, options) {
  const resolveBase = (base, stack, inherit) => {
    if (stack.includes(base)) {
      options.onCycle?.(base);
      return void 0;
    }
    const sample = options.samples.get(base);
    if (!sample && (inherit || base && !PRIMITIVE_FORM_TYPES.test(base)))
      options.onMissingBase?.(base, inherit);
    return sample;
  };
  const nextOrigin = (origin, base) => origin === "own" ? `inherited:${base}` : origin;
  const step = (nodes, prefix, origin, stack, depth) => {
    if (options.maxDepth !== void 0 && depth > options.maxDepth || options.maxStack !== void 0 && stack.length > options.maxStack) {
      options.onLimit?.();
      return;
    }
    for (const node of nodes) {
      const key = nodeName(node);
      const base = nodeAttr(node, "TYPE");
      if (key === "INHERIT") {
        const sample2 = resolveBase(base, stack, true);
        if (sample2)
          step(nodeChildren(sample2), prefix, nextOrigin(origin, base), [...stack, base], depth + 1);
        continue;
      }
      if (options.skip(node, key)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const result = options.visit({
        node,
        key,
        path,
        prefix,
        base,
        origin,
        resolveBase: () => resolveBase(base, stack, false)
      });
      if (result === false) continue;
      const sample = result === void 0 ? resolveBase(base, stack, false) : result;
      if (sample)
        step(nodeChildren(sample), path, nextOrigin(origin, base), [...stack, base], depth + 1);
      step(nodeChildren(node), path, origin, stack, depth + 1);
    }
  };
  step(rootNodes, "", "own", [], 0);
}
function extractDocumentForm(allRoots, samples) {
  const roots = allRoots.filter(
    (node) => !/^(USE|INCLUDE|On|METHOD|PROPERTY|SCRIPT)/.test(nodeName(node))
  );
  const fields3 = [];
  for (const root of roots) {
    walkFormTree(nodeChildren(root), {
      samples,
      maxDepth: 32,
      skip: (_, key) => !key || key === "OnBeforeSave" || key === "OnCreate",
      visit: ({ node, path, base }) => {
        fields3.push({
          path,
          type: base || "element",
          multiple: nodeAttr(node, "MULTIPLE") === "1"
        });
      }
    });
  }
  return { roots: roots.map(nodeName), fields: fields3 };
}
function extractCatalogFields(catalogRoots, catalogId, type, samples) {
  const query = /* @__PURE__ */ new Map();
  const roots = catalogRoots.filter((node) => nodeAttr(node, "SAMPLE") !== "1");
  const own = roots.find((node) => nodeName(node) === catalogId);
  const record = findNode(roots, type) ?? (own ? nodeChildren(own).find((node) => nodeAttr(node, "MULTIPLE") === "1") : void 0);
  if (record) {
    walkFormTree(nodeChildren(record), {
      samples,
      skip: (_, key) => !key || /^(On|DocDesc)/.test(key),
      visit: ({ node, path }) => {
        query.set(path, node);
      }
    });
  }
  return query;
}
function extractDocumentShape(roots, type, samples) {
  const root = roots.find((node) => nodeName(node) === type && nodeAttr(node, "SAMPLE") !== "1");
  const parents = /* @__PURE__ */ new Set();
  const computed = /* @__PURE__ */ new Set();
  const stored = /* @__PURE__ */ new Set();
  const serverFilled = /* @__PURE__ */ new Set();
  const shape = {
    fields: /* @__PURE__ */ new Set(),
    repeated: /* @__PURE__ */ new Set(),
    types: /* @__PURE__ */ new Map(),
    parents,
    computed,
    serverFilled
  };
  if (root) {
    walkFormTree(nodeChildren(root), {
      samples,
      maxStack: 64,
      onLimit: () => {
        shape.partial = true;
      },
      onMissingBase: () => {
        shape.partial = true;
      },
      skip: (_, key) => !key || /^(On|DocDesc)/.test(key),
      visit: ({ node, key, path, prefix, base }) => {
        const isComputed = nodeAttr(node, "PROPERTY") === "1";
        if (!prefix) shape.fields.add(key);
        if (prefix && !isComputed) parents.add(prefix);
        (isComputed ? computed : stored).add(path);
        shape.types.set(path, base);
        if (nodeAttr(node, "MULTIPLE") === "1") shape.repeated.add(path);
      }
    });
  }
  for (const path of stored) computed.delete(path);
  const onSave = roots.find((node) => nodeName(node) === "OnBeforeSave");
  const code = onSave ? nodeAttr(onSave, "EXPR") : "";
  for (const path of stored)
    if (!path.includes(".") && code.includes(`TopElem.${path}.Clear()`) && new RegExp(String.raw`TopElem\.${path}\s*=(?!=)`).test(code))
      serverFilled.add(path);
  return shape;
}
function extractFormFields(root, samples, query, resolveTitle, notes) {
  const fields3 = /* @__PURE__ */ new Map();
  const methods = /* @__PURE__ */ new Map();
  walkFormTree(nodeChildren(root), {
    samples,
    maxStack: 64,
    onLimit: () => {
      throw new HcmError("FORM_DEPTH_LIMIT", "Наследование в форме глубже 64 уровней.");
    },
    onCycle: () => {
      throw new HcmError(
        "FORM_INHERITANCE",
        "Базовые типы формы ссылаются друг на друга по кругу."
      );
    },
    onMissingBase: (base) => {
      const note = `Базовый тип ${base} не найден: его поля в ответ не попали.`;
      if (!notes.includes(note)) notes.push(note);
    },
    skip: (node, key) => !key || /^(On|DocDesc)$|^On/.test(key) || nodeAttr(node, "TEMP") === "1",
    visit: ({ node, path, base, origin, resolveBase }) => {
      const catalogNode = query.get(path);
      const parameters = Object.entries(attrsObject(node)).filter(([key]) => /^@_PARAM__\d+$/.test(key)).map(([, value]) => text(value));
      const computed = nodeAttr(node, "PROPERTY") === "1";
      if (computed && (parameters.length || !nodeAttr(node, "TITLE") && !catalogNode)) {
        methods.set(path, { name: path, parameters });
        return false;
      }
      const title = resolveTitle(
        nodeAttr(node, "TITLE") || (catalogNode ? nodeAttr(catalogNode, "TITLE") : "")
      );
      const sample = resolveBase();
      const field = {
        path,
        type: (sample ? "" : base) || (!nodeChildren(node).some((child) => nodeName(child)) && catalogNode ? nodeAttr(catalogNode, "TYPE") : "") || "element",
        origin
      };
      if (title) field.title = title;
      if (nodeAttr(node, "FOREIGN-ARRAY")) field.references = nodeAttr(node, "FOREIGN-ARRAY");
      if (nodeAttr(node, "MULTIPLE") === "1") field.multiple = true;
      if (nodeAttr(node, "NOT-NULL") === "1") field.required = true;
      if (nodeAttr(node, "PRIMARY-KEY")) field.key = nodeAttr(node, "PRIMARY-KEY");
      if (computed) field.computed = true;
      if (catalogNode) field.query = true;
      fields3.set(path, field);
      return sample ?? null;
    }
  });
  return { fields: fields3, methods };
}

// src/schema.ts
var list = (value) => (Array.isArray(value) ? value : [value]).filter((v) => !!v && typeof v === "object");
var data = (value) => list(value)[0] ?? {};
function serverDatabases(info) {
  return list(info.databases).flatMap(
    (db) => typeof db.id === "string" ? [{ id: db.id, catalogs: list(db.catalogs) }] : []
  );
}
var text2 = (value) => typeof value === "string" ? value : "";
var languages = {
  ru: "russian",
  en: "english",
  kk: "kazakh",
  uk: "ukrain",
  uz: "uzbek",
  hy: "armenian",
  bg: "bulgarian",
  tr: "turkish"
};
function languageFileUrl(id, language) {
  const folder2 = language === void 0 ? languages[text2(id)] ?? "russian" : languages[language] ?? language;
  return `x-local://lngs/${identifier(folder2, "language")}/const.xml`;
}
var folded = (value) => value.toLowerCase().replaceAll("ё", "е");
var matches = (search, values) => {
  if (search === void 0) return true;
  const where = values.map((value) => folded(value ?? ""));
  return folded(search).split(/\s+/).filter(Boolean).every((word) => {
    const stem = word.replace(
      /(?<=[а-я]{4})(?:ами|ями|ого|его|ому|ему|ов|ев|ам|ям|ах|ях|ом|ем|ых|их|ым|им|[аеиоуыэюяьй]{1,2})$/,
      ""
    );
    return where.some((value) => value.includes(stem));
  });
};
var nothingFound = (where, examples, search = "", one = "поле") => `Ничего не найдено: search ищет слова ${where}.${/\S\s+\S/.test(search) ? ` Все слова должны быть в одном ${one}: искать нужно по одному слову.` : ""} Можно попробовать слово из заголовка на языке сервера, часть имени латиницей (${examples}) или вызов без search.`;
var pageSize = (value) => Buffer.byteLength(JSON.stringify(value));
var usualFormUrl = (type) => `x-local://wtv/wtv_${type}.xmd`;
var customUnreadable = "Документ с настраиваемыми полями прочитать не удалось: настраиваемых полей в ответе нет.";
function remembered(cache, key, ttlMs, now, read) {
  const cached = cache.get(key);
  if (cached && cached.expires > now()) return cached.value;
  const reading = read();
  cache.set(key, { expires: now() + ttlMs, value: reading });
  reading.catch(() => {
    if (cache.get(key)?.value === reading) cache.delete(key);
  });
  return reading;
}
var SchemaReader = class _SchemaReader {
  constructor(applicationInfo, readForm, readDocument, ttlMs = _SchemaReader.TTL_MS, now = Date.now) {
    this.applicationInfo = applicationInfo;
    this.readForm = readForm;
    this.readDocument = readDocument;
    this.ttlMs = ttlMs;
    this.now = now;
  }
  static TTL_MS = 6e4;
  forms = /* @__PURE__ */ new Map();
  shapes = /* @__PURE__ */ new Map();
  dictionaries = /* @__PURE__ */ new Map();
  documents = /* @__PURE__ */ new Map();
  /** Найденный адрес формы по имени типа или каталога; ненайденный следующий вызов ищет заново. */
  formUrls = /* @__PURE__ */ new Map();
  fetches = 0;
  /** Сколько раз формы или общие документы запрашивались у сервера мимо кэша. */
  get serverReads() {
    return this.fetches;
  }
  fetchForm(url) {
    this.fetches++;
    return this.readForm(url);
  }
  fetchDocument(url) {
    this.fetches++;
    return this.readDocument(url);
  }
  /** Сбросить кэши форм, структур, словарей и общих документов. */
  invalidate() {
    this.forms.clear();
    this.shapes.clear();
    this.dictionaries.clear();
    this.documents.clear();
    this.formUrls.clear();
  }
  /** Сбросить кэш общих документов (common, custom_templates) после записи объекта. */
  invalidateDocuments() {
    this.documents.clear();
  }
  cached(cache, key, read) {
    return remembered(cache, key, this.ttlMs, this.now, read);
  }
  knownFormUrl(key) {
    const cached = this.formUrls.get(key);
    return cached && cached.expires > this.now() ? cached.value : void 0;
  }
  rememberFormUrl(key, url) {
    this.formUrls.set(key, { expires: this.now() + this.ttlMs, value: url });
  }
  form(url) {
    return this.cached(this.forms, url, () => this.fetchForm(url).then(parseForm));
  }
  /**
   * Типы полей для проверки после записи. Базовый тип отдаёт свои поля тому месту, которое его
   * называет: без них логическое true, отправленное серверу, не равнялось бы хранимому им 1.
   */
  async documentForm(url) {
    const samples = /* @__PURE__ */ new Map();
    return extractDocumentForm(await this.samples(url, samples), samples);
  }
  shared(info, id) {
    const url = text2(list(info.shared_docs).find((item) => item.id === id)?.url);
    if (!url)
      return Promise.reject(
        new HcmError("SCHEMA_METADATA", `Сервер не сообщил адрес общего документа ${id}.`)
      );
    return id === "common" ? this.fetchForm(url).then((source) => XmlDocument.parse(source).snapshot().data) : this.fetchDocument(url);
  }
  commonData(info) {
    return this.cached(this.documents, "common", () => this.shared(info, "common"));
  }
  /** Типы объектов, которые объявляет сервер; пустой список, если объявление не читается. */
  async declaredTypes(info) {
    const common = await this.commonData(info).catch(() => ({}));
    return list(data(common.exchange_object_types).exchange_object_type);
  }
  customData(info) {
    return this.cached(
      this.documents,
      "custom_templates",
      () => this.shared(info, "custom_templates")
    );
  }
  language(info, language) {
    const url = languageFileUrl(info.ui_lang_id, language);
    return this.cached(this.dictionaries, url, async () => {
      const value = await this.fetchDocument(url);
      return new Map(
        list(data(value.items).item ?? value.item).map((item) => [text2(item.id), text2(item.val)])
      );
    });
  }
  unknownType(info, type, declared = []) {
    const catalogs = this.catalogs(info);
    const types = [
      ...catalogs.map((item) => text2(item.object_type)),
      ...declared.map((item) => text2(item.name))
    ].filter(Boolean);
    if (types.includes(type)) return void 0;
    const near = [
      ...catalogs.filter((item) => item.id === type),
      ...catalogs.filter((item) => isSimilarName(text2(item.id), type))
    ].map((item) => text2(item.object_type)).concat(types.filter((item) => isSimilarName(item, type)));
    const rows = catalogs.filter((item) => !text2(item.object_type) && text2(item.id).startsWith(type)).map((item) => text2(item.id)).slice(0, 3);
    return new HcmError(
      "UNKNOWN_TYPE",
      `На сервере нет типа объекта ${type}.`,
      `${similarHint(near)}${rows.length ? `Каталог без своего типа объекта: ${rows.join(", ")} — его поля показывает схема по имени каталога. ` : ""}Типы объектов показывает schema.types.`
    );
  }
  /**
   * Имя, не являющееся типом объекта, отклоняется до записи. Проверке нужны списки сервера:
   * если их не прочитать, имя оставляется серверу.
   */
  async requireType(type) {
    const info = await this.applicationInfo().catch(() => void 0);
    if (!info) return;
    const catalogs = this.catalogs(info);
    if (catalogs.some((item) => item.object_type === type)) return;
    const declared = await this.declaredTypes(info);
    if (declared.some((item) => item.name === type)) return;
    if (declared.length || catalogs.some((item) => item.id === type))
      throw this.unknownType(info, type, declared);
  }
  /**
   * Являются ли строки этого типа документами. Строки других каталогов (group_collaborators)
   * строит сервер, документа у них нет; если не определить, ответ — да.
   */
  async hasDocuments(info, type) {
    if (this.catalogs(info).some((item) => item.object_type === type)) return true;
    const declared = await this.declaredTypes(info);
    return !declared.length || declared.some((item) => item.name === type);
  }
  /**
   * Каталоги по базам, основная — первой: каталоги user_data и ещё нескольких типов лежат в базе
   * trash. Тип объекта сервер называет только у части каталогов. Рядом он перечисляет общие
   * списки (common.…): это не каталоги, и они пропускаются.
   */
  databases(info) {
    const databases = serverDatabases(info);
    const main = databases.find((db) => db.id === info.default_db_name) ?? databases[0];
    return (main ? [main, ...databases.filter((db) => db !== main)] : []).map(
      (db) => db.catalogs.filter((item) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(text2(item.id)))
    );
  }
  catalogs(info) {
    return this.databases(info).flat();
  }
  /** Каталоги с типом объекта; каталоги типа берутся из первой базы, где они есть. */
  typedCatalogs(info) {
    const seen = /* @__PURE__ */ new Set();
    return this.databases(info).flatMap((catalogs) => {
      const own = catalogs.filter((item) => text2(item.object_type) && !seen.has(item.object_type));
      for (const item of own) seen.add(item.object_type);
      return own;
    });
  }
  catalog(info, id) {
    return this.catalogs(info).find((item) => item.id === id);
  }
  /** Тип строк каталога: названный сервером или, если нет, по форме каталога. */
  async rowType(catalog) {
    const named = text2(catalog.object_type);
    if (named || !text2(catalog.form_url)) return named;
    return extractRowType(await this.form(text2(catalog.form_url)), text2(catalog.id));
  }
  /**
   * Каталоги, строки которых — объекты этого типа. У некоторых типов (event) сервер оставляет
   * каталог без имени: тогда засчитывается каталог, названный по типу, если форма согласна.
   */
  async catalogsOf(info, type) {
    const named = this.typedCatalogs(info).filter((item) => item.object_type === type);
    if (named.length || !type) return named;
    const plural = this.catalogs(info).find(
      (item) => item.id === `${type}s` && !text2(item.object_type)
    );
    return plural && await this.rowType(plural).catch(() => "") === type ? [{ ...plural, object_type: type }] : [];
  }
  async context(language) {
    const info = await this.applicationInfo();
    const notes = [];
    let unreadLanguage;
    const dictionary = await this.language(info, language).catch(() => {
      unreadLanguage = `Файл языка ${languageFileUrl(info.ui_lang_id, language)} прочитать не удалось: заголовков из него в ответе нет.`;
      notes.push(unreadLanguage);
      return /* @__PURE__ */ new Map();
    });
    const custom = await this.customData(info).catch(() => {
      notes.push(customUnreadable);
      return void 0;
    });
    return {
      info,
      dictionary,
      ...custom ? { custom } : {},
      ...unreadLanguage ? { unreadLanguage } : {},
      notes
    };
  }
  title(value, dictionary) {
    if (value.startsWith("const=")) return dictionary.get(value.slice(6)) ?? "";
    return /^##(['"])([\s\S]*)\1##$/.exec(value)?.[2] ?? value;
  }
  typeTranslations(info) {
    const url = `x-local://i18n/common/${identifier(info.ui_lang_id ?? "ru", "ui_lang_id")}/const.json`;
    return this.cached(this.dictionaries, url, async () => {
      const source = await this.fetchForm(url);
      return new Map(
        Object.entries(data(JSON.parse(source))).map(([key, value]) => [key, text2(value)])
      );
    }).catch(() => /* @__PURE__ */ new Map());
  }
  typeTitle(definition, dictionary, translations) {
    const expression = text2(definition.title).trim();
    const call = /^(i18n\.t|ms_tools\.get_const)\s*\(\s*'([^'\\]*)'\s*\)$/.exec(expression);
    if (call) return (call[1] === "i18n.t" ? translations : dictionary).get(call[2]) ?? "";
    const literal2 = /^'([^'\\]*)'$/.exec(expression);
    if (literal2) return literal2[1];
    const constant = text2(definition.web_const);
    return constant ? this.title(constant.startsWith("const=") ? constant : `const=${constant}`, dictionary) : "";
  }
  async samples(url, samples, visited = /* @__PURE__ */ new Set()) {
    if (visited.has(url)) return [];
    if (visited.size >= 64)
      throw new HcmError("FORM_DEPTH_LIMIT", "Форма подключает больше 64 других форм.");
    visited.add(url);
    const nodes = await this.form(url);
    for (const targetUrl of formIncludeUrls(nodes, url))
      await this.samples(targetUrl, samples, visited);
    registerFormSamples(nodes, samples);
    return nodes;
  }
  /** Поля одной строки каталога по пути, прочитанные из формы каталога. */
  async catalogFields(catalog, type, samples) {
    if (!catalog || !text2(catalog.form_url)) return /* @__PURE__ */ new Map();
    const catalogRoots = await this.samples(text2(catalog.form_url), samples);
    return extractCatalogFields(catalogRoots, text2(catalog.id), type, samples);
  }
  /**
   * Адрес формы документа типа: обычный, а если такой формы нет — тот, что сервер объявляет для
   * типа в common. Формы типов тестирования (assessment и др.) лежат вне x-local://wtv. Если не
   * нашлась ни та, ни другая, отказ — тот, что дало чтение обычной формы.
   */
  async typeFormUrl(type) {
    const known = this.knownFormUrl(type);
    if (known) return known;
    const usual = usualFormUrl(type);
    let url = usual;
    try {
      await this.form(usual);
    } catch (error) {
      const info = await this.applicationInfo().catch(() => void 0);
      const declared = info ? await this.declaredTypes(info) : [];
      url = text2(declared.find((item) => item.name === type)?.form_url);
      if (!url) throw error;
    }
    this.rememberFormUrl(type, url);
    return url;
  }
  /** Структура документа одного типа с унаследованными полями; читается один раз на форму. */
  async documentShape(type, url) {
    const formUrl = url ?? await this.typeFormUrl(type);
    return this.cached(this.shapes, `${formUrl}#${type}`, async () => {
      const samples = /* @__PURE__ */ new Map();
      const roots = await this.samples(formUrl, samples);
      return extractDocumentShape(roots, type, samples);
    });
  }
  /** Структура одной строки каталога; каталог назван или находится по типу объекта его строк. */
  async catalogShape(selector) {
    const info = await this.applicationInfo();
    const catalogs = selector.catalog === void 0 ? await this.catalogsOf(info, selector.type ?? "") : [this.catalog(info, selector.catalog)].filter((item) => item !== void 0);
    if (catalogs.length !== 1) return void 0;
    const catalog = catalogs[0];
    return this.cached(this.shapes, `catalog#${text2(catalog.id)}`, async () => {
      const known = await this.catalogFields(catalog, await this.rowType(catalog), /* @__PURE__ */ new Map());
      const shape = {
        fields: /* @__PURE__ */ new Set(),
        repeated: /* @__PURE__ */ new Set(),
        types: /* @__PURE__ */ new Map()
      };
      for (const [path, node] of known) {
        if (!path.includes(".")) shape.fields.add(path);
        shape.types.set(path, nodeAttr(node, "TYPE"));
        if (nodeAttr(node, "MULTIPLE") === "1") shape.repeated.add(path);
      }
      return shape;
    });
  }
  /**
   * Сервер отвечает на отклонённый запрос к каталогу голым HTTP 500. После такого отказа здесь
   * называется обычная причина: каталога не существует или поля нет в каталоге.
   */
  async explainQuery(catalogId, fields3) {
    const info = await this.applicationInfo();
    const catalog = this.catalog(info, catalogId);
    if (!catalog) {
      const near = [
        ...await this.catalogsOf(info, catalogId),
        ...this.catalogs(info).filter(
          (item) => isSimilarName(text2(item.id), catalogId) || isSimilarName(text2(item.object_type), catalogId)
        )
      ].map((item) => text2(item.id));
      return new HcmError(
        "UNKNOWN_CATALOG",
        `На сервере нет каталога ${catalogId}.`,
        `${similarHint(near)}Каталоги и их типы объектов показывает schema.types.`
      );
    }
    if (!fields3.length) return void 0;
    const type = await this.rowType(catalog);
    const known = await this.catalogFields(catalog, type, /* @__PURE__ */ new Map());
    const unknown = fields3.filter((field) => !known.has(field));
    if (!known.size || !unknown.length) return void 0;
    const names = [...known.keys()].filter((name2) => !name2.includes("."));
    const listed = `${names.slice(0, 30).join(", ")}${names.length > 30 ? `… (всего ${names.length})` : ""}`;
    return new HcmError(
      "UNKNOWN_CATALOG_FIELD",
      `В каталоге ${catalogId} нет поля: ${unknown.join(", ")}.`,
      await this.hasDocuments(info, type) ? `Поиск идёт по строкам каталога, не по документам: в schema.get для типа ${type} поля каталога отмечены query:true, остальные поля документа читает objects.get. Поля каталога: ${listed}.` : `Поля каталога: ${listed}; подробнее — schema.get по имени каталога ${catalogId}.`,
      { fields: unknown }
    );
  }
  async get(input, pageBytes = 16 * 1024) {
    const limit = boundedInteger(input.limit, 80, 1e3, "limit");
    const cursor = boundedInteger(input.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor");
    const requestedType = input.type === void 0 ? void 0 : identifier(input.type, "type");
    const byType = input.url === void 0 ? requiredString(requestedType, "type") : void 0;
    let formUrl = byType === void 0 ? requiredString(input.url, "url") : usualFormUrl(byType);
    const { info, custom, dictionary, notes } = await this.context(input.language);
    try {
      if (byType !== void 0) formUrl = await this.typeFormUrl(byType);
      await this.form(formUrl);
    } catch (error) {
      if (byType === void 0) throw error;
      const declared = await this.declaredTypes(info);
      const alternative = text2(this.catalog(info, byType)?.form_url);
      if (!alternative || alternative === formUrl) {
        throw this.unknownType(info, byType, declared) ?? error;
      }
      formUrl = alternative;
      await this.form(formUrl);
      if (this.unknownType(info, byType, declared)) this.rememberFormUrl(byType, formUrl);
    }
    const samples = /* @__PURE__ */ new Map();
    const roots = await this.samples(formUrl, samples);
    const root = findFormRoot(roots, requestedType);
    if (!root)
      throw new HcmError(
        "FORM_TYPE_MISMATCH",
        "Тип объекта в форме не определён: запрошенного типа в ней нет, или типов несколько, а type не задан."
      );
    const type = nodeName(root);
    const catalog = (await this.catalogsOf(info, type))[0];
    const mistaken = requestedType === void 0 ? void 0 : this.catalog(info, requestedType);
    const rows = mistaken ? await this.rowType(mistaken).catch(() => "") : "";
    const byCatalog = !!rows && rows !== requestedType;
    const rowsOnly = byCatalog && !await this.hasDocuments(info, rows);
    if (byCatalog)
      notes.push(
        rowsOnly ? `${requestedType} — каталог без своего типа объекта: документов у его строк нет. Поля строки — под ${rows}; в условиях и fields поиска их пишут без этой приставки.` : `${requestedType} — имя каталога; поля его объектов показывает тип ${rows}, поля строки каталога — path:"${rows}".`
      );
    const query = await this.catalogFields(catalog, type, samples);
    const { fields: fields3, methods } = extractFormFields(
      root,
      samples,
      query,
      (raw) => this.title(raw, dictionary),
      notes
    );
    if (byCatalog)
      for (const key of (await this.catalogFields(mistaken, rows, samples)).keys()) {
        const field = fields3.get(`${rows}.${key}`);
        if (field) field.query = true;
      }
    for (const [path2, node] of query) {
      if (path2.includes(".") || fields3.has(path2) || methods.has(path2)) continue;
      const property = nodeAttr(node, "PROPERTY") === "1";
      const title = this.title(nodeAttr(node, "TITLE"), dictionary);
      fields3.set(path2, {
        path: path2,
        type: nodeAttr(node, "TYPE") || "string",
        origin: "catalog",
        ...title ? { title } : {},
        ...nodeAttr(node, "FOREIGN-ARRAY") ? { references: nodeAttr(node, "FOREIGN-ARRAY") } : {},
        ...nodeAttr(node, "MULTIPLE") === "1" ? { multiple: true } : {},
        ...property ? { computed: true } : { query: true }
      });
    }
    const childCounts = /* @__PURE__ */ new Map();
    for (const path2 of fields3.keys()) {
      const dot = path2.lastIndexOf(".");
      if (dot > 0) {
        const parent = path2.slice(0, dot);
        childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
      }
    }
    for (const [path2, count] of childCounts) {
      const parent = fields3.get(path2);
      if (parent) parent.children = count;
    }
    const template = data(custom?.[type]);
    const templateField = text2(template.template_field);
    const templates = [template];
    if (templateField) {
      if (input.kind === void 0)
        notes.push(
          `Вид объекта хранится в поле ${templateField}_id: его значение передаётся в kind, чтобы увидеть настраиваемые поля этого вида.`
        );
      else {
        const kind = list(data(data(custom?.[templateField]).items).item).find(
          (item) => text2(item.id) === input.kind
        );
        if (kind) templates.push(kind);
        else notes.push(`Вида ${input.kind} нет в списке ${templateField}.`);
      }
    }
    for (const template2 of templates) {
      const sheets = new Map(
        list(data(template2.sheets).sheet).map((sheet) => [text2(sheet.id), text2(sheet.title)])
      );
      for (const item of list(data(template2.fields).field)) {
        const name2 = text2(item.name);
        if (!name2) continue;
        const field = {
          path: `custom_elems.custom_elem[name=${name2}].value`,
          name: name2,
          type: text2(item.type) || "string",
          origin: "custom"
        };
        const title = this.title(text2(item.title), dictionary);
        const values = list(data(item.entries).entry).map((entry) => text2(entry.value)).filter(Boolean);
        const sheet = sheets.get(text2(item.sheet_id));
        if (title) field.title = title;
        if (item.is_required === "1" || item.is_required === "true" || item.is_required === true)
          field.required = true;
        if (text2(item.catalog)) field.references = text2(item.catalog);
        if (values.length) field.values = values;
        const sheetTitle = sheet && this.title(sheet, dictionary);
        if (sheetTitle) field.sheet = sheetTitle;
        fields3.set(field.path, field);
      }
    }
    const path = input.path ?? (rowsOnly && input.search === void 0 && fields3.has(rows) ? rows : void 0);
    const selected = [...fields3.values()].filter(
      (field) => (!input.origin || input.origin.includes(
        field.origin.split(":")[0]
      )) && (path !== void 0 ? field.path.startsWith(`${path}.`) && (input.deep || input.search !== void 0 || !field.path.slice(path.length + 1).includes(".")) : input.deep || input.search !== void 0 || field.origin === "custom" || !field.path.includes(".")) && matches(input.search, [field.path, field.name, field.title, field.references])
    );
    const element = path === void 0 ? void 0 : fields3.get(path);
    if (path !== void 0 && !element)
      notes.push(`Поля ${path} в типе ${type} нет: путь ищет search.`);
    const found = input.include?.includes("methods") ? [...methods.values()].filter((method) => matches(input.search, [method.name])) : void 0;
    if (input.search !== void 0 && !selected.length && !found?.length)
      notes.push(
        nothingFound(
          "в пути, заголовке поля и имени каталога, на который оно ссылается",
          "hire, mail",
          input.search,
          "поле"
        )
      );
    const result = {
      type,
      ...catalog ? { catalog: text2(catalog.id) } : {},
      formUrl,
      ...element ? { element } : {},
      fields: [],
      total: selected.length,
      notes
    };
    if (found) result.methods = found;
    const limitBytes = Math.max(256, pageBytes);
    const baseBytes = pageSize(result);
    let fieldsBytes = 0;
    for (const field of selected.slice(cursor, cursor + limit)) {
      const itemBytes = pageSize(field);
      const nextLen = result.fields.length + 1;
      const nextCursor = cursor + nextLen;
      const sep = result.fields.length > 0 ? 1 : 0;
      const cursorOverhead = nextCursor < selected.length ? Buffer.byteLength(`,"nextCursor":${nextCursor}`) : 0;
      const cutOverhead = nextCursor < selected.length && nextLen < limit ? 17 : 0;
      if (baseBytes + fieldsBytes + sep + itemBytes + cursorOverhead + cutOverhead > limitBytes) {
        break;
      }
      result.fields.push(field);
      fieldsBytes += sep + itemBytes;
    }
    if (cursor + result.fields.length < selected.length) {
      result.nextCursor = cursor + result.fields.length;
      if (result.fields.length < limit) result.cutBySize = true;
    }
    if (pageSize(result) > limitBytes || !result.fields.length && cursor < selected.length && limit > 0)
      throw new HcmError(
        "SCHEMA_PAGE_LIMIT",
        "Одно поле или методы формы не помещаются на страницу схемы: выборку нужно сузить."
      );
    return result;
  }
  async types(input = {}) {
    const limit = boundedInteger(input.limit, 50, 1e3, "limit");
    const cursor = boundedInteger(input.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor");
    const { info, custom, dictionary, unreadLanguage, notes: unread } = await this.context();
    const translations = await this.typeTranslations(info);
    const common = await this.commonData(info);
    const definitions = list(data(common.exchange_object_types).exchange_object_type);
    const named = this.typedCatalogs(info);
    const unnamed = [];
    for (const definition of definitions) {
      const type = text2(definition.name);
      if (!type || named.some((item) => item.object_type === type)) continue;
      unnamed.push((await this.catalogsOf(info, type))[0] ?? { object_type: type });
    }
    const all = [...named, ...unnamed].map((catalog) => {
      const type = text2(catalog.object_type);
      const definition = definitions.find((item) => item.name === type);
      const title = this.typeTitle(definition ?? {}, dictionary, translations);
      const template = data(custom?.[type]);
      return {
        type,
        ...text2(catalog.id) ? { catalog: text2(catalog.id) } : {},
        ...title ? { title } : {},
        ...custom && {
          customFields: text2(template.template_field) ? "by kind" : list(data(template.fields).field).length
        }
      };
    });
    const types = all.filter(
      (item) => matches(input.search, [item.type, item.catalog, item.title])
    );
    const listed = new Set(all.map((item) => item.catalog));
    const untyped = this.catalogs(info).filter((item) => !text2(item.object_type)).map((item) => text2(item.id)).filter(
      (id) => !listed.has(id) && (matches(input.search, [id]) || types.length <= 20 && types.some((item) => id.startsWith(`${item.type}_`)))
    );
    const rows = [...types, ...untyped.map((catalog) => ({ catalog }))];
    const page = rows.slice(cursor, cursor + limit);
    const searchNote = input.search !== void 0 && !types.length ? unreadLanguage : void 0;
    const notes = [
      ...page.some((item) => "type" in item) ? unread : searchNote ? [searchNote] : [],
      ...page.some((item) => !("type" in item)) ? [
        "Строка без type — каталог без своего типа объекта: документов у его строк нет, искать в нём можно, поля строки показывает схема по имени каталога."
      ] : [],
      ...input.search !== void 0 && !rows.length ? [
        nothingFound(
          "в имени типа, имени каталога и заголовке",
          "collab, group",
          input.search,
          "типе"
        )
      ] : []
    ];
    return {
      types: page,
      total: rows.length,
      ...cursor + limit < rows.length ? { nextCursor: cursor + limit } : {},
      ...notes.length ? { notes } : {}
    };
  }
};

// src/platform-errors.ts
function refusalHint(cause) {
  return `${cause ? `Обычная причина: ${cause}. ` : ""}Причину сервер в ответе не сообщает. Строка о ней может быть в логе xhttp за сегодня (последние строки показывает logs.follow); отклонённый запрос часто строки не оставляет.`;
}
var ADDRESS_HINT = "Проверить адрес и порт подключения: WTCTL_URL или baseUrl в файле подключений.";
function network(reason, address, host) {
  switch (reason) {
    case "refused":
      return {
        message: `Сервер ${address} не отвечает: соединение отклонено.`,
        hint: `Проверить, что сервер запущен. ${ADDRESS_HINT}`
      };
    case "unknown_host":
      return { message: `Адрес сервера не найден: ${host}.`, hint: ADDRESS_HINT };
    case "unreachable":
      return { message: `Сервер ${address} недоступен по сети.`, hint: ADDRESS_HINT };
    case "certificate":
      return {
        message: `Сертификат сервера ${address} не прошёл проверку.`,
        hint: "Если сертификат выпущен внутренним центром сертификации, нужно указать его корневой сертификат в переменной NODE_EXTRA_CA_CERTS."
      };
    case "tls":
      return {
        message: `Не удалось установить защищённое соединение с ${address}.`,
        hint: "Проверить схему в адресе подключения: https для защищённого порта, http для обычного."
      };
    case "not_http":
      return { message: `По адресу ${address} отвечает не сервер HTTP.`, hint: ADDRESS_HINT };
    case "redirect":
      return {
        message: `Сервер ${address} перенаправляет запросы на другой адрес.`,
        hint: "Нужно указать в подключении конечный адрес сервера, например с https вместо http."
      };
    case "timeout":
      return {
        message: `Сервер ${address} не ответил за отведённое время.`,
        hint: "Проверить, что сервер работает. Для долгих операций увеличить timeoutMs подключения."
      };
    case "reset":
      return {
        message: `Соединение с ${address} оборвалось.`,
        hint: "Проверить, что сервер работает, и повторить."
      };
    case "aborted":
      return { message: `Запрос к ${address} прерван.` };
    default:
      return {
        message: `Запрос к ${address} не выполнен: нет связи с сервером.`,
        hint: `Проверить, что сервер запущен. ${ADDRESS_HINT}`
      };
  }
}
function platformFailure(error, baseUrl, usualCause, indeterminate = false) {
  let address = baseUrl.replace(/\/+$/, "");
  let host = address;
  try {
    const url = new URL(baseUrl);
    address = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    host = url.hostname;
  } catch {
  }
  const status = error.status;
  if (status === void 0) {
    if (error.kind === "http") {
      const reason = typeof error.details?.network === "string" ? error.details.network : "reset";
      const text3 = network(reason, address, host);
      if (!indeterminate) return text3;
      return {
        message: text3.message,
        hint: `Запрос на запись ушёл, а ответа нет: проверить, прошла ли запись, прежде чем повторять.${reason === "timeout" ? " Для долгих операций — увеличить timeoutMs подключения." : ""}`
      };
    }
    if (error.kind === "auth")
      return {
        message: "Не заданы имя пользователя и пароль подключения.",
        hint: "Нужно задать WTCTL_USERNAME и WTCTL_PASSWORD (для MCP-сервера — в env его записи) или создать файл подключений: wtctl config init."
      };
    if (error.requestSent === false) return { message: error.message };
    if (error.kind === "cleanup") return { message: "Не удалось закрыть сессию на сервере." };
    return {
      message: "Ответ сервера не соответствует ожидаемому виду.",
      hint: "Если так отвечает любая операция, по адресу подключения может работать не сервер WebSoft HCM или его версия не поддерживается: выполнить runtime.check."
    };
  }
  if (status === 401)
    return {
      message: "Сервер отказал во входе (HTTP 401).",
      hint: "Проверить имя пользователя и пароль подключения."
    };
  if (status === 403)
    return {
      message: "Сервер запретил запрос (HTTP 403).",
      hint: "У пользователя подключения нет прав на это действие."
    };
  if (status === 500)
    return { message: "Сервер отклонил запрос (HTTP 500).", hint: refusalHint(usualCause) };
  if (status === 404)
    return {
      message: "Сервер ответил HTTP 404: по этому адресу ничего нет.",
      hint: "Если так отвечает любая операция, проверить адрес подключения: по нему может работать не сервер WebSoft HCM."
    };
  if (status === 502 || status === 503 || status === 504)
    return {
      message: `Сервер недоступен (HTTP ${status}).`,
      hint: "Так отвечает промежуточный сервер, когда сам сервер WebSoft HCM остановлен или перегружен."
    };
  if (error.requestSent === false) return { message: error.message };
  if (status >= 200 && status < 300)
    return { message: `Сервер ответил HTTP ${status}, но разобрать ответ не удалось.` };
  return { message: `Сервер ответил ошибкой HTTP ${status}.` };
}

// src/self-check.ts
var CheckFailure = class extends Error {
};
async function checkServer(config, invoke) {
  const report = {
    permissions: config.permissions,
    checks: [],
    summary: { ok: 0, failed: 0, skipped: 0 }
  };
  let info = {};
  const rows = (value) => Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : [];
  const text3 = (value, max = 128) => {
    const result = requiredString(value, "ответ проверки");
    if (result.length > max) throw new Error();
    return result;
  };
  const probe = async (name2, id, args = {}, accept = (_) => {
  }) => {
    const skipped = name2 !== "login" && report.checks[0]?.result === "failed" ? "сессия не открыта" : name2 === "execute" && !config.permissions.execute ? `выполнение кода не разрешено подключением. ${permissionHint(config, "execute")}` : void 0;
    if (skipped) {
      report.checks.push({ name: name2, result: "skipped", reason: skipped });
      return;
    }
    const controller = new AbortController();
    let late = false;
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          late = true;
          controller.abort();
          reject(new Error());
        }, config.timeoutMs);
      });
      const pending = invoke(id, args, controller.signal);
      pending.catch(() => {
      });
      accept(await Promise.race([pending, timeout]));
      report.checks.push({ name: name2, result: "ok" });
    } catch (error) {
      const status = error instanceof WsHcmApiError ? error.status : void 0;
      const explained = error instanceof WsHcmApiError && (name2 === "login" || status === void 0) ? platformFailure(error, config.baseUrl) : void 0;
      const reason = late ? "превышено время проверки" : error instanceof CheckFailure ? error.message : status === 500 && name2 === "portal" ? "HTTP 500: проверить порт в объекте «хост» и адрес подключения" : explained ? [explained.message, explained.hint].filter(Boolean).join(" ") : status !== void 0 ? `HTTP ${status}` : error instanceof HcmError ? `проверка не пройдена: ${error.code}` : "проверка не пройдена";
      report.checks.push({ name: name2, result: "failed", reason });
    } finally {
      clearTimeout(timer);
    }
  };
  await probe("login", "native.session.open", {}, (v) => {
    if (inputObject(v).opened !== true) throw new Error();
  });
  await probe("version", "runtime.status", {}, (v) => {
    report.version = text3(inputObject(v).version);
  });
  await probe("appInfo", "native.spxml2.getAppInfo", { fastStart: true }, (v) => {
    info = inputObject(v);
    if (typeof info.ui_lang_id === "string") report.language = text3(info.ui_lang_id, 16);
    const database2 = serverDatabases(info).find((db) => db.id === text3(info.default_db_name));
    if (!database2?.catalogs.length) throw new Error();
  });
  await probe(
    "query",
    "runtime.query",
    { catalog: "collaborators", limit: 1, fields: ["id"] },
    (v) => {
      if (inputObject(v).incomplete === true)
        throw new CheckFailure("база данных отвергла запрос; причина — в логе spxml_unibridge");
    }
  );
  await probe("document", "objects.get", {
    url: rows(info.shared_docs).find((doc) => doc.id === "custom_templates")?.url
  });
  await probe("schema", "schema.get", { type: "collaborator", cursor: 0 }, (v) => {
    const fields3 = rows(inputObject(v).fields);
    if (!fields3.length || !fields3.some((f) => String(f.origin).startsWith("inherited:")))
      throw new Error();
  });
  await probe("titles", "objects.get", { url: languageFileUrl(info.ui_lang_id) });
  await probe("libraries", "rpc.list", { library: "tools", limit: 1 }, (v) => {
    if (inputObject(v).source !== "server") throw new Error();
  });
  await probe("logs", "logs.list", { limit: 1 });
  await probe("portal", "anonymous.diagnostics.portal", {}, (v) => {
    const status = Number(inputObject(v).status);
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error();
    if (status >= 500) throw new WsHcmApiError("http", "Ошибка портала", { status });
  });
  await probe("execute", "execute.script", { code: "RESULT = [1 + 1];" }, (v) => {
    const result = inputObject(v).result;
    if (!Array.isArray(result) || result.length !== 1 || String(result[0]) !== "2")
      throw new Error();
  });
  for (const { result } of report.checks) report.summary[result]++;
  return report;
}

// src/server-info.ts
var fields2 = ["sys_db_capability", "catalog_limits", "version_server", "os_type"];
var maxCatalogXmlBytes = 256 * 1024;
var maxCatalogRows = 4096;
function signedInteger(value) {
  if (!/^(?:0x[0-9a-fA-F]{1,16}|[+-]?\d{1,20})$/.test(value)) throw new Error();
  const integer3 = BigInt(value);
  if (integer3 < -0x8000000000000000n || integer3 > 0x7fffffffffffffffn) throw new Error();
  return value;
}
function database(mask) {
  if ((mask & 1n) === 0n) return "xml";
  if ((mask & 0x10000n) !== 0n) return "mssql";
  if ((mask & 0x20000n) !== 0n) return "oracle";
  if ((mask & 0x8000n) !== 0n) return "azure";
  return (mask & 0x200000000n) !== 0n ? "postgresql" : "other";
}
function catalogLimits(source) {
  if (Buffer.byteLength(source) > maxCatalogXmlBytes) throw new Error();
  const document = parseXml(source);
  exactKeys(document, ["catalogs"]);
  const root = document.catalogs;
  if (typeof root === "string" && root.trim() === "") return [];
  const container = object3(root);
  exactKeys(container, ["catalog", "#text"]);
  if (!blank(container["#text"])) throw new Error();
  const children2 = container.catalog;
  const rows = children2 === void 0 ? [] : Array.isArray(children2) ? children2 : [children2];
  if (rows.length > maxCatalogRows) throw new Error();
  const names = /* @__PURE__ */ new Set();
  return rows.map((value) => {
    const row = object3(value);
    exactKeys(row, ["name", "max_records_num", "#text"]);
    if (!blank(row["#text"]) || typeof row.name !== "string" || typeof row.max_records_num !== "string")
      throw new Error();
    const name2 = row.name;
    if (name2.length === 0 || name2.length > 512 || names.has(name2)) throw new Error();
    names.add(name2);
    return { objectTypeName: name2, maxRecordsNum: signedInteger(row.max_records_num) };
  });
}
function parseServerInfo(response, profile = "native") {
  try {
    if (profile !== "native" && profile !== "web") throw new Error();
    const { rpc, result } = strictResponse(response);
    if (rpc.valueType !== void 0 && !isType(rpc.valueType, "object") || !blank(rpc.lexicalValue))
      throw new Error();
    exactKeys(result, ["@_VALUE-TYPE", "#text", ...fields2]);
    if (!isType(result["@_VALUE-TYPE"], "object") || !blank(result["#text"])) throw new Error();
    const capabilityMask = signedInteger(typedText(result.sys_db_capability, "integer"));
    const versionServer = typedText(result.version_server, "string");
    const osType = typedText(result.os_type, "string");
    if (versionServer.length === 0 || versionServer.length > 256 || !["windows", "linux"].includes(osType))
      throw new Error();
    return freezeRegistry({
      profile,
      versionServer,
      osType,
      capabilityMask,
      database: database(BigInt(capabilityMask)),
      catalogLimits: catalogLimits(typedText(result.catalog_limits, "string"))
    });
  } catch {
    throw new HcmError(
      "SERVER_INFO_RESPONSE",
      "Сервер вернул сведения о себе в неожиданном виде.",
      "Ожидаются четыре поля функции ms_tools.get_admin_init_server_data: sys_db_capability, catalog_limits, version_server, os_type. Её ответ как есть покажет rpc.call."
    );
  }
}
async function readServerInfo(server, profile = "native") {
  return parseServerInfo(
    await server.read(`${profile}.rpc.call`, {
      target: "ms_tools.get_admin_init_server_data",
      args: []
    }),
    profile
  );
}

// src/operations/connection.ts
var checkFailed = (data2) => {
  const check = data2;
  if (!(check.summary.failed > 0)) return void 0;
  return {
    code: "CHECK_FAILED",
    message: `Проверка подключения не пройдена: ${check.checks.filter((item) => item.result === "failed").map((item) => item.name).join(", ")}.`,
    hint: check.checks.find((item) => item.result === "failed")?.reason ?? "Причины — в data.checks.",
    retryable: false
  };
};
var connectionOperations = [
  operation({
    id: "server.info",
    effect: "read",
    description: "Сведения, которые сервер отдаёт админке при запуске: версия, операционная система, маска возможностей, ограничения на число записей по типам объектов; в профиле native ещё папки: в dataFolders запись и удаление файлов идут под правом write, в codeFolders нужны права write и execute (удаление там идёт кодом на сервере). Маска — не права пользователя, ограничения — не список каталогов. profile: native (по умолчанию) или web.",
    inputSchema: schema({ profile: { type: "string", enum: ["native", "web"] } }),
    summary: "Версия, операционная система и ограничения сервера.",
    run: async (context, args) => {
      const info = await readServerInfo(context.server, args.profile === "web" ? "web" : "native");
      const folders = info.profile === "native" ? await context.files.folders() : void 0;
      return folders ? { ...info, dataFolders: folders.data, codeFolders: folders.code } : info;
    }
  }),
  operation({
    id: "runtime.status",
    effect: "read",
    description: "Проверить связь: версия сервера, база данных (database), userId и права подключения. Ничего не меняет.",
    inputSchema: schema({}),
    run: async (context) => {
      const version = await context.server.read("native.rpc.call", {
        target: "tools.get_version",
        args: [rpcArgument("wtv")]
      });
      const info = await context.server.applicationInfo().catch(() => void 0);
      const userId = typeof info?.auth_object_url === "string" ? parsePhysicalDocumentId(info.auth_object_url) : void 0;
      const database2 = (await readServerInfo(context.server).catch(() => void 0))?.database;
      return {
        connection: context.config.name,
        baseUrl: context.config.baseUrl,
        version: scalar(findXmlNode(version, "Result"), "версии"),
        ...database2 ? { database: database2 } : {},
        ...userId ? { userId } : {},
        operationCount: context.operationCount,
        permissions: context.config.permissions
      };
    }
  }),
  operation({
    id: "runtime.check",
    effect: "read",
    description: "Проверить подключение по шагам: вход, версия, запрос, документ, схема, библиотеки, логи, портал; при праве execute — ещё код RESULT = [1 + 1]. Запись не проверяется.",
    inputSchema: schema({}),
    reply: { store: "never", failed: checkFailed },
    run: (context) => checkServer(
      context.config,
      (id, input, signal) => context.pipeline.invoke(id, input, signal)
    )
  })
];

// src/files.ts
import { createHash as createHash2 } from "node:crypto";
import { open as open2, writeFile } from "node:fs/promises";
import { isAbsolute, resolve as resolve3 } from "node:path";

// src/local-file.ts
import { randomUUID } from "node:crypto";
import { constants, copyFile, link, open, rename, stat, unlink } from "node:fs/promises";
import { resolve as resolve2 } from "node:path";
async function saveLocalFile(path, overwrite, fill, argument = "path") {
  if (path.includes("\0"))
    throw new HcmError("INVALID_ARGUMENT", `${argument}: в пути есть нулевой символ.`);
  const target2 = resolve2(path);
  const existing = await stat(target2).catch(() => void 0);
  if (existing?.isDirectory())
    throw new HcmError(
      "INVALID_ARGUMENT",
      `${argument}: по этому пути папка, а нужен путь к файлу.`,
      "К пути нужно добавить имя файла."
    );
  if (existing && !overwrite) throw fileExists();
  const local2 = (error) => {
    if (error.code === "EEXIST") throw fileExists();
    if (error.code === "ENOENT")
      throw new HcmError(
        "FOLDER_NOT_FOUND",
        "Папки для файла нет.",
        "Сначала нужно создать папку."
      );
    throw saveFailed(error);
  };
  const temporary = `${target2}.${randomUUID()}.tmp`;
  let file = await open(temporary, "wx", 384).catch(local2);
  try {
    await fill(file).catch((error) => {
      throw typeof error?.syscall === "string" ? saveFailed(error) : error;
    });
    await file.close();
    file = void 0;
    const bytes = (await stat(temporary)).size;
    if (overwrite) await rename(temporary, target2).catch(local2);
    else
      await link(temporary, target2).catch((error) => {
        if (error.code === "EEXIST") local2(error);
        return copyFile(temporary, target2, constants.COPYFILE_EXCL).catch(local2);
      });
    return bytes;
  } finally {
    await file?.close().catch(() => {
    });
    await unlink(temporary).catch(() => {
    });
  }
}
function fileExists() {
  return new HcmError(
    "FILE_EXISTS",
    "Файл по этому пути уже есть.",
    "Нужно разрешить замену файла (overwrite) или выбрать другой путь."
  );
}
function saveFailed(error) {
  return new HcmError(
    "FILE_SAVE_FAILED",
    `Не удалось записать файл на этом компьютере${error.code ? ` (${error.code})` : ""}.`,
    "Проверить права на папку и свободное место на диске или выбрать другой путь."
  );
}

// src/scripts.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var TARGET = "ms_tools.evaluate_remote_collection_obj";
var FORM = "x-local://wtv/wtv_remote_collection.xmd";
function paramsJson(params) {
  const value = inputObject(params, "params");
  try {
    return JSON.stringify(value);
  } catch {
    throw new HcmError(
      "INVALID_ARGUMENT",
      "params: значение нельзя записать как JSON.",
      "Большое целое передаётся строкой; объект не может ссылаться на самого себя."
    );
  }
}
function prepareScript(value, params) {
  const code = (params === void 0 ? "" : `var PARAMS = ParseJson(DecodeCharset(Base64Decode("${Buffer.from(paramsJson(params)).toString("base64")}"), "utf-8")); `) + requiredString(value, "code");
  const marker = `hcm_inline_${randomUUID2().replaceAll("-", "")}`;
  const xml = `<remote_collection SPXML-FORM="${FORM}" SPXML-FORM-ELEM="remote_collection"><code>${marker}</code><name>${marker}</name><use_cache>0</use_cache><script>${escapeXml(code)}</script></remote_collection>`;
  return { request: { target: TARGET, args: [{ lexicalValue: { xml } }] }, executionId: marker };
}
var ID = /^(?:0x[0-9a-f]{1,16}|\d{1,20})$/i;
var AGENT_RUN = `var doc = OpenDoc(UrlFromDocID(Int(PARAMS.id)));
if (doc.TopElem.Name != 'server_agent') throw 'Объект с этим ID — не агент сервера (server_agent).';
var from = StrXmlDate(Date());
var started = doc.TopElem.run_agent(PARAMS.objectId, PARAMS.objectIds, Date(), true);
if (started) doc.Save();
RESULT = [{ started: started, from: from, to: StrXmlDate(Date()) }];`;
function agentRun(args) {
  const id = (value, path) => {
    if (typeof value !== "string" || !ID.test(value))
      throw new HcmError("INVALID_ARGUMENT", `${path}: нужен ID строкой, 0x… или десятичный.`);
    return BigInt(value).toString();
  };
  const list2 = args.objectIds ?? [];
  if (!Array.isArray(list2) || list2.length > 1e3)
    throw new HcmError("INVALID_ARGUMENT", "objectIds: нужен список до 1000 ID.");
  return {
    code: AGENT_RUN,
    params: {
      id: id(args.id, "id"),
      objectId: args.objectId === void 0 ? null : id(args.objectId, "objectId"),
      objectIds: list2.map((item, index) => id(item, `objectIds[${index}]`)).join(";")
    }
  };
}
function agentRunResult(data2) {
  const row = data2.result[0];
  const time = (value) => String(value ?? "").slice(0, 19);
  const started = row?.started === "1";
  return {
    started,
    startedAt: time(row?.from),
    finishedAt: time(row?.to),
    hint: started ? "Код агента отработал до конца или до ошибки: ошибку сервер пишет только в лог. Строки запуска — лог agent, alert и ошибки кода — лог xhttp, между startedAt и finishedAt." : "Сервер агента не запустил; причину он пишет в лог agent."
  };
}
function scriptResult(response, executionId) {
  const decoded = decodeRpcValue(findXmlNode(response, "Result"));
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "Сервер вернул результат кода в неожиданном виде: это не объект."
    );
  const value = decoded;
  if (typeof value.error !== "string" || !/^\d+$/.test(value.error))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "Сервер вернул результат кода без числового кода ошибки."
    );
  if (value.error !== "0") {
    const reason = (typeof value.error_text === "string" ? value.error_text : "").split(/\r?\n/).map((line) => line.trim()).filter(
      (line) => line !== "" && !line.startsWith("Error evaluating collection") && !line.includes("wtv_remote_collection.xmd")
    ).join("\n");
    const unread = /^JavaScript syntax error\.\nUnknown source,\s+line \d+$/.test(reason);
    const where = reason === "" ? "" : "Сообщение сервера — в details.scriptError. ";
    throw new HcmError(
      "SCRIPT_FAILED",
      "Сервер сообщил об ошибке в коде SP-XML Script.",
      unread ? where + "Код не разобран и не выполнялся: данные не менялись." : where + "Код выполнялся до ошибки. Если он только читал, его можно повторить; если менял данные — сначала проверить их.",
      reason === "" ? void 0 : { scriptError: reason },
      unread ? "not_sent" : "indeterminate"
    );
  }
  if (!Array.isArray(value.result))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "RESULT — не массив.",
      "Нужно присвоить RESULT массив, даже когда возвращать нечего: RESULT = [];"
    );
  if (!Array.isArray(value.columns) || value.data === null || typeof value.data !== "object" || Array.isArray(value.data))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "Сервер вернул результат кода не полностью: нет columns или data."
    );
  const total = value.total;
  const serverTicks = value.ticks;
  if (typeof total !== "string" || typeof serverTicks !== "string" || !/^\d+$/.test(total) || !/^\d+$/.test(serverTicks))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "Сервер вернул результат кода с неверными счётчиками total или ticks."
    );
  const data2 = value.data;
  return {
    result: value.result,
    ...value.columns.length ? { columns: value.columns } : {},
    ...Object.keys(data2).length ? { data: data2 } : {},
    executionId
  };
}

// src/files.ts
function fileContent(content, encoding) {
  const binary = () => ({ base64: content.toString("base64"), bytes: content.length });
  if (encoding === "base64") return binary();
  let text3;
  try {
    text3 = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return binary();
  }
  return /[\u0000-\u0008\u000b\u000e-\u001f]/.test(text3) ? binary() : { text: text3, bytes: content.length };
}
var FILE_EXISTS_TARGET = "tools.file_url_exists_server";
var FILE_EXISTS_URL_MAX_LENGTH = 256;
function fileExistsUrl(value) {
  const invalid = () => new HcmError(
    "INVALID_ARGUMENT",
    "url: нужен адрес x-local://… не длиннее 256 знаков.",
    "Адрес вида x-local://папка/путь: без имени пользователя и пароля, порта, знаков ? и #, обратной косой черты и управляющих символов."
  );
  if (typeof value !== "string" || value.length > FILE_EXISTS_URL_MAX_LENGTH || !value.startsWith("x-local://") || /[\\?#\u0000-\u001f\u007f]/u.test(value))
    throw invalid();
  const authority = value.slice("x-local://".length).split("/", 1)[0];
  if (!authority || /[\s@:\\]/u.test(authority)) throw invalid();
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 55296 && unit <= 56319) {
      const next = value.charCodeAt(++index);
      if (!(next >= 56320 && next <= 57343)) throw invalid();
    } else if (unit >= 56320 && unit <= 57343) throw invalid();
    else if (unit === 65534 || unit === 65535) throw invalid();
  }
  return value;
}
function fileFolders(info) {
  const data2 = /* @__PURE__ */ new Set();
  const design = /* @__PURE__ */ new Set();
  const database2 = /* @__PURE__ */ new Set();
  const entries = Array.isArray(info?.config_entries) ? info.config_entries : [];
  for (const entry of entries) {
    if (typeof entry?.value !== "string" || !entry.value) continue;
    if (entry.name === "DATA-DB") data2.add(entry.value);
    else if (entry.name === "DESIGN-DB") design.add(entry.value);
    else if (entry.name === "DB-STORE-HOOK") database2.add(entry.value.trim().split(/\s/, 1)[0]);
  }
  if (!data2.size && !design.size) return void 0;
  return {
    data: [...data2],
    code: [...design].filter((name2) => !data2.has(name2)),
    database: [...database2]
  };
}
function fileTarget(value, listing = false) {
  const text3 = listing && typeof value === "string" ? value.replace(/\/$/, "") : value;
  const [folder2 = "", ...path] = typeof text3 === "string" ? text3.slice(10).split("/") : [];
  const plain = (part) => !/^[. ]*$|%(?:2e|2f|5c|[01][0-9a-f]|7f)/i.test(part);
  if (typeof text3 !== "string" || !text3.startsWith("x-local://") || /[\\?#\p{Cc}\p{Cs}]/u.test(text3) || !/^[\w-]+$/.test(folder2) || !(listing || path.length) || !path.every(plain))
    throw new HcmError(
      "INVALID_ARGUMENT",
      listing ? "url: нужен адрес x-local://папка или x-local://папка/путь." : "url: нужен адрес x-local://папка/путь.",
      `${listing ? "Без" : "Путь не пустой, без"} частей из одних точек и пробелов, без %2e, %2f, %5c, знаков \\ ? #. Например, x-local://share/report.txt.`
    );
  return { url: text3, folder: folder2 };
}
function isDocumentUrl(url) {
  return /^x-local:\/\/[^/]+\/objects\//.test(url) && parsePhysicalDocumentId(url) !== void 0;
}
var DOCUMENT_REFUSALS = {
  delete: [
    "Адрес — документ объекта: files.delete его не удаляет.",
    "Объект удаляет objects.delete: он сверяет каталог. Удаление по адресу положило бы объект в корзину сервера в обход этой проверки."
  ],
  write: [
    "Адрес — документ объекта: files.write его не записывает.",
    "Поля объекта правит objects.patch, документ целиком — native.lds.putDoc. Запись по адресу меняет документ, но не строку каталога."
  ]
};
function assertNotDocument(url, action) {
  if (isDocumentUrl(url)) throw new HcmError("FILE_IS_DOCUMENT", ...DOCUMENT_REFUSALS[action]);
}
function folderKind(folders, folder2) {
  if (!folders) return void 0;
  if (folders.data.includes(folder2)) return "data";
  if (folders.code.includes(folder2)) return "code";
  throw new HcmError(
    "FOLDER_NOT_WRITABLE",
    `Папка ${folder2} не принимает файлы.`,
    `Папки данных: ${folders.data.join(", ")}. Папки кода (нужны права write и execute): ${folders.code.join(", ")}.`
  );
}
var UPLOAD_BLOCK_BYTES = 1e7;
var WRITE_INTERRUPTED = {
  message: "Запись прервалась: файл на сервере может быть пустым или недописанным. Запись можно повторить целиком."
};
var READ_BACK_FAILED = {
  message: "Файл записан, но прочитать его для сверки не удалось.",
  hint: "Содержимое на сервере не проверено: сравнить через files.read; запись можно повторить целиком."
};
var WRITE_MISMATCH_HINT = "Файл записывается целиком: запись можно повторить; если расхождение повторяется — сервер портит файл при записи, проверить через files.read.";
async function writeSource(args) {
  const { text: text3, base64, file } = args;
  if ([text3, base64, file].filter((value) => value !== void 0).length !== 1)
    throw new HcmError("INVALID_ARGUMENT", "Нужно ровно одно из text, base64 и file.");
  if (typeof file === "string") return diskSource(file);
  const bytes = typeof text3 === "string" && !new RegExp("\\p{Cs}", "u").test(text3) ? Buffer.from(text3) : typeof base64 === "string" ? Buffer.from(base64, "base64") : void 0;
  if (!bytes || base64 !== void 0 && bytes.toString("base64") !== base64)
    throw new HcmError(
      "INVALID_ARGUMENT",
      "text — без непарных суррогатов, base64 — без переводов строк."
    );
  return {
    bytes: bytes.length,
    async *blocks() {
      for (let start = 0; start < bytes.length; start += UPLOAD_BLOCK_BYTES)
        yield bytes.subarray(start, start + UPLOAD_BLOCK_BYTES);
    },
    close: async () => void 0
  };
}
function localPathError(message) {
  return new HcmError(
    "INVALID_ARGUMENT",
    `file: ${message}`,
    "Путь — на компьютере, где работает клиент; у MCP-сервера — там, где он запущен."
  );
}
async function diskSource(path) {
  if (!isAbsolute(path) || path.includes("\0")) throw localPathError("нужен полный путь к файлу.");
  let handle;
  try {
    handle = await open2(path, "r");
  } catch {
    throw localPathError("файл не открывается для чтения.");
  }
  const info = await handle.stat().catch(() => void 0);
  if (!info?.isFile()) {
    await handle.close();
    throw localPathError("по этому пути не файл.");
  }
  const size = info.size;
  return {
    bytes: size,
    // Ровно столько байт, сколько названо в начале записи. Один буфер на все блоки: прошлый блок
    // к этому времени уже отправлен.
    async *blocks() {
      const block = Buffer.allocUnsafe(Math.min(UPLOAD_BLOCK_BYTES, size));
      for (let position = 0; position < size; ) {
        const length = Math.min(block.length, size - position);
        for (let filled = 0; filled < length; ) {
          const { bytesRead } = await handle.read(
            block,
            filled,
            length - filled,
            position + filled
          );
          if (!bytesRead)
            throw new HcmError("INVALID_ARGUMENT", "file: файл стал короче, пока шла запись.");
          filled += bytesRead;
        }
        yield block.subarray(0, length);
        position += length;
      }
    },
    close: () => handle.close()
  };
}
async function collect(body, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.length;
    if (bytes > limit)
      throw new HcmError(
        "FILE_TOO_LARGE",
        `Файл больше предела ответа подключения maxResponseBytes (${limit} байт).`,
        "Файл любого размера сохраняет на диск files.read с file."
      );
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}
function uploadAnswer(response, type) {
  try {
    const { rpc } = strictResponse(response);
    const value = rpc.lexicalValue;
    if (!isType(rpc.valueType, type) || typeof value !== "string" || !(type === "string" ? value : value === "1"))
      throw new Error();
    return value;
  } catch {
    throw new HcmError("FILE_WRITE_RESPONSE", "Сервер ответил на запись файла в неожиданном виде.");
  }
}
function codeDelete(url) {
  return prepareScript(
    `if (IsDirectory(PARAMS.url)) RESULT = ['directory'];
else if (!UrlExists(PARAMS.url)) RESULT = ['absent'];
else { DeleteUrl(PARAMS.url); if (UrlExists(PARAMS.url)) RESULT = ['remains']; else RESULT = ['deleted']; }`,
    { url }
  );
}
function fileRemains() {
  return new HcmError(
    "READ_BACK_MISMATCH",
    "Сервер ответил на удаление без ошибки, но файл или папка по адресу остались.",
    "Адрес нужно проверить через files.exists перед повтором."
  );
}
function codeDeleteRefusal(data2) {
  if (data2.result[0] === "directory")
    return new HcmError("FILE_IS_FOLDER", "Адрес — папка: в папке кода удаляется только файл.");
  if (data2.result[0] === "absent")
    return new HcmError("FILE_NOT_FOUND", "По адресу нет файла.", "Адрес проверяет files.exists.");
  return void 0;
}
function codeList(url, db) {
  return prepareScript(
    `var rows = [];
var item = '';
var folder = false;
var dir = false;
var prefix = PARAMS.url + '/';
var cut = StrOptSubStrPos(prefix, '[');
var provider = undefined;
var urls = undefined;
var name = '';
var slash = undefined;
var seen = {};
try { dir = IsDirectory(PARAMS.url); } catch (e) { dir = false; }
if (PARAMS.db) {
  provider = tools.spxml_unibridge.Object.provider;
  urls = provider.GetUrlsByPattern(cut == undefined ? prefix : StrLeftRange(prefix, cut));
  while (urls.GetNext()) {
    item = urls.GetValue();
    if (!StrBegins(item, prefix, true)) { continue; }
    name = StrRightRangePos(item, StrLen(prefix));
    slash = StrOptSubStrPos(name, '/');
    folder = slash != undefined;
    if (folder) { name = StrLeftRange(name, slash); }
    if ((name == '') || seen.HasProperty('/' + name)) { continue; }
    seen.SetProperty('/' + name, true);
    rows.push({ u: prefix + name, f: folder, b: (folder ? 0 : provider.FetchUrlAttribute(item, 'Length')) });
  }
}
if (dir) { for (item in ReadDirectory(PARAMS.url)) { folder = IsDirectory(item); rows.push({ u: item, f: folder, b: folder ? 0 : UrlFileSize(item) }); } }
RESULT = (dir || (ArrayCount(rows) > 0)) ? rows : ['none'];`,
    { url, db }
  );
}
function fileList(data2, folder2, search = "") {
  if (data2.result[0] === "none")
    throw new HcmError(
      "FOLDER_NOT_FOUND",
      "По адресу нет папки.",
      "Список показывает только папку; файл читает files.read, адрес проверяет files.exists."
    );
  const rows = /* @__PURE__ */ new Map();
  for (const row of data2.result) {
    const name2 = typeof row?.u === "string" && row.u.startsWith(`${folder2}/`) ? row.u.slice(folder2.length + 1).replace(/\/$/, "") : "";
    const bytes = Number(row?.b);
    if (!name2 || /[/\\]/.test(name2) || row.f !== "1" && !Number.isFinite(bytes))
      throw new HcmError("SCRIPT_RESPONSE", "Сервер вернул список папки в неожиданном виде.");
    if (!rows.has(name2)) rows.set(name2, row.f === "1" ? { name: name2, folder: true } : { name: name2, bytes });
  }
  const part = search.toLowerCase();
  const items = [...rows.values()].filter((item) => item.name.toLowerCase().includes(part));
  items.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { items, total: items.length };
}
function parseFileExists(response) {
  try {
    const { rpc, result } = strictResponse(response);
    exactKeys(result, ["@_VALUE-TYPE", "#text"]);
    if (!isType(rpc.valueType, "bool") || !isType(result["@_VALUE-TYPE"], "bool") || result["#text"] !== "0" && result["#text"] !== "1" || rpc.lexicalValue !== result["#text"])
      throw new Error();
    return freezeRegistry({
      exists: result["#text"] === "1"
    });
  } catch {
    throw new HcmError(
      "FILE_EXISTS_RESPONSE",
      "Сервер ответил на проверку файла в неожиданном виде.",
      "Ожидается значение Bool 0 или 1 от функции tools.file_url_exists_server. Её ответ как есть покажет rpc.call."
    );
  }
}
var ServerFiles = class {
  constructor(server, config) {
    this.server = server;
    this.config = config;
  }
  async exists(args) {
    return parseFileExists(
      await this.server.read("native.rpc.call", {
        target: FILE_EXISTS_TARGET,
        args: [rpcArgument(fileExistsUrl(args.url))]
      })
    );
  }
  /** Без file файл собирается в память в пределах maxResponseBytes; с file идёт на диск без предела. */
  async read(args) {
    const url = requiredString(args.url, "url");
    const { encoding, file, overwrite } = args;
    if (file === void 0) {
      if (overwrite === true)
        throw new HcmError("INVALID_ARGUMENT", "overwrite действует только вместе с file.");
      const limit = this.config.maxResponseBytes;
      return fileContent(
        await this.load(url, (body) => collect(body, limit)),
        encoding
      );
    }
    if (encoding !== void 0)
      throw new HcmError(
        "INVALID_ARGUMENT",
        "encoding не нужен вместе с file: файл сохраняется байт в байт."
      );
    const path = requiredString(file, "file");
    if (!isAbsolute(path)) throw localPathError("нужен полный путь к файлу.");
    const bytes = await saveLocalFile(
      path,
      overwrite === true,
      (handle) => this.load(url, (body) => writeFile(handle, body)),
      "file"
    );
    return { bytes, file: resolve3(path) };
  }
  /** Файл сервера потоком байт: read читает тело ответа, пока запрос занимает подключение. */
  load(url, read) {
    return this.server.stream("native.lds.loadUrl", { url, useBinaryResponse: true }, read);
  }
  async list(args, call) {
    const target2 = fileTarget(args.url, true);
    const search = args.search === void 0 ? "" : requiredString(args.search, "search");
    const database2 = (await this.folders())?.database.includes(target2.folder) === true;
    const data2 = await this.server.runCode(
      codeList(target2.url, database2),
      call.outcome,
      (answer) => answer.result[0] === "none"
    );
    return fileList(data2, target2.url, search);
  }
  /**
   * Путь настольной админки, одинаковый для всех папок: начало записи делает файл пустым, блоки
   * ложатся по месту, затем файл читается назад и сверяется по размеру и SHA256.
   */
  async write(args, call) {
    const target2 = fileTarget(args.url);
    assertNotDocument(target2.url, "write");
    const source = await writeSource(args);
    try {
      const kind = folderKind(await this.folders(), target2.folder);
      if (kind !== "data" && !this.config.permissions.execute)
        throw new HcmError(
          "EXECUTE_DISABLED",
          kind === "code" ? `Папка ${target2.folder} — папка кода: файл в ней — код сервера, поэтому запись требует ещё права execute.` : "Сервер не сообщил, какие папки — папки кода, поэтому запись требует ещё права execute.",
          permissionHint(this.config, "execute")
        );
      const upload = (method, ...values) => this.server.call(
        "native.rpc.call",
        { target: `tools.upload_${method}`, args: values.map(rpcArgument) },
        call.outcome
      );
      call.afterSend = WRITE_INTERRUPTED;
      const id = uploadAnswer(await upload("begin", target2.url, source.bytes), "string");
      const sent = createHash2("sha256");
      let bytes = 0;
      for await (const block of source.blocks()) {
        sent.update(block);
        const end = bytes + block.length;
        uploadAnswer(await upload("range", id, bytes, end, block.toString("base64")), "bool");
        bytes = end;
      }
      uploadAnswer(await upload("end", id), "bool");
      call.afterSend = READ_BACK_FAILED;
      const read = await this.readBack(target2.url);
      delete call.afterSend;
      if (read.bytes !== bytes || !read.digest.equals(sent.digest()))
        throw new HcmError(
          "READ_BACK_MISMATCH",
          read.bytes !== bytes ? `Файл на сервере после записи отличается от отправленного: ${read.bytes} байт вместо ${bytes}.` : "Файл на сервере после записи того же размера, что отправленный, но с другим содержимым.",
          WRITE_MISMATCH_HINT
        );
      return { bytes, mutationOutcome: "confirmed" };
    } finally {
      await source.close();
    }
  }
  /** Размер и SHA256 файла на сервере: файл читается потоком и в памяти не собирается. */
  readBack(url) {
    return this.load(url, async (body) => {
      const hash = createHash2("sha256");
      let bytes = 0;
      for await (const chunk of body) {
        hash.update(chunk);
        bytes += chunk.length;
      }
      return { bytes, digest: hash.digest() };
    });
  }
  async delete(args, call) {
    const target2 = fileTarget(args.url);
    assertNotDocument(target2.url, "delete");
    const folders = await this.folders();
    if (folderKind(folders, target2.folder) === "code") {
      if (!this.config.permissions.execute)
        throw new HcmError(
          "EXECUTE_DISABLED",
          `Папка ${target2.folder} на этом сервере принимает удаление только кодом на сервере: нужно ещё право execute.`,
          permissionHint(this.config, "execute")
        );
      const data2 = await this.server.runCode(
        codeDelete(target2.url),
        call.outcome,
        (answer) => !!codeDeleteRefusal(answer)
      );
      const refusal = codeDeleteRefusal(data2);
      if (refusal) throw refusal;
      if (data2.result[0] === "remains") throw fileRemains();
      return { deleted: true, mutationOutcome: "confirmed" };
    }
    const database2 = folders?.database.includes(target2.folder) === true;
    const checkable = target2.url.length <= FILE_EXISTS_URL_MAX_LENGTH;
    if (database2 && !checkable)
      throw new HcmError(
        "INVALID_ARGUMENT",
        `url: в папке ${target2.folder} адрес для удаления — не длиннее 256 знаков.`,
        "Удаление в папке, которую сервер хранит в базе данных, проверяется по адресу, а проверка принимает до 256 знаков."
      );
    const present = async () => (await this.exists({ url: target2.url })).exists;
    if (checkable && !await present())
      throw new HcmError(
        "FILE_NOT_FOUND",
        database2 ? "По адресу нет файла." : "По адресу нет файла или папки.",
        database2 ? `Папку ${target2.folder} сервер хранит в базе данных: вложенных папок в ней нет, файлы удаляются по одному. Список показывает files.list.` : "Адрес проверяет files.exists."
      );
    await this.server.call("native.lds.deleteUrl", { url: target2.url }, call.outcome);
    if (checkable && await present())
      throw database2 ? new HcmError(
        "FILE_NOT_DELETABLE",
        "Файл или папка остались на диске сервера: с диска сервер по адресу ничего не удаляет.",
        `Папку ${target2.folder} сервер хранит в базе данных и по адресу удаляет только то, что лежит в базе. Если у файла была копия в базе, теперь сервер отдаёт файл с диска: содержимое могло стать прежним, проверить через files.read. С диска файлы и папки удаляют на самом сервере.`
      ) : fileRemains();
    return { deleted: true, mutationOutcome: "confirmed" };
  }
  /** Сбой чтения сведений о приложении означает, что сервер не дал списков папок. */
  async folders() {
    return fileFolders(await this.server.applicationInfo().catch(() => void 0));
  }
};

// src/operations/files.ts
var fileOperations = [
  operation({
    id: "files.exists",
    effect: "read",
    description: "Есть ли файл или папка по адресу x-local://…. Ответ ничего не говорит о содержимом, размере и правах на чтение. Адрес — до 256 знаков.",
    inputSchema: schema(
      {
        url: {
          type: "string",
          minLength: 1,
          maxLength: FILE_EXISTS_URL_MAX_LENGTH,
          pattern: "^x-local://"
        }
      },
      ["url"]
    ),
    summary: "Есть ли файл или папка по адресу.",
    run: (context, args) => context.files.exists(args)
  }),
  operation({
    id: "files.read",
    effect: "read",
    writesLocalDisk: (args, inBatch) => {
      if (inBatch && isStepReference(args)) return true;
      if (args === null || typeof args !== "object" || Array.isArray(args)) return false;
      if (!Object.hasOwn(args, "file")) return false;
      const file = args.file;
      return typeof file === "string" || inBatch && isStepReference(file);
    },
    description: 'Прочитать файл по адресу сервера: text, если содержимое — текст в UTF-8, иначе base64. encoding:"base64" отдаёт base64 и для текста. file — полный путь на этом компьютере: файл любого размера сохраняется туда байт в байт (право write сервера не нужно; в MCP вызывается через hcm_api_write), overwrite заменяет существующий. Документы объектов читает objects.get.',
    inputSchema: schema(
      {
        url: string,
        encoding: { type: "string", enum: ["base64"] },
        file: string,
        overwrite: boolean
      },
      ["url"]
    ),
    summary: "Прочитать файл: текст в UTF-8 или base64; с file — сохранить на этот компьютер.",
    usualCause: "по этому адресу ничего нет",
    // Содержимое сохраняется всегда: results.export пишет его в файл. Ответ о файле на диске — нет.
    reply: { store: (data2) => data2.file === void 0 },
    run: (context, args) => context.files.read(args)
  }),
  operation({
    id: "files.list",
    effect: "execute",
    description: "Один уровень папки x-local://папка или x-local://папка/путь: items — файлы с размером (bytes) и вложенные папки (folder:true), по имени. search оставляет имена с этой частью, регистр не важен. Список даёт код на сервере: нужно право execute.",
    inputSchema: schema({ url: string, search: string }, ["url"]),
    summary: "Показать один уровень папки: файлы с размером и вложенные папки.",
    run: (context, args, call) => context.files.list(args, call)
  }),
  operation({
    id: "files.write",
    effect: "write",
    description: "Записать файл любого размера по адресу x-local://…: text — текст (пишется в UTF-8), base64 — двоичные данные, file — полный путь к файлу на этом компьютере, без передачи данных в вызове. Файл заменяется целиком, вложенные папки сервер создаёт сам. confirmed — файл прочитан назад и совпал с отправленным. Папке кода (wt, wtv, custom…) нужно ещё право execute: файл в ней — код сервера. Какие папки принимают запись, показывает server.info.",
    inputSchema: schema({ url: string, text: string, base64: string, file: string }, ["url"]),
    summary: "Записать файл: text, base64 или file с этого компьютера; после записи файл сверяется.",
    run: (context, args, call) => context.files.write(args, call)
  }),
  operation({
    id: "files.delete",
    effect: "write",
    description: "Удалить файл по адресу x-local://…. В папке данных так же удаляется пустая папка; в папке кода — только файл, и нужно ещё право execute.",
    inputSchema: schema({ url: string }, ["url"]),
    summary: "Удалить файл (в папке данных — и пустую папку).",
    usualCause: "в папке есть файлы; если сервер не сообщил, какие папки принимают запись, это может быть папка кода, где файл удаляет код на сервере",
    run: (context, args, call) => context.files.delete(args, call)
  })
];

// src/log-output.ts
function summary(file) {
  return {
    name: file.name,
    type: file.type,
    sizeBytes: Number(file.sizeBytes),
    ...file.dateHint === void 0 ? {} : { date: file.dateHint }
  };
}
function logEntry(event) {
  return {
    sequence: event.sequence,
    ...event.time === void 0 ? {} : { time: event.time },
    ...event.context === void 0 ? {} : { context: event.context },
    level: event.level,
    text: [event.message, ...event.text.split("\n").slice(1)].join("\n"),
    ...event.partialBeginning ? { partialBeginning: true } : {}
  };
}
function logFiles(data2) {
  return {
    files: data2.files.map(summary),
    total: data2.total,
    ...data2.nextOffset === void 0 ? {} : { nextOffset: data2.nextOffset }
  };
}
function logText(data2) {
  return {
    file: data2.file.name,
    text: data2.text,
    sizeBytes: Number(data2.sizeBytesAfter),
    tailOnly: data2.truncated,
    fingerprint: data2.fingerprint
  };
}
function fitting(entries, budgetBytes, fromEnd) {
  let bytes = 0;
  let count = 0;
  for (let index = 0; index < entries.length; index++) {
    const item = entries[fromEnd ? entries.length - 1 - index : index];
    bytes += Buffer.byteLength(JSON.stringify(item)) + 1;
    if (bytes > budgetBytes && count > 0) break;
    count++;
  }
  return count;
}
function logMatches(data2, budgetBytes) {
  const events = data2.events.map(logEntry);
  const kept = fitting(events, budgetBytes, false);
  const offset = (data2.nextOffset ?? data2.matches) - events.length;
  const nextOffset = kept < events.length ? offset + kept : data2.nextOffset;
  return {
    file: data2.file.name,
    events: events.slice(0, kept),
    totalEvents: data2.totalEvents,
    matches: data2.matches,
    fingerprint: data2.fingerprint,
    tailOnly: data2.truncated,
    ...nextOffset === void 0 ? {} : { nextOffset },
    ...kept < events.length ? { cutBySize: true } : {}
  };
}
function logNews(data2, first, budgetBytes) {
  const all = data2.events.map(logEntry);
  const recent = first ? all.slice(-10) : all;
  const events = recent.slice(recent.length - fitting(recent, budgetBytes, true));
  const omitted = first ? 0 : all.length - events.length;
  return {
    file: data2.file.name,
    events,
    ...omitted ? { omitted } : {},
    cursor: data2.cursor,
    changed: data2.changed,
    gapPossible: data2.gapPossible,
    windowTruncated: data2.windowTruncated,
    ...data2.resetReason === void 0 ? {} : { resetReason: data2.resetReason }
  };
}

// src/operations/logs.ts
var logWindow = { file: string, full: boolean, tailBytes: integer };
var logOperations = [
  operation({
    id: "logs.list",
    effect: "read",
    description: "Логи сервера, сначала свежие. type — имя лога без даты (xhttp, agent…); nameContains, startDate и endDate отбирают по имени и дате сервера. По умолчанию 30 файлов.",
    inputSchema: schema({
      type: string,
      nameContains: string,
      startDate: string,
      endDate: string,
      offset: integer,
      limit: integer
    }),
    run: async (context, args) => logFiles(await context.logs.list(args))
  }),
  operation({
    id: "logs.read",
    effect: "read",
    description: "Текст лога: конец файла (tailBytes) или весь файл (full:true). Пока сервер пишет в файл, он может его не отдать: чтение повторяется один раз, затем ошибка LOG_READ_UNAVAILABLE.",
    inputSchema: schema(logWindow, ["file"]),
    reply: { store: "always" },
    run: async (context, args) => {
      const input = args.tailBytes === void 0 && args.full !== true ? { ...args, tailBytes: context.pageBytes } : args;
      return logText(await context.logs.read(input));
    }
  }),
  operation({
    id: "logs.search",
    effect: "read",
    description: "События лога по тексту, уровню или потоку в прочитанной части файла. Многострочное событие возвращается целиком. Уровень определяется по словам в тексте, время — местное время сервера. newestFirst:true отдаёт сначала последние события. cutBySize:true — событий на странице меньше limit, потому что больше не поместилось в ответ; дальше — nextOffset. expectedFingerprint из прошлого ответа защищает следующую страницу от изменившегося файла.",
    inputSchema: schema(
      {
        ...logWindow,
        text: string,
        level: {
          type: "string",
          enum: ["normal", "debug", "info", "warning", "error", "critical"]
        },
        context: string,
        offset: integer,
        limit: integer,
        newestFirst: boolean,
        expectedFingerprint: string
      },
      ["file"]
    ),
    run: async (context, args) => logMatches(await context.logs.search(args), context.pageBytes)
  }),
  operation({
    id: "logs.follow",
    effect: "read",
    description: "Новые события лога с прошлого вызова по cursor. Последнее событие может повториться; gapPossible:true — часть событий могла быть пропущена. После ошибки чтения использовать прежний cursor; другой файл начинать без cursor.",
    inputSchema: schema({ ...logWindow, cursor: string }, ["file"]),
    run: async (context, args) => logNews(
      await context.logs.follow(args),
      args.cursor === void 0,
      context.pageBytes
    )
  })
];

// src/operations/objects.ts
var patchEffect = (args) => args.preview === true ? "read" : void 0;
var dbName = { type: "string", description: "База сервера, если объект не в основной базе." };
var target = { id: string, type: string, url: string, dbName };
var objectOperations = [
  operation({
    id: "objects.get",
    effect: "read",
    description: "Прочитать документ объекта по id или url; несколько объектов — ids (до 100), ответ — items, у непрочитанного в элементе error. fields — поля верхнего уровня. Повторяющийся элемент приходит списком и при одном значении. Из запрошенных полей: emptyFields — без значения (в data.data не попадают), fromCatalog — вычисляемые поля строки каталога, unknownFields — которых у типа нет.",
    inputSchema: schema({
      ...target,
      fields,
      ids: { type: "array", items: string, minItems: 1, maxItems: 100 }
    }),
    usualCause: "объекта с таким ID или адресом нет; ID строки каталога без своего типа объекта — не ID документа",
    run: async (context, args) => {
      if (args.ids === void 0) return context.objects.get(args);
      const ids = args.ids;
      if (args.id !== void 0 || args.url !== void 0)
        throw new HcmError("INVALID_ARGUMENT", "ids: вместе с id или url не задаётся.");
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some((id) => typeof id !== "string"))
        throw new HcmError("INVALID_ARGUMENT", "ids: список от 1 до 100 ID, каждый строкой.");
      const checkedType = args.type === void 0 ? void 0 : identifier(args.type, "type");
      const checkedDb = args.dbName === void 0 ? void 0 : validateDbName(requiredString(args.dbName, "dbName"), "dbName");
      const items = [];
      let failed = 0;
      for (const id of ids) {
        try {
          items.push(
            await context.objects.get({
              ...checkedType === void 0 ? {} : { type: checkedType },
              fields: args.fields,
              ...checkedDb === void 0 ? {} : { dbName: checkedDb },
              id
            })
          );
        } catch (error) {
          const refusal = context.pipeline.failure("objects.get", error).error;
          if (/^PLATFORM_(?!SOAP-FAULT)/.test(refusal.code)) throw error;
          failed++;
          items.push({ id, error: { code: refusal.code, message: refusal.message } });
        }
      }
      return {
        items,
        total: items.length,
        ...failed ? { failed, hint: "PLATFORM_SOAP-FAULT у элемента: обычно объекта с таким ID нет." } : {}
      };
    }
  }),
  operation({
    id: "objects.create",
    effect: "write",
    description: "Создать объект типа type с полями data. ID выдаёт сервер; после записи объект перечитывается и сверяется с запросом. Обработчики, которые админка выполняет при создании, не запускаются.",
    inputSchema: schema({ type: string, data: object, dbName, formUrl: string }, ["type", "data"]),
    usualCause: "значение, которое тип объекта не принимает",
    run: (context, args, call) => context.objects.create(args, call.outcome)
  }),
  operation({
    id: "objects.patch",
    effect: "write",
    effectFor: patchEffect,
    description: "Изменить поля объекта, сохранив остальное содержимое документа. patch — {путь: значение} или список {op:'set'|'remove', path, value}; remove — пути, которые удалить; путь, которого в документе нет, — отказ, ничего не записано. preview:true ничего не записывает. Правка, которая ничего не меняет, не записывается: в ответе noop:true; resave:true записывает документ и без правок — сервер при сохранении заново заполняет поля, которые берёт из связанных объектов. expectedFingerprint отклоняет запись, если объект изменился после чтения; это сверка перед записью, а не блокировка.",
    inputSchema: schema({
      ...target,
      patch: {},
      remove: { type: "array", items: string },
      expectedFingerprint: string,
      preview: boolean,
      resave: boolean
    }),
    usualCause: "объекта с таким ID или адресом нет",
    run: (context, args, call) => context.objects.patch(args, call.outcome)
  }),
  operation({
    id: "objects.delete",
    effect: "write",
    description: 'Удалить документ объекта безвозвратно; permanent:true обязателен. Если у типа один каталог, клиент сам проверяет наличие и исчезновение в нём (иначе verification:"server"); catalog задаёт каталог явно.',
    inputSchema: schema({ ...target, permanent: boolean, catalog: string }),
    usualCause: "объекта с таким ID или адресом нет",
    run: (context, args, call) => context.objects.delete(args, call.outcome)
  })
];

// src/operations/query.ts
var queryEffect = (args) => isStepReference(args) || args.query !== void 0 ? "execute" : "read";
async function fieldTypes(catalogShape, catalog, where) {
  if (typeof catalog !== "string" || !where || typeof where !== "object") return void 0;
  const values = Object.values(where).flatMap(
    (condition) => condition && typeof condition === "object" ? Object.values(condition).flat() : [condition]
  );
  if (!values.some((value) => looksLikeDate(value) || looksLikeReal(value) || looksLikeHexId(value)))
    return void 0;
  const shape = await catalogShape();
  return shape?.types.size ? shape.types : void 0;
}
var queryOperations = [
  operation({
    id: "runtime.query",
    effect: "unknown",
    effectFor: queryEffect,
    description: "Поиск в каталоге: {catalog, where, fields, order}, условия соединяются через «и»; order — поле или список полей каталога, по убыванию — «поле desc». Или запрос XQuery целиком: {query}; он требует права execute и возвращает строки каталога целиком (например return $e). Ответ: items, total; nextStartPosition есть, пока строки не кончились. Запрос, который возвращает отдельные значения, выполняет native.lds.xQuery.",
    inputSchema: schema({
      query: string,
      catalog: string,
      where: object,
      order: { anyOf: [string, { type: "array", items: string }] },
      fields,
      limit: { type: "integer", minimum: 1, maximum: 1e3 },
      startPosition: { type: "integer", minimum: 0, maximum: 1e6 }
    }),
    usualCause: "нет такого каталога или поля, ошибка в запросе XQuery",
    run: async (context, args, call) => {
      if (args.query !== void 0 && args.catalog !== void 0)
        throw new HcmError("QUERY_ARGUMENT", "Нужно указать query или catalog, но не оба.");
      if (args.query !== void 0 && args.order !== void 0)
        throw new HcmError(
          "QUERY_ARGUMENT",
          "order работает с catalog.",
          "В тексте XQuery сортировку пишут сами: order by $e/поле."
        );
      if (typeof args.catalog === "string" && /^[A-Za-z_]\w*\.[\w.]+$/.test(args.catalog))
        throw new HcmError(
          "UNKNOWN_CATALOG",
          `${args.catalog} — общий список сервера, а не каталог.`,
          `Его элементы читает запрос XQuery: for $e in ${args.catalog} return $e.`
        );
      let reading;
      const catalogShape = () => reading ??= context.schema.catalogShape({ catalog: requiredString(args.catalog, "catalog") }).catch(() => void 0);
      const query = args.query === void 0 ? catalogQuery(
        args.catalog,
        args.where,
        args.order,
        await fieldTypes(catalogShape, args.catalog, args.where)
      ) : requiredString(args.query, "query");
      if (args.query === void 0 && args.order !== void 0) {
        const shape2 = await catalogShape();
        const repeated = orderFields(args.order).map((item) => item.field).filter((field) => shape2?.repeated.has(field));
        if (repeated.length)
          throw new HcmError(
            "INVALID_ARGUMENT",
            `order: поле хранит несколько значений, сортировать по нему нельзя: ${repeated.join(", ")}.`,
            "Нужно выбрать поле с одним значением: у такого в schema.get нет multiple:true.",
            { fields: repeated }
          );
      }
      const limit = boundedInteger(args.limit, 20, 1e3, "limit");
      if (limit === 0)
        throw new HcmError("INVALID_ARGUMENT", "limit: нужно целое число от 1 до 1000.");
      const startPos = boundedInteger(args.startPosition, 0, 1e6, "startPosition");
      const sql = args.query !== void 0 && /^\s*sql\s*:/i.test(query);
      if (args.query !== void 0 && !sql) call.effect = "read";
      let response;
      try {
        const request = {
          query,
          startPos,
          maxCount: limit,
          expectToReadAll: false
        };
        response = await (sql ? context.server.call("native.lds.xQuery", request, call.outcome) : context.server.read("native.lds.xQuery", request));
      } catch (error) {
        const refused = error instanceof WsHcmApiError && error.kind === "soap-fault";
        let reason;
        if (refused) context.logs.serverWroteLog();
        if (refused)
          for (const [catalog, fields3] of args.query === void 0 ? [
            [
              requiredString(args.catalog, "catalog"),
              [
                ...Object.keys(inputObject(args.where ?? {}, "where")),
                ...orderFields(args.order).map((item) => item.field)
              ]
            ]
          ] : xqueryNames(query)) {
            reason = await context.schema.explainQuery(catalog, fields3).catch(() => void 0);
            if (reason) break;
          }
        throw reason ?? error;
      }
      const read = queryPage(response, startPos, limit, args.fields, args.query !== void 0);
      const page = { ...read, items: read.items.map(withoutFalseOffset) };
      if (!page.items.length && args.query === void 0) {
        const missing = await context.schema.explainQuery(requiredString(args.catalog, "catalog"), []).catch(() => void 0);
        if (missing) throw missing;
      }
      const requested = Array.isArray(args.fields) ? args.fields : [];
      const absent = page.items.length ? requested.filter((field) => page.items.every((item) => !Object.hasOwn(item, field))) : args.query === void 0 ? requested : [];
      const lacking = page.items.some(
        (item) => requested.some((field) => !Object.hasOwn(item, field))
      );
      if (!absent.length && !lacking && !page.items.some(hasStructure)) return page;
      const shape = args.query === void 0 ? await catalogShape() : await context.schema.catalogShape({ type: rowTag(response) ?? "" }).catch(() => void 0);
      if (!shape) return page;
      const unknownFields = shape.fields.size ? absent.filter((field) => !shape.fields.has(field)) : [];
      const asked = requested.filter(
        (field) => shape.fields.has(field) && ![...shape.repeated].some((path) => path.startsWith(`${field}.`))
      );
      return {
        ...page,
        items: page.items.map((item) => {
          const row = withRepeated(item, shape.repeated);
          for (const field of asked)
            if (!Object.hasOwn(row, field)) row[field] = shape.repeated.has(field) ? [] : "";
          return projectFields(row, args.fields);
        }),
        ...unknownFields.length ? {
          unknownFields,
          hint: [
            page.hint,
            "Полей из unknownFields нет в строке каталога. Поле документа читает objects.get."
          ].filter(Boolean).join(" ")
        } : {}
      };
    }
  })
];

// src/operations/results.ts
var resultOperations = [
  operation({
    id: "results.export",
    effect: "read",
    writesLocalDisk: true,
    description: "Сохранить большой результат целиком в файл на этом компьютере: json — как есть, jsonl — по строке на элемент списка ответа, text — текст лога или файла. Папка должна существовать. Право write сервера не нужно (в MCP — hcm_result_export или hcm_api_write).",
    inputSchema: schema(
      {
        resultId: string,
        path: string,
        format: { type: "string", enum: ["json", "jsonl", "text"] },
        overwrite: boolean
      },
      ["resultId", "path"]
    ),
    run: (context, args) => context.results.export(args)
  }),
  operation({
    id: "results.read",
    effect: "read",
    description: "Дочитать сохранённый результат по resultId: список — по элементам, текст лога или файла — по символам. format:json читает любой результат как текст JSON по частям.",
    inputSchema: schema(
      {
        resultId: string,
        offset: integer,
        limit: integer,
        format: { type: "string", enum: ["auto", "json", "text"] }
      },
      ["resultId"]
    ),
    reply: { store: "never" },
    run: (context, args) => context.results.read(
      requiredString(args.resultId, "resultId"),
      args.offset,
      args.limit,
      args.format
    )
  })
];

// src/operations/rpc.ts
var rpcOperations = [
  operation({
    id: "rpc.call",
    effect: "execute",
    description: "Вызвать функцию библиотеки сервера: {library, method, arguments:[…]}. Строки, целые, логические значения и null передаются как есть; дата, объект, XML и большое целое — как {valueType, lexicalValue}. async:true запускает фоновой задачей.",
    inputSchema: schema(
      { library: string, method: string, arguments: { type: "array" }, async: boolean },
      ["library", "method"]
    ),
    summary: "Вызвать функцию: {library, method, arguments:[…]}; async:true запускает фоновой задачей.",
    usualCause: "нет такой функции, неверные аргументы или ошибка внутри функции",
    run: async (context, args, call) => {
      const target2 = `${identifier(args.library, "library")}.${identifier(args.method, "method")}`;
      const supplied = args.arguments ?? [];
      if (!Array.isArray(supplied))
        throw new HcmError("INVALID_ARGUMENT", "arguments: нужен массив.");
      const encoded = supplied.map(
        (value) => value !== null && typeof value === "object" ? inputObject(value, "аргумент функции") : rpcArgument(value)
      );
      const operationId = args.async === true ? "web.spxml.callMethodAsync" : "native.rpc.call";
      const nativeArgs = { target: target2, args: encoded };
      try {
        prepare(nativeArgs, context.pipeline.describe(operationId).inputSchema);
      } catch (error) {
        const index = error instanceof ArgumentError && /^args\.args\[(\d+)\]/.exec(error.message);
        if (!index) throw error;
        throw new HcmError(
          "INVALID_RPC_ARGUMENT",
          `arguments[${index[1]}]: объект должен быть вида {valueType, lexicalValue}.`,
          "Строки, целые числа, true, false и null передаются как есть. Остальное — явно: {valueType:'date', lexicalValue:'2026-10-01T00:00:00'}, {valueType:'integer', lexicalValue:'6148914691236517121'}, {valueType:'real', lexicalValue:'1.5'}."
        );
      }
      for (const argument of encoded)
        if (typeof argument.lexicalValue === "string") escapeXml(argument.lexicalValue);
      let response;
      try {
        response = await context.server.call(operationId, nativeArgs, call.outcome);
      } catch (error) {
        if (error instanceof WsHcmApiError && error.status === 500) {
          context.logs.serverWroteLog();
          const reason = await context.rpcCatalog.refusal(target2).catch(() => void 0);
          if (reason) throw reason;
        }
        throw error;
      }
      return args.async === true ? withoutXmlFormatting(response) : rpcValue(response);
    }
  }),
  operation({
    id: "rpc.list",
    effect: "read",
    description: "Найти функции библиотек сервера: query, library, method. Без all — только те, что можно вызвать с клиента (rpc.call); all:true добавляет функции, которые вызываются только из кода на сервере (serverOnly:true). Список не говорит о типах аргументов и о том, меняет ли функция данные.",
    inputSchema: schema({
      query: { type: "string", maxLength: 512 },
      library: { type: "string", maxLength: 128, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
      method: { type: "string", maxLength: 128, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
      all: boolean,
      cursor: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      limit: { type: "integer", minimum: 1, maximum: 100 }
    }),
    summary: "Найти функции, разрешённые для вызова с клиента: query, library, method; all:true — вместе с функциями только для кода на сервере.",
    run: (context, args) => context.rpcCatalog.list(args, context.pageBytes)
  }),
  operation({
    id: "rpc.describe",
    effect: "read",
    description: "Параметры функции по targetId «библиотека.функция»; source:true добавляет до 8 КБ её кода. serverOnly:true в ответе — функция вызывается только из кода на сервере. Сама функция не вызывается.",
    inputSchema: schema(
      {
        targetId: {
          type: "string",
          maxLength: 257,
          pattern: "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$"
        },
        source: boolean
      },
      ["targetId"]
    ),
    summary: "Параметры функции по targetId «библиотека.функция»; source:true добавляет код. Знает и функции, которые вызываются только из кода на сервере.",
    run: (context, args) => context.rpcCatalog.describe(requiredString(args.targetId, "targetId"), args)
  })
];

// src/operations/schema.ts
var schemaPage = { search: string, limit: { type: "integer", minimum: 1 }, cursor: integer };
var schemaOperations = [
  operation({
    id: "schema.get",
    effect: "read",
    description: "Поля типа объекта: свои, унаследованные, настраиваемые и поля каталога, с заголовками на языке сервера. deep:true — вложенные поля любой глубины сразу, а не один уровень. Ответ постраничный.",
    inputSchema: schema({
      ...schemaPage,
      type: string,
      url: string,
      path: string,
      deep: boolean,
      origin: {
        type: "array",
        items: { type: "string", enum: ["own", "inherited", "custom", "catalog"] }
      },
      kind: string,
      include: { type: "array", items: { type: "string", enum: ["methods"] } },
      language: string
    }),
    usualCause: "формы по этому адресу нет",
    run: (context, args) => context.schema.get(args, context.pageBytes)
  }),
  operation({
    id: "schema.types",
    effect: "read",
    description: "Типы объектов сервера: тип, каталог, заголовок, число настраиваемых полей. Каталога у типа может не быть. За типами — каталоги без своего типа объекта: строка без type, документов у их строк нет.",
    inputSchema: schema(schemaPage),
    run: (context, args) => context.schema.types(args)
  })
];

// src/operations/scripts.ts
var scriptOperations = [
  operation({
    id: "execute.script",
    effect: "execute",
    description: "Выполнить код SP-XML Script на сервере. Код присваивает массив переменной RESULT; числа и логические значения приходят строками, дату нужно приводить к строке в коде (StrDate, StrXmlDate): на части версий сервера сама дата в ответ не попадает. params — объект JSON, в коде это готовая переменная PARAMS. На сервер ничего не устанавливается. Код может менять данные, отката нет.",
    inputSchema: schema(
      {
        code: { type: "string", minLength: 1 },
        params: { type: "object" }
      },
      ["code"]
    ),
    run: (context, args, call) => context.server.runCode(prepareScript(args.code, args.params), call.outcome)
  }),
  operation({
    id: "agents.run",
    effect: "execute",
    description: "Запустить агента сервера и дождаться конца его кода. Ответ: started, startedAt и finishedAt — местное время сервера. Ошибку в коде агента ответ не показывает: она в логе xhttp между этими отметками. Дата последнего запуска сохраняется в агенте, как при запуске из админки.",
    inputSchema: schema(
      {
        id: { type: "string", description: "ID агента (server_agent)." },
        objectId: { type: "string", description: "ID объекта: в коде агента это OBJECT_ID." },
        objectIds: {
          type: "array",
          items: string,
          maxItems: 1e3,
          description: "ID нескольких объектов: в коде агента это OBJECTS_ID_STR, через «;»."
        }
      },
      ["id"]
    ),
    summary: "Запустить агента по ID и дождаться конца: {id}; objectId и objectIds — объекты, над которыми он работает.",
    details: "Вызов ждёт, пока код агента не кончится, и ограничен временем ожидания подключения (timeoutMs): долгого агента нужно запускать без ожидания — rpc.call {library:'tools', method:'start_agent', arguments:[id]} — и следить за логом agent. Параметры агента берутся из его документа. Агенты на C# и агенты выгрузки и импорта не проверялись.",
    run: async (context, args, call) => {
      const agent = agentRun(args);
      const data2 = await context.server.runCode(
        prepareScript(agent.code, agent.params),
        call.outcome
      );
      context.logs.serverWroteLog();
      return agentRunResult(data2);
    }
  })
];

// src/operations.ts
var composite = [
  ...fileOperations,
  ...connectionOperations,
  ...queryOperations,
  ...objectOperations,
  ...schemaOperations,
  ...logOperations,
  ...resultOperations,
  ...rpcOperations,
  ...scriptOperations,
  ...batchOperations
];
var specs = [...composite, ...nativeOperations].map(
  (spec) => Object.freeze(spec)
);
var operations = freezeRegistry(specs.map(definitionOf));
var byId = new Map(operations.map((operation2) => [operation2.id, operation2]));
if (byId.size !== operations.length) throw new Error("ID операции runtime повторяется");
var specById = new Map(specs.map((spec) => [spec.id, spec]));
function operationSpec(id) {
  return specById.get(id);
}
function operationDefinition(id) {
  return byId.get(id);
}
function operationWritesLocalDisk(id, args, inBatch = false) {
  const rule = specById.get(id)?.writesLocalDisk;
  if (rule === void 0) return false;
  if (rule === true) return true;
  return rule(
    args,
    inBatch,
    (stepId, stepArgs) => operationWritesLocalDisk(stepId, stepArgs, true)
  );
}
function operationSearchRank(operation2, query) {
  const id = operation2.id.toLowerCase();
  if (id === query) return 5;
  if (id.split(".").includes(query)) return 4;
  if (id.includes(query)) return 3;
  const text3 = `${operation2.title} ${operation2.description}`.toLowerCase();
  if (!text3.includes(query)) return 0;
  return text3.split(/[^\p{L}\p{N}_]+/u).includes(query) ? 2 : 1;
}

// src/operation-map.ts
var PROTOCOL = "protocol";
var TOPICS = [
  {
    id: "functions",
    title: "Функции библиотек сервера: найти, посмотреть параметры и код, вызвать",
    operations: ["rpc.list", "rpc.describe", "rpc.call"]
  },
  {
    id: "tasks",
    title: "Фоновые задачи: запустить, узнать состояние, остановить",
    operations: [
      "web.spxml.callMethodAsync",
      "web.spxml.getAsyncMethodStatus",
      "web.spxml.getBackgroundTasksByName",
      "web.spxml.killAsyncMethod"
    ]
  },
  {
    id: "agents",
    title: "Агенты сервера: запустить и дождаться конца",
    operations: ["agents.run"]
  },
  {
    id: "files",
    title: "Файлы сервера по адресу x-local://…: проверить, прочитать, показать папку, записать, удалить, загрузить",
    operations: [
      "files.exists",
      "files.read",
      "files.list",
      "files.write",
      "files.delete",
      "web.pages.uploadFile",
      "web.pages.uploadChunk",
      "web.pages.clearUploadChunks"
    ]
  },
  {
    id: "documents",
    title: "Документ объекта как XML: чтение, сохранение, удаление",
    operations: [
      "native.lds.loadDoc",
      "native.lds.putDoc",
      "native.lds.deleteDoc",
      "native.lds.getNewObjectId",
      "native.physicalDocuments.createFromXml"
    ]
  },
  {
    id: "server",
    title: "Сведения о сервере и проверка служб",
    operations: [
      "server.info",
      "native.spxml2.getAppInfo",
      "anonymous.diagnostics.portal",
      "anonymous.diagnostics.xhttpInfo",
      "web.websocket.heartbeat"
    ]
  },
  {
    id: "forms",
    title: "Формы, тексты интерфейса и картинки",
    operations: [
      "native.spxml2.getForm",
      "web.pages.getScreenForm",
      "web.pages.getUiText",
      "native.resources.getImage",
      "native.resources.getCompoundResource"
    ]
  },
  {
    id: "basic",
    title: "Основные операции: по ID нужны в runtime.batch (несколько операций одним вызовом); у остальных есть свои команды и инструменты",
    operations: [],
    prefixes: ["runtime.", "objects.", "schema.", "logs.", "results.", "execute."]
  },
  {
    id: PROTOCOL,
    title: "Прямые вызовы протокола: сырой XQuery и RPC, открытие и закрытие сессий. Обычно не нужны",
    operations: []
  }
];
var topicOfOperation = /* @__PURE__ */ new Map();
for (const operation2 of operations) {
  const topic = TOPICS.find((item) => item.operations.includes(operation2.id)) ?? TOPICS.find((item) => item.prefixes?.some((prefix) => operation2.id.startsWith(prefix))) ?? TOPICS.find((item) => item.id === PROTOCOL);
  topicOfOperation.set(operation2.id, topic);
  const listed = topic.operations.includes(operation2.id);
  if (listed !== Boolean(operationSpec(operation2.id)?.summary))
    throw new Error(
      `${listed ? "Операция темы без summary" : "Операция с summary не названа в теме"}: ${operation2.id}`
    );
}
for (const topic of TOPICS)
  for (const id of topic.operations)
    if (topicOfOperation.get(id) !== topic) throw new Error(`Неизвестная операция в теме: ${id}`);
function operationMap() {
  return {
    topics: TOPICS.map((topic) => ({
      topic: topic.id,
      title: topic.title,
      ...topic.operations.length ? { operations: [...topic.operations] } : { count: operations.filter((item) => topicOfOperation.get(item.id) === topic).length }
    })),
    total: operations.length,
    effects: Object.fromEntries(
      ["read", "write", "execute", "unknown"].map((effect) => [effect, operations.filter((item) => item.effect === effect).length]).filter(([, count]) => count)
    ),
    hint: 'Операции темы с описаниями: api.list с topic; операции одного эффекта: query "read", "write", "execute" или "unknown" (в CLI также --effect). Эффект — требуемое право (unknown зависит от аргументов: запрос, пакет). Аргументы и ограничения одной операции: api.describe по её id.'
  };
}
function operationTopic(id) {
  return topicOfOperation.get(id)?.id ?? PROTOCOL;
}
function operationOrder(id) {
  const position = (topicOfOperation.get(id)?.operations ?? []).indexOf(id);
  return position < 0 ? Number.MAX_SAFE_INTEGER : position;
}
function operationSummary(id) {
  return operationSpec(id)?.summary;
}
function operationNotes(id) {
  return operationSpec(id)?.details;
}
function requireTopic(id) {
  if (TOPICS.some((topic) => topic.id === id)) return id;
  throw new HcmError(
    "UNKNOWN_TOPIC",
    "Такой темы нет.",
    `Темы: ${TOPICS.map((topic) => topic.id).join(", ")}.`
  );
}
function overviewMatches(id, query) {
  const topic = topicOfOperation.get(id);
  return `${topic?.title} ${operationSummary(id) ?? ""}`.toLowerCase().includes(query);
}

// src/catalog.ts
function listHcmOperations(filter = {}) {
  const asked = filter.query?.toLowerCase().trim();
  const effect = filter.effect ?? ["read", "write", "execute", "unknown"].find((name2) => name2 === asked);
  const query = effect && effect === asked ? void 0 : asked;
  const topic = filter.topic === void 0 ? void 0 : requireTopic(filter.topic);
  const selected = operations.filter(
    (operation2) => (!topic || operationTopic(operation2.id) === topic) && (!filter.group || operation2.group === filter.group) && (!effect || operation2.effect === effect) && (!query || operationSearchRank(operation2, query) > 0 || overviewMatches(operation2.id, query))
  );
  if (topic && !query)
    selected.sort((left, right) => operationOrder(left.id) - operationOrder(right.id));
  if (query)
    selected.sort(
      (left, right) => operationSearchRank(right, query) - operationSearchRank(left, query)
    );
  const start = boundedInteger(filter.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor");
  const limit = boundedInteger(filter.limit, 30, 1e3, "limit");
  if (limit === 0)
    throw new HcmError("INVALID_ARGUMENT", "limit: нужно целое число от 1 до 1000.", void 0, {
      path: "limit"
    });
  return {
    operations: selected.slice(start, start + limit),
    total: selected.length,
    ...start + limit < selected.length ? { nextCursor: start + limit } : {}
  };
}
function describeHcmOperation(id) {
  if (typeof id !== "string" || id.length > 128 || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(id))
    throw new HcmError(
      "INVALID_OPERATION_ID",
      "ID операции записан неверно: допустимы латинские буквы, цифры, точка и _, первой идёт буква, не больше 128 знаков."
    );
  const operation2 = operationDefinition(id);
  if (!operation2)
    throw new HcmError("UNKNOWN_OPERATION", `Операции ${id} нет.`, unknownOperationHint(id), {
      operationId: id
    });
  return operation2;
}
function operationEffect(id, args = {}) {
  return effectOf(id)(args);
}
function effectOf(id) {
  describeHcmOperation(id);
  const operation2 = operationSpec(id);
  return (args) => operation2.effectFor?.(args, effectOf) ?? operation2.effect;
}
function unknownOperationHint(id, name2 = (known) => known) {
  if (name2(id) !== id) return `${id} вызывается как ${name2(id)}, а не по ID операции.`;
  const asked = id.split(".").at(-1).toLowerCase();
  const near = operations.map((item) => item.id).filter((known) => isSimilarName(known.split(".").at(-1).toLowerCase(), asked));
  return `${similarHint(near)}Список операций показывает ${name2("api.list")}.`;
}

export {
  HcmError,
  inputObject,
  requiredString,
  boundedInteger,
  scalar,
  isSimilarName,
  similarHint,
  MAX_CONFIG_BYTES,
  defaultConfigPath,
  parseConfiguration,
  LOCAL_LIMITS,
  loadConfig,
  loadConfigWithDefaults,
  markServedByMcp,
  permissionHint,
  configExample,
  withConnection,
  listConnections,
  updateConnection,
  removeConnection,
  rpcArgument,
  rpcValue,
  refusedAtDoor,
  WriteOutcome,
  identifier,
  withoutFalseOffset,
  cleanXmlValue,
  projectFields,
  queryPage,
  hasStructure,
  sameData,
  patchSegments,
  XmlDocument,
  LibraryReader,
  withRepeated,
  serverDatabases,
  SchemaReader,
  platformFailure,
  readServerInfo,
  saveLocalFile,
  scriptResult,
  fileExistsUrl,
  ServerFiles,
  logEntry,
  operations,
  operationSpec,
  operationDefinition,
  operationWritesLocalDisk,
  operationMap,
  operationTopic,
  operationSummary,
  operationNotes,
  listHcmOperations,
  describeHcmOperation,
  operationEffect,
  unknownOperationHint
};
