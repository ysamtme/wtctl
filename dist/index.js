import { createRequire as __wtctlRequire } from "node:module";
const require = __wtctlRequire(import.meta.url);
import {
  NativeGateway,
  freezeRegistry,
  getEffectiveNativeEffect,
  getNativeOperations,
  loginFailed,
  nativeEffect,
  prepare,
  validate
} from "./chunks/chunk-7INSH2T3.js";
import {
  WebSocketHeartbeatError,
  WsHcmApiError,
  assertXmlCharacters,
  attachCleanupError,
  buildXml,
  createPlatformXmlBuilder,
  createPlatformXmlParser,
  escapeXml,
  findXmlNode,
  isTransportFailure,
  localName,
  parsePhysicalDocumentId,
  parseXml,
  resolvePhysicalDocumentLocation,
  validatePlatformXmlSource
} from "./chunks/chunk-PGLJGJ37.js";

// src/errors.ts
var HcmError = class extends Error {
  constructor(code, message, hint, details, mutationOutcome) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.details = details;
    this.mutationOutcome = mutationOutcome;
    this.name = "HcmError";
  }
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

// src/scripts.ts
import { randomUUID } from "node:crypto";
var TARGET = "ms_tools.evaluate_remote_collection_obj";
var FORM = "x-local://wtv/wtv_remote_collection.xmd";
function prepareScript(value, params) {
  const code = (params === void 0 ? "" : `var PARAMS = ParseJson(DecodeCharset(Base64Decode("${Buffer.from(JSON.stringify(inputObject(params, "params"))).toString("base64")}"), "utf-8")); `) + requiredString(value, "code");
  if (Buffer.byteLength(code) > 1024 * 1024)
    throw new HcmError("SCRIPT_TOO_LARGE", "Код SP-XML Script больше 1 МиБ.");
  const marker = `hcm_inline_${randomUUID().replaceAll("-", "")}`;
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
  const children3 = Object.keys(node).filter((key) => !key.startsWith("@_") && key !== "#text");
  const text3 = node["#text"] ?? "";
  if (typeof text3 !== "string")
    throw new HcmError("SCRIPT_RESPONSE", "Значение в результате — не текст.");
  if (["array", "object", "null", "undefined"].includes(type) && text3.trim() !== "")
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "В массиве, объекте или null результата есть посторонний текст."
    );
  if (type === "array") {
    if (children3.some((key) => key !== "e"))
      throw new HcmError("SCRIPT_RESPONSE", "В массиве результата есть посторонние элементы.");
    const items = node.e === void 0 ? [] : Array.isArray(node.e) ? node.e : [node.e];
    return items.map((item) => decodeRpcValue(item, depth + 1));
  }
  if (type === "object") {
    return Object.fromEntries(children3.map((key) => [key, decodeRpcValue(node[key], depth + 1)]));
  }
  if (type === "null" || type === "undefined") {
    if (children3.length !== 0)
      throw new HcmError("SCRIPT_RESPONSE", "В значении null результата есть вложенные элементы.");
    return null;
  }
  if (!["string", "integer", "real", "bool", "date"].includes(type))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "В результате есть значение неподдерживаемого типа (VALUE-TYPE).",
      "Возвращать можно простые значения, массивы и обычные объекты. Элементы и документы XML (XmElem, XmDoc) нужно превращать в строку в самом коде. Ответ сервера как есть покажет web.rpc.call."
    );
  if (children3.length !== 0)
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
    const unread = /syntax error/i.test(reason) && !/^\(/m.test(reason);
    throw new HcmError(
      "SCRIPT_FAILED",
      "Сервер сообщил об ошибке в коде SP-XML Script.",
      unread ? "Сообщение сервера — в details.scriptError. Код не разобран и не выполнялся: данные не менялись." : "Сообщение сервера — в details.scriptError. До ошибки код мог изменить данные: их нужно проверить перед повтором.",
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
function fileContent(response, encoding) {
  if (encoding !== void 0 && encoding !== "base64")
    throw new HcmError(
      "INVALID_ARGUMENT",
      'encoding: допустимо только "base64".',
      "Без encoding текст в UTF-8 приходит в text, остальное — в base64."
    );
  const data2 = response !== null && typeof response === "object" ? response.Data : void 0;
  if (typeof data2 !== "string" || /[^A-Za-z0-9+/=\s]/.test(data2))
    throw new HcmError("FILE_READ_RESPONSE", "Сервер вернул файл в неожиданном виде.");
  const content = Buffer.from(data2.replace(/\s+/g, ""), "base64");
  const binary = { base64: content.toString("base64"), bytes: content.length };
  if (encoding === "base64") return binary;
  try {
    const text3 = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return /[\u0000-\u0008\u000b\u000e-\u001f]/.test(text3) ? binary : { text: text3, bytes: content.length };
  } catch {
    return binary;
  }
}
var FILE_EXISTS_TARGET = "tools.file_url_exists_server";
var FILE_EXISTS_URL_MAX_LENGTH = 256;
function fileExistsUrl(value) {
  const invalid2 = () => new HcmError(
    "INVALID_ARGUMENT",
    "url: нужен адрес x-local://… не длиннее 256 знаков.",
    "Адрес вида x-local://папка/путь: без имени пользователя и пароля, порта, знаков ? и #, обратной косой черты и управляющих символов."
  );
  if (typeof value !== "string" || value.length > FILE_EXISTS_URL_MAX_LENGTH || !value.startsWith("x-local://") || /[\\?#\u0000-\u001f\u007f]/u.test(value))
    throw invalid2();
  const authority = value.slice("x-local://".length).split("/", 1)[0];
  if (!authority || /[\s@:\\]/u.test(authority)) throw invalid2();
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 55296 && unit <= 56319) {
      const next = value.charCodeAt(++index);
      if (!(next >= 56320 && next <= 57343)) throw invalid2();
    } else if (unit >= 56320 && unit <= 57343) throw invalid2();
    else if (unit === 65534 || unit === 65535) throw invalid2();
  }
  return value;
}
function fileFolders(info) {
  const data2 = /* @__PURE__ */ new Set();
  const design = /* @__PURE__ */ new Set();
  const entries = Array.isArray(info?.config_entries) ? info.config_entries : [];
  for (const entry2 of entries) {
    const list2 = entry2?.name === "DATA-DB" ? data2 : entry2?.name === "DESIGN-DB" ? design : void 0;
    if (list2 && typeof entry2.value === "string" && entry2.value) list2.add(entry2.value);
  }
  if (!data2.size && !design.size) return void 0;
  return { data: [...data2], code: [...design].filter((name3) => !data2.has(name3)) };
}
function fileTarget(value, listing = false) {
  const text3 = listing && typeof value === "string" ? value.replace(/\/$/, "") : value;
  const [folder = "", ...path] = typeof text3 === "string" ? text3.slice(10).split("/") : [];
  const plain = (part) => !/^[. ]*$|%(?:2e|2f|5c|[01][0-9a-f]|7f)/i.test(part);
  if (typeof text3 !== "string" || !text3.startsWith("x-local://") || /[\\?#\p{Cc}\p{Cs}]/u.test(text3) || !/^[\w-]+$/.test(folder) || !(listing || path.length) || !path.every(plain))
    throw new HcmError(
      "INVALID_ARGUMENT",
      listing ? "url: нужен адрес x-local://папка или x-local://папка/путь." : "url: нужен адрес x-local://папка/путь.",
      `${listing ? "Без" : "Путь не пустой, без"} частей из одних точек и пробелов, без %2e, %2f, %5c, знаков \\ ? #. Например, x-local://share/report.txt.`
    );
  return { url: text3, folder };
}
function assertFileDeletable(folder) {
  if (folder === "wt_data" || folder === "trash")
    throw new HcmError(
      "FILE_NOT_DELETABLE",
      `В папке ${folder} сервер не удаляет файлы и папки по адресу.`,
      "Это папка базы сервера. Документ объекта удаляет objects.delete; обычный файл клиент здесь не удаляет."
    );
}
function fileRoute(operation, folders, folder, canExecute) {
  if (!folders) return "unlisted";
  if (folders.data.includes(folder)) return "data";
  if (!folders.code.includes(folder))
    throw new HcmError(
      "FOLDER_NOT_WRITABLE",
      `Папка ${folder} не принимает файлы.`,
      `Папки данных: ${folders.data.join(", ")}. Папки кода (нужны права write и execute): ${folders.code.join(", ")}.`
    );
  if (!canExecute)
    throw new HcmError(
      "EXECUTE_DISABLED",
      `Папка ${folder} на этом сервере принимает ${operation === "write" ? "запись" : "удаление"} только кодом на сервере: нужно ещё право execute.`,
      "Право execute включает владелец подключения в настройках подключения (permissions.execute)."
    );
  return "code";
}
function fileWriteContent(args) {
  const { text: text3, base64 } = args;
  const bytes = typeof text3 === "string" && !new RegExp("\\p{Cs}", "u").test(text3) ? Buffer.from(text3) : typeof base64 === "string" ? Buffer.from(base64, "base64") : void 0;
  if (text3 === void 0 === (base64 === void 0) || !bytes || text3 === void 0 && bytes.toString("base64") !== base64)
    throw new HcmError(
      "INVALID_ARGUMENT",
      "Нужно ровно одно из text (без непарных суррогатов) и base64 (без переводов строк)."
    );
  return {
    ...typeof text3 === "string" ? { text: text3 } : {},
    base64: bytes.toString("base64"),
    bytes: bytes.length
  };
}
function fileScript(code, params) {
  try {
    return prepareScript(code, params);
  } catch (error) {
    if (!(error instanceof HcmError) || error.code !== "SCRIPT_TOO_LARGE") throw error;
    throw new HcmError(
      "FILE_TOO_LARGE",
      "Файл не помещается в код для сервера.",
      "В папку кода файл записывает код на сервере: текст — до 750 КБ (меньше, если в нём много переводов строк), двоичные данные — до 580 КБ."
    );
  }
}
function codeWrite(url, content) {
  const text3 = content.text !== void 0;
  return fileScript(
    `PutUrlData(PARAMS.url, ${text3 ? "PARAMS.text" : "Base64Decode(PARAMS.base64)"});
RESULT = [UrlFileSize(PARAMS.url)];`,
    text3 ? { url, text: content.text } : { url, base64: content.base64 }
  );
}
function codeDelete(url) {
  return fileScript(
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
    "Адрес нужно проверить через files.exists перед повтором.",
    void 0,
    "indeterminate"
  );
}
function codeDeleteRefusal(data2) {
  if (data2.result[0] === "directory")
    return new HcmError("FILE_IS_FOLDER", "Адрес — папка: в папке кода удаляется только файл.");
  if (data2.result[0] === "absent")
    return new HcmError("FILE_NOT_FOUND", "По адресу нет файла.", "Адрес проверяет files.exists.");
  return void 0;
}
function codeList(url) {
  return fileScript(
    `var rows = [];
var item = '';
var folder = false;
var dir = false;
try { dir = IsDirectory(PARAMS.url); } catch (e) { dir = false; }
if (dir) { for (item in ReadDirectory(PARAMS.url)) { folder = IsDirectory(item); rows.push({ u: item, f: folder, b: folder ? 0 : UrlFileSize(item) }); } }
RESULT = dir ? rows : ['none'];`,
    { url }
  );
}
function fileList(data2, folder, search = "") {
  if (data2.result[0] === "none")
    throw new HcmError(
      "FOLDER_NOT_FOUND",
      "По адресу нет папки.",
      "Список показывает только папку; файл читает files.read, адрес проверяет files.exists."
    );
  const rows = data2.result.map((row) => {
    const name3 = typeof row?.u === "string" && row.u.startsWith(`${folder}/`) ? row.u.slice(folder.length + 1).replace(/\/$/, "") : "";
    const bytes = Number(row?.b);
    if (!name3 || /[/\\]/.test(name3) || row.f !== "1" && !Number.isFinite(bytes))
      throw new HcmError("SCRIPT_RESPONSE", "Сервер вернул список папки в неожиданном виде.");
    return row.f === "1" ? { name: name3, folder: true } : { name: name3, bytes };
  });
  const part = search.toLowerCase();
  const items = rows.filter((item) => item.name.toLowerCase().includes(part));
  items.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { items, total: items.length };
}
function object(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
  return value;
}
function wrapper(value, child) {
  const node = object(value);
  if (node["#text"] !== void 0 && (typeof node["#text"] !== "string" || node["#text"].trim() !== "") || Object.keys(node).some((key) => {
    if (key === child || key === "#text") return false;
    return !/^@_xmlns(?::[A-Za-z_][\w.-]*)?$/.test(key) || typeof node[key] !== "string" || node[key].length > 1024;
  }))
    throw new Error();
  return node[child];
}
function parseFileExists(response) {
  try {
    const rpc = object(response);
    if (Object.keys(rpc).some((key) => !["xml", "valueType", "lexicalValue"].includes(key)) || typeof rpc.valueType !== "string" || rpc.valueType.toLowerCase() !== "bool")
      throw new Error();
    const result = object(wrapper(wrapper(rpc.xml, "ResultData"), "Result"));
    if (Object.keys(result).some((key) => !["@_VALUE-TYPE", "#text"].includes(key)) || typeof result["@_VALUE-TYPE"] !== "string" || result["@_VALUE-TYPE"].toLowerCase() !== "bool" || result["#text"] !== "0" && result["#text"] !== "1" || rpc.lexicalValue !== result["#text"])
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
  constructor(server, permissions) {
    this.server = server;
    this.permissions = permissions;
  }
  async exists(args) {
    return parseFileExists(
      await this.server.read("native.rpc.call", {
        target: FILE_EXISTS_TARGET,
        args: [{ valueType: "string", lexicalValue: fileExistsUrl(args.url) }]
      })
    );
  }
  async read(args) {
    return fileContent(
      await this.server.call("native.lds.loadUrl", { url: requiredString(args.url, "url") }),
      args.encoding
    );
  }
  async list(args, call) {
    const folder = fileTarget(args.url, true).url;
    const search = args.search === void 0 ? "" : requiredString(args.search, "search");
    const data2 = await this.server.runCode(
      codeList(folder),
      call.outcome,
      (answer) => answer.result[0] === "none"
    );
    return fileList(data2, folder, search);
  }
  async write(args, call) {
    const target = fileTarget(args.url);
    const content = fileWriteContent(args);
    if (await this.route("write", target.folder, call) === "code") {
      const data2 = await this.server.runCode(codeWrite(target.url, content), call.outcome);
      return { bytes: Number(data2.result[0]), mutationOutcome: "confirmed" };
    }
    await this.server.call(
      "native.lds.putUrl",
      { url: target.url, data: { base64: content.base64 } },
      call.outcome
    );
    return { bytes: content.bytes, mutationOutcome: "confirmed" };
  }
  async delete(args, call) {
    const target = fileTarget(args.url);
    assertFileDeletable(target.folder);
    if (await this.route("delete", target.folder, call) === "code") {
      const data2 = await this.server.runCode(
        codeDelete(target.url),
        call.outcome,
        (answer) => !!codeDeleteRefusal(answer)
      );
      const refusal = codeDeleteRefusal(data2);
      if (refusal) throw refusal;
      if (data2.result[0] === "remains") throw fileRemains();
      return { deleted: true, mutationOutcome: "confirmed" };
    }
    await this.server.call("native.lds.deleteUrl", { url: target.url }, call.outcome);
    if (target.url.length <= FILE_EXISTS_URL_MAX_LENGTH) {
      if ((await this.exists({ url: target.url })).exists) throw fileRemains();
    }
    return { deleted: true, mutationOutcome: "confirmed" };
  }
  /** A failure to read the application info means the server gave no folder lists. */
  async folders() {
    return fileFolders(await this.server.applicationInfo().catch(() => void 0));
  }
  async route(operation, folder, call) {
    const route = fileRoute(operation, await this.folders(), folder, this.permissions.execute);
    if (operation === "write" && route !== "unlisted") call.refusal = "files.write:listed";
    return route;
  }
};

// src/operations.ts
var string = { type: "string" };
var integer = { type: "integer", minimum: 0 };
var boolean = { type: "boolean" };
var object2 = { type: "object" };
var fields = { type: "array", items: string };
function schema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}
function definition(id, effect, description, inputSchema) {
  return {
    id,
    group: id.split(".")[0],
    title: id,
    description,
    effect,
    status: "implemented",
    inputSchema
  };
}
var address = { id: string, type: string, url: string, fields };
var schemaPage = { search: string, limit: { type: "integer", minimum: 1 }, cursor: integer };
var logWindow = { file: string, full: boolean, tailBytes: integer };
var composite = [
  definition(
    "files.exists",
    "read",
    "Есть ли файл или папка по адресу x-local://…. Ответ ничего не говорит о содержимом, размере и правах на чтение. Адрес — до 256 знаков.",
    schema(
      {
        url: {
          type: "string",
          minLength: 1,
          maxLength: FILE_EXISTS_URL_MAX_LENGTH,
          pattern: "^x-local://"
        }
      },
      ["url"]
    )
  ),
  definition(
    "files.read",
    "read",
    'Прочитать файл по адресу сервера: text, если содержимое — текст в UTF-8, иначе base64. encoding:"base64" отдаёт base64 и для текста. Документы объектов читает objects.get.',
    schema({ url: string, encoding: { type: "string", enum: ["base64"] } }, ["url"])
  ),
  definition(
    "files.list",
    "execute",
    "Один уровень папки x-local://папка или x-local://папка/путь: items — файлы с размером (bytes) и вложенные папки (folder:true), по имени. search оставляет имена с этой частью, регистр не важен. Список даёт код на сервере: нужно право execute.",
    schema({ url: string, search: string }, ["url"])
  ),
  definition(
    "files.write",
    "write",
    "Записать файл по адресу x-local://…: text — текст (пишется в UTF-8), base64 — двоичные данные. Файл заменяется целиком, вложенные папки сервер создаёт сам. В папку кода (wt, wtv, custom…) файл записывает код на сервере: нужно ещё право execute. Какие папки принимают запись, показывает server.info.",
    schema({ url: string, text: string, base64: string }, ["url"])
  ),
  definition(
    "files.delete",
    "write",
    "Удалить файл по адресу x-local://…. В папке данных так же удаляется пустая папка; в папке кода — только файл, и нужно ещё право execute.",
    schema({ url: string }, ["url"])
  ),
  definition(
    "server.info",
    "read",
    "Сведения, которые сервер отдаёт админке при запуске: версия, операционная система, маска возможностей, ограничения на число записей по типам объектов; в профиле native ещё папки: dataFolders принимают запись через LDS, codeFolders — только кодом на сервере. Маска — не права пользователя, ограничения — не список каталогов. profile: native (по умолчанию) или web.",
    schema({ profile: { type: "string", enum: ["native", "web"] } })
  ),
  definition(
    "runtime.status",
    "read",
    "Проверить связь: версия сервера и права подключения. Ничего не меняет.",
    schema({})
  ),
  definition(
    "runtime.check",
    "read",
    "Проверить подключение по шагам: вход, версия, запрос, документ, схема, библиотеки, логи, портал; при праве execute — ещё код RESULT = [1 + 1]. Запись не проверяется.",
    schema({})
  ),
  definition(
    "runtime.query",
    "unknown",
    "Поиск в каталоге: {catalog, where, fields, order}, условия соединяются через «и»; order — поле или список полей каталога, по убыванию — «поле desc». Или запрос XQuery целиком: {query}; он требует права execute и заканчивается на return $elem. Ответ: items, total; nextStartPosition есть, пока строки не кончились. Запрос, который возвращает отдельные значения, выполняет native.lds.xQuery.",
    schema({
      query: string,
      catalog: string,
      where: object2,
      order: { anyOf: [string, { type: "array", items: string }] },
      fields,
      limit: { type: "integer", minimum: 1, maximum: 1e3 },
      startPosition: { type: "integer", minimum: 0, maximum: 1e6 }
    })
  ),
  definition(
    "objects.get",
    "read",
    "Прочитать документ объекта по id или url; несколько объектов — ids (до 100), ответ — items, у непрочитанного в элементе error. fields — поля верхнего уровня. Повторяющийся элемент приходит списком и при одном значении. unknownFields — запрошенные имена, которых у типа нет; пустое поле в ответ не попадает.",
    schema({ ...address, ids: { type: "array", items: string, minItems: 1, maxItems: 100 } })
  ),
  definition(
    "objects.create",
    "write",
    "Создать объект типа type с полями data. ID выдаёт сервер; после записи объект перечитывается и сверяется с запросом. Обработчики, которые админка выполняет при создании, не запускаются.",
    schema({ type: string, data: object2, dbName: string, formUrl: string }, ["type", "data"])
  ),
  definition(
    "objects.patch",
    "write",
    "Изменить поля объекта, сохранив остальное содержимое документа. patch — {путь: значение} или список {op:'set'|'remove', path, value}; remove — пути, которые удалить. preview:true ничего не записывает. Правка, которая ничего не меняет, не записывается: в ответе noop:true; resave:true записывает документ и без правок — сервер при сохранении заново заполняет поля, которые берёт из связанных объектов. expectedFingerprint отклоняет запись, если объект изменился после чтения; это сверка перед записью, а не блокировка.",
    schema({
      ...address,
      patch: {},
      remove: { type: "array", items: string },
      expectedFingerprint: string,
      preview: boolean,
      resave: boolean
    })
  ),
  definition(
    "objects.delete",
    "write",
    "Удалить документ объекта безвозвратно; permanent:true обязателен. catalog — проверить, что объект был в этом каталоге и исчез из него.",
    schema({ ...address, permanent: boolean, catalog: string })
  ),
  definition(
    "schema.get",
    "read",
    "Поля типа объекта: свои, унаследованные, настраиваемые и поля каталога, с заголовками на языке сервера. deep:true — вложенные поля любой глубины сразу, а не один уровень. Ответ постраничный.",
    schema({
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
    })
  ),
  definition(
    "schema.types",
    "read",
    "Типы объектов сервера: тип, каталог, заголовок, число настраиваемых полей. Каталога у типа может не быть. catalogs — сколько на сервере каталогов всего, считая каталоги без своего типа объекта.",
    schema(schemaPage)
  ),
  definition(
    "logs.list",
    "read",
    "Логи сервера, сначала свежие. type — имя лога без даты (xhttp, agent…); nameContains, startDate и endDate отбирают по имени и дате сервера. По умолчанию 30 файлов.",
    schema({
      type: string,
      nameContains: string,
      startDate: string,
      endDate: string,
      offset: integer,
      limit: integer
    })
  ),
  definition(
    "logs.read",
    "read",
    "Текст лога: конец файла (tailBytes) или весь файл (full:true). Пока сервер пишет в файл, он может его не отдать: чтение повторяется один раз, затем ошибка LOG_READ_UNAVAILABLE.",
    schema(logWindow, ["file"])
  ),
  definition(
    "logs.search",
    "read",
    "События лога по тексту, уровню или потоку в прочитанной части файла. Многострочное событие возвращается целиком. Уровень определяется по словам в тексте, время — местное время сервера. newestFirst:true отдаёт сначала последние события. cutBySize:true — событий на странице меньше limit, потому что больше не поместилось в ответ; дальше — nextOffset. expectedFingerprint из прошлого ответа защищает следующую страницу от изменившегося файла.",
    schema(
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
    )
  ),
  definition(
    "logs.follow",
    "read",
    "Новые события лога с прошлого вызова по cursor. Последнее событие может повториться; gapPossible:true — часть событий могла быть пропущена. После ошибки чтения использовать прежний cursor; другой файл начинать без cursor.",
    schema({ ...logWindow, cursor: string }, ["file"])
  ),
  definition(
    "results.export",
    "read",
    "Сохранить большой результат целиком в файл на этом компьютере: json — как есть, jsonl — по строке на элемент списка ответа, text — текст лога или файла. Папка должна существовать.",
    schema({ resultId: string, path: string, format: string, overwrite: boolean }, [
      "resultId",
      "path"
    ])
  ),
  definition(
    "results.read",
    "read",
    "Дочитать сохранённый результат по resultId: список — по элементам, текст лога или файла — по символам. format:json читает любой результат как текст JSON по частям.",
    schema(
      {
        resultId: string,
        offset: integer,
        limit: integer,
        format: { type: "string", enum: ["auto", "json", "text"] }
      },
      ["resultId"]
    )
  ),
  definition(
    "rpc.call",
    "execute",
    "Вызвать функцию библиотеки сервера: {library, method, arguments:[…]}. Строки, целые, логические значения и null передаются как есть; дата, объект, XML и большое целое — как {valueType, lexicalValue}. async:true запускает фоновой задачей.",
    schema({ library: string, method: string, arguments: { type: "array" }, async: boolean }, [
      "library",
      "method"
    ])
  ),
  definition(
    "rpc.list",
    "read",
    "Найти функции библиотек сервера: query, library, method. Без all — только те, что можно вызвать с клиента (rpc.call); all:true добавляет функции, которые вызываются только из кода на сервере (serverOnly:true). builtIn:true берёт встроенную таблицу сборки 2025.1.1171 без обращения к серверу. Список не говорит о типах аргументов и о том, меняет ли функция данные.",
    schema({
      query: { type: "string", maxLength: 512 },
      library: { type: "string", maxLength: 128, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
      method: { type: "string", maxLength: 128, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
      builtIn: boolean,
      all: boolean,
      cursor: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      limit: { type: "integer", minimum: 1, maximum: 100 }
    })
  ),
  definition(
    "rpc.describe",
    "read",
    "Параметры функции по targetId «библиотека.функция»; source:true добавляет до 8 КБ её кода. serverOnly:true в ответе — функция вызывается только из кода на сервере. Сама функция не вызывается.",
    schema(
      {
        targetId: {
          type: "string",
          maxLength: 257,
          pattern: "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$"
        },
        builtIn: boolean,
        source: boolean
      },
      ["targetId"]
    )
  ),
  definition(
    "execute.script",
    "execute",
    "Выполнить код SP-XML Script на сервере. Код присваивает массив переменной RESULT; числа, даты и логические значения приходят строками. params — объект JSON, в коде это готовая переменная PARAMS. На сервер ничего не устанавливается. Код может менять данные, отката нет.",
    schema(
      {
        code: { type: "string", minLength: 1, maxLength: 1048576 },
        params: { type: "object" }
      },
      ["code"]
    )
  ),
  definition(
    "agents.run",
    "execute",
    "Запустить агента сервера и дождаться конца его кода. Ответ: started, startedAt и finishedAt — местное время сервера. Ошибку в коде агента ответ не показывает: она в логе xhttp между этими отметками. Дата последнего запуска сохраняется в агенте, как при запуске из админки.",
    schema(
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
    )
  ),
  definition(
    "runtime.batch",
    "unknown",
    "Несколько операций одним вызовом: steps — список {id, args, as}. Значение из прошлого шага: {$ref:'имя.data.items.0.id'}, где имя — as того шага, дальше путь по его ответу. Класс вызова — по самому сильному шагу: все шаги читают — чтение, есть запись — запись, есть выполнение кода — выполнение. Права проверяются для каждого шага. Это не транзакция: выполненные шаги не откатываются; первый сбой останавливает остальные, если не задано stopOnError:false.",
    schema(
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
    )
  )
];
var operations = freezeRegistry([...composite, ...getNativeOperations()]);
var byId = new Map(operations.map((operation) => [operation.id, operation]));
if (byId.size !== operations.length) throw new Error("Duplicate runtime operation ID");
function operationDefinition(id) {
  return byId.get(id);
}
function operationSearchRank(operation, query) {
  const id = operation.id.toLowerCase();
  if (id === query) return 5;
  if (id.split(".").includes(query)) return 4;
  if (id.includes(query)) return 3;
  const text3 = `${operation.title} ${operation.description}`.toLowerCase();
  if (!text3.includes(query)) return 0;
  return text3.split(/[^\p{L}\p{N}_]+/u).includes(query) ? 2 : 1;
}

// src/operation-map.ts
var PROTOCOL = "protocol";
var TOPICS = [
  {
    id: "functions",
    title: "Функции библиотек сервера: найти, посмотреть параметры и код, вызвать",
    operations: {
      "rpc.list": "Найти функции, разрешённые для вызова с клиента: query, library, method; all:true — вместе с функциями только для кода на сервере.",
      "rpc.describe": "Параметры функции по targetId «библиотека.функция»; source:true добавляет код. Знает и функции, которые вызываются только из кода на сервере.",
      "rpc.call": "Вызвать функцию: {library, method, arguments:[…]}; async:true запускает фоновой задачей."
    }
  },
  {
    id: "tasks",
    title: "Фоновые задачи: запустить, узнать состояние, остановить",
    operations: {
      "web.spxml.callMethodAsync": "Запустить функцию библиотеки фоновой задачей; ответ содержит TrackingID.",
      "web.spxml.getAsyncMethodStatus": "Состояние задачи по TrackingID. Итог выдаётся один раз: его нужно сохранить и больше не опрашивать.",
      "web.spxml.getBackgroundTasksByName": "Найти задачи по имени библиотеки и функции.",
      "web.spxml.killAsyncMethod": "Попросить сервер остановить задачу."
    }
  },
  {
    id: "agents",
    title: "Агенты сервера: запустить и дождаться конца",
    operations: {
      "agents.run": "Запустить агента по ID и дождаться конца: {id}; objectId и objectIds — объекты, над которыми он работает."
    }
  },
  {
    id: "files",
    title: "Файлы сервера по адресу x-local://…: проверить, прочитать, показать папку, записать, удалить, загрузить",
    operations: {
      "files.exists": "Есть ли файл или папка по адресу.",
      "files.read": 'Прочитать файл: текст, если это текст в UTF-8, иначе base64; encoding:"base64" — всегда base64.',
      "files.list": "Показать один уровень папки: файлы с размером и вложенные папки.",
      "files.write": "Записать файл: text или base64; способ записи операция выбирает по папке.",
      "files.delete": "Удалить файл (в папке данных — и пустую папку).",
      "web.pages.uploadFile": "Загрузить файл до 8 МБ в папку загрузок сервера; ответ содержит его адрес.",
      "web.pages.uploadChunk": "Загрузить одну часть большого файла.",
      "web.pages.clearUploadChunks": "Удалить загруженные части файла."
    }
  },
  {
    id: "documents",
    title: "Документ объекта как XML: чтение, сохранение, удаление",
    operations: {
      "native.lds.loadDoc": "Прочитать документ по адресу; приходит разобранным в JSON.",
      "native.lds.putDoc": "Сохранить документ по адресу из текста XML.",
      "native.lds.deleteDoc": "Удалить документ по адресу.",
      "native.lds.getNewObjectId": "Выделить новый ID объекта; каждый вызов расходует ID.",
      "native.physicalDocuments.createFromXml": "Создать документ из готового XML; новый ID подставляется вместо {{objectId}}."
    }
  },
  {
    id: "changes",
    title: "Учёт изменений самим сервером: на 2025.1–2025.2 отвечает пусто, см. описания операций",
    operations: {
      "native.lds.getModObjects": "Объекты, изменённые после даты minModDate; на 2025.1–2025.2 ответ пуст и при изменениях.",
      "native.lds.getCatalogsStat": "Число записей по каталогам из кэша сервера; пустой ответ не значит, что записей нет."
    }
  },
  {
    id: "server",
    title: "Сведения о сервере и проверка служб",
    operations: {
      "server.info": "Версия, операционная система и ограничения сервера.",
      "native.spxml2.getAppInfo": "Каталоги, типы объектов, общие документы и настройки приложения.",
      "anonymous.diagnostics.portal": "Отвечает ли портал.",
      "anonymous.diagnostics.xhttpInfo": "Служебная страница /xhttp_info.",
      "web.websocket.heartbeat": "Отвечает ли служба WebSocket."
    }
  },
  {
    id: "forms",
    title: "Формы, тексты интерфейса и картинки",
    operations: {
      "native.spxml2.getForm": "Текст формы (.xmd, .xms) по адресу.",
      "web.pages.getScreenForm": "Текст экранной формы по адресу.",
      "web.pages.getUiText": "Тексты интерфейса.",
      "native.resources.getImage": "Картинка ресурса по ID.",
      "native.resources.getCompoundResource": "Вложение составного документа."
    }
  },
  {
    id: "basic",
    title: "Основные операции. У каждой есть своя команда и свой инструмент; по ID они нужны в runtime.batch — несколько операций одним вызовом",
    operations: {},
    prefixes: ["runtime.", "objects.", "schema.", "logs.", "results.", "execute."]
  },
  {
    id: PROTOCOL,
    title: "Прямые вызовы протокола: те же действия через веб-профиль, сессии, сырые запросы. Обычно не нужны",
    operations: {}
  }
];
var topicOfOperation = /* @__PURE__ */ new Map();
for (const operation of operations) {
  const topic = TOPICS.find((item) => Object.hasOwn(item.operations, operation.id)) ?? TOPICS.find((item) => item.prefixes?.some((prefix) => operation.id.startsWith(prefix))) ?? TOPICS.find((item) => item.id === PROTOCOL);
  topicOfOperation.set(operation.id, topic);
}
for (const topic of TOPICS)
  for (const id of Object.keys(topic.operations))
    if (topicOfOperation.get(id) !== topic) throw new Error(`Unknown operation in topic: ${id}`);
function operationTopic(id) {
  return topicOfOperation.get(id)?.id ?? PROTOCOL;
}
function operationOrder(id) {
  const position = Object.keys(topicOfOperation.get(id)?.operations ?? {}).indexOf(id);
  return position < 0 ? Number.MAX_SAFE_INTEGER : position;
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
  return `${topic?.title} ${topic?.operations[id] ?? ""}`.toLowerCase().includes(query);
}

// src/catalog.ts
function listHcmOperations(filter = {}) {
  const asked = filter.query?.toLowerCase().trim();
  const effect = filter.effect ?? ["read", "write", "execute", "unknown"].find((name3) => name3 === asked);
  const query = effect && effect === asked ? void 0 : asked;
  const topic = filter.topic === void 0 ? void 0 : requireTopic(filter.topic);
  const selected = operations.filter(
    (operation) => (!topic || operationTopic(operation.id) === topic) && (!filter.group || operation.group === filter.group) && (!effect || operation.effect === effect) && (!filter.status || operation.status === filter.status) && (!query || operationSearchRank(operation, query) > 0 || overviewMatches(operation.id, query))
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
  const operation = operationDefinition(id);
  if (!operation) {
    const asked = id.split(".").at(-1).toLowerCase();
    const near = operations.map((item) => item.id).filter((known) => {
      const last = known.split(".").at(-1).toLowerCase();
      return last.includes(asked) || asked.includes(last);
    }).slice(0, 5);
    throw new HcmError(
      "UNKNOWN_OPERATION",
      `Операции ${id} нет.`,
      `${near.length ? `Похожие: ${near.join(", ")}. ` : ""}Список операций показывает api.list.`,
      { operationId: id }
    );
  }
  return operation;
}

// src/log-output.ts
function summary(file) {
  return {
    name: file.name,
    type: file.type,
    sizeBytes: Number(file.sizeBytes),
    ...file.dateHint === void 0 ? {} : { date: file.dateHint }
  };
}
function entry(event) {
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
  const events = data2.events.map(entry);
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
  const all = data2.events.map(entry);
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
function looksLikeDecimalId(value) {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value);
}
function literal(value, date2 = false, integer2 = false) {
  if (integer2 && looksLikeDecimalId(value)) return value;
  if (date2 && looksLikeDate(value) && value.length <= 40 && !value.includes("'"))
    return `date('${value}')`;
  if (value === null) return "null()";
  if (typeof value === "boolean") return value ? "true()" : "false()";
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))
    return decimalLiteral(value);
  if (typeof value === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(value)) {
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
function catalogQuery(catalog, where = {}, dates = /* @__PURE__ */ new Set(), order, integers = /* @__PURE__ */ new Set()) {
  const name3 = identifier(catalog, "catalog");
  const conditions = [];
  for (const [field, condition] of Object.entries(inputObject(where, "where"))) {
    const path = `$elem/${identifier(field, "поле условия")}`;
    const date2 = dates.has(field);
    const integer2 = integers.has(field);
    const equals = (value) => value === "" || value === null ? `(${path} = '' or IsEmpty(${path}) = true())` : `${path} = ${literal(value, date2, integer2)}`;
    if (condition !== null && typeof condition === "object") {
      const operators = Object.entries(inputObject(condition, "условие"));
      if (operators.length === 0)
        throw new HcmError(
          "INVALID_FILTER_OPERATOR",
          "В условии по полю нет оператора.",
          void 0,
          { field }
        );
      for (const [operation, value] of operators) {
        if (operation === "eq" || operation === "ne" || operation === "gt" || operation === "gte" || operation === "lt" || operation === "lte") {
          const operator = { eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[operation];
          if (operation === "eq") conditions.push(equals(value));
          else if (operation === "ne" && (value === "" || value === null))
            conditions.push(`IsEmpty(${path}) = false()`);
          else conditions.push(`${path} ${operator} ${literal(value, date2, integer2)}`);
        } else if (operation === "contains")
          conditions.push(`contains(${path}, ${literal(value)})`);
        else if (operation === "in" && Array.isArray(value) && value.length > 0 && value.length <= 100)
          conditions.push(`(${value.map(equals).join(" or ")})`);
        else
          throw new HcmError(
            "INVALID_FILTER_OPERATOR",
            "Операторы условия: eq, ne, gt, gte, lt, lte, contains, in. Для in нужен массив от 1 до 100 значений.",
            void 0,
            { field, operation }
          );
      }
    } else conditions.push(equals(condition));
  }
  const sorted = orderFields(order).map(
    ({ field, descending }) => `$elem/${field}${descending ? " descending" : ""}`
  );
  return `for $elem in ${name3}${conditions.length ? ` where ${conditions.map((condition) => `(${condition})`).join(" and ")}` : ""}${sorted.length ? ` order by ${sorted.join(", ")}` : ""} return $elem`;
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
function responseChild(response, name3) {
  const matches2 = elementEntries(response).filter(([key]) => localName(key) === name3);
  if (matches2.length > 1 || matches2.length === 1 && Array.isArray(matches2[0][1]))
    throw new HcmError(
      "PLATFORM_RESPONSE",
      `В ответе на запрос XQuery элемент ${name3} повторяется.`
    );
  return matches2[0]?.[1];
}
function responseScalar(value, name3) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const node = value;
    if (elementEntries(node).length === 0 && typeof node["#text"] === "string")
      return node["#text"];
  }
  throw new HcmError("PLATFORM_RESPONSE", `В ответе на запрос XQuery ${name3} — не текст.`);
}
function representationError() {
  throw new HcmError(
    "QUERY_REPRESENTATION",
    "Запрос вернул не строки каталога целиком.",
    "Запрос должен заканчиваться на `return $elem`, а поля выбираются аргументом fields. Запрос, который возвращает отдельные значения или разные элементы, читает native.lds.xQuery."
  );
}
function hasMixedText(value) {
  if (Array.isArray(value)) return value.some(hasMixedText);
  if (!value || typeof value !== "object") return false;
  const node = value;
  const children3 = elementEntries(node);
  return children3.length > 0 && node["#text"] !== void 0 && responseScalar(node["#text"], "содержимое строки").trim() !== "" || children3.some(([, child]) => hasMixedText(child));
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
  const children3 = entries[0][1];
  return (Array.isArray(children3) ? children3 : [children3]).map((child) => {
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
function sameKey(stored, key) {
  const text3 = String(stored);
  return text3 === key || ID_TEXT.test(text3) && ID_TEXT.test(key) && BigInt(text3) === BigInt(key);
}
function brief(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  const keys = Object.entries(value).map(
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
      nodes = parser.parse(source);
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
  snapshot() {
    const type = local(name(this.root));
    const xml = builder.build(withoutIndentation([this.root]));
    assertXml(xml);
    const data2 = inputObject(compact(children(this.root)), "содержимое документа");
    const attributes = this.root[":@"];
    const formUrl = attributes?.["@_SPXML-FORM"];
    return {
      type,
      xml,
      data: data2,
      fingerprint: createHash("sha256").update(JSON.stringify(semantic([this.root]))).digest("hex"),
      ...typeof formUrl === "string" ? { formUrl } : {}
    };
  }
  patch(input2) {
    const before = this.snapshot();
    const workingRoot = structuredClone(this.root);
    const operations2 = Array.isArray(input2) ? input2 : Object.entries(inputObject(input2, "patch")).map(([path, value]) => ({
      op: "set",
      path,
      value
    }));
    if (operations2.length > 1e3)
      throw new HcmError("PATCH_LIMIT", "В одном patch не больше 1000 изменений.");
    const changes = [];
    for (const raw of operations2) {
      const operation = inputObject(raw, "элемент patch");
      const path = requiredString(operation.path, "path");
      const segments = patchSegments(path);
      const upTo = (count) => segments.slice(0, count).map((part) => part[0]).join(".");
      let createdKeyedElement = false;
      let created = false;
      if (operation.op !== "set" && operation.op !== "remove")
        throw new HcmError("INVALID_PATCH", "op: поддерживаются set и remove.");
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
            (child) => name(child) === key && sameKey(compact(children(child)), keyValue)
          ))
        );
        if (position === void 0 && matches2.length > 1)
          throw new HcmError(
            "AMBIGUOUS_PATCH",
            "Таких полей несколько: нужно указать номер элемента, например [0], или ключ [имя=значение], который есть только у одного.",
            operation.op === "remove" && key === void 0 && index > 0 && index === segments.length - 1 ? `Чтобы убрать все элементы, нужно удалить сам список: remove ["${upTo(index)}"].` : void 0,
            { path }
          );
        let chosen = matches2[position ?? 0];
        if (chosen && hasExternalData(chosen.node, index === segments.length - 1))
          throw new HcmError(
            "EXTERNAL_FIELD_REQUIRES_API",
            "Поле хранится отдельно от документа как большое поле.",
            "Клиент большие поля не меняет; обычное изменение документа сведения о таком поле не переписывает.",
            { path },
            "not_sent"
          );
        if (index < segments.length - 1) {
          if (!chosen && position === void 0 && (createdKeyedElement || segments.slice(index).some((part) => part[3] !== void 0))) {
            if (operation.op === "remove") break;
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
        if (operation.op === "remove") {
          if (chosen) parent.splice(chosen.i, 1);
          else if (key !== void 0) break;
        } else {
          if (!Object.hasOwn(operation, "value"))
            throw new HcmError("INVALID_PATCH", "Для set нужно value.", void 0, { path });
          if (key !== void 0) inputObject(operation.value, "значение элемента с ключом");
          const made = segments[index - 1];
          if (created && made?.[3] === field && !sameKey(operation.value, made[4]))
            throw new HcmError(
              "INVALID_PATCH",
              "Ключ в значении не совпадает с ключом в пути.",
              "Элемент создан с ключом из пути: в значение нужно записать его же.",
              { path }
            );
          const replacement = Array.isArray(operation.value) ? operation.value.map((value) => encodeValue(field, value)) : [encodeValue(field, operation.value)];
          if (key !== void 0 && !sameKey(
            inputObject(compact(children(replacement[0])), "значение элемента с ключом")[key],
            keyValue
          ))
            throw new HcmError(
              "INVALID_PATCH",
              "Ключ в значении не совпадает с ключом в пути.",
              void 0,
              {
                path
              }
            );
          const stored = chosen ? compact(children(chosen.node)) : void 0;
          if (stored !== operation.value && withoutFalseOffset(stored) === operation.value) {
          } else if (chosen) {
            if (chosen.node[":@"] !== void 0 && replacement.length === 1)
              replacement[0][":@"] = chosen.node[":@"];
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
          op: operation.op,
          path,
          ...chosen && !created ? { before: brief(withoutFalseOffset(compact(children(chosen.node)))) } : {},
          ...operation.op === "set" ? { after: brief(operation.value) } : {}
        });
      }
    }
    const after = new _XmlDocument(workingRoot).snapshot();
    this.root = workingRoot;
    return { before, after, changes };
  }
};

// src/protocol/library-functions.ts
function normalizeFormParams(source, library = false) {
  return source.replace(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^<>"']|"[^"]*"|'[^']*')+>/g,
    (tag) => {
      if (/^<[!?\/]/.test(tag)) return tag;
      const counts = /* @__PURE__ */ new Map();
      return tag.replace(/\s+([^\s=/>]+)\s*=\s*(?:"[^"]*"|'[^']*')/g, (attribute, name3) => {
        const key = name3.toUpperCase();
        const count = counts.get(key) ?? 0;
        counts.set(key, count + 1);
        if (key === "PARAM") return attribute.replace(name3, `PARAM__${count}`);
        if (library && count) attribute = attribute.replace(name3, `${name3}__${count}`);
        return key === "EXPR" ? attribute.replace(/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);)/g, "&amp;") : attribute;
      });
    }
  );
}
var LibraryReader = class {
  constructor(applicationInfo, readFile2) {
    this.applicationInfo = applicationInfo;
    this.readFile = readFile2;
  }
  shared;
  files = /* @__PURE__ */ new Map();
  file({ url }) {
    let cached = this.files.get(url);
    if (!cached) {
      cached = this.readFile(url).catch((error) => {
        this.files.delete(url);
        throw error;
      }).then((response) => {
        const encoded = findXmlNode(response, "Data");
        if (typeof encoded !== "string") throw new Error();
        const source = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.from(encoded, "base64")
        );
        const root = findXmlNode(
          parseXml(normalizeFormParams(source, true)),
          "SPXML-INLINE-FORM"
        );
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
      }).catch(() => void 0);
      this.files.set(url, cached);
    }
    return cached;
  }
  async read(library) {
    this.shared ??= this.applicationInfo().then((info) => {
      if (!Array.isArray(info.shared_docs)) throw new Error();
      return info.shared_docs.filter((file) => {
        if (!file || typeof file.id !== "string" || typeof file.url !== "string") return false;
        try {
          const url = new URL(file.url);
          return url.hostname.toLowerCase() !== String(info.default_db_name).toLowerCase() && !(url.protocol === "x-local:" && url.hostname === "data_local");
        } catch {
          return true;
        }
      });
    }).catch(() => {
      this.shared = void 0;
      return void 0;
    });
    const shared = await this.shared;
    if (!shared) return void 0;
    const files = shared.filter((file) => library === void 0 || file.id === library);
    const targets2 = /* @__PURE__ */ new Map();
    const skipped = /* @__PURE__ */ new Set();
    for (let offset = 0; offset < files.length; offset += 4) {
      const batch = files.slice(offset, offset + 4);
      const results = await Promise.all(batch.map((file) => this.file(file)));
      results.forEach((result, index) => {
        if (result === void 0) skipped.add(batch[index].id);
        else
          for (const fn of result) {
            const id = `${batch[index].id}.${fn.id}`;
            targets2.set(id, { ...fn, id });
          }
      });
    }
    return {
      targets: [...targets2.values()].sort((a, b) => a.id.localeCompare(b.id)),
      skipped: [...skipped]
    };
  }
};

// src/schema.ts
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
var parser2 = createPlatformXmlParser({
  preserveOrder: true,
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false
});
var list = (value) => (Array.isArray(value) ? value : [value]).filter((v) => !!v && typeof v === "object");
var data = (value) => list(value)[0] ?? {};
var text = (value) => typeof value === "string" ? value : "";
var name2 = (node) => Object.keys(node).find((key) => !/^[#?:]/.test(key)) ?? "";
var children2 = (node) => Array.isArray(node[name2(node)]) ? node[name2(node)] : [];
var attr = (node, key) => text(data(node[":@"])[`@_${key}`]);
var find = (nodes, target) => {
  for (const node of nodes) {
    if (name2(node) === target) return node;
    const found = find(children2(node), target);
    if (found) return found;
  }
  return void 0;
};
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
  const folder = language === void 0 ? languages[text(id)] ?? "russian" : languages[language] ?? language;
  return `x-local://lngs/${identifier(folder, "language")}/const.xml`;
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
var SchemaReader = class {
  constructor(applicationInfo, readForm, readDocument) {
    this.applicationInfo = applicationInfo;
    this.readForm = readForm;
    this.readDocument = readDocument;
  }
  forms = /* @__PURE__ */ new Map();
  shapes = /* @__PURE__ */ new Map();
  dictionaries = /* @__PURE__ */ new Map();
  common;
  custom;
  form(url) {
    let cached = this.forms.get(url);
    if (!cached) {
      cached = this.readForm(url).then((source) => {
        const normalized = normalizeFormParams(source);
        try {
          validatePlatformXmlSource(normalized);
          const root = find(parser2.parse(normalized), "SPXML-FORM");
          if (root) return children2(root).filter((node) => name2(node));
        } catch {
          throw new HcmError("FORM_RESPONSE", "Сервер вернул форму с ошибкой в XML.");
        }
        throw new HcmError("FORM_RESPONSE", "В ответе сервера нет формы (SPXML-FORM).");
      });
      this.forms.set(url, cached);
    }
    return cached;
  }
  /**
   * Field types for the check after a write. A base type gives its fields to the place that names
   * it: without them a logical value the server stores as 1 would not equal the true that was sent.
   */
  async documentForm(url) {
    const samples = /* @__PURE__ */ new Map();
    const roots = (await this.samples(url, samples)).filter(
      (node) => !/^(USE|INCLUDE|On|METHOD|PROPERTY|SCRIPT)/.test(name2(node))
    );
    const fields3 = (nodes, prefix = "", stack = [], depth = 0) => {
      if (depth > 32) return [];
      return nodes.flatMap((node) => {
        const key = name2(node);
        const base = attr(node, "TYPE");
        const sample = samples.has(base) && !stack.includes(base) ? samples.get(base) : void 0;
        const inherited = sample ? [...stack, base] : stack;
        if (key === "INHERIT")
          return sample ? fields3(children2(sample), prefix, inherited, depth + 1) : [];
        if (!key || ["OnBeforeSave", "OnCreate"].includes(key)) return [];
        const path = prefix ? `${prefix}.${key}` : key;
        return [
          { path, type: base || "element", multiple: attr(node, "MULTIPLE") === "1" },
          ...sample ? fields3(children2(sample), path, inherited, depth + 1) : [],
          ...fields3(children2(node), path, stack, depth + 1)
        ];
      });
    };
    return { roots: roots.map(name2), fields: roots.flatMap((root) => fields3(children2(root))) };
  }
  shared(info, id) {
    const url = text(list(info.shared_docs).find((item) => item.id === id)?.url);
    if (!url)
      return Promise.reject(
        new HcmError("SCHEMA_METADATA", `Сервер не сообщил адрес общего документа ${id}.`)
      );
    return id === "common" ? this.readForm(url).then((source) => XmlDocument.parse(source).snapshot().data) : this.readDocument(url);
  }
  commonData(info) {
    if (!this.common) {
      const reading2 = this.common = this.shared(info, "common");
      reading2.catch(() => {
        if (this.common === reading2) this.common = void 0;
      });
    }
    return this.common;
  }
  /** Object types the server declares; an empty list when the declaration cannot be read. */
  async declaredTypes(info) {
    const common = await this.commonData(info).catch(() => ({}));
    return list(data(common.exchange_object_types).exchange_object_type);
  }
  customData(info) {
    if (!this.custom || this.custom.expires <= Date.now())
      this.custom = { expires: Date.now() + 6e4, value: this.shared(info, "custom_templates") };
    return this.custom.value;
  }
  language(info, language) {
    const folder = languageFileUrl(info.ui_lang_id, language);
    let cached = this.dictionaries.get(folder);
    if (!cached) {
      cached = this.readDocument(folder).then(
        (value) => new Map(
          list(data(value.items).item ?? value.item).map((item) => [
            text(item.id),
            text(item.val)
          ])
        )
      );
      this.dictionaries.set(folder, cached);
    }
    return cached;
  }
  unknownType(info, type, declared = []) {
    const catalogs = this.catalogs(info);
    const own = catalogs.filter((item) => item.id === type).map((item) => text(item.object_type));
    const types = [
      ...catalogs.map((item) => text(item.object_type)),
      ...declared.map((item) => text(item.name))
    ].filter(Boolean);
    if (types.includes(type)) return void 0;
    const near = [
      .../* @__PURE__ */ new Set([
        ...own.filter(Boolean),
        ...types.filter((item) => item.includes(type) || type.includes(item))
      ])
    ].slice(0, 5);
    const rows = catalogs.filter((item) => !text(item.object_type) && text(item.id).startsWith(type)).map((item) => text(item.id)).slice(0, 3);
    return new HcmError(
      "UNKNOWN_TYPE",
      `На сервере нет типа объекта ${type}.`,
      `${near.length ? `Похожие: ${near.join(", ")}. ` : ""}${rows.length ? `Каталог без своего типа объекта: ${rows.join(", ")} — его поля показывает схема по имени каталога. ` : ""}Типы объектов показывает schema.types.`
    );
  }
  /**
   * A name that is not an object type is refused before anything is written. The check needs the
   * server's lists: when they cannot be read, the name is left to the server.
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
   * Whether rows of this type are documents. Rows of the other catalogs (group_collaborators)
   * are built by the server and have no document; the answer is yes when it cannot be told.
   */
  async hasDocuments(info, type) {
    if (this.catalogs(info).some((item) => item.object_type === type)) return true;
    const declared = await this.declaredTypes(info);
    return !declared.length || declared.some((item) => item.name === type);
  }
  /**
   * Catalogs of the main database. The server names the object type only for some of them. Next to
   * them it lists its common lists (common.…): those are not catalogs and are left out.
   */
  catalogs(info) {
    const databases = list(info.databases);
    return list(
      (databases.find((db) => db.id === info.default_db_name) ?? databases[0])?.catalogs
    ).filter((item) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(text(item.id)));
  }
  /** Type of the rows of a catalog: named by the server or, failing that, by the catalog form. */
  async rowType(catalog) {
    const named = text(catalog.object_type);
    if (named || !text(catalog.form_url)) return named;
    const root = (await this.form(text(catalog.form_url))).find(
      (node) => name2(node) === catalog.id
    );
    const row = root && children2(root).find((node) => attr(node, "MULTIPLE") === "1");
    return row ? name2(row) : "";
  }
  /**
   * Catalogs whose rows are objects of the type. For some types (event) the server leaves the
   * catalog unnamed: then the catalog called after the type counts, if its form agrees.
   */
  async catalogsOf(info, type) {
    const catalogs = this.catalogs(info);
    const named = catalogs.filter((item) => item.object_type === type);
    if (named.length || !type) return named;
    const plural = catalogs.find((item) => item.id === `${type}s` && !text(item.object_type));
    return plural && await this.rowType(plural).catch(() => "") === type ? [{ ...plural, object_type: type }] : [];
  }
  async context(language) {
    const info = await this.applicationInfo();
    const notes = [];
    const dictionary = await this.language(info, language).catch(() => {
      notes.push(
        `Файл языка ${languageFileUrl(info.ui_lang_id, language)} прочитать не удалось: заголовки, которые берутся из него, показаны как есть.`
      );
      return /* @__PURE__ */ new Map();
    });
    const custom = await this.customData(info).catch(() => {
      notes.push(
        "Документ с настраиваемыми полями прочитать не удалось: настраиваемых полей в ответе нет."
      );
      return {};
    });
    return { info, dictionary, custom, notes };
  }
  title(value, dictionary) {
    if (value.startsWith("const="))
      return dictionary.get(value.slice(6)) ?? (dictionary.size ? "" : value);
    return /^##(['"])([\s\S]*)\1##$/.exec(value)?.[2] ?? value;
  }
  typeTranslations(info) {
    const url = `x-local://i18n/common/${identifier(info.ui_lang_id ?? "ru", "ui_lang_id")}/const.json`;
    let cached = this.dictionaries.get(url);
    if (!cached) {
      cached = this.readForm(url).then(
        (source) => new Map(
          Object.entries(data(JSON.parse(source))).map(([key, value]) => [key, text(value)])
        )
      ).catch(() => /* @__PURE__ */ new Map());
      this.dictionaries.set(url, cached);
    }
    return cached;
  }
  typeTitle(definition2, dictionary, translations) {
    const expression = text(definition2.title).trim();
    const call = /^(i18n\.t|ms_tools\.get_const)\s*\(\s*'([^'\\]*)'\s*\)$/.exec(expression);
    if (call) return (call[1] === "i18n.t" ? translations : dictionary).get(call[2]) ?? "";
    const literal2 = /^'([^'\\]*)'$/.exec(expression);
    if (literal2) return literal2[1];
    const constant = text(definition2.web_const);
    return constant ? this.title(constant.startsWith("const=") ? constant : `const=${constant}`, dictionary) : "";
  }
  async samples(url, samples, visited = /* @__PURE__ */ new Set()) {
    if (visited.has(url)) return [];
    if (visited.size >= 64)
      throw new HcmError("FORM_DEPTH_LIMIT", "Форма подключает больше 64 других форм.");
    visited.add(url);
    const nodes = await this.form(url);
    for (const node of nodes) {
      if (["USE", "INCLUDE"].includes(name2(node)) && attr(node, "FORM")) {
        const target = attr(node, "FORM");
        await this.samples(
          target.startsWith("//") ? `x-local:${target}` : new URL(target, url).href,
          samples,
          visited
        );
      }
    }
    for (const node of nodes)
      if (!/^(USE|INCLUDE|On|DocDesc)/.test(name2(node))) samples.set(name2(node), node);
    return nodes;
  }
  /** Fields of one catalog row by path, read from the catalog form. */
  async catalogFields(catalog, type, samples) {
    const query = /* @__PURE__ */ new Map();
    if (!catalog || !text(catalog.form_url)) return query;
    const catalogRoots = await this.samples(text(catalog.form_url), samples);
    const roots = catalogRoots.filter((node) => attr(node, "SAMPLE") !== "1");
    const own = roots.find((node) => name2(node) === text(catalog.id));
    const record3 = find(roots, type) ?? (own ? children2(own).find((node) => attr(node, "MULTIPLE") === "1") : void 0);
    const collect = (nodes, prefix = "", stack = []) => {
      for (const node of nodes) {
        const key = name2(node);
        const base = attr(node, "TYPE");
        if (key === "INHERIT") {
          if (samples.has(base) && !stack.includes(base))
            collect(children2(samples.get(base)), prefix, [...stack, base]);
        } else if (key && !/^(On|DocDesc)/.test(key)) {
          const path = prefix ? `${prefix}.${key}` : key;
          query.set(path, node);
          if (samples.has(base) && !stack.includes(base))
            collect(children2(samples.get(base)), path, [...stack, base]);
          collect(children2(node), path, stack);
        }
      }
    };
    if (record3) collect(children2(record3));
    return query;
  }
  /** Shape of a document of one type, with inherited fields; read once per form. */
  documentShape(type, formUrl = `x-local://wtv/wtv_${type}.xmd`) {
    return this.shape(`${formUrl}#${type}`, async () => {
      const samples = /* @__PURE__ */ new Map();
      const roots = await this.samples(formUrl, samples);
      const root = roots.find((node) => name2(node) === type && attr(node, "SAMPLE") !== "1");
      const computed = /* @__PURE__ */ new Set();
      const stored = /* @__PURE__ */ new Set();
      const shape = {
        fields: /* @__PURE__ */ new Set(),
        repeated: /* @__PURE__ */ new Set(),
        dates: /* @__PURE__ */ new Set(),
        computed
      };
      const collect = (nodes, prefix = "", stack = []) => {
        if (stack.length > 64) return;
        for (const node of nodes) {
          const key = name2(node);
          const base = attr(node, "TYPE");
          const sample = samples.has(base) && !stack.includes(base) ? samples.get(base) : void 0;
          if (key === "INHERIT") {
            if (sample) collect(children2(sample), prefix, [...stack, base]);
            else if (!stack.includes(base)) shape.partial = true;
            continue;
          }
          if (!key || /^(On|DocDesc)/.test(key)) continue;
          const path = prefix ? `${prefix}.${key}` : key;
          if (!prefix) shape.fields.add(key);
          if (!prefix) (attr(node, "PROPERTY") === "1" ? computed : stored).add(key);
          if (!prefix && base === "date") shape.dates.add(key);
          if (attr(node, "MULTIPLE") === "1") shape.repeated.add(path);
          if (sample) collect(children2(sample), path, [...stack, base]);
          collect(children2(node), path, stack);
        }
      };
      if (root) collect(children2(root));
      for (const key of stored) computed.delete(key);
      return shape;
    });
  }
  /** Shape of one catalog row; the catalog is named or found by the object type of its rows. */
  async catalogShape(selector) {
    const info = await this.applicationInfo();
    const catalogs = selector.catalog === void 0 ? await this.catalogsOf(info, selector.type ?? "") : this.catalogs(info).filter((item) => item.id === selector.catalog);
    if (catalogs.length !== 1) return void 0;
    const catalog = catalogs[0];
    return this.shape(`catalog#${text(catalog.id)}`, async () => {
      const known = await this.catalogFields(catalog, await this.rowType(catalog), /* @__PURE__ */ new Map());
      const integers = /* @__PURE__ */ new Set();
      const shape = {
        fields: /* @__PURE__ */ new Set(),
        repeated: /* @__PURE__ */ new Set(),
        dates: /* @__PURE__ */ new Set(),
        integers
      };
      for (const [path, node] of known) {
        if (!path.includes(".")) shape.fields.add(path);
        if (!path.includes(".") && attr(node, "TYPE") === "date") shape.dates.add(path);
        if (!path.includes(".") && attr(node, "TYPE") === "integer") integers.add(path);
        if (attr(node, "MULTIPLE") === "1") shape.repeated.add(path);
      }
      return shape;
    });
  }
  shape(key, read) {
    let cached = this.shapes.get(key);
    if (!cached) {
      cached = read();
      this.shapes.set(key, cached);
      cached.catch(() => this.shapes.delete(key));
    }
    return cached;
  }
  /**
   * The server answers a refused catalog query with a bare HTTP 500. After such a refusal this
   * names the usual cause: a catalog that does not exist or a field that is not in the catalog.
   */
  async explainQuery(catalogId, fields3) {
    const info = await this.applicationInfo();
    const catalogs = this.catalogs(info);
    const catalog = catalogs.find((item) => item.id === catalogId);
    if (!catalog) {
      const near = [
        ...await this.catalogsOf(info, catalogId),
        ...catalogs.filter(
          (item) => text(item.id).includes(catalogId) || text(item.object_type) && catalogId.includes(text(item.object_type))
        )
      ].map((item) => text(item.id)).filter((item, index, all) => all.indexOf(item) === index).slice(0, 5);
      return new HcmError(
        "UNKNOWN_CATALOG",
        `На сервере нет каталога ${catalogId}.`,
        `${near.length ? `Похожие: ${near.join(", ")}. ` : ""}Каталоги и их типы объектов показывает schema.types.`
      );
    }
    if (!fields3.length) return void 0;
    const type = await this.rowType(catalog);
    const known = await this.catalogFields(catalog, type, /* @__PURE__ */ new Map());
    const unknown = fields3.filter((field) => !known.has(field));
    if (!known.size || !unknown.length) return void 0;
    const names = [...known.keys()].filter((name3) => !name3.includes("."));
    const listed = `${names.slice(0, 30).join(", ")}${names.length > 30 ? `… (всего ${names.length})` : ""}`;
    return new HcmError(
      "UNKNOWN_CATALOG_FIELD",
      `В каталоге ${catalogId} нет поля: ${unknown.join(", ")}.`,
      await this.hasDocuments(info, type) ? `Поиск идёт по строкам каталога, не по документам. Поля каталога: ${listed}; в schema.get для типа ${type} они отмечены query:true. Остальные поля документа читает objects.get.` : `Поля каталога: ${listed}; подробнее — schema.get по имени каталога ${catalogId}.`,
      { fields: unknown }
    );
  }
  async get(input2) {
    const limit = boundedInteger(input2.limit, 80, 1e3, "limit");
    const cursor = boundedInteger(input2.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor");
    const requestedType = input2.type === void 0 ? void 0 : identifier(input2.type, "type");
    let formUrl = input2.url === void 0 ? `x-local://wtv/wtv_${requiredString(requestedType, "type")}.xmd` : requiredString(input2.url, "url");
    const { info, custom, dictionary, notes } = await this.context(input2.language);
    try {
      await this.form(formUrl);
    } catch (error) {
      if (input2.url !== void 0 || requestedType === void 0) throw error;
      const declared = await this.declaredTypes(info);
      const alternative = text(declared.find((item) => item.name === requestedType)?.form_url) || text(this.catalogs(info).find((item) => item.id === requestedType)?.form_url);
      if (!alternative || alternative === formUrl) {
        throw this.unknownType(info, requestedType, declared) ?? error;
      }
      formUrl = alternative;
      await this.form(formUrl);
    }
    const samples = /* @__PURE__ */ new Map();
    const roots = await this.samples(formUrl, samples);
    const candidates = roots.filter(
      (node) => attr(node, "SAMPLE") !== "1" && !/^(USE|INCLUDE|On|DocDesc)/.test(name2(node))
    );
    const root = requestedType === void 0 ? candidates.length === 1 ? candidates[0] : void 0 : candidates.find((node) => name2(node) === requestedType);
    if (!root)
      throw new HcmError(
        "FORM_TYPE_MISMATCH",
        "Тип объекта в форме не определён: запрошенного типа в ней нет, или типов несколько, а type не задан."
      );
    const type = name2(root);
    const catalog = (await this.catalogsOf(info, type))[0];
    const mistaken = this.catalogs(info).find((item) => item.id === requestedType);
    const rows = mistaken ? await this.rowType(mistaken).catch(() => "") : "";
    const byCatalog = !!rows && rows !== requestedType;
    const rowsOnly = byCatalog && !await this.hasDocuments(info, rows);
    if (byCatalog)
      notes.push(
        rowsOnly ? `${requestedType} — каталог без своего типа объекта: документов у его строк нет. Поля строки — под ${rows}; в условиях и fields поиска их пишут без этой приставки.` : `${requestedType} — имя каталога; поля его объектов показывает тип ${rows}, поля строки каталога — path:"${rows}".`
      );
    const query = await this.catalogFields(catalog, type, samples);
    const fields3 = /* @__PURE__ */ new Map();
    const methods = /* @__PURE__ */ new Map();
    const baseType = (base, stack, inherit = false) => {
      if (stack.includes(base))
        throw new HcmError(
          "FORM_INHERITANCE",
          "Базовые типы формы ссылаются друг на друга по кругу."
        );
      const sample = samples.get(base);
      if (!sample && (inherit || base && !/^(string|integer|real|bool|date|variant|record|attr)$/.test(base))) {
        const note = `Базовый тип ${base} не найден: его поля в ответ не попали.`;
        if (!notes.includes(note)) notes.push(note);
      }
      return sample;
    };
    const walk = (nodes, prefix = "", origin = "own", stack = []) => {
      if (stack.length > 64)
        throw new HcmError("FORM_DEPTH_LIMIT", "Наследование в форме глубже 64 уровней.");
      for (const node of nodes) {
        const key = name2(node);
        const base = attr(node, "TYPE");
        if (key === "INHERIT") {
          const sample2 = baseType(base, stack, true);
          if (sample2)
            walk(children2(sample2), prefix, origin === "own" ? `inherited:${base}` : origin, [
              ...stack,
              base
            ]);
          continue;
        }
        if (!key || /^(On|DocDesc)$|^On/.test(key) || attr(node, "TEMP") === "1") continue;
        const path2 = prefix ? `${prefix}.${key}` : key;
        const catalogNode = query.get(path2);
        const parameters = Object.entries(data(node[":@"])).filter(([key2]) => /^@_PARAM__\d+$/.test(key2)).map(([, value]) => text(value));
        const computed = attr(node, "PROPERTY") === "1";
        if (computed && (parameters.length || !attr(node, "TITLE") && !catalogNode)) {
          methods.set(path2, { name: path2, parameters });
          continue;
        }
        const title = this.title(
          attr(node, "TITLE") || (catalogNode ? attr(catalogNode, "TITLE") : ""),
          dictionary
        );
        const sample = baseType(base, stack);
        const field = {
          path: path2,
          type: (sample ? "" : base) || (!children2(node).some((child) => name2(child)) && catalogNode ? attr(catalogNode, "TYPE") : "") || "element",
          origin
        };
        if (title) field.title = title;
        if (attr(node, "FOREIGN-ARRAY")) field.references = attr(node, "FOREIGN-ARRAY");
        if (attr(node, "MULTIPLE") === "1") field.multiple = true;
        if (attr(node, "NOT-NULL") === "1") field.required = true;
        if (attr(node, "PRIMARY-KEY")) field.key = attr(node, "PRIMARY-KEY");
        if (computed) field.computed = true;
        if (catalogNode) field.query = true;
        fields3.set(path2, field);
        if (sample) {
          walk(children2(sample), path2, origin === "own" ? `inherited:${base}` : origin, [
            ...stack,
            base
          ]);
        }
        walk(children2(node), path2, origin, stack);
      }
    };
    walk(children2(root));
    if (byCatalog)
      for (const key of (await this.catalogFields(mistaken, rows, samples)).keys()) {
        const field = fields3.get(`${rows}.${key}`);
        if (field) field.query = true;
      }
    for (const [path2, node] of query) {
      if (path2.includes(".") || fields3.has(path2) || methods.has(path2)) continue;
      const property = attr(node, "PROPERTY") === "1";
      const title = this.title(attr(node, "TITLE"), dictionary);
      fields3.set(path2, {
        path: path2,
        type: attr(node, "TYPE") || "string",
        origin: "catalog",
        ...title ? { title } : {},
        ...attr(node, "FOREIGN-ARRAY") ? { references: attr(node, "FOREIGN-ARRAY") } : {},
        ...attr(node, "MULTIPLE") === "1" ? { multiple: true } : {},
        ...property ? { computed: true } : { query: true }
      });
    }
    for (const field of fields3.values()) {
      const count = [...fields3.keys()].filter(
        (path2) => path2.startsWith(`${field.path}.`) && !path2.slice(field.path.length + 1).includes(".")
      ).length;
      if (count) field.children = count;
    }
    const template = data(custom[type]);
    const templateField = text(template.template_field);
    const templates = [template];
    if (templateField) {
      if (input2.kind === void 0)
        notes.push(
          `Вид объекта хранится в поле ${templateField}_id: его значение передаётся в kind, чтобы увидеть настраиваемые поля этого вида.`
        );
      else {
        const kind = list(data(data(custom[templateField]).items).item).find(
          (item) => text(item.id) === input2.kind
        );
        if (kind) templates.push(kind);
        else notes.push(`Вида ${input2.kind} нет в списке ${templateField}.`);
      }
    }
    for (const template2 of templates) {
      const sheets = new Map(
        list(data(template2.sheets).sheet).map((sheet) => [text(sheet.id), text(sheet.title)])
      );
      for (const item of list(data(template2.fields).field)) {
        const name3 = text(item.name);
        if (!name3) continue;
        const field = {
          path: `custom_elems.custom_elem[name=${name3}].value`,
          name: name3,
          type: text(item.type) || "string",
          origin: "custom"
        };
        const title = this.title(text(item.title), dictionary);
        const values = list(data(item.entries).entry).map((entry2) => text(entry2.value)).filter(Boolean);
        const sheet = sheets.get(text(item.sheet_id));
        if (title) field.title = title;
        if (item.is_required === "1" || item.is_required === "true" || item.is_required === true)
          field.required = true;
        if (text(item.catalog)) field.references = text(item.catalog);
        if (values.length) field.values = values;
        if (sheet) field.sheet = this.title(sheet, dictionary);
        fields3.set(field.path, field);
      }
    }
    const path = input2.path ?? (rowsOnly && input2.search === void 0 && fields3.has(rows) ? rows : void 0);
    const selected = [...fields3.values()].filter(
      (field) => (!input2.origin || input2.origin.includes(
        field.origin.split(":")[0]
      )) && (path !== void 0 ? field.path.startsWith(`${path}.`) && (input2.deep || input2.search !== void 0 || !field.path.slice(path.length + 1).includes(".")) : input2.deep || input2.search !== void 0 || field.origin === "custom" || !field.path.includes(".")) && matches(input2.search, [field.path, field.name, field.title, field.references])
    );
    const element = path === void 0 ? void 0 : fields3.get(path);
    if (path !== void 0 && !element)
      notes.push(`Поля ${path} в типе ${type} нет: путь ищет search.`);
    const found = input2.include?.includes("methods") ? [...methods.values()].filter((method) => matches(input2.search, [method.name])) : void 0;
    if (input2.search !== void 0 && !selected.length && !found?.length)
      notes.push(
        nothingFound(
          "в пути, заголовке поля и имени каталога, на который оно ссылается",
          "hire, mail",
          input2.search,
          "поле"
        )
      );
    const result = {
      type,
      ...catalog ? { catalog: text(catalog.id) } : {},
      formUrl,
      ...element ? { element } : {},
      fields: [],
      total: selected.length,
      notes
    };
    if (found) result.methods = found;
    for (const field of selected.slice(cursor, cursor + limit)) {
      result.fields.push(field);
      result.nextCursor = cursor + result.fields.length;
      if (result.nextCursor >= selected.length) delete result.nextCursor;
      if (pageSize(result) > 16 * 1024 - 32) {
        result.fields.pop();
        break;
      }
    }
    if (cursor + result.fields.length < selected.length) {
      result.nextCursor = cursor + result.fields.length;
      if (result.fields.length < limit) result.cutBySize = true;
    } else delete result.nextCursor;
    if (pageSize(result) > 16 * 1024 || !result.fields.length && cursor < selected.length && limit > 0)
      throw new HcmError(
        "SCHEMA_PAGE_LIMIT",
        "Одно поле или методы формы не помещаются на страницу схемы: выборку нужно сузить."
      );
    return result;
  }
  async types(input2 = {}) {
    const limit = boundedInteger(input2.limit, 50, 1e3, "limit");
    const cursor = boundedInteger(input2.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor");
    const { info, custom, dictionary } = await this.context();
    const translations = await this.typeTranslations(info);
    const common = await this.commonData(info);
    const definitions = list(data(common.exchange_object_types).exchange_object_type);
    const named = this.catalogs(info).filter((item) => text(item.object_type));
    const unnamed = [];
    for (const definition2 of definitions) {
      const type = text(definition2.name);
      if (!type || named.some((item) => item.object_type === type)) continue;
      unnamed.push((await this.catalogsOf(info, type))[0] ?? { object_type: type });
    }
    const types = [...named, ...unnamed].map((catalog) => {
      const type = text(catalog.object_type);
      const definition2 = definitions.find((item) => item.name === type);
      const title = this.typeTitle(definition2 ?? {}, dictionary, translations);
      const template = data(custom[type]);
      return {
        type,
        ...text(catalog.id) ? { catalog: text(catalog.id) } : {},
        ...title ? { title } : {},
        customFields: text(template.template_field) ? "by kind" : list(data(template.fields).field).length
      };
    }).filter((item) => matches(input2.search, [item.type, item.catalog, item.title]));
    const listed = new Set(types.map((item) => item.catalog));
    const untyped = input2.search === void 0 ? [] : this.catalogs(info).filter((item) => !text(item.object_type)).map((item) => text(item.id)).filter(
      (id) => !listed.has(id) && (matches(input2.search, [id]) || types.length <= 20 && types.some((item) => id.startsWith(`${item.type}_`)))
    ).slice(0, 5);
    return {
      types: types.slice(cursor, cursor + limit),
      total: types.length,
      catalogs: this.catalogs(info).length,
      ...cursor + limit < types.length ? { nextCursor: cursor + limit } : {},
      ...input2.search !== void 0 && (!types.length || untyped.length) ? {
        notes: [
          untyped.length ? `${types.length ? "Каталоги" : "Типа с таким именем нет; есть каталоги"} без своего типа объекта: ${untyped.join(", ")}. Поля строки показывает схема по имени каталога.` : nothingFound(
            "в имени типа, имени каталога и заголовке",
            "collab, group",
            input2.search,
            "типе"
          )
        ]
      } : {}
    };
  }
};

// src/results.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { mkdir, readFile, rename, stat, open, unlink } from "node:fs/promises";
import { constants, copyFile, link, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
async function writeResultFile(path, chunks, overwrite = false) {
  const target = resolve(path);
  if ((await stat(target).catch(() => void 0))?.isDirectory())
    throw new HcmError(
      "INVALID_ARGUMENT",
      "path: по этому пути папка, а нужен путь к файлу.",
      "К пути нужно добавить имя файла, например result.json."
    );
  const temporary = `${target}.${randomUUID2()}.tmp`;
  try {
    await writeFile(temporary, chunks, { encoding: "utf8", mode: 384, flag: "wx" });
    const bytes = (await stat(temporary)).size;
    if (overwrite) await rename(temporary, target);
    else
      await link(temporary, target).catch((error) => {
        if (error.code === "EEXIST") throw error;
        return copyFile(temporary, target, constants.COPYFILE_EXCL);
      });
    return bytes;
  } catch (error) {
    const code = error.code;
    if (code === "EEXIST")
      throw new HcmError(
        "FILE_EXISTS",
        "Файл по этому пути уже есть.",
        "Нужно разрешить замену файла (overwrite) или выбрать другой путь."
      );
    if (code === "ENOENT")
      throw new HcmError(
        "FOLDER_NOT_FOUND",
        "Папки для файла нет.",
        "Сначала нужно создать папку."
      );
    throw error;
  } finally {
    await unlink(temporary).catch(() => {
    });
  }
}
async function* jsonLines(source, count, list2 = "items") {
  const name3 = JSON.stringify(list2).slice(1);
  let depth = 0, selected = -1, quoted = 0, key = "", row = false;
  for await (const chunk of source) {
    let output = "";
    for (const char of chunk) {
      if (selected > 0 && depth >= selected) {
        const end = !quoted && depth === selected && (char === "," || char === "]");
        output += end ? row ? "\n" : "" : char;
        if (end && row) count.items++;
        row = !end;
        if (end && char === "]") selected = 0;
      }
      if (quoted) {
        if (depth === 1 && key.length < name3.length) key += char;
        quoted = quoted === 2 ? 1 : char === "\\" ? 2 : char === '"' ? 0 : 1;
      } else if (char === '"') {
        quoted = 1;
        key = "";
      } else {
        if (char === "[" && selected < 0 && (!depth || depth === 1 && key === name3))
          selected = depth + 1;
        if (char === "[" || char === "{") depth++;
        if (char === "]" || char === "}") depth--;
        if (char !== ":") key = "";
      }
    }
    yield output;
  }
  if (selected < 0) throw exportFormatError();
}
var exportFormatError = () => new HcmError(
  "INVALID_RESULT_FORMAT",
  "Этот результат нельзя отдать в запрошенном формате.",
  "text подходит сохранённой строке и ответу с полем text, jsonl — списку; json подходит любому результату."
);
function textOf(data2) {
  if (typeof data2 === "string") return data2;
  if (data2 === null || typeof data2 !== "object" || Array.isArray(data2)) return void 0;
  const text3 = data2.text;
  return typeof text3 === "string" ? text3 : void 0;
}
function listOf(data2) {
  if (data2 === null || typeof data2 !== "object" || Array.isArray(data2)) return void 0;
  if (textOf(data2) !== void 0) return void 0;
  let found;
  for (const [key, value] of Object.entries(data2)) {
    if (!Array.isArray(value) || value.length < 2 || key.length > 256) continue;
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > (found?.bytes ?? 0)) found = { key, items: value, bytes };
  }
  return found && found.bytes * 2 > Buffer.byteLength(JSON.stringify(data2)) ? found : void 0;
}
var CHUNK_CHARS = 65536;
var RECORD_BYTES = 16;
var MAX_METADATA_BYTES = 4096;
function invalid() {
  return new HcmError(
    "RESULT_INVALID",
    "Сохранённый результат не читается: его файлы повреждены или неполны."
  );
}
function natural(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function record(first, second) {
  const bytes = Buffer.alloc(RECORD_BYTES);
  bytes.writeBigUInt64LE(BigInt(first));
  bytes.writeBigUInt64LE(BigInt(second), 8);
  return bytes;
}
function numbers(bytes) {
  const first = Number(bytes.readBigUInt64LE());
  const second = Number(bytes.readBigUInt64LE(8));
  if (!natural(first) || !natural(second)) throw invalid();
  return [first, second];
}
async function writeAll(file, bytes) {
  for (let offset = 0; offset < bytes.length; ) {
    const written = (await file.write(bytes, offset, bytes.length - offset)).bytesWritten;
    if (!written) throw new Error("Result write did not progress");
    offset += written;
  }
}
async function readExactly(file, position, length) {
  const bytes = Buffer.alloc(length);
  for (let offset = 0; offset < length; ) {
    const read = (await file.read(bytes, offset, length - offset, position + offset)).bytesRead;
    if (!read) throw invalid();
    offset += read;
  }
  return bytes;
}
async function reading(paths, action) {
  const files = [];
  try {
    for (const path of paths) files.push(await open(path, "r"));
    return await action(files);
  } finally {
    await Promise.all(files.map((file) => file.close()));
  }
}
function high(value) {
  return /[\uD800-\uDBFF]/.test(value);
}
function low(value) {
  return /[\uDC00-\uDFFF]/.test(value);
}
var JsonWriter = class {
  constructor(body, index) {
    this.body = body;
    this.index = index;
  }
  bytes = 0;
  chars = 0;
  checkpoints = 0;
  pending = "";
  async append(text3) {
    for (let offset = 0; offset < text3.length; ) {
      if (!this.pending) {
        await writeAll(this.index, record(this.chars, this.bytes));
        this.checkpoints++;
      }
      let length = Math.min(CHUNK_CHARS - this.pending.length, text3.length - offset);
      if (high(text3.charAt(offset + length - 1)) && low(text3.charAt(offset + length))) length--;
      if (!length) {
        await this.flush();
        continue;
      }
      const part = text3.slice(offset, offset + length);
      this.pending += part;
      this.chars += part.length;
      this.bytes += Buffer.byteLength(part);
      offset += length;
      if (this.pending.length >= CHUNK_CHARS) await this.flush();
    }
  }
  async flush() {
    if (this.pending) {
      await writeAll(this.body, Buffer.from(this.pending));
      this.pending = "";
    }
  }
};
var ResultStore = class {
  constructor(config) {
    this.config = config;
    const scope = createHash2("sha256").update(`${config.name}
${config.baseUrl}
${config.username ?? "anonymous"}`).digest("hex").slice(0, 24);
    this.directory = join(resolve(config.runtimeDir), scope, "results");
  }
  directory;
  path(id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
      throw new HcmError(
        "INVALID_RESULT_ID",
        "resultId неверен: нужен ID из meta.resultId ответа."
      );
    return join(this.directory, `${id}.json`);
  }
  payload(id, extension) {
    this.path(id);
    return join(this.directory, `${id}.${extension}`);
  }
  async export(input2, envelope) {
    const id = requiredString(input2.resultId, "resultId"), path = requiredString(input2.path, "path");
    const format = input2.format ?? "json";
    if (!["json", "jsonl", "text"].includes(format)) throw exportFormatError();
    if (envelope) await mkdir(dirname(resolve(path)), { recursive: true });
    const count = { items: 0 };
    const store = this;
    const source = async function* () {
      for (let offset = 0; offset !== void 0; ) {
        const page = await store.read(id, offset, 65536, format === "text" ? "text" : "json");
        if (format === "text" && page.format !== "text") throw exportFormatError();
        yield String(page.text);
        offset = page.nextOffset;
      }
    };
    const wrapped = async function* () {
      if (envelope) {
        const { truncated: _, ...meta } = envelope.meta;
        yield `${JSON.stringify({ ...envelope, data: void 0, meta }).slice(0, -1)},"data":`;
      }
      yield* format === "jsonl" ? jsonLines(source(), count, await store.listName(id)) : source();
      if (envelope) yield "}\n";
    };
    const bytes = await writeResultFile(path, wrapped(), input2.overwrite === true);
    return { path, bytes, format, ...format === "jsonl" ? count : {} };
  }
  async listName(id) {
    try {
      const manifest = this.path(id);
      if ((await stat(manifest)).size > MAX_METADATA_BYTES) return void 0;
      const list2 = JSON.parse(await readFile(manifest, "utf8")).list;
      return typeof list2 === "string" ? list2 : void 0;
    } catch {
      return void 0;
    }
  }
  async put(data2) {
    const id = randomUUID2();
    const created = [];
    const files = [];
    const create = async (path) => {
      const file = await open(`${path}.tmp`, "wx", 384);
      files.push(file);
      created.push(`${path}.tmp`);
      return file;
    };
    try {
      await mkdir(this.directory, { recursive: true });
      const body = await create(this.payload(id, "data.json"));
      const index = await create(this.payload(id, "data.idx"));
      const writer = new JsonWriter(body, index);
      const metadata = {
        version: 2,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        kind: Array.isArray(data2) ? "array" : typeof data2 === "string" ? "string" : "json",
        jsonBytes: 0,
        jsonChars: 0,
        checkpoints: 0
      };
      const list2 = listOf(data2);
      const elements = Array.isArray(data2) ? data2 : list2?.items;
      if (elements) {
        const rows = await create(this.payload(id, "rows.idx"));
        metadata.rows = elements.length;
        if (list2) metadata.list = list2.key;
        await writer.append(list2 ? `{${JSON.stringify(list2.key)}:[` : "[");
        let pendingIndex = [];
        for (const [position, item] of elements.entries()) {
          if (position) await writer.append(",");
          const serialised = JSON.stringify(item) ?? "null";
          pendingIndex.push(record(writer.bytes, Buffer.byteLength(serialised)));
          if (pendingIndex.length >= 4096) {
            await writeAll(rows, Buffer.concat(pendingIndex));
            pendingIndex = [];
          }
          await writer.append(serialised);
        }
        if (pendingIndex.length) await writeAll(rows, Buffer.concat(pendingIndex));
        await writer.append("]");
        if (list2) {
          const rest = JSON.stringify({ ...data2, [list2.key]: void 0 });
          await writer.append(rest === "{}" ? "}" : `,${rest.slice(1)}`);
        }
      } else {
        const serialised = JSON.stringify(data2);
        if (serialised === void 0)
          throw new HcmError("RESULT_SERIALIZATION", "Результат — не значение JSON.");
        await writer.append(serialised);
      }
      await writer.flush();
      Object.assign(metadata, {
        jsonBytes: writer.bytes,
        jsonChars: writer.chars,
        checkpoints: writer.checkpoints
      });
      const text3 = textOf(data2);
      if (text3 !== void 0) {
        const plain = await create(this.payload(id, "text.bin"));
        metadata.textChars = text3.length;
        for (let offset = 0; offset < text3.length; offset += CHUNK_CHARS)
          await writeAll(plain, Buffer.from(text3.slice(offset, offset + CHUNK_CHARS), "utf16le"));
      }
      await Promise.all(files.map((file) => file.close()));
      files.length = 0;
      for (const temporary of [...created]) {
        const target = temporary.slice(0, -4);
        await rename(temporary, target);
        created.push(target);
      }
      const manifest = this.path(id);
      const metadataFile = await create(manifest);
      await writeAll(metadataFile, Buffer.from(JSON.stringify(metadata)));
      await metadataFile.close();
      files.length = 0;
      await rename(`${manifest}.tmp`, manifest);
      created.push(manifest);
      return { resultId: id, bytes: writer.bytes, ...list2 ? { list: list2.key } : {} };
    } catch (error) {
      await Promise.allSettled(files.map((file) => file.close()));
      await Promise.allSettled(created.map((path) => unlink(path)));
      if (error instanceof HcmError) throw error;
      if (error instanceof TypeError)
        throw new HcmError("RESULT_SERIALIZATION", "Результат нельзя записать как JSON.");
      throw new HcmError(
        "RESULT_WRITE_FAILED",
        "Не удалось сохранить результат на этом компьютере.",
        "Проверить права на папку runtimeDir и свободное место на диске."
      );
    }
  }
  async read(id, offsetValue, limitValue, formatValue) {
    const manifest = this.path(id);
    if (formatValue !== void 0 && !["auto", "json", "text"].includes(formatValue))
      throw new HcmError("INVALID_RESULT_FORMAT", "format: нужно auto, json или text.");
    let size;
    try {
      size = (await stat(manifest)).size;
    } catch {
      throw new HcmError(
        "RESULT_NOT_FOUND",
        "Результата с таким resultId нет, или он сохранён другим подключением."
      );
    }
    if (size > MAX_METADATA_BYTES)
      return this.legacy(manifest, size, offsetValue, limitValue, formatValue);
    let envelope;
    try {
      envelope = JSON.parse(await readFile(manifest, "utf8"));
    } catch {
      throw invalid();
    }
    if (envelope !== null && typeof envelope === "object" && "version" in envelope && envelope.version === 1)
      return this.legacy(manifest, size, offsetValue, limitValue, formatValue);
    const metadata = this.metadata(envelope);
    const arrayPage = (metadata.kind === "array" || metadata.list !== void 0) && formatValue !== "json";
    const offset = boundedInteger(offsetValue, 0, Number.MAX_SAFE_INTEGER, "offset");
    const asked = boundedInteger(limitValue, arrayPage ? 100 : 12e3, 65536, "limit");
    if (!asked) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    const limit = arrayPage ? Math.min(asked, 1e3) : asked;
    try {
      await this.assertSize(this.payload(id, "data.json"), metadata.jsonBytes);
      await this.assertSize(this.payload(id, "data.idx"), metadata.checkpoints * RECORD_BYTES);
      if (arrayPage && formatValue !== "text") return await this.array(id, metadata, offset, limit);
      if (formatValue === "text" && metadata.textChars === void 0) throw exportFormatError();
      const plain = metadata.textChars !== void 0 && formatValue !== "json";
      const total = plain ? metadata.textChars : metadata.jsonChars;
      const text3 = plain ? await this.plain(id, metadata, offset, limit) : await this.json(id, metadata, offset, limit);
      return this.textPage(text3, offset, total, limit, plain ? "text" : "json");
    } catch (error) {
      if (error instanceof HcmError) throw error;
      throw invalid();
    }
  }
  metadata(value) {
    if (value === null || typeof value !== "object") throw invalid();
    const source = value;
    if (source.version !== 2 || !["array", "string", "json"].includes(String(source.kind)) || typeof source.createdAt !== "string" || !natural(source.jsonBytes) || source.jsonBytes < 1 || !natural(source.jsonChars) || source.jsonChars < 1 || !natural(source.checkpoints) || source.checkpoints < 1 || source.checkpoints > source.jsonChars || source.checkpoints * RECORD_BYTES > Number.MAX_SAFE_INTEGER || source.checkpoints < Math.ceil(source.jsonChars / CHUNK_CHARS) || source.checkpoints > Math.ceil(source.jsonChars / (CHUNK_CHARS - 1)) || source.kind === "array" && (!natural(source.rows) || source.rows * RECORD_BYTES > Number.MAX_SAFE_INTEGER) || source.list !== void 0 && (typeof source.list !== "string" || source.kind !== "json" || !natural(source.rows) || source.rows * RECORD_BYTES > Number.MAX_SAFE_INTEGER) || source.kind === "string" && source.textChars === void 0 || source.kind === "array" && source.textChars !== void 0 || source.textChars !== void 0 && (!natural(source.textChars) || source.textChars * 2 > Number.MAX_SAFE_INTEGER))
      throw invalid();
    return source;
  }
  async assertSize(path, expected) {
    if ((await stat(path)).size !== expected) throw invalid();
  }
  async array(id, metadata, offset, limit) {
    const count = metadata.rows;
    await this.assertSize(this.payload(id, "rows.idx"), count * RECORD_BYTES);
    if (offset >= count)
      return {
        items: [],
        total: count,
        ...metadata.list === void 0 ? {} : { list: metadata.list }
      };
    return reading(
      [this.payload(id, "rows.idx"), this.payload(id, "data.json")],
      async ([index, body]) => {
        const selected = await readExactly(
          index,
          offset * RECORD_BYTES,
          Math.min(limit, count - offset) * RECORD_BYTES
        );
        const items = [];
        let used = 128;
        for (let position = 0; position < selected.length; position += RECORD_BYTES) {
          const [start, bytes] = numbers(selected.subarray(position, position + RECORD_BYTES));
          if (start < 1 || !bytes || start + bytes >= metadata.jsonBytes) throw invalid();
          if (used + bytes > this.config.outputLimitBytes / 2) {
            if (!items.length)
              return {
                items,
                total: count,
                blockedItem: { index: offset, bytes },
                hint: "Элемент blockedItem не помещается в ответ и не пропущен. Читать результат с format:json — текстом JSON по частям."
              };
            break;
          }
          items.push(
            JSON.parse(
              new TextDecoder("utf8", { fatal: true }).decode(
                await readExactly(body, start, bytes)
              )
            )
          );
          used += bytes + 1;
        }
        return {
          items,
          total: count,
          ...offset + items.length < count ? { nextOffset: offset + items.length } : {},
          ...items.length < Math.min(limit, count - offset) ? { cutBySize: true } : {},
          ...metadata.list === void 0 ? {} : { list: metadata.list }
        };
      }
    );
  }
  async plain(id, metadata, offset, limit) {
    await this.assertSize(this.payload(id, "text.bin"), metadata.textChars * 2);
    if (offset >= metadata.textChars) return "";
    const file = await open(this.payload(id, "text.bin"), "r");
    try {
      const start = Math.max(0, offset - 1);
      const text3 = (await readExactly(file, start * 2, Math.min(limit + 3, metadata.textChars - start) * 2)).toString("utf16le");
      if (offset && high(text3.charAt(0)) && low(text3.charAt(1)))
        throw new HcmError(
          "INVALID_OFFSET",
          "offset попадает в середину символа Unicode: нужно брать nextOffset из прошлого ответа."
        );
      return text3.slice(offset - start);
    } finally {
      await file.close();
    }
  }
  async json(id, metadata, offset, limit) {
    if (offset >= metadata.jsonChars) return "";
    return reading(
      [this.payload(id, "data.idx"), this.payload(id, "data.json")],
      async ([index, body]) => {
        const first = numbers(await readExactly(index, 0, RECORD_BYTES));
        if (first[0] !== 0 || first[1] !== 0) throw invalid();
        let left = 0;
        let right = metadata.checkpoints - 1;
        let selected = [0, 0];
        const target = Math.max(0, offset - 1);
        while (left <= right) {
          const middle = Math.floor((left + right) / 2);
          const checkpoint = numbers(
            await readExactly(index, middle * RECORD_BYTES, RECORD_BYTES)
          );
          if (checkpoint[0] >= metadata.jsonChars || checkpoint[1] >= metadata.jsonBytes)
            throw invalid();
          if (checkpoint[0] <= target) {
            selected = checkpoint;
            left = middle + 1;
          } else right = middle - 1;
        }
        const [start, byteOffset] = selected;
        if (target - start >= CHUNK_CHARS) throw invalid();
        const amount = Math.min(metadata.jsonBytes - byteOffset, (offset - start + limit + 2) * 4);
        const decoded = new TextDecoder("utf8", { fatal: true }).decode(
          await readExactly(body, byteOffset, amount),
          { stream: byteOffset + amount < metadata.jsonBytes }
        );
        const relative = offset - start;
        if (decoded.length < Math.min(metadata.jsonChars - start, relative + limit + 1))
          throw invalid();
        if (byteOffset + amount === metadata.jsonBytes && decoded.length !== metadata.jsonChars - start)
          throw invalid();
        if (relative && high(decoded.charAt(relative - 1)) && low(decoded.charAt(relative)))
          throw new HcmError(
            "INVALID_OFFSET",
            "offset попадает в середину символа Unicode: нужно брать nextOffset из прошлого ответа."
          );
        return decoded.slice(relative, relative + limit + 1);
      }
    );
  }
  textPage(source, offset, total, limit, format) {
    if (!source.length && offset < total) throw invalid();
    let lower = 0;
    let upper = Math.min(limit, source.length);
    while (lower < upper) {
      const middle = Math.ceil((lower + upper) / 2);
      if (Buffer.byteLength(JSON.stringify(source.slice(0, middle))) <= this.config.outputLimitBytes / 2)
        lower = middle;
      else upper = middle - 1;
    }
    let end = lower;
    if (end && high(source.charAt(end - 1)) && low(source.charAt(end))) {
      if (end === 1) end++;
      else end--;
    }
    if (!end && source.length)
      throw new HcmError(
        "RESULT_OUTPUT_LIMIT",
        "В ответ не помещается даже один символ: предел размера ответа слишком мал."
      );
    return {
      text: source.slice(0, end),
      format,
      totalChars: total,
      ...offset + end < total ? { nextOffset: offset + end } : {},
      ...end < Math.min(limit, source.length) ? { cutBySize: true } : {}
    };
  }
  /** Version-one artifacts retain their bounded reader; all new references use indexed v2. */
  async legacy(path, bytes, offsetValue, limitValue, format) {
    if (bytes > this.config.maxResponseBytes * 2)
      throw new HcmError(
        "LEGACY_RESULT_TOO_LARGE",
        "Результат сохранён прежней версией клиента и слишком велик, чтобы его прочитать.",
        "Новые результаты хранятся иначе и читаются по частям; этот файл нужно открыть напрямую в папке runtimeDir."
      );
    let data2;
    try {
      const envelope = JSON.parse(await readFile(path, "utf8"));
      if (envelope === null || typeof envelope !== "object" || !("version" in envelope) || envelope.version !== 1 || !("data" in envelope))
        throw invalid();
      data2 = envelope.data;
    } catch {
      throw invalid();
    }
    const array = Array.isArray(data2) && format !== "json";
    const offset = boundedInteger(offsetValue, 0, Number.MAX_SAFE_INTEGER, "offset");
    const limit = boundedInteger(limitValue, array ? 100 : 12e3, array ? 1e3 : 65536, "limit");
    if (!limit) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    if (array) {
      const rows = data2;
      const items = [];
      let used = 128;
      for (const item of rows.slice(offset, offset + limit)) {
        const size = Buffer.byteLength(JSON.stringify(item));
        if (used + size > this.config.outputLimitBytes / 2) {
          if (!items.length)
            return {
              items,
              total: rows.length,
              blockedItem: { index: offset, bytes: size },
              hint: "Элемент blockedItem не помещается в ответ и не пропущен. Читать результат с format:json."
            };
          break;
        }
        items.push(item);
        used += size + 1;
      }
      return {
        items,
        total: rows.length,
        ...offset + items.length < rows.length ? { nextOffset: offset + items.length } : {}
      };
    }
    const text3 = typeof data2 === "string" && format !== "json" ? data2 : JSON.stringify(data2);
    if (offset && high(text3.charAt(offset - 1)) && low(text3.charAt(offset)))
      throw new HcmError(
        "INVALID_OFFSET",
        "offset попадает в середину символа Unicode: нужно брать nextOffset из прошлого ответа."
      );
    return this.textPage(
      text3.slice(offset, offset + limit + 1),
      offset,
      text3.length,
      limit,
      typeof data2 === "string" && format !== "json" ? "text" : "json"
    );
  }
};

// src/logs.ts
import { createHash as createHash3 } from "node:crypto";
var LogReadUnavailableError = class extends HcmError {
  constructor() {
    super(
      "LOG_READ_UNAVAILABLE",
      "Сервер не отдал текст лога и со второй попытки. Несколько секунд после каждой записанной строки он держит файл лога занятым.",
      "На нагруженном сервере лог за сегодня может не читаться вовсе; логи за прошлые даты читаются в любое время."
    );
  }
};
var LEVELS = ["normal", "debug", "info", "warning", "error", "critical"];
var hash = (text3) => createHash3("sha256").update(text3).digest("hex");
function text2(value, label, optional = false) {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && "#text" in value && typeof value["#text"] === "string")
    return value["#text"];
  if (optional && value === void 0) return "";
  throw new HcmError("LOG_REPORT_INVALID", `Отчёт сервера о логах: не читается ${label}.`);
}
function date(value, label) {
  if (value === void 0) return void 0;
  const source = requiredString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source) || Number.isNaN(Date.parse(`${source}T00:00:00Z`)) || (/* @__PURE__ */ new Date(`${source}T00:00:00Z`)).toISOString().slice(0, 10) !== source)
    throw new HcmError("INVALID_LOG_DATE", `${label}: нужна дата в виде ГГГГ-ММ-ДД.`);
  return source;
}
function filename(value) {
  const source = requiredString(value, "file");
  if (source.length > 255 || /[\\/\u0000-\u001F\u007F]/.test(source) || !/\.log$/i.test(source) || source === "." || source === "..")
    throw new HcmError(
      "INVALID_LOG_FILE",
      "Нужно имя файла .log или его адрес из logs.list; путь с папками не принимается."
    );
  return source;
}
function logKind(name3) {
  return name3.replace(/\.log$/i, "").replace(/[_-]?\d{4}-\d{2}-\d{2}.*$/, "") || name3;
}
function canonicalUrl(name3) {
  return `x-local://Logs/${encodeURIComponent(name3)}`;
}
function selectedName(value) {
  const source = requiredString(value, "file");
  if (!source.includes("://")) return filename(source);
  let url;
  let name3;
  try {
    url = new URL(source);
    name3 = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new HcmError("INVALID_LOG_FILE", "Адрес лога записан неверно.");
  }
  if (url.protocol !== "x-local:" || url.hostname.toLowerCase() !== "logs" || url.username || url.password || url.port || url.search || url.hash)
    throw new HcmError(
      "INVALID_LOG_FILE",
      "Читаются только логи из папки Logs сервера: адрес вида x-local://Logs/имя.log."
    );
  return filename(name3);
}
function parseLogReport(source) {
  const parsed = parseXml(source);
  if (Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, "data"))
    throw new HcmError("LOG_REPORT_INVALID", "Сервер вернул отчёт о логах в неожиданном виде.");
  const data2 = parsed.data;
  if (data2 === "") return [];
  const container = inputObject(data2, "отчёт о логах").rs;
  if (container === void 0 || container === "") return [];
  const raw = inputObject(container, "строки отчёта о логах").r;
  const rows = raw === void 0 ? [] : Array.isArray(raw) ? raw : [raw];
  if (rows.length > 1e4)
    throw new HcmError("LOG_REPORT_TOO_LARGE", "В отчёте сервера о логах больше 10000 строк.");
  const names = /* @__PURE__ */ new Set();
  return rows.map((value) => {
    const rawCells = inputObject(
      inputObject(value, "строка отчёта о логах").cs,
      "ячейки строки отчёта о логах"
    ).c;
    if (!Array.isArray(rawCells) || rawCells.length < 7)
      throw new HcmError(
        "LOG_REPORT_INVALID",
        "В строке отчёта сервера о логах меньше семи ячеек."
      );
    const cells = rawCells.map(
      (cell) => cell === "" ? {} : inputObject(cell, "ячейка отчёта о логах")
    );
    const name3 = filename(text2(cells[2].t, "имя файла"));
    const reportedUrl = text2(cells[6].t, "адрес файла");
    if (selectedName(reportedUrl) !== name3)
      throw new HcmError(
        "LOG_REPORT_INVALID",
        "В отчёте сервера о логах адрес файла не совпадает с его именем."
      );
    if (names.has(name3))
      throw new HcmError("LOG_REPORT_INVALID", "В отчёте сервера о логах имя файла повторяется.");
    names.add(name3);
    const sizeBytes = text2(cells[3].r ?? cells[3].t, "размер файла");
    if (!/^\d{1,20}$/.test(sizeBytes) || BigInt(sizeBytes) > 0xffffffffffffffffn)
      throw new HcmError(
        "LOG_REPORT_INVALID",
        "В отчёте сервера о логах размер файла — не целое неотрицательное число."
      );
    const dateLabel = text2(cells[1].t, "дата", true);
    const dateFromName = /(?:^|[_-])(\d{4}-\d{2}-\d{2})(?:\D|$)/.exec(name3)?.[1];
    const labelMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateLabel);
    const dateHint = dateFromName ?? (labelMatch ? `${labelMatch[3]}-${labelMatch[2]}-${labelMatch[1]}` : void 0);
    const rawDateSeconds = text2(cells[1].r, "дата в секундах", true);
    return {
      name: name3,
      url: canonicalUrl(name3),
      title: text2(cells[0].t, "заголовок", true),
      type: logKind(name3),
      sizeBytes,
      dateLabel,
      ...dateHint === void 0 ? {} : { dateHint },
      ...rawDateSeconds === "" ? {} : { rawDateSeconds },
      redFlag: text2(cells[5].t, "признак redFlag", true) === "true"
    };
  });
}
var ERROR_WORDS = /\b(?:error|exception|failed|denied|invalid)\b|not defined|not found|not allowed|unknown object property|unknown method|unregistered|wrong number of arguments|already declared|(?:^|\s)major:|ошибк|не найден|не удалось|исключени|недопустим|отказано|запрещ[её]н|уже открыт|невозможно/i;
function severity(message) {
  if (/\b(?:critical|fatal)\b|критическ/i.test(message)) return "critical";
  if (ERROR_WORDS.test(message)) return "error";
  if (/\b(?:warning|warn)\b|предупрежд/i.test(message)) return "warning";
  if (/\b(?:debug|trace)\b/i.test(message)) return "debug";
  if (/\b(?:info|information|inform)\b/i.test(message)) return "info";
  return "normal";
}
function parseLogEvents(source, dateHint, partialBeginning = false) {
  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events = [];
  for (const [index, line] of lines.entries()) {
    const match = /^\s{0,3}((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:[.,]\d+)?)(?:\s+(.*)|$)/.exec(line);
    if (match || !events.length && line !== "") {
      let message = match?.[2] ?? line;
      const context = /^\[([^\]]+)\]\s*/.exec(message);
      if (context) message = message.slice(context[0].length);
      events.push({
        sequence: events.length + 1,
        ...match?.[1] === void 0 ? {} : { time: match[1] },
        ...dateHint === void 0 ? {} : { dateHint },
        ...context?.[1] === void 0 ? {} : { context: context[1] },
        message,
        lines: [line],
        lineStart: index + 1,
        lineEnd: index + 1,
        ...!events.length && partialBeginning ? { partialBeginning: true } : {}
      });
    } else if (events.length) {
      const last = events.at(-1);
      last.lines.push(line);
      last.lineEnd = index + 1;
    }
  }
  return events.map(({ lines: lines2, ...event }) => ({
    ...event,
    level: severity([event.message, ...lines2.slice(1)].join("\n")),
    text: lines2.join("\n")
  }));
}
function rpcString(value) {
  const result = inputObject(value, "ответ функции сервера");
  if (result.valueType !== "string" || typeof result.lexicalValue !== "string")
    throw new HcmError("LOG_RESPONSE_INVALID", "Функция сервера вернула не строку.");
  return result.lexicalValue;
}
var LogReader = class {
  constructor(gateway, options) {
    this.gateway = gateway;
    this.busyMs = options.logBusyMs ?? 5500;
    if (!Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes < 1024)
      throw new HcmError("INVALID_ARGUMENT", "maxResponseBytes: нужно целое число не меньше 1024.");
    this.maxTailBytes = Math.max(1, Math.floor((options.maxResponseBytes - 512) / 6));
  }
  maxTailBytes;
  busyMs;
  busyUntil = 0;
  /**
   * The server keeps a log file to itself for about five seconds after writing a line to it
   * (measured on 2025.1.1333 and 2025.2.1535) and refuses to read it meanwhile. The owner reports
   * a request the server has just refused, since the refusal is what gets written.
   */
  serverWroteLog() {
    this.busyUntil = Date.now() + this.busyMs;
  }
  async whileBusy() {
    const wait = this.busyUntil - Date.now();
    if (wait > 0) await new Promise((resolve3) => setTimeout(resolve3, wait));
  }
  async allFiles() {
    const params = "<func_params><server_log_report><type_id>all</type_id><show_alert>false</show_alert></server_log_report></func_params>";
    const response = await this.gateway.call("native.rpc.call", {
      target: "tools_report.server_log_report",
      args: [{ valueType: "string", lexicalValue: encodeURIComponent(params) }]
    });
    return parseLogReport(rpcString(response));
  }
  async list(input2 = {}) {
    const start = date(input2.startDate, "startDate");
    const end = date(input2.endDate, "endDate");
    if (start && end && start > end)
      throw new HcmError("INVALID_LOG_DATE", "startDate позже endDate.");
    const offset = boundedInteger(input2.offset, 0, Number.MAX_SAFE_INTEGER, "offset");
    const limit = boundedInteger(input2.limit, 30, 1e3, "limit");
    if (!limit) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    const type = input2.type === void 0 ? void 0 : requiredString(input2.type, "type");
    const filter = input2.nameContains === void 0 ? void 0 : requiredString(input2.nameContains, "nameContains").toLowerCase();
    const files = (await this.allFiles()).filter(
      (file) => (!type || file.type === type) && (!filter || file.name.toLowerCase().includes(filter)) && (!start || file.dateHint !== void 0 && file.dateHint >= start) && (!end || file.dateHint !== void 0 && file.dateHint <= end)
    ).sort(
      (left, right) => (right.dateHint ?? "").localeCompare(left.dateHint ?? "") || left.name.localeCompare(right.name)
    );
    return {
      files: files.slice(offset, offset + limit),
      total: files.length,
      ...offset + limit < files.length ? { nextOffset: offset + limit } : {},
      dateSemantics: "server calendar date; timezone unspecified"
    };
  }
  async read(input2) {
    const name3 = selectedName(input2.file);
    if (input2.full !== void 0 && typeof input2.full !== "boolean")
      throw new HcmError("INVALID_ARGUMENT", "full: нужно true или false.");
    if (input2.full && input2.tailBytes !== void 0)
      throw new HcmError("INVALID_ARGUMENT", "Нужно указать full или tailBytes, но не оба.");
    const tailBytes = boundedInteger(
      input2.tailBytes,
      Math.min(524288, this.maxTailBytes),
      this.maxTailBytes,
      "tailBytes"
    );
    if (!tailBytes) throw new HcmError("INVALID_ARGUMENT", "tailBytes: нужно число больше нуля.");
    const refused = (error) => error instanceof WsHcmApiError && error.kind === "soap-fault" && error.status === 500 && error.operation === "CallMethod" && error.requestSent !== false && !isTransportFailure(error);
    const attempt = async () => {
      const file2 = (await this.allFiles()).find((item) => item.name === name3);
      if (!file2)
        throw new HcmError(
          "LOG_NOT_FOUND",
          "Такого файла нет среди логов сервера.",
          "Имена файлов показывает logs.list. Файлы вне списка логов не читаются."
        );
      const sizeBefore2 = BigInt(file2.sizeBytes);
      if (input2.full && sizeBefore2 > BigInt(this.maxTailBytes))
        throw new HcmError(
          "LOG_TOO_LARGE",
          "Лог целиком не помещается в предел чтения подключения.",
          "Нужно прочитать конец файла (tailBytes) или увеличить maxResponseBytes подключения."
        );
      const effectiveTailBytes2 = Number(
        input2.full || sizeBefore2 < BigInt(tailBytes) ? sizeBefore2 : BigInt(tailBytes)
      );
      try {
        const response2 = await this.gateway.call("native.rpc.call", {
          target: "tools.load_url_data_server",
          args: [
            { valueType: "string", lexicalValue: file2.url },
            { valueType: "integer", lexicalValue: String(effectiveTailBytes2) }
          ]
        });
        return { file: file2, sizeBefore: sizeBefore2, effectiveTailBytes: effectiveTailBytes2, response: response2 };
      } catch (error) {
        if (!refused(error)) throw error;
        return { refusal: error };
      }
    };
    await this.whileBusy();
    let read = await attempt();
    if ("refusal" in read) {
      const first = read.refusal;
      this.serverWroteLog();
      await this.whileBusy();
      read = await attempt();
      if ("refusal" in read) {
        const unavailable = new LogReadUnavailableError();
        for (const error of [first, read.refusal])
          if (error.cleanupError !== void 0) attachCleanupError(unavailable, error.cleanupError);
        throw unavailable;
      }
    }
    const { file, sizeBefore, effectiveTailBytes, response } = read;
    const returned = rpcString(response);
    const notice = /^Показано последние (\d+) байт файла\. Для просмотра всего файла его нужно сохранить\.\r?\n/.exec(
      returned
    );
    if (notice && notice[1] !== String(effectiveTailBytes))
      throw new HcmError(
        "LOG_RESPONSE_INVALID",
        "Сервер сообщил не тот размер прочитанного конца файла, который был запрошен."
      );
    const after = (await this.allFiles()).find((item) => item.name === name3);
    if (!after || BigInt(after.sizeBytes) < sizeBefore || sizeBefore === 0n && BigInt(after.sizeBytes) !== 0n || input2.full && BigInt(after.sizeBytes) !== sizeBefore || (input2.full || sizeBefore === 0n) && (file.rawDateSeconds !== after.rawDateSeconds || file.dateHint !== after.dateHint || file.dateLabel !== after.dateLabel) || !notice)
      throw new HcmError(
        "LOG_CHANGED",
        "Лог изменился или исчез, пока читался.",
        "Чтение нужно повторить: прочитанный текст отброшен. Список файлов покажет logs.list."
      );
    const body = notice ? returned.slice(notice[0].length) : returned;
    if (effectiveTailBytes === 0 && body !== "")
      throw new HcmError("LOG_RESPONSE_INVALID", "Сервер вернул текст, хотя файл лога пуст.");
    return {
      file: after,
      text: body,
      requestedMode: input2.full ? "full" : "tail",
      ...input2.full ? {} : { requestedTailBytes: tailBytes },
      effectiveTailBytes,
      sizeBytesBefore: file.sizeBytes,
      sizeBytesAfter: after.sizeBytes,
      serverTailNotice: !!notice,
      truncated: sizeBefore > BigInt(effectiveTailBytes) || BigInt(after.sizeBytes) > BigInt(effectiveTailBytes),
      returnedChars: body.length,
      fingerprint: hash(body),
      semantics: "server RPC text; byte offsets and original encoding are not preserved",
      consistency: sizeBefore === 0n ? "empty file reported before and after; zero range does not open file or flush pending log writes" : "file size checked before and after; full reads also compare available date metadata; no atomic snapshot or same-size rewrite guarantee"
    };
  }
  async search(input2) {
    if (input2.level !== void 0 && !LEVELS.includes(input2.level))
      throw new HcmError(
        "INVALID_LOG_LEVEL",
        "level: нужно одно из normal, debug, info, warning, error, critical."
      );
    const offset = boundedInteger(input2.offset, 0, Number.MAX_SAFE_INTEGER, "offset");
    const limit = boundedInteger(input2.limit, 100, 1e3, "limit");
    if (!limit) throw new HcmError("INVALID_ARGUMENT", "limit: нужно число больше нуля.");
    const query = input2.text === void 0 ? void 0 : requiredString(input2.text, "text").toLowerCase();
    const context = input2.context === void 0 ? void 0 : requiredString(input2.context, "context").toLowerCase();
    const read = await this.read(input2);
    if (input2.expectedFingerprint !== void 0 && input2.expectedFingerprint !== read.fingerprint)
      throw new HcmError(
        "LOG_CHANGED",
        "Лог изменился между страницами поиска.",
        "Поиск нужно начать с первой страницы и дальше передавать fingerprint из нового ответа."
      );
    const all = parseLogEvents(read.text, read.file.dateHint, read.truncated);
    const events = all.filter(
      (event) => (!input2.level || event.level === input2.level) && (!query || event.text.toLowerCase().includes(query)) && (!context || event.context?.toLowerCase().includes(context))
    );
    if (input2.newestFirst === true) events.reverse();
    return {
      file: read.file,
      events: events.slice(offset, offset + limit),
      totalEvents: all.length,
      matches: events.length,
      fingerprint: read.fingerprint,
      truncated: read.truncated,
      ...offset + limit < events.length ? { nextOffset: offset + limit } : {},
      severityDetection: "text heuristic",
      lineNumbers: "relative to fetched text"
    };
  }
  async follow(input2) {
    let previous;
    if (input2.cursor !== void 0) {
      try {
        if (input2.cursor.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(input2.cursor)) throw new Error();
        const raw = inputObject(
          JSON.parse(Buffer.from(input2.cursor, "base64url").toString("utf8"))
        );
        if (raw.version !== 1 || typeof raw.file !== "string" || typeof raw.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(raw.fingerprint) || typeof raw.sizeBytes !== "string" || !/^\d+$/.test(raw.sizeBytes) || raw.sizeBytes.length > 20 || !Array.isArray(raw.anchors) || raw.anchors.length > 8 || raw.anchors.some((anchor) => typeof anchor !== "string" || !/^[0-9a-f]{16}$/.test(anchor)))
          throw new Error();
        previous = raw;
        if (selectedName(previous.file) !== selectedName(input2.file)) throw new Error();
      } catch {
        throw new HcmError(
          "INVALID_LOG_CURSOR",
          "cursor неверен или получен для другого файла лога."
        );
      }
    }
    const read = await this.read(input2);
    const events = parseLogEvents(read.text, read.file.dateHint, read.truncated);
    const hashes = events.map((event) => hash(event.text.replace(/\n+$/, "")).slice(0, 16));
    const fingerprint = read.fingerprint.slice(0, 16);
    let start = 0;
    let resetReason;
    const changed = !previous || previous.fingerprint !== fingerprint || previous.sizeBytes !== read.file.sizeBytes;
    if (previous) {
      if (BigInt(read.file.sizeBytes) < BigInt(previous.sizeBytes))
        resetReason = "file-size-decreased";
      else if (!changed) start = events.length;
      else {
        let matched = -1;
        let ambiguous = false;
        for (const anchor of [...previous.anchors].reverse()) {
          const first = hashes.indexOf(anchor);
          if (first < 0) continue;
          if (first !== hashes.lastIndexOf(anchor)) {
            ambiguous = true;
            continue;
          }
          matched = first;
          break;
        }
        if (matched >= 0) start = matched + 1;
        else resetReason = ambiguous ? "ambiguous-overlap" : "overlap-not-found";
      }
    }
    const cursor = {
      version: 1,
      file: read.file.url,
      fingerprint,
      sizeBytes: read.file.sizeBytes,
      anchors: hashes.slice(-8)
    };
    return {
      file: read.file,
      events: events.slice(start),
      cursor: Buffer.from(JSON.stringify(cursor)).toString("base64url"),
      changed,
      gapPossible: !!resetReason,
      windowTruncated: read.truncated,
      ...resetReason === void 0 ? {} : { resetReason },
      semantics: "tail overlap; updated final events may be repeated; no byte cursor or exactly-once guarantee"
    };
  }
};

// src/rpc-targets-1171.ts
var RPC_TARGETS_1171 = [
  ["i18n.obtain_const_translate_data", [], null],
  ["i18n.save_const_translate_data", [], null],
  [
    "ms_tools.activate_objects_to_persons",
    ["sTaskIDParam", "sType", "sObjectIDs", "sPersonIDs", "oParams"],
    true
  ],
  ["ms_tools.activate_to_objects", ["sTaskIDParam", "sTypeParam", "sObjectIDs", "oParams"], true],
  [
    "ms_tools.assign_qualifications_to_objects",
    ["sTaskIDParam", "sType", "sObjectIDs", "oParams"],
    true
  ],
  [
    "ms_tools.calculate_statistic_rec_obj",
    ["iStatisticRecIDParam", "iObjectIDParam", "iPersonIDParam"],
    true
  ],
  ["ms_tools.catalog_resave", ["sTaskIDParam", "sCatalogNameParam", "bDataFlag", "bIDFlag"], true],
  ["ms_tools.delete_shared_list_elem", ["sListPathParam", "sPrimaryKeyParam"], true],
  ["ms_tools.delete_url_on_server", ["sUrl"], true],
  ["ms_tools.enable_logs_server", [], true],
  ["ms_tools.eval_remote_action_step", ["iRemoteActionIDParam", "oParamsParam"], true],
  [
    "ms_tools.evaluate_remote_collection_obj",
    [
      "oRemoteCollectionParam",
      "iObjectIDParam",
      "iPersonIDParam",
      "oCollectionParams",
      "iStartPos",
      "iPageSize"
    ],
    true
  ],
  ["ms_tools.get_admin_init_server_data", [], true],
  ["ms_tools.get_log_email_errors", ["dtLastDateParam"], true],
  [
    "ms_tools.get_loop_array",
    [
      "TopElem",
      "List",
      "bDispRoles",
      "bDispFilter",
      "bDispHier",
      "arrSelRows",
      "iParenIDParam",
      "sSearchTypeParam",
      "iRemoteCollectionIDParam",
      "iStartPos",
      "iPageSize"
    ],
    true
  ],
  ["ms_tools.get_object_source_server", ["iObjectIDParam"], true],
  ["ms_tools.get_task_data", ["sTaskIDParam"], true],
  ["ms_tools.get_tasks_data", ["sTaskListParam"], true],
  ["ms_tools.init_task_data", ["teTaskInfo", "iDelayParam"], true],
  [
    "ms_tools.obtain_shared_list_elem",
    ["sListPathParam", "sPrimaryKeyParam", "oListElemParam"],
    true
  ],
  ["ms_tools.remove_task_data", ["sTaskIDParam"], true],
  ["ms_tools.set_task_data", ["sTaskIDParam", "teTaskInfoParam"], true],
  ["ms_tools.set_task_field_data", ["sTaskIDParam", "sFieldNameParam", "sFieldValueParam"], true],
  ["ms_tools.start_task_data", ["sTaskIDParam", "sMethodNameParam", "oMethodParamsParam"], true],
  ["ms_tools.update_claims_by_object", ["oObjectID", "sObjectType", "sClaimTypes"], true],
  [
    "qti_tools.call_testing_system_method",
    ["oParam", "sMethodNameParam", "oArrParam", "bReturnUrl"],
    true
  ],
  ["qti_tools.get_qti_zip", ["iAssessmentID"], true],
  ["qti_tools.prepare_qti_run", ["iAssessmentIDParam"], true],
  ["qti_tools.pulish_assessment", ["oAssessmentParam", "sCoursePathParam"], true],
  [
    "tools_app.call_application_library_method",
    ["oObjectParam", "sMethodNameParam", "arrMethodParam"],
    true
  ],
  ["tools_app.clear_application_cache", ["sApplicationCode", "sComponentCode"], true],
  ["tools_app.create_application_instance", ["iApplicationIDParam", "bReturnID"], true],
  [
    "tools_app.create_application_instance_object",
    ["sObjectNameParam", "oObjectFieldsParam", "iApplicationInstanceIDParam", "bSaveParam"],
    true
  ],
  ["tools_app.get_application_ids", ["oObjectParam"], true],
  [
    "tools_app.get_application_lib_url",
    [
      "sApplicationCodeParam",
      "sApplicationLibraryUrlParam",
      "sApplicationVendorParam",
      "sApplicationVendorLibraryParam",
      "sApplicationLicTypeParam"
    ],
    true
  ],
  ["tools_app.get_application_objects", ["oObjectParam", "arrCatalogs"], true],
  ["tools_app.get_application_resource", ["oObjectParam", "sResourceUrl"], true],
  ["tools_app.get_application_resources_list", ["oObjectParam"], true],
  ["tools_app.package_application", ["oObjectParam"], true],
  ["tools_app.save_application_object", ["docObject", "code_wvar", "iApplicationIDParam"], true],
  ["tools_app.save_application_settings", ["iApplicationID", "teSettings"], true],
  ["tools_ass.ass_create_notification", ["oTypeParam", "iObjectIDParam"], true],
  ["tools_ass.create_event_assessment_plans", ["event_id"], true],
  [
    "tools_ass.generate_assessment_plan",
    [
      "ASSESSMENT_ID",
      "PLAN_ONLY",
      "IS_CLEAN",
      "KILL",
      "FLOORBOUND",
      "ACOUNT",
      "GROUP_ID",
      "AUDITORIS_IDS",
      "oParam"
    ],
    true
  ],
  [
    "tools_ass.generate_participant_by_plan",
    ["ASSESSMENT_ID", "PARTICIPANT_CODE", "ASSESSMENT_PLAN_ID", "EXPERT_ID", "NEW_PA"],
    true
  ],
  ["tools_auth.check_lds_access_obj", ["curObjectDocAccess", "sCanParam", "sCataloName"], true],
  ["tools_auth.get_lds_claim_access_obj", ["sUpdateTypeParam", "arrClaimsParam"], true],
  [
    "tools_chat.add_chatbot_to_conversation",
    ["iConversationID", "iChatbotID", "iChatbotTypeID"],
    true
  ],
  [
    "tools_chat.change_participants_conversation",
    [
      "iConversationID",
      "docConversation",
      "sAction",
      "iParticipantID",
      "arrParticipants",
      "iChatbotID",
      "iConversationTypeID",
      "docParticipantObject"
    ],
    true
  ],
  ["tools_chat.del_chatbot_from_conversation", ["iConversationID", "iChatbotID"], true],
  [
    "tools_chat.write_message",
    [
      "sTextMessage",
      "iObjectID",
      "teObject",
      "iSenderID",
      "teSender",
      "arrFiles",
      "arrCatalogs",
      "sMessageID",
      "oMessageData",
      "sMessageType",
      "arrMessageRecipients"
    ],
    true
  ],
  [
    "tools_cl.export_scorm",
    ["iCLCourseID_PARAM", "curUserIDPARAM", "iLocIDPARAM", "paramsZipUrl"],
    true
  ],
  ["tools_cl.import_objects_from_pack", ["sFileUrlPARAM", "sMode"], true],
  ["tools_component.get_components_init_urls_obj", ["arrUrlTypesParam"], true],
  ["tools_i18n.obtain_const_translate_data", ["sUrlParam"], true],
  ["tools_i18n.save_const_translate_data", [], true],
  ["tools_idm.test_idm_client", ["sLoginParam"], true],
  ["tools_knlg.base64_encode", ["sStr"], true],
  ["tools_knlg.get_article_desc", ["sDesc", "sNewUrl", "sQueryParam"], true],
  [
    "tools_knlg.get_http_request_file_id",
    ["sUrl", "sMethod", "sParam", "sHeader", "bOnServer", "sFileUrl", "sFileName"],
    true
  ],
  ["tools_knlg.http_request", ["sUrl", "sParam", "bOnServer"], true],
  ["tools_knlg.http_request_obj", ["sUrl", "sMethod", "sParam", "sHeader", "bOnServer"], true],
  ["tools_library.convert_mp4_to_m3u", ["srcResID"], true],
  ["tools_library.convert_pdf_libratry_material", ["iMaterialId"], true],
  [
    "tools_library.import_file_by_source_type",
    ["iSourceTypeID", "sFileUrlPARAM", "iLibraryMaterialIDPARAM", "sAuxName"],
    true
  ],
  [
    "tools_library.import_resource_by_source_type",
    ["iSourceTypeID", "iResourceID", "iLibraryMaterialIDPARAM", "sAuxName"],
    true
  ],
  ["tools_library.old_import_book_from_word", ["iBookID", "fileUrl"], true],
  ["tools_lp.any_color_to_rgb", ["sColor", "bRGBA", "nOpacity"], true],
  ["tools_lp.apply_param_type", ["oParam", "sValue"], true],
  ["tools_lp.clear_template_cache", ["iWebDesignIDParam"], true],
  [
    "tools_lp.get_owt_params",
    ["oCurParams", "aOWTParams", "sPrefix", "bUsePreset", "oPreset", "sOWTId", "oArgs"],
    true
  ],
  ["tools_lp.hex_to_rgb", ["sHexColor", "bRGBA", "nOpacity"], true],
  ["tools_lp.refresh_web_template_cache", ["iWebDesignIDParam"], true],
  ["tools_lp.webcolor_to_hex", ["sWebColor"], true],
  [
    "tools_proctor.check_foto",
    ["iLearningRecordId", "docLearningRecord", "arrDefaultFotoUrls", "rConfidence", "sModelType"],
    true
  ],
  ["tools_proctor.download_proctoring_files", ["iLearningRecordID"], true],
  ["tools_proctor.get_proctoring_active_learning_id", ["teRecord"], true],
  ["tools_recr.get_estaff_event_types", ["sLogin", "sPassword"], true],
  ["tools_report.benefit_report", ["oParams"], true],
  ["tools_report.budget_report", ["sXmlParam"], true],
  ["tools_report.budget_transfers_report", [], true],
  ["tools_report.career_reserve_report", ["_param_str"], true],
  ["tools_report.certificate_type_report", ["oParams"], true],
  ["tools_report.competence_by_depart_report", ["_param_str"], true],
  ["tools_report.course_by_depart_report", ["_param_str"], true],
  ["tools_report.course_comment_report", ["_param_str"], true],
  ["tools_report.course_dynamics_report", ["sParams", "curUserID", "sApplicationID"], true],
  [
    "tools_report.course_integral_efficiency_report",
    ["_param_str", "curUserID", "sApplicationID"],
    true
  ],
  ["tools_report.course_module_status_report", ["_param_str"], true],
  ["tools_report.course_part_report", ["oParams", "curUser", "curUserID", "sApplicationID"], true],
  ["tools_report.course_report", ["Ps", "curUserID", "sApplicationID", "oParams"], true],
  ["tools_report.course_statistics_report", ["_param_str", "curUserID", "sApplicationID"], true],
  [
    "tools_report.custom_report_export_to_file",
    ["vCustomReport", "curUserID", "sOutType", "sFileUrl"],
    true
  ],
  [
    "tools_report.edu_response_analysis_report",
    ["Ps", "curUserID", "sApplicationID", "oParams"],
    true
  ],
  ["tools_report.educ_plan_report", ["Ps"], true],
  ["tools_report.education_method_report", ["_param_str"], true],
  ["tools_report.event_by_depart_report", ["_param_str", "curUser"], true],
  ["tools_report.event_dep_report", ["_param_str", "curUser"], true],
  ["tools_report.event_person_report", ["_param_str", "curUser"], true],
  ["tools_report.events_report", ["oParams", "curUser"], true],
  ["tools_report.exceed_course_report", ["oParams", "curUserID", "sApplicationID"], true],
  [
    "tools_report.fnSaveFile",
    ["oObjectParam", "sFileType", "bClearObjectParam", "sDestinationParam", "sReportNameParam"],
    false
  ],
  ["tools_report.gather_system_info", [], true],
  ["tools_report.get_report_data", ["sUrlParam", "bSwitchForm", "sReportName"], true],
  ["tools_report.get_xhttp_info", ["port", "schema"], true],
  ["tools_report.good_statistics_report", ["oParams"], true],
  ["tools_report.key_positions_protection_report", ["oParams", "curUser"], true],
  ["tools_report.learning_dynamics_report", [], null],
  ["tools_report.learning_statistics_report", ["_param_str"], true],
  ["tools_report.list_export_to_file", ["oList", "sOutType", "sFileUrl"], true],
  ["tools_report.list_html_export", ["oList", "sOutType"], true],
  ["tools_report.load_excel", ["sHtml", "sFileUrl"], true],
  ["tools_report.load_word", ["sHtml", "sFileUrl"], true],
  ["tools_report.log_report", ["sMsg"], true],
  ["tools_report.model_roles", ["curUserID", "sApplicationID", "sBlockName", "oParams"], true],
  ["tools_report.no_request_by_good_report", ["oParams"], true],
  ["tools_report.not_certified_report", ["oParams"], true],
  ["tools_report.not_studied_report", ["oParams"], true],
  ["tools_report.payment_type_report", ["oParams"], true],
  ["tools_report.persons_report", ["Ps"], true],
  ["tools_report.policy_type_report", ["oParams"], true],
  ["tools_report.poll_procedure_report", ["oParams"], true],
  ["tools_report.poll_report", ["oParams"], true],
  ["tools_report.profiling_report", ["sXmlParam"], true],
  ["tools_report.qualification_report", ["oParams"], true],
  ["tools_report.question_by_depart_report", ["_param_str"], true],
  ["tools_report.question_report", ["oParams", "curUser"], true],
  ["tools_report.questions_analytics_report", ["_param_str"], true],
  ["tools_report.read_report_settings", ["sReportName", "oTopElem", "arrParams"], true],
  ["tools_report.recommender_compare_report", ["_param_str"], true],
  ["tools_report.recommender_detail_report", ["Ps"], true],
  ["tools_report.recommender_use_report", ["_param_str"], true],
  ["tools_report.request_report", ["oParams"], true],
  ["tools_report.request_statistics_report", ["oParams"], true],
  ["tools_report.run_db_perfomance_test", ["check_current_db", "countUsers"], true],
  ["tools_report.save_report_settings", ["sReportName", "arrParams"], true],
  [
    "tools_report.save_report_to_file",
    [
      "sHtml",
      "sReportName",
      "sOutType",
      "sFileUrl",
      "bIsWebClient",
      "sColumns",
      "arrData",
      "oParams",
      "bNewExport",
      "arrNewColumnDatas",
      "arrNewRowDatas"
    ],
    true
  ],
  ["tools_report.server_log_report", ["_param_str"], true],
  ["tools_report.statistic_report", ["_param_str"], true],
  ["tools_report.successors_report", ["oParams", "curUser"], true],
  ["tools_report.test_by_depart_report", ["_param_str"], true],
  ["tools_report.test_dynamics_report", ["sParams", "curUserID", "sApplicationID"], true],
  ["tools_report.test_person_report", ["Ps", "curUserID", "sApplicationID"], true],
  ["tools_report.test_report", ["_param_str", "curUserID", "sApplicationID"], true],
  ["tools_report.test_statistics_report", ["_param_str", "curUserID", "sApplicationID"], true],
  ["tools_report.transaction_report", ["oParams"], true],
  ["tools_report.view_accounts", ["Ps", "curUserID", "sApplicationID"], true],
  ["tools_report.view_awards", ["Ps", "curUserID", "sApplicationID"], true],
  ["tools_report.view_badges", ["Ps", "curUserID", "sApplicationID"], true],
  ["tools_web.clear_bbcode_from_html", ["sMessageSource", "objRegExp"], true],
  ["tools_web.clear_person_pict_cache", ["iPersonIDParam"], true],
  ["tools_web.convert_bbcode_to_html", ["sMessageSource", "objRegExp"], true],
  ["tools_web.convert_html_to_bbcode", ["sMessageSource", "objRegExp"], true],
  ["tools_web.drop_active_web_templates", [], true],
  ["tools_web.get_data_cache", ["sKeyParam"], true],
  ["tools_web.get_data_cache_by_pattern", ["sPatternParam"], true],
  ["tools_web.get_user_data", ["oConditionsParam"], true],
  [
    "tools_web.push_notification_workspace",
    ["vWSConfiguration", "sMessagePARAM", "sDomainPARAM", "aUserPARAM", "oOptionsPARAM"],
    true
  ],
  ["tools_web.remove_data_cache", ["sKeyParam"], true],
  ["tools_web.remove_user_data", ["sKeyParam", "sListNameParam"], true],
  ["tools_web.remove_user_data_by_prefix", ["sKeyParam"], true],
  [
    "tools_web.send_message",
    ["vApplication", "sMessagePARAM", "sDomainPARAM", "aUserPARAM", "oOptionsPARAM"],
    true
  ],
  ["tools_web.set_data_cache", ["sKeyParam", "oValueParam", "iDurationParam"], true],
  [
    "tools_web.set_user_data",
    ["oConditionsParam", "oValueParam", "iDurationParam", "sListNameParam"],
    true
  ],
  [
    "tools.activate_course_to_event",
    [
      "_even_id",
      "_course_id",
      "_doc_event",
      "_duration",
      "_start_learning_date",
      "_last_learning_date",
      "bSkipDismissed",
      "bUseProctoring",
      "iProctorPreferID",
      "sComment"
    ],
    true
  ],
  [
    "tools.activate_test_to_event",
    [
      "_even_id",
      "_test_id",
      "_doc_event",
      "_duration",
      "_start_learning_date",
      "_last_learning_date",
      "sActTypeParam",
      "bSkipDismissed",
      "bUseProctoring",
      "iProctorPreferID",
      "bActivateOnlyAssist"
    ],
    true
  ],
  ["tools.alert_server", ["sMessageParam"], true],
  ["tools.amgr_cancel_agent", ["roleUID", "threadID"], true],
  ["tools.amgr_get_agent_list_json", [], true],
  ["tools.amgr_kill_role", ["nodeId", "roleUID"], true],
  [
    "tools.assign_qualification_to_event",
    ["_even_id", "_doc_event", "_qualification_id", "_date"],
    true
  ],
  [
    "tools.build_report_remote",
    ["REPORT_ID", "PS", "docReportParam", "sLngSHORT", "bMetaOnly"],
    true
  ],
  [
    "tools.calculate_statistic_rec",
    ["iStatisticRecId", "iObjectIdParam", "bIgnorePeriodSettingsParam", "bCalculateCatalogsParam"],
    true
  ],
  ["tools.call_code_library_method", ["oLibraryParam", "sMethodNameParam", "arrParams"], true],
  [
    "tools.call_library_system_method",
    ["iLibrarySystemIdParam", "sMethodNameParam", "oParams"],
    true
  ],
  [
    "tools.call_webinar_system_method",
    ["iWebinarSystemIdParam", "sMethodNameParam", "oParams"],
    true
  ],
  ["tools.check_access", ["_source_doc", "_user_id"], true],
  ["tools.close_request", ["_request_id"], true],
  ["tools.copy_manifest_resources", ["fileUrl", "baseUrl"], true],
  ["tools.copy_url_server", ["sDestUrlParam", "sSourceUrlParam"], true],
  ["tools.copy_url_temp_suffix", ["sDestUrlPARAM", "sSourceUrlPARAM"], true],
  [
    "tools.create_certificate_to_event",
    ["_even_id", "_type_id", "_doc_event", "bCreateByNotAssist"],
    true
  ],
  [
    "tools.create_data_package",
    [
      "iExchangeSeverIDParam",
      "_report_id",
      "sPackIDParam",
      "dtLimitParam",
      "iExchangeObjectIDParam",
      "sPrimaryKeyUserData"
    ],
    true
  ],
  ["tools.create_license", [], null],
  ["tools.create_license_complete", [], null],
  ["tools.create_list_package", ["sResultUrlParam", "fldPackage"], true],
  [
    "tools.create_package",
    ["_pak_url", "_report_id", "_param_source", "sPackIDParam", "sModeParam", "bStdParam"],
    true
  ],
  [
    "tools.create_search_condition",
    [
      "sSearchString",
      "sCatalogName",
      "arrSearchFieldNames",
      "sForeignFieldName",
      "sSearchTypeParam"
    ],
    true
  ],
  ["tools.delete_directory_server", ["sDirParam"], true],
  ["tools.delete_trash_url_server", ["sUrlParam"], true],
  ["tools.DigitalVerifyDoc", ["iDocIDParam"], true],
  ["tools.download_data", ["iExchangeSeverIDParam"], true],
  [
    "tools.download_package",
    ["iExchangeSeverID", "iPackageID", "sTempUrlParam", "fldPackageValidParam", "bUpdateObjects"],
    true
  ],
  ["tools.download_package_list", ["iExchangeSeverID"], true],
  ["tools.drop_cache_code_library", ["CodeLibraryIDs"], true],
  ["tools.drop_doc_type", ["docTypeID", "checkContent"], true],
  ["tools.eval_code_page_url", ["_url", "_doc_id", "_rnd_id"], true],
  [
    "tools.file_source_clear_old_file",
    ["iFileSourceIdParam", "sOldFileUrlParam", "sCurFileUrlParam"],
    true
  ],
  [
    "tools.file_source_download_file",
    ["iFileSourceIdParam", "sUidPARAM", "oRequestPARAM", "oResponsePARAM"],
    true
  ],
  [
    "tools.file_source_get_file_to_save_url",
    ["iFileSourceIdParam", "iResourceIdParam", "sUidPARAM"],
    true
  ],
  ["tools.file_source_get_file_url", ["iFileSourceIdParam", "sUidPARAM"], true],
  ["tools.file_source_get_files_list", ["iFileSourceIdParam"], true],
  [
    "tools.file_source_get_temp_file_to_save_url",
    ["iFileSourceIdParam", "iResourceIdParam", "sUidPARAM"],
    true
  ],
  ["tools.file_source_get_upload_file_url", ["iFileSourceIdParam", "sFileNameParam"], true],
  [
    "tools.file_source_upload_file",
    ["iFileSourceIdParam", "sFileUrlParam", "sTempFileUrlParam"],
    true
  ],
  ["tools.file_url_exists", ["sFilePathParam"], true],
  ["tools.file_url_exists_server", ["sFilePathParam"], true],
  ["tools.generate_qr", ["text", "options"], true],
  ["tools.get_access_role_claims", ["dUpdateParam"], true],
  ["tools.get_client_data", ["sLogin", "sPassword"], true],
  ["tools.get_code_library", ["oLibraryParam"], true],
  ["tools.get_content_access", ["iPersonID", "tePerson", "bAppOnly"], true],
  ["tools.get_file_from_data", ["oSource"], true],
  ["tools.get_hash_server", ["sTextParam", "sTypeParam"], true],
  ["tools.get_list_lngs", [], true],
  ["tools.get_log_email_errors", [], null],
  ["tools.get_oapi_schemas", [], true],
  [
    "tools.get_object_data_from_package_url",
    ["sUrlPackageParam", "iObjectIDParam", "sObjectTypeParam"],
    true
  ],
  ["tools.get_package_log", ["sUrlPackageParam", "oParam"], true],
  ["tools.get_params_code_library", ["oLibraryParam"], true],
  ["tools.get_process_param", ["oLibraryParam", "sNameAttr"], true],
  [
    "tools.get_statistic_data",
    ["iStatisticRecId", "iObjectIdParam", "sPeriodTypeParam", "dDateStartParam", "dDateEndParam"],
    true
  ],
  ["tools.get_version", ["sTypeParam", "bDateFlag"], true],
  ["tools.get_webinar_system_topelem", ["iWebinarSystemIdParam"], true],
  ["tools.getDayYear", ["dDate"], true],
  ["tools.getWeekYear", ["dDate"], true],
  ["tools.import_excel_persons", ["sParamsXml"], true],
  ["tools.load_course", ["fileUrl", "sFileCharsetParam", "docCourseParam"], true],
  ["tools.load_share_url_server", ["sUrlParam", "b64encode"], true],
  ["tools.load_url_data_server", ["sFilePathParam", "iSizeParam"], true],
  ["tools.load_url_text_server", ["sFilePathParam"], true],
  ["tools.log_event_server", ["sTypeParam", "sTextParam"], true],
  ["tools.make_password", ["PASSWORD", "CHECK"], true],
  ["tools.object_to_text", ["objectPARAM", "sFormatPARAM", "iMaxDepthPARAM"], true],
  [
    "tools.obtain_statistic_data",
    [
      "StatisticRec",
      "iObjectIdParam",
      "sPeriodTypeParam",
      "dDateStartParam",
      "dDateEndParam",
      "bVirtual",
      "bForceRedo"
    ],
    true
  ],
  ["tools.open_course_package_server", ["sUrlPARAM"], true],
  [
    "tools.package_process",
    [
      "_path",
      "_type",
      "_source",
      "_report_id",
      "_exchange_server_id",
      "iDownloadPackageIDParam",
      "bUpdateObjects",
      "_base_url"
    ],
    true
  ],
  ["tools.parse_throw_error", ["sErrorStr", "oError"], true],
  ["tools.post_file_to_server", ["_send_file", "_server_id", "_report_id"], true],
  [
    "tools.process_print_form",
    ["oFormParam", "iTopElemParam", "bReturnFilename", "TopElemParam"],
    true
  ],
  ["tools.put_message_in_queue", ["sQueueName", "sCommandXml"], true],
  ["tools.put_url_text_server", ["sUrlParam", "sTextParam"], true],
  ["tools.read_directory_server", ["sFilePathParam", "bDirParam"], true],
  ["tools.read_object", ["sSomeObjectPARAM"], true],
  [
    "tools.register_doc_types_catalog_by_serialized_str",
    ["sSerializedCatalogsToRegPARAM", "bServerCheck"],
    true
  ],
  ["tools.replace_cached_doc_server", ["sUrlParam"], true],
  [
    "tools.request_rejecting",
    ["iRequestID", "docRequest", "iPersonID", "dSaveParam", "curUser"],
    true
  ],
  [
    "tools.resource_pic_envelope",
    ["sMode", "vParam1", "vParam2", "vParam3", "vParam4", "iResourceID"],
    true
  ],
  ["tools.restore_doc", ["iObjectIDParam"], true],
  [
    "tools.send_file_to_server",
    ["_subject", "_body", "_send_file", "_server_id", "_report_id"],
    true
  ],
  ["tools.set_form_last_seved_data", ["sCatalogNameParam", "bValueParam"], true],
  ["tools.split_errortext", ["sErrorStr"], true],
  ["tools.start_agent", ["_agent_id", "_element_id", "_elems_id_str", "dDateParam"], true],
  ["tools.start_import_excel_persons", ["Ps"], true],
  ["tools.submit_subscriptions", ["_document_id", "documentDoc", "iPersonIDParam"], true],
  ["tools.uni_process_package", ["sUrlPackageParam", "fldFormParam"], true],
  ["tools.update_learnings_course_parts_structure", ["learningArray", "_course_doc_str"], true],
  ["tools.upload_begin", ["sUrlParam", "iLenghtParam"], true],
  ["tools.upload_data", ["iExchangeSeverIDParam", "dtLimitParam", "iExchangeObjectIDParam"], true],
  ["tools.upload_end", ["sIDParam"], true],
  ["tools.upload_range", ["sIDParam", "iStartIndexParam", "iFinishIndexParam", "sDataParam"], true],
  ["tools.url_file_size_server", ["sUrlParam"], true],
  ["tools.zip_extract_server", ["sSourceUrlParam", "sTargetUrlParam"], true]
];

// src/rpc-catalog.ts
var RPC_CATALOG_PAGE_MAX_BYTES = 16 * 1024;
var targets = freezeRegistry(
  RPC_TARGETS_1171.map(([id, parameters, allowed]) => ({ id, parameters, allowed }))
);
function input(id, value) {
  try {
    validate(value, operationDefinition(id).inputSchema);
    return inputObject(value);
  } catch {
    throw new HcmError(
      "INVALID_ARGUMENT",
      "Аргументы поиска функций не подходят.",
      "Аргументы операции описывает api.describe."
    );
  }
}
function unknownTarget(targetId, available, source) {
  const [library, method] = targetId.split(".");
  const inLibrary = available.filter((item) => item.id.startsWith(`${library}.`));
  const near = inLibrary.map((item) => item.id.slice(library.length + 1)).filter((name3) => name3.toLowerCase().includes(method.toLowerCase())).slice(0, 5);
  return new HcmError(
    "UNKNOWN_RPC_TARGET",
    source !== "server" ? `Функции ${targetId} нет во встроенной таблице.` : inLibrary.length ? `В библиотеке ${library} нет функции ${method}.` : `Среди библиотек сервера нет библиотеки ${library} или в ней нет функций.`,
    `${near.length ? `Похожие: ${near.join(", ")}. ` : ""}Имена ищет rpc.list: query — часть имени, all:true — вместе с функциями, которые вызываются только из кода на сервере.`
  );
}
var RpcCatalog = class {
  reader;
  constructor(applicationInfo, readFile2) {
    if (applicationInfo && readFile2) this.reader = new LibraryReader(applicationInfo, readFile2);
  }
  async catalog(builtIn, library) {
    const server = builtIn === true ? void 0 : await this.reader?.read(library);
    return server ? {
      targets: server.targets,
      source: "server",
      ...server.skipped.length ? { skipped: server.skipped } : {}
    } : { targets, source: "built-in 2025.1.1171" };
  }
  /** Why the server refused a call, when its own list of functions explains it. */
  async refusal(targetId) {
    const { targets: available, source } = await this.catalog(false, targetId.split(".")[0]);
    if (source !== "server") return void 0;
    const target = available.find((item) => item.id === targetId);
    if (!target) return unknownTarget(targetId, available, source);
    if (target.allowed !== false) return void 0;
    const [library, method] = targetId.split(".");
    return new HcmError(
      "RPC_SERVER_ONLY",
      `Функцию ${targetId} сервер не разрешает вызывать с клиента.`,
      `Вызывать её нужно из кода на сервере: execute.script, например r = ${library}.${method}(…); RESULT = [r + '']; — массив обойти циклом, из объекта взять нужные поля.`
    );
  }
  async list(filter = {}) {
    const args = input("rpc.list", filter);
    const query = filter.query?.trim().toLowerCase();
    const cursor = boundedInteger(args.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor");
    const limit = boundedInteger(args.limit, 30, 100, "limit");
    const { targets: available, ...metadata } = await this.catalog(filter.builtIn, filter.library);
    const matching = available.filter((target) => {
      const [library, method] = target.id.split(".");
      return (filter.library === void 0 || library === filter.library) && (filter.method === void 0 || method === filter.method) && (!query || [target.id, ...target.parameters].some((value) => value.toLowerCase().includes(query)));
    });
    const filtered = filter.all === true ? matching : matching.filter((target) => target.serverOnly !== true);
    const total = filtered.length;
    const hidden = matching.length - filtered.length;
    const serverOnlyHidden = hidden ? { serverOnlyHidden: hidden } : {};
    const selected = [];
    for (const { id, parameters, allowed, serverOnly } of filtered.slice(cursor, cursor + limit)) {
      const target = { id, parameters, allowed, ...serverOnly ? { serverOnly } : {} };
      const candidate = [...selected, target];
      const nextCursor2 = cursor + candidate.length;
      const page = {
        ...metadata,
        targets: candidate,
        total,
        ...serverOnlyHidden,
        ...nextCursor2 < total ? { nextCursor: nextCursor2 } : {}
      };
      if (Buffer.byteLength(JSON.stringify(page, null, 2), "utf8") > RPC_CATALOG_PAGE_MAX_BYTES) {
        if (selected.length === 0)
          throw new HcmError(
            "RPC_METADATA_TOO_LARGE",
            "Описание следующей функции не помещается в страницу.",
            "Эту функцию нужно прочитать отдельно: rpc.describe.",
            { targetId: target.id }
          );
        break;
      }
      selected.push(target);
    }
    const nextCursor = cursor + selected.length;
    return freezeRegistry({
      ...metadata,
      targets: selected,
      total,
      ...serverOnlyHidden,
      ...nextCursor < total ? { nextCursor } : {}
    });
  }
  async describe(targetId, options = {}) {
    input("rpc.describe", { ...inputObject(options), targetId });
    const { targets: available, ...metadata } = await this.catalog(
      options.builtIn,
      targetId.split(".")[0]
    );
    const target = available.find((item) => item.id === targetId);
    if (!target) throw unknownTarget(targetId, available, metadata.source);
    const { id, parameters, allowed, serverOnly } = target;
    let code = {};
    if (options.source === true && metadata.source === "server") {
      const bytes = Buffer.from(target.code ?? "", "utf8");
      code = {
        code: new TextDecoder().decode(bytes.subarray(0, 8192), { stream: true }),
        ...bytes.length > 8192 ? { codeTruncated: true } : {}
      };
    }
    return freezeRegistry({
      id,
      parameters,
      allowed,
      ...serverOnly ? {
        serverOnly,
        note: `С клиента функция не вызывается (нет ALLOW-CALL-FROM-CLIENT). Вызывать её нужно из кода на сервере: ${id}(…).`
      } : {},
      ...metadata,
      ...code
    });
  }
};

// src/server-info.ts
var fields2 = ["sys_db_capability", "catalog_limits", "version_server", "os_type"];
var maxCatalogXmlBytes = 256 * 1024;
var maxCatalogRows = 4096;
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
function wrapper2(value, child) {
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
  if (typeof node["@_VALUE-TYPE"] !== "string" || node["@_VALUE-TYPE"].toLowerCase() !== type)
    throw new Error();
  const text3 = node["#text"] ?? "";
  if (typeof text3 !== "string") throw new Error();
  return text3;
}
function signedInteger(value) {
  if (!/^(?:0x[0-9a-fA-F]{1,16}|[+-]?\d{1,20})$/.test(value)) throw new Error();
  const integer2 = BigInt(value);
  if (integer2 < -0x8000000000000000n || integer2 > 0x7fffffffffffffffn) throw new Error();
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
  const children3 = container.catalog;
  const rows = children3 === void 0 ? [] : Array.isArray(children3) ? children3 : [children3];
  if (rows.length > maxCatalogRows) throw new Error();
  const names = /* @__PURE__ */ new Set();
  return rows.map((value) => {
    const row = object3(value);
    exactKeys(row, ["name", "max_records_num", "#text"]);
    if (!blank(row["#text"]) || typeof row.name !== "string" || typeof row.max_records_num !== "string")
      throw new Error();
    const name3 = row.name;
    if (name3.length === 0 || name3.length > 512 || names.has(name3)) throw new Error();
    names.add(name3);
    return { objectTypeName: name3, maxRecordsNum: signedInteger(row.max_records_num) };
  });
}
function parseServerInfo(response, profile = "native") {
  try {
    if (profile !== "native" && profile !== "web") throw new Error();
    const rpc = object3(response);
    exactKeys(rpc, ["xml", "valueType", "lexicalValue"]);
    if (rpc.valueType !== void 0 && (typeof rpc.valueType !== "string" || rpc.valueType.toLowerCase() !== "object") || !blank(rpc.lexicalValue))
      throw new Error();
    const result = object3(wrapper2(wrapper2(rpc.xml, "ResultData"), "Result"));
    exactKeys(result, ["@_VALUE-TYPE", "#text", ...fields2]);
    if (typeof result["@_VALUE-TYPE"] !== "string" || result["@_VALUE-TYPE"].toLowerCase() !== "object" || !blank(result["#text"]))
      throw new Error();
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

// src/platform-errors.ts
var USUAL_CAUSES = {
  "runtime.query": "нет такого каталога или поля, ошибка в запросе XQuery",
  "objects.get": "объекта с таким ID или адресом нет; ID строки каталога без своего типа объекта — не ID документа",
  "objects.patch": "объекта с таким ID или адресом нет",
  "objects.delete": "объекта с таким ID или адресом нет",
  "objects.create": "значение, которое тип объекта не принимает",
  "schema.get": "формы по этому адресу нет",
  "rpc.call": "нет такой функции, неверные аргументы или ошибка внутри функции",
  "files.read": "по этому адресу ничего нет",
  "files.write": "сервер не сообщил, какие папки принимают запись; в папку кода файл записывает код на сервере",
  "files.delete": "по адресу нет файла или в папке есть файлы; если сервер не сообщил, какие папки принимают запись, это может быть папка кода, где файл удаляет код на сервере",
  "native.lds.loadDoc": "по этому адресу ничего нет"
};
function refusalHint(operation) {
  const cause = USUAL_CAUSES[operation];
  return `${cause ? `Обычная причина: ${cause}. ` : ""}Причину сервер в ответе не сообщает. Строка о ней может быть в логе xhttp за сегодня (последние строки показывает logs.follow); отклонённый запрос часто строки не оставляет.`;
}
var ADDRESS_HINT = "Проверить адрес и порт подключения: WTCTL_URL или baseUrl в файле подключений.";
function network(reason, address2, host) {
  switch (reason) {
    case "refused":
      return {
        message: `Сервер ${address2} не отвечает: соединение отклонено.`,
        hint: `Проверить, что сервер запущен. ${ADDRESS_HINT}`
      };
    case "unknown_host":
      return { message: `Адрес сервера не найден: ${host}.`, hint: ADDRESS_HINT };
    case "unreachable":
      return { message: `Сервер ${address2} недоступен по сети.`, hint: ADDRESS_HINT };
    case "certificate":
      return {
        message: `Сертификат сервера ${address2} не прошёл проверку.`,
        hint: "Если сертификат выпущен внутренним центром сертификации, нужно указать его корневой сертификат в переменной NODE_EXTRA_CA_CERTS."
      };
    case "tls":
      return {
        message: `Не удалось установить защищённое соединение с ${address2}.`,
        hint: "Проверить схему в адресе подключения: https для защищённого порта, http для обычного."
      };
    case "not_http":
      return { message: `По адресу ${address2} отвечает не сервер HTTP.`, hint: ADDRESS_HINT };
    case "redirect":
      return {
        message: `Сервер ${address2} перенаправляет запросы на другой адрес.`,
        hint: "Нужно указать в подключении конечный адрес сервера, например с https вместо http."
      };
    case "timeout":
      return {
        message: `Сервер ${address2} не ответил за отведённое время.`,
        hint: "Проверить, что сервер работает. Для долгих операций увеличить timeoutMs подключения."
      };
    case "reset":
      return {
        message: `Соединение с ${address2} оборвалось.`,
        hint: "Проверить, что сервер работает, и повторить."
      };
    case "aborted":
      return { message: `Запрос к ${address2} прерван.` };
    default:
      return {
        message: `Запрос к ${address2} не выполнен: нет связи с сервером.`,
        hint: `Проверить, что сервер запущен. ${ADDRESS_HINT}`
      };
  }
}
function platformFailure(error, baseUrl, operation) {
  let address2 = baseUrl.replace(/\/+$/, "");
  let host = address2;
  try {
    const url = new URL(baseUrl);
    address2 = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    host = url.hostname;
  } catch {
  }
  const status = error.status;
  if (status === void 0) {
    const reason = error.details?.network;
    if (error.kind === "http")
      return network(
        typeof reason === "string" ? reason : "reset",
        address2,
        host
      );
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
    return { message: "Сервер отклонил запрос (HTTP 500).", hint: refusalHint(operation) };
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
async function checkServer(config, invoke) {
  const report = {
    permissions: config.permissions,
    checks: [],
    summary: { ok: 0, failed: 0, skipped: 0 }
  };
  let info = {};
  const rows = (value) => Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : [];
  const text3 = (value, max = 128) => {
    const result = requiredString(value, "check response");
    if (result.length > max) throw new Error();
    return result;
  };
  const probe = async (name3, id, args = {}, accept = (_) => {
  }) => {
    const skipped = name3 !== "login" && report.checks[0]?.result === "failed" ? "сессия не открыта" : name3 === "execute" && !config.permissions.execute ? "выполнение кода не разрешено подключением" : void 0;
    if (skipped) {
      report.checks.push({ name: name3, result: "skipped", reason: skipped });
      return;
    }
    let late = false;
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          late = true;
          reject(new Error());
        }, config.timeoutMs);
      });
      const pending = invoke(id, args);
      pending.catch(() => {
      });
      accept(await Promise.race([pending, timeout]));
      report.checks.push({ name: name3, result: "ok" });
    } catch (error) {
      const status = error instanceof WsHcmApiError ? error.status : void 0;
      const explained = error instanceof WsHcmApiError && (name3 === "login" || status === void 0) ? platformFailure(error, config.baseUrl, id) : void 0;
      const reason = late ? "превышено время проверки" : status === 500 && name3 === "portal" ? "HTTP 500: проверить порт в объекте «хост» и адрес подключения" : explained ? [explained.message, explained.hint].filter(Boolean).join(" ") : status !== void 0 ? `HTTP ${status}` : error instanceof HcmError ? `проверка не пройдена: ${error.code}` : "проверка не пройдена";
      report.checks.push({ name: name3, result: "failed", reason });
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
    const database2 = rows(info.databases).find((db) => db.id === text3(info.default_db_name));
    if (!rows(database2?.catalogs).length) throw new Error();
  });
  await probe("query", "runtime.query", { catalog: "collaborators", limit: 1, fields: ["id"] });
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
    if (status >= 500) throw new WsHcmApiError("http", "Portal error", { status });
  });
  await probe("execute", "execute.script", { code: "RESULT = [1 + 1];" }, (v) => {
    const result = inputObject(v).result;
    if (!Array.isArray(result) || result.length !== 1 || String(result[0]) !== "2")
      throw new Error();
  });
  for (const { result } of report.checks) report.summary[result]++;
  return report;
}

// src/objects.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { mkdir as mkdir2, appendFile } from "node:fs/promises";
import { join as join2 } from "node:path";

// src/verification.ts
var shown = (value) => value === void 0 ? null : typeof value === "string" ? value.length > 200 ? `${value.slice(0, 200)}…` : value : Array.isArray(value) ? `[список: ${value.length}]` : value !== null && typeof value === "object" ? "{структура}" : value;
function record2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function bool(value) {
  if (value === true || value === "true" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  return void 0;
}
var DATE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:\d{2})?$/;
function serverDate(value) {
  const match = typeof value === "string" ? DATE.exec(value) : null;
  return match ? `${match[1]}T${match[2] ?? "00:00"}:${match[3] ?? "00"}` : void 0;
}
function isServerDate(value) {
  return DATE.test(value);
}
function equivalent(expected, actual, path, fields3, prior, inCollection = false, differences = []) {
  const differ = () => {
    if (differences.length < 5)
      differences.push({ path, requested: shown(expected), actual: shown(actual) });
    return false;
  };
  const field = fields3.get(path.replace(/\[\d+\]/g, ""));
  const child = (key) => prior?.[key];
  const hasAttrs = record2(prior) && Object.keys(prior).some((key) => key.startsWith("@_"));
  const text3 = record2(prior) && /\S/.test(String(prior["#text"] ?? ""));
  if (!hasAttrs && !text3 && record2(prior) && typeof expected === "string" && expected.trim() === "")
    expected = "";
  if (field?.multiple === true && !inCollection) {
    const left = expected === void 0 || expected === "" ? [] : Array.isArray(expected) ? expected : [expected];
    const right = actual === void 0 || actual === "" ? [] : Array.isArray(actual) ? actual : [actual];
    if (left.length !== right.length) return differ();
    return left.every(
      (item, index) => equivalent(
        item,
        right[index],
        `${path}[${index}]`,
        fields3,
        child(index) ?? prior,
        true,
        differences
      )
    );
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return differ();
    return expected.every(
      (item, i) => equivalent(item, actual[i], `${path}[${i}]`, fields3, child(i), false, differences)
    );
  }
  if (record2(expected)) {
    const received = !hasAttrs && !text3 && (actual == null || actual === "") ? {} : actual;
    if (!record2(received)) return differ();
    return Object.entries(expected).every(
      ([key, value]) => equivalent(value, received[key], `${path}.${key}`, fields3, child(key), false, differences)
    );
  }
  if (expected === void 0 || expected === "" || expected === null)
    return actual === void 0 || actual === "" || actual === null || differ();
  if (actual !== null && typeof actual === "object") return differ();
  if (field?.type === "bool")
    return bool(expected) !== void 0 && bool(expected) === bool(actual) || differ();
  if (field?.type === "integer" && /^(?:-?\d+|0x[0-9a-f]+)$/i.test(String(expected)) && /^(?:-?\d+|0x[0-9a-f]+)$/i.test(String(actual)))
    return BigInt(String(expected)) === BigInt(String(actual)) || differ();
  const date2 = serverDate(expected);
  if (date2 !== void 0 && date2 === serverDate(actual)) return true;
  return String(expected) === String(actual) || differ();
}
function verifyFields(expected, actual, descriptors, names = Object.keys(expected), original) {
  const reference = original ? Object.values(parseXml(original))[0] : expected;
  const fields3 = /* @__PURE__ */ new Map();
  if (Array.isArray(descriptors)) {
    for (const field of descriptors)
      if (record2(field) && typeof field.path === "string") fields3.set(field.path, field);
  }
  const differences = [];
  const mismatches = [...new Set(names)].filter(
    (name3) => !equivalent(expected[name3], actual[name3], name3, fields3, reference[name3], false, differences)
  );
  if (mismatches.length)
    throw new HcmError(
      "READ_BACK_MISMATCH",
      "Документ сохранён, но поля из details.fields не приняли запрошенные значения.",
      "Что не совпало — в details.differences. Остальные поля запроса сохранены: заново объект не создавать. Обычная причина: сервер переписывает значение или внутри структуры нет такого поля; поля показывает schema.get.",
      { fields: mismatches, differences },
      "indeterminate"
    );
}
function verifyRemovals(expected, actual, changes, descriptors) {
  const at = (data2, path) => {
    let value = data2;
    let fieldPath = "";
    for (const match of patchSegments(path)) {
      fieldPath += `${fieldPath ? "." : ""}${match[1]}`;
      value = record2(value) ? value[match[1]] : void 0;
      if (match[3] !== void 0) {
        const keyPath = `${fieldPath}.${match[3]}`;
        const field = Array.isArray(descriptors) ? descriptors.find((field2) => record2(field2) && field2.path === keyPath) : void 0;
        value = (Array.isArray(value) ? value : [value]).find(
          (item) => record2(item) && equivalent(match[4], item[match[3]], keyPath, /* @__PURE__ */ new Map([[keyPath, field]]))
        );
      } else if (match[2] !== void 0)
        value = Array.isArray(value) ? value[Number(match[2])] : Number(match[2]) === 0 ? value : void 0;
    }
    return value;
  };
  for (const raw of changes) {
    if (!record2(raw) || raw.op !== "remove" || typeof raw.path !== "string" || patchSegments(raw.path).at(-1)[2] !== void 0)
      continue;
    if (at(expected, raw.path) !== void 0) continue;
    const value = at(actual, raw.path);
    if (value !== void 0 && value !== "" && value !== null)
      throw new HcmError(
        "READ_BACK_MISMATCH",
        "Поле, которое нужно было удалить, осталось в документе.",
        "До повтора проверить, не задаёт ли форма этому полю значение по умолчанию.",
        { fields: [raw.path] },
        "indeterminate"
      );
  }
}

// src/objects.ts
function isBinary(value) {
  return !!value && typeof value === "object" && "kind" in value && value.kind === "binary" && "bytes" in value && value.bytes instanceof Uint8Array;
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
function patchInput(patch, remove, resave = false) {
  if (remove === void 0) {
    if (patch === void 0) {
      if (resave) return [];
      throw new HcmError("INVALID_ARGUMENT", "Нужно указать patch, remove или оба.");
    }
    return patch;
  }
  if (!Array.isArray(remove) || remove.some((path) => typeof path !== "string"))
    throw new HcmError("INVALID_ARGUMENT", "remove: нужен список путей.");
  const set = Array.isArray(patch) ? patch : Object.entries(inputObject(patch ?? {}, "patch")).map(([path, value]) => ({
    op: "set",
    path,
    value
  }));
  return [...set, ...remove.map((path) => ({ op: "remove", path }))];
}
var ServerObjects = class {
  constructor(server, schema2, journalDirectory) {
    this.server = server;
    this.schema = schema2;
    this.journalDirectory = journalDirectory;
  }
  /** One object by id or url, as objects.get answers. */
  async get(args) {
    const loaded = await this.load(args);
    const snapshot = loaded.document.snapshot();
    const data2 = withoutFalseOffset(projectFields(snapshot.data, args.fields));
    const absent = Array.isArray(args.fields) ? args.fields.filter((field) => !Object.hasOwn(data2, field)) : [];
    const shape = absent.length || hasStructure(data2) ? await this.schema.documentShape(snapshot.type, snapshot.formUrl).catch(() => void 0) : void 0;
    const row = await this.catalogRow(snapshot.type, loaded.url, loaded.id, absent);
    const unknownFields = shape?.fields.size ? absent.filter((field) => !shape.fields.has(field) && !row.known.has(field)) : [];
    const emptyFields = shape?.fields.size ? absent.filter(
      (field) => !unknownFields.includes(field) && !Object.hasOwn(row.values, field)
    ) : [];
    return {
      ...loaded.id === void 0 ? {} : { id: loaded.id },
      type: snapshot.type,
      url: loaded.url,
      data: shape ? withRepeated(data2, shape.repeated) : data2,
      ...Object.keys(row.values).length ? { fromCatalog: row.values } : {},
      ...emptyFields.length ? { emptyFields } : {},
      ...unknownFields.length ? { unknownFields } : {},
      fingerprint: snapshot.fingerprint,
      ...snapshot.formUrl === void 0 ? {} : { formUrl: snapshot.formUrl }
    };
  }
  async load(args) {
    const url = args.url === void 0 ? resolvePhysicalDocumentLocation(requiredString(args.id, "id")).url : requiredString(args.url, "url");
    const response = await this.server.call("native.lds.loadDoc", {
      url,
      useBinaryResponse: true
    });
    const source = isBinary(response) ? new TextDecoder("utf-8", { fatal: true }).decode(response.bytes) : buildXml(findXmlNode(response, "Data"));
    let document;
    try {
      document = XmlDocument.parse(source);
    } catch (error) {
      if (args.url === void 0 || !(error instanceof HcmError)) throw error;
      throw new HcmError(
        error.code,
        error.message,
        "Если по адресу не документ объекта: файл читает files.read, поля формы — schema.get с url."
      );
    }
    const snapshot = document.snapshot();
    const documentId = typeof snapshot.data.id === "string" && snapshot.data.id !== "" ? snapshot.data.id : void 0;
    const requested = args.id === void 0 ? void 0 : resolvePhysicalDocumentLocation(requiredString(args.id, "id")).objectId;
    if (requested !== void 0 && documentId !== void 0 && BigInt(resolvePhysicalDocumentLocation(documentId).objectId) !== BigInt(requested))
      throw new HcmError(
        "TARGET_MISMATCH",
        "ID в прочитанном документе не совпадает с запрошенным.",
        "Нужно передать id и url одного объекта или что-то одно. Запись не отправлена.",
        void 0,
        "not_sent"
      );
    if (args.type !== void 0 && snapshot.type !== identifier(args.type, "type"))
      throw new HcmError(
        "TYPE_MISMATCH",
        `Тип объекта — ${snapshot.type}, а не ${String(args.type)}.`,
        void 0,
        { actualType: snapshot.type }
      );
    return { document, url, id: documentId ?? requested ?? parsePhysicalDocumentId(url) };
  }
  async journal(entry2) {
    await mkdir2(this.journalDirectory, { recursive: true });
    await appendFile(
      join2(this.journalDirectory, "mutations.jsonl"),
      `${JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ...entry2 })}
`,
      { encoding: "utf8", mode: 384 }
    );
  }
  async resolveCatalog(type, documentUrl) {
    const info = await this.server.applicationInfo();
    let dbName = typeof info.default_db_name === "string" ? info.default_db_name : void 0;
    if (documentUrl) {
      const url = new URL(documentUrl);
      if (url.protocol === "x-local:") dbName = url.hostname;
    }
    if (dbName === void 0 || !Array.isArray(info.databases)) return void 0;
    const db = info.databases.find(
      (value) => value && typeof value === "object" && "id" in value && value.id === dbName
    );
    if (!db || typeof db !== "object" || !("catalogs" in db) || !Array.isArray(db.catalogs))
      return void 0;
    const named = (value, objectType, id) => !!value && typeof value === "object" && "object_type" in value && value.object_type === objectType && "id" in value && typeof value.id === "string" && (id === void 0 || value.id === id);
    let matches2 = db.catalogs.filter((value) => named(value, type));
    if (!matches2.length)
      matches2 = db.catalogs.filter((value) => named(value, "", `${type}s`));
    return matches2.length === 1 ? identifier(inputObject(matches2[0]).id, "catalog") : void 0;
  }
  /**
   * Values of the named fields in the catalog row of an object. `known` holds the names that are
   * fields of the catalog, whether the row has a value for them or not.
   */
  async catalogRow(type, url, id, names) {
    const none = { values: {}, known: /* @__PURE__ */ new Set() };
    if (!names.length || id === void 0) return none;
    try {
      const catalog = await this.resolveCatalog(type, url);
      if (!catalog) return none;
      const shape = await this.schema.catalogShape({ catalog });
      const known = new Set(names.filter((name3) => shape?.fields.has(name3)));
      if (!known.size) return none;
      const response = await this.server.read("native.lds.xQuery", {
        query: `for $elem in ${catalog} where $elem/id = ${resolvePhysicalDocumentLocation(id).objectId} return $elem`,
        maxCount: 1,
        expectToReadAll: false,
        keepCursor: false
      });
      const [item] = queryPage(response, 0, 1, [...known], false).items;
      const values = Object.fromEntries(
        Object.entries(withoutFalseOffset(item ?? {})).filter(
          ([name3]) => known.has(name3)
        )
      );
      return { values, known };
    } catch {
      return none;
    }
  }
  async catalogHasId(catalog, id) {
    const lexicalId = resolvePhysicalDocumentLocation(id).objectId;
    const response = await this.server.read("native.lds.xQuery", {
      query: `for $elem in ${catalog} where $elem/id = ${lexicalId} return $elem`,
      maxCount: 2,
      expectToReadAll: false,
      keepCursor: false
    });
    const data2 = cleanXmlValue(findXmlNode(response, "Data"));
    return data2 !== null && typeof data2 === "object" && Object.values(data2).some((value) => Array.isArray(value) ? value.length > 0 : value !== "");
  }
  /**
   * What the server would not keep is refused before the write: a field the type does not have is
   * dropped from the saved document, as is a value for a field the server computes, and a date the
   * server cannot read is stored as another value.
   */
  async requireFields(type, formUrl, data2, names) {
    const shape = await this.schema.documentShape(type, formUrl).catch(() => void 0);
    if (!shape) return;
    const written = [...new Set(names)];
    const unknown = shape.fields.size && !shape.partial ? written.filter((name3) => !shape.fields.has(name3)) : [];
    if (unknown.length) {
      const near = [...shape.fields].filter(
        (field) => unknown.some(
          (name3) => name3.length > 3 && field.includes(name3) || field.length > 3 && name3.includes(field) || oneEditApart(field, name3)
        )
      ).slice(0, 5);
      throw new HcmError(
        "UNKNOWN_FIELD",
        `У типа ${type} нет поля: ${unknown.join(", ")}.`,
        `${near.length ? `Похожие: ${near.join(", ")}. ` : ""}Поля типа показывает schema.get.`,
        { fields: unknown }
      );
    }
    const computed = written.filter((name3) => shape.computed?.has(name3));
    if (computed.length)
      throw new HcmError(
        "INVALID_ARGUMENT",
        `${computed.join(", ")}: значение вычисляет сервер, записать его нельзя.`,
        "Менять нужно поля, из которых сервер его складывает. Вычисляемые поля в schema.get помечены computed:true.",
        { fields: computed }
      );
    const wrong = written.filter((name3) => {
      const value = data2[name3];
      return shape.dates.has(name3) && typeof value === "string" && value && !isServerDate(value);
    });
    if (wrong.length)
      throw new HcmError(
        "INVALID_ARGUMENT",
        `${wrong.join(", ")}: дата записана не так, как её читает сервер.`,
        'Писать нужно "2026-12-05" или "2026-12-05T09:30:00". Время — местное время сервера: смещение в значении сервер не учитывает.',
        { fields: wrong }
      );
  }
  async create(args, out) {
    const type = identifier(args.type, "type");
    const data2 = inputObject(args.data, "data");
    if (data2.id !== void 0)
      throw new HcmError(
        "IMMUTABLE_ID",
        "ID новому объекту выдаёт сервер: нужно убрать id из data."
      );
    if (!Object.keys(data2).length)
      throw new HcmError(
        "INVALID_ARGUMENT",
        "data: нет ни одного поля.",
        "Нужно передать поля нового объекта, например {name: '…'}; значения по умолчанию сервер подставит сам."
      );
    XmlDocument.create(type, data2).snapshot();
    if (args.formUrl === void 0) await this.schema.requireType(type);
    const formUrl = args.formUrl === void 0 ? `x-local://wtv/wtv_${type}.xmd` : requiredString(args.formUrl, "formUrl");
    const form = await this.schema.documentForm(formUrl);
    if (!Array.isArray(form.roots) || !form.roots.includes(type))
      throw new HcmError("FORM_TYPE_MISMATCH", "В форме нет запрошенного типа объекта.");
    await this.requireFields(type, formUrl, data2, Object.keys(data2));
    const dbName = args.dbName === void 0 ? "wt_data" : identifier(args.dbName, "dbName");
    const mutationId = randomUUID3();
    out.note({ mutationId });
    await this.journal({ mutationId, operation: "objects.create", stage: "allocating", type });
    const allocated = await this.server.call("native.lds.getNewObjectId", { dbName }, out);
    const location = resolvePhysicalDocumentLocation(
      scalar(findXmlNode(allocated, "ObjectID"), "ObjectID"),
      dbName
    );
    out.note({ objectId: location.objectId, url: location.url });
    const snapshot = XmlDocument.create(
      type,
      { id: location.objectId, ...data2 },
      formUrl
    ).snapshot();
    await this.journal({
      mutationId,
      operation: "objects.create",
      stage: "prepared",
      objectId: location.objectId
    });
    await this.server.call(
      "native.lds.putDoc",
      { url: location.url, data: snapshot.xml, writeDocInfo: true, neverSaved: true },
      out
    );
    const loaded = await this.load({ url: location.url, type });
    const result = loaded.document.snapshot();
    if (BigInt(requiredString(loaded.id, "ID при проверочном чтении")) !== BigInt(location.objectId))
      throw new HcmError(
        "READ_BACK_MISMATCH",
        "При проверочном чтении ID созданного объекта не совпал с выданным.",
        void 0,
        { mutationId },
        "indeterminate"
      );
    verifyFields(snapshot.data, result.data, form.fields, Object.keys(data2));
    await this.journal({
      mutationId,
      operation: "objects.create",
      stage: "verified",
      objectId: location.objectId
    });
    return {
      id: location.objectId,
      url: location.url,
      type,
      fingerprint: result.fingerprint,
      mutationId,
      mutationOutcome: "confirmed"
    };
  }
  async patch(args, out) {
    const loaded = await this.load(args);
    const changes = loaded.document.patch(
      patchInput(args.patch, args.remove, args.resave === true)
    );
    if (args.expectedFingerprint !== void 0 && args.expectedFingerprint !== changes.before.fingerprint)
      throw new HcmError(
        "CONFLICT",
        "Объект изменился после чтения: его fingerprint не равен expectedFingerprint.",
        "Прочитать объект заново и составить изменение по его текущему состоянию.",
        void 0,
        "not_sent"
      );
    await this.requireFields(
      changes.before.type,
      changes.before.formUrl,
      changes.after.data,
      changes.changes.filter((change) => inputObject(change).op === "set").map((change) => patchSegments(String(inputObject(change).path))[0][1])
    );
    const noop = changes.before.fingerprint === changes.after.fingerprint;
    if (args.preview === true || noop && args.resave !== true)
      return {
        preview: args.preview === true,
        noop: noop && args.resave !== true,
        changes: changes.changes,
        fingerprint: changes.before.fingerprint
      };
    const current = await this.load(args);
    if (current.document.snapshot().fingerprint !== changes.before.fingerprint)
      throw new HcmError(
        "CONFLICT",
        "Объект изменился, пока готовилась запись.",
        void 0,
        void 0,
        "not_sent"
      );
    const form = await this.schema.documentForm(
      changes.before.formUrl ?? `x-local://wtv/wtv_${changes.before.type}.xmd`
    );
    const branches = changes.changes.map(
      (change) => patchSegments(String(inputObject(change).path))[0][1]
    );
    const mutationId = randomUUID3();
    await this.journal({
      mutationId,
      operation: "objects.patch",
      stage: "prepared",
      fingerprint: changes.before.fingerprint
    });
    out.note({
      mutationId,
      url: loaded.url,
      ...loaded.id === void 0 ? {} : { objectId: loaded.id }
    });
    await this.server.call(
      "native.lds.putDoc",
      { url: loaded.url, data: changes.after.xml, writeDocInfo: true },
      out
    );
    const verified = await this.load(args);
    const snapshot = verified.document.snapshot();
    verifyFields(changes.after.data, snapshot.data, form.fields, branches, changes.before.xml);
    verifyRemovals(changes.after.data, snapshot.data, changes.changes, form.fields);
    await this.journal({
      mutationId,
      operation: "objects.patch",
      stage: "verified",
      fingerprint: snapshot.fingerprint
    });
    const serverChanged = Object.keys({ ...changes.after.data, ...snapshot.data }).filter(
      (key) => key !== "doc_info" && !branches.includes(key) && JSON.stringify(changes.after.data[key]) !== JSON.stringify(snapshot.data[key])
    );
    return {
      ...verified.id === void 0 ? {} : { id: verified.id },
      type: snapshot.type,
      url: loaded.url,
      fingerprint: snapshot.fingerprint,
      changes: changes.changes,
      ...serverChanged.length ? { serverChanged: serverChanged.slice(0, 20) } : {},
      mutationId,
      mutationOutcome: "confirmed"
    };
  }
  async delete(args, out) {
    if (args.permanent !== true)
      throw new HcmError(
        "DELETE_MODE_REQUIRED",
        "Объект удаляется безвозвратно: для этого нужен permanent:true.",
        "Корзины у этой операции нет.",
        void 0,
        "not_sent"
      );
    const loaded = await this.load(args);
    const snapshot = loaded.document.snapshot();
    const objectId = requiredString(loaded.id, "ID объекта");
    const catalog = args.catalog === void 0 ? await this.resolveCatalog(snapshot.type, loaded.url) : identifier(args.catalog, "catalog");
    if (catalog !== void 0 && !await this.catalogHasId(catalog, objectId))
      throw new HcmError(
        "CATALOG_MISMATCH",
        "Объекта нет в каталоге, по которому проверяется удаление.",
        "Нужно указать каталог, в котором объект есть. Запрос на удаление не отправлен.",
        void 0,
        "not_sent"
      );
    const mutationId = randomUUID3();
    await this.journal({ mutationId, operation: "objects.delete", stage: "prepared", objectId });
    out.note({ mutationId, objectId, url: loaded.url });
    await this.server.call("native.lds.deleteDoc", { url: loaded.url, strictDelete: true }, out);
    if (catalog !== void 0 && await this.catalogHasId(catalog, objectId))
      throw new HcmError(
        "READ_BACK_MISMATCH",
        "После удаления объект всё ещё есть в каталоге.",
        "Перед повтором удаления прочитать объект. Причину сервер пишет в лог spxml_unibridge.",
        void 0,
        "indeterminate"
      );
    await this.journal({
      mutationId,
      operation: "objects.delete",
      stage: catalog === void 0 ? "acknowledged" : "verified-absence",
      objectId
    });
    return {
      id: objectId,
      mutationId,
      mutationOutcome: "confirmed",
      verification: catalog === void 0 ? "server acknowledgement" : "catalog absence",
      ...catalog === void 0 ? {} : { catalog }
    };
  }
};

// src/write-outcome.ts
function refusedAtDoor(error) {
  return error instanceof WsHcmApiError && error.status === 401 || loginFailed(error);
}
var WriteOutcome = class {
  marks = 0;
  ids = {};
  /** Before a request that may change the server; returns the withdrawal of this one mark. */
  sending() {
    this.marks++;
    let withdrawn = false;
    return () => {
      if (!withdrawn) this.marks--;
      withdrawn = true;
    };
  }
  note(ids) {
    for (const [key, value] of Object.entries(ids))
      if (value !== void 0) this.ids[key] = value;
  }
  /** The first line that fits: no error, a read, a refusal at the door, a mark not withdrawn, otherwise not sent. */
  verdict(effect, error) {
    const { mutationId, objectId, executionId } = this.ids;
    const exactIds = {
      ...mutationId !== void 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(mutationId) ? { mutationId } : {},
      ...objectId !== void 0 && /^(?:[0-9]{1,20}|0[xX][0-9a-fA-F]{1,16})$/.test(objectId) && BigInt(objectId) <= 0xffffffffffffffffn ? { objectId } : {},
      ...executionId !== void 0 && /^hcm_inline_[a-f0-9]{32}$/.test(executionId) ? { executionId } : {}
    };
    const sent = effect !== "read" && this.marks > 0;
    const verdict = { sent, ids: { ...this.ids }, exactIds };
    if (error === void 0) return verdict;
    const turnedAway = error instanceof HcmError && (error.code === "RPC_SERVER_ONLY" || error.code === "UNKNOWN_RPC_TARGET");
    const mutationOutcome = effect === "read" ? error instanceof HcmError ? error.mutationOutcome : void 0 : sent && !turnedAway ? "indeterminate" : "not_sent";
    if (mutationOutcome === void 0) return verdict;
    const refusedAfterSend = mutationOutcome === "indeterminate" && refusedAtDoor(error);
    return { ...verdict, mutationOutcome, ...refusedAfterSend && { refusedAfterSend } };
  }
};

// src/hcm-server.ts
function refuseUnowned(id, args, refused) {
  const effect = nativeEffect(id, args);
  if (effect !== void 0 && refused(effect))
    throw new Error(`${id}: запрос, который может изменить сервер, без владельца исхода записи`);
}
var HcmServer = class {
  constructor(port) {
    this.port = port;
  }
  appInfo;
  /** A request of an operation the registry calls a read. Anything else must say what it is. */
  async call(id, args, outcome) {
    if (!outcome) {
      refuseUnowned(id, args, (effect) => effect !== "read");
      return this.port.call(id, args);
    }
    const withdraw = outcome.sending();
    try {
      return await this.port.call(id, args);
    } catch (error) {
      if (error instanceof WsHcmApiError && error.requestSent === false || refusedAtDoor(error))
        withdraw();
      throw error;
    }
  }
  /** A request that only reads here though its operation can do more (xQuery, rpc.call); a registry write is refused. */
  async read(id, args) {
    refuseUnowned(id, args, (effect) => effect === "write");
    return this.port.call(id, args);
  }
  /** Application info, kept for 30 seconds; a refused request is not kept. */
  async applicationInfo() {
    if (!this.appInfo || this.appInfo.expires < Date.now()) {
      const value = this.call("native.spxml2.getAppInfo", { fastStart: true });
      this.appInfo = { expires: Date.now() + 3e4, value };
      value.catch(() => {
        if (this.appInfo?.value === value) this.appInfo = void 0;
      });
    }
    return inputObject(await this.appInfo.value, "сведения о приложении");
  }
  /**
   * Code prepared by prepareScript, run on the server; the answer is checked for a caught error.
   * `idle` tells from the answer that the code did nothing: the mark is withdrawn.
   */
  async runCode(script, outcome, idle) {
    prepare(script.request, describeHcmOperation("web.rpc.call").inputSchema);
    outcome.note({ executionId: script.executionId });
    const withdraw = outcome.sending();
    try {
      const data2 = scriptResult(
        await this.port.call("web.rpc.call", script.request),
        script.executionId
      );
      if (idle?.(data2)) withdraw();
      return data2;
    } catch (error) {
      if (error instanceof HcmError && error.mutationOutcome === "not_sent" || refusedAtDoor(error))
        withdraw();
      throw error;
    }
  }
};

// src/reply.ts
function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array)
    return { base64: Buffer.from(value).toString("base64"), bytes: value.length };
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  return value;
}
function beginning(data2) {
  const cut = (value) => Array.isArray(value) ? value.slice(0, 3) : typeof value === "string" ? value.slice(0, 1e3) : value;
  if (data2 === null || typeof data2 !== "object" || Array.isArray(data2)) return cut(data2);
  return Object.fromEntries(Object.entries(data2).map(([key, value]) => [key, cut(value)]));
}
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
var ReplyPacker = class {
  constructor(config, results) {
    this.config = config;
    this.results = results;
  }
  /** Room for the payload of one reply; the rest of the output limit is left to its other fields. */
  get pageBytes() {
    return Math.floor(this.config.outputLimitBytes * 0.6);
  }
  /** What the operation returned; an answer over the limit is stored whole and replaced by its beginning. */
  async success(id, start, value, bound) {
    const data2 = jsonSafe(value);
    const serialised = JSON.stringify(data2);
    const failedBatch = id === "runtime.batch" && data2 !== null && typeof data2 === "object" && "ok" in data2 && data2.ok === false;
    const failedCheck = id === "runtime.check" && data2.summary.failed > 0;
    const batch = data2;
    const failedSteps = failedBatch ? batch.results.flatMap(
      (result, index) => result.ok ? [] : [{ index, id: result.meta.operationId, code: result.error?.code ?? "UNKNOWN" }]
    ) : [];
    const outcome = failedBatch || failedCheck ? {
      ok: false,
      error: {
        code: failedCheck ? "CHECK_FAILED" : "BATCH_FAILED",
        message: failedCheck ? `Проверка подключения не пройдена: ${data2.checks.filter((check) => check.result === "failed").map((check) => check.name).join(", ")}.` : `Отказало шагов пакета: ${failedSteps.length} из ${batch.requested}${batch.requested > batch.completed ? `; после отказа не запускались: ${batch.requested - batch.completed}` : ""}. До повтора нужно посмотреть исход каждого шага.`,
        hint: failedCheck ? data2.checks.find((check) => check.result === "failed")?.reason ?? "Причины — в data.checks." : "Номера и коды отказавших шагов — в error.details.failed, ответы шагов — в data.results.",
        retryable: false,
        ...failedBatch ? {
          details: {
            failed: failedSteps.slice(0, 20),
            ...failedSteps.length > 20 ? { failedTotal: failedSteps.length } : {}
          }
        } : {}
      }
    } : { ok: true };
    if (bound && Buffer.byteLength(serialised ?? "null") > this.config.outputLimitBytes && id !== "results.read" && id !== "runtime.check") {
      const stored = await this.results.put(data2);
      let preview = beginning(data2);
      if (Buffer.byteLength(JSON.stringify(preview)) > this.config.outputLimitBytes / 2)
        preview = {
          kind: "stored-result",
          ...data2 !== null && typeof data2 === "object" && !Array.isArray(data2) ? Object.fromEntries(
            Object.entries(data2).slice(0, 40).map(([key, value2]) => [
              key,
              Array.isArray(value2) ? id === "runtime.batch" && key === "results" ? value2.map(stepSummary) : `[список: ${value2.length}]` : value2 !== null && typeof value2 === "object" ? "{структура}" : typeof value2 === "string" && value2.length > 120 ? `${value2.slice(0, 120)}…` : value2
            ])
          ) : {}
        };
      return {
        ...outcome,
        ...failedBatch && "error" in outcome ? {
          error: {
            ...outcome.error,
            hint: "Номера и коды отказавших шагов — в error.details.failed; ответы шагов сохранены, их читает results.read."
          }
        } : {},
        data: {
          preview,
          resultId: stored.resultId,
          hint: `Ответ не поместился и сохранён целиком: results.read читает ${stored.list === void 0 ? "его частями" : `список ${stored.list} по элементам`}, results.export сохраняет в файл.`
        },
        meta: {
          operationId: id,
          connection: this.config.name,
          durationMs: Math.round(performance.now() - start),
          truncated: true,
          resultId: stored.resultId,
          resultBytes: stored.bytes
        }
      };
    }
    const kept = bound && (id === "logs.read" || id === "files.read") ? await this.results.put(data2).catch(() => void 0) : void 0;
    return {
      ...outcome,
      data: data2,
      meta: {
        operationId: id,
        connection: this.config.name,
        durationMs: Math.round(performance.now() - start),
        ...kept ? { resultId: kept.resultId } : {}
      }
    };
  }
  /** What the operation threw: worded by the class of the error, without secrets, within the limit. */
  failure(id, start, error, verdict, extra = {}) {
    const failure = this.pack(id, start, error, verdict, extra.refusal);
    if (!extra.batchRecovery) return failure;
    return { ...failure, data: this.batchRecoveryData(extra.batchRecovery) };
  }
  /** Local storage failure cannot erase already executed steps or label a sent batch not_sent. */
  batchRecoveryData(recovery) {
    const data2 = {
      partial: true,
      receiptOnly: true,
      completed: recovery.completed,
      requested: recovery.requested,
      sentMutationSteps: recovery.sentMutationSteps,
      receipts: [],
      omittedReceipts: recovery.receipts.length
    };
    const receipts = data2.receipts;
    const budget = Math.floor(this.config.outputLimitBytes / 3);
    for (const receipt of recovery.receipts) {
      const compact2 = { ...receipt };
      if (typeof compact2.url === "string" && compact2.url.length > 256) delete compact2.url;
      receipts.push(compact2);
      data2.omittedReceipts = recovery.receipts.length - receipts.length;
      if (Buffer.byteLength(JSON.stringify(data2)) > budget) {
        receipts.pop();
        data2.omittedReceipts = recovery.receipts.length - receipts.length;
        break;
      }
    }
    return data2;
  }
  pack(id, start, error, verdict, refusal) {
    const redact = (message, limit = 500) => {
      let safe = message;
      for (const secret of [
        this.config.password,
        this.config.username && this.config.password ? Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64") : void 0
      ])
        if (secret) safe = safe.replaceAll(secret, "[redacted]");
      return safe.replace(/\b[A-Za-z]:[\\/][^\r\n<>"']*/g, "[server-path]").replace(/(?:SessionID|Authorization|Cookie)\s*[:=]\s*[^\s,;]+/gi, "[redacted]").slice(0, limit);
    };
    const { mutationOutcome, refusedAfterSend, ids, exactIds } = verdict;
    const { mutationOutcome: _own, ...normal } = error instanceof HcmError ? error.toJSON() : error instanceof WebSocketHeartbeatError ? {
      code: error.errorCode,
      message: "Служба WebSocket не ответила на проверку.",
      hint: error.hint,
      retryable: false
    } : error instanceof WsHcmApiError ? {
      code: `PLATFORM_${error.kind.toUpperCase()}`,
      ...platformFailure(error, this.config.baseUrl, refusal ?? id),
      retryable: false,
      ...error.status === void 0 ? {} : { details: { status: error.status } }
    } : error instanceof TypeError ? {
      code: "INVALID_ARGUMENT",
      message: error.message,
      hint: "Аргументы операции описывает api.describe.",
      retryable: false
    } : {
      code: "INTERNAL_ERROR",
      message: "Операция не выполнена: внутренняя ошибка клиента.",
      hint: "Проверить аргументы по api.describe. Если ошибка повторяется при верных аргументах, это дефект клиента.",
      retryable: false
    };
    if (refusedAfterSend)
      normal.hint = `${normal.hint ?? ""} До этого отказа запрос на запись уже ушёл: после восстановления входа проверить, прошла ли запись, прежде чем повторять.`.trim();
    const trim = (value, depth = 0, limit = 256) => {
      if (typeof value === "string") {
        const text3 = redact(value, limit + 1);
        return text3.length > limit ? `${text3.slice(0, limit - 1)}…` : text3;
      }
      if (depth > 3) return "[details omitted]";
      if (Array.isArray(value)) return value.slice(0, 12).map((item) => trim(item, depth + 1));
      if (value !== null && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).slice(0, 12).map(([key, item]) => [
            key.slice(0, 128),
            trim(item, depth + 1, key === "scriptError" ? 2048 : 256)
          ])
        );
      return value;
    };
    let details = {
      ...trim({
        ...normal.details,
        ...ids.mutationId === void 0 ? {} : { mutationId: ids.mutationId },
        ...ids.objectId === void 0 ? {} : { objectId: ids.objectId },
        ...ids.url === void 0 ? {} : { url: ids.url },
        ...ids.executionId === void 0 ? {} : { executionId: ids.executionId }
      }),
      ...exactIds
    };
    if (Buffer.byteLength(JSON.stringify(details)) > this.config.outputLimitBytes / 4)
      details = {
        omitted: true,
        ...exactIds
      };
    const omitOversizedConnection = (value) => {
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if (bytes <= this.config.outputLimitBytes) return value;
      const omitted = {
        ...value,
        meta: { ...value.meta, connection: "[omitted]", connectionOmitted: true }
      };
      return Buffer.byteLength(JSON.stringify(omitted)) < bytes ? omitted : value;
    };
    const result = omitOversizedConnection({
      ok: false,
      error: {
        ...normal,
        // A platform failure is worded here from fixed text and the configured address; a password
        // that happens to be part of a word must not cut holes in it.
        ...error instanceof WsHcmApiError ? {} : {
          message: redact(normal.message),
          ...normal.hint === void 0 ? {} : { hint: redact(normal.hint) }
        },
        ...mutationOutcome === void 0 ? {} : { mutationOutcome },
        ...Object.keys(details).length ? { details } : {}
      },
      meta: {
        operationId: typeof id === "string" && id.length <= 128 ? id : "[invalid-operation]",
        connection: this.config.name,
        durationMs: Math.round(performance.now() - start)
      }
    });
    if (error instanceof WebSocketHeartbeatError) {
      const contextual = omitOversizedConnection({
        ...result,
        error: {
          ...result.error,
          details: { ...result.error?.details, heartbeatReceipt: error.receipt }
        }
      });
      if (Buffer.byteLength(JSON.stringify(contextual)) <= this.config.outputLimitBytes)
        return contextual;
      const receipt = error.receipt;
      return {
        ...contextual,
        error: {
          ...contextual.error,
          hint: "Проверить ответ heartbeat; автоматический повтор не выполняется.",
          details: {
            heartbeatReceiptFieldsOmitted: true,
            heartbeatReceipt: {
              route: receipt.route,
              phase: receipt.phase,
              ...receipt.httpStatus === void 0 ? {} : { httpStatus: receipt.httpStatus },
              handshakeValidated: receipt.handshakeValidated,
              heartbeatWritten: receipt.heartbeatWritten,
              heartbeatObserved: receipt.heartbeatObserved,
              closeRequested: receipt.closeRequested,
              peerCloseObserved: receipt.peerCloseObserved,
              peerEofObserved: receipt.peerEofObserved,
              closeWriteVerified: false,
              localSocketDisposed: receipt.localSocketDisposed,
              forcedLocalTermination: receipt.forcedLocalTermination
            }
          }
        }
      };
    }
    return result;
  }
};

// src/runtime.ts
function withoutXmlFormatting(value) {
  if (Array.isArray(value)) return value.map(withoutXmlFormatting);
  if (!value || typeof value !== "object" || value instanceof Uint8Array) return value;
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, child]) => key !== "@_xmlns" && !(key === "#text" && typeof child === "string" && child.trim() === "")
    ).map(([key, child]) => [
      key,
      // A line break and the indentation of the closing tag are formatting of an empty element.
      typeof child === "string" && /^\s*\n[ \t]+$/.test(child) ? "" : withoutXmlFormatting(child)
    ])
  );
}
function plainAnswer(id, answer) {
  if (answer === null || typeof answer !== "object" || Array.isArray(answer)) return answer;
  const data2 = answer;
  if (id === "web.pages.uploadFile" && typeof data2.Url === "string" && data2.Url) {
    const url = `x-local://share/uploaded_files/${data2.Url}`;
    const { Url: _, ...rest } = data2;
    return { ...rest, url, folderUrl: url.slice(0, url.lastIndexOf("/")) };
  }
  if (id === "web.spxml.getAsyncMethodStatus" && data2.ResultData !== void 0)
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
var HcmRuntime = class {
  constructor(config, port) {
    this.config = config;
    this.results = new ResultStore(config);
    this.replies = new ReplyPacker(config, this.results);
    this.gateway = new NativeGateway(config);
    this.server = new HcmServer(port ?? this.gateway);
    this.logs = new LogReader({ call: (id, args) => this.server.read(id, args) }, config);
    this.files = new ServerFiles(this.server, config.permissions);
    this.rpcCatalog = new RpcCatalog(
      () => this.server.applicationInfo(),
      (url) => this.server.call("native.lds.loadUrl", { url })
    );
    this.schemaReader = new SchemaReader(
      () => this.server.applicationInfo(),
      async (url) => requiredString(await this.server.call("native.spxml2.getForm", { url }), "ответ с формой"),
      async (url) => (await this.objects.load({ url })).document.snapshot().data
    );
    this.objects = new ServerObjects(this.server, this.schemaReader, this.results.directory);
  }
  gateway;
  results;
  logs;
  replies;
  server;
  schemaReader;
  files;
  objects;
  rpcCatalog;
  queue = Promise.resolve();
  closed = false;
  closePromise;
  listOperations(filter = {}) {
    return listHcmOperations(filter);
  }
  describe(id) {
    return describeHcmOperation(id);
  }
  /** Resolve conditional side effects for the actual arguments; frontends must use this before routing. */
  getOperationEffect(id, args = {}) {
    return this.effect(this.describe(id), args);
  }
  call(id, args = {}) {
    const start = performance.now();
    if (this.closed)
      return Promise.resolve(
        this.failure(id, start, new HcmError("RUNTIME_CLOSED", "Подключение уже закрыто."))
      );
    let snapshot;
    try {
      snapshot = inputObject(structuredClone(args));
    } catch {
      return Promise.resolve(
        this.failure(
          id,
          start,
          new HcmError(
            "INVALID_ARGUMENT",
            "Аргументы операции — не объект, или в них есть значение, которое нельзя скопировать.",
            "Нужно передать значения, совместимые с JSON; двоичные данные — как {base64: …}, XML — как {xml: …}."
          ),
          { outcome: new WriteOutcome(), effect: operationDefinition(id)?.effect ?? "unknown" }
        )
      );
    }
    const run = this.queue.then(() => this.perform(id, snapshot, start));
    this.queue = run.catch(() => void 0);
    return run;
  }
  effect(operation, args) {
    if (operation.id === "runtime.query") {
      const deferredArguments = Object.keys(args).length === 1 && typeof args.$ref === "string";
      return deferredArguments || args.query !== void 0 ? "execute" : "read";
    }
    if (operation.id === "objects.patch" && args.preview === true) return "read";
    if (operation.id === "runtime.batch") {
      const steps = args.steps;
      if (!Array.isArray(steps)) return "unknown";
      const effects = steps.map((raw) => {
        const step = inputObject(raw, "step");
        const id = requiredString(step.id, "step.id");
        if (id === "runtime.batch")
          throw new HcmError("NESTED_BATCH", "Пакет внутри пакета не поддерживается.");
        return this.effect(
          this.describe(id),
          step.args === void 0 ? {} : inputObject(step.args)
        );
      });
      if (effects.includes("unknown") || effects.includes("write") && effects.includes("execute"))
        return "unknown";
      return effects.includes("execute") ? "execute" : effects.includes("write") ? "write" : "read";
    }
    return operation.profile === void 0 ? operation.effect : getEffectiveNativeEffect(operation, args);
  }
  authorize(effect) {
    if ((effect === "write" || effect === "unknown") && !this.config.permissions.write)
      throw new HcmError(
        "WRITE_DISABLED",
        "Подключение не разрешает запись.",
        "Нужно право write: его включает владелец подключения в настройках подключения (permissions.write).",
        void 0,
        "not_sent"
      );
    if ((effect === "execute" || effect === "unknown") && !this.config.permissions.execute)
      throw new HcmError(
        "EXECUTE_DISABLED",
        "Подключение не разрешает выполнять код, функции и запросы XQuery на сервере.",
        "Нужно право execute: его включает владелец подключения в настройках подключения (permissions.execute).",
        void 0,
        "not_sent"
      );
  }
  async perform(id, args, start, boundOutput = true, state = { outcome: new WriteOutcome(), effect: "read" }) {
    try {
      const operation = this.describe(id);
      state.effect = operation.effect;
      validate(args, operation.inputSchema);
      state.effect = this.effect(operation, args);
      this.authorize(state.effect);
      if (operation.profile !== void 0) prepare(args, operation.inputSchema);
      const value = await this.dispatch(id, args, state);
      return await this.replies.success(id, start, value, boundOutput);
    } catch (error) {
      return this.failure(id, start, error, state);
    }
  }
  failure(id, start, error, state = { outcome: new WriteOutcome(), effect: "read" }) {
    if (error instanceof WsHcmApiError && error.status === 500 || error instanceof HcmError && error.code === "SCRIPT_FAILED")
      this.logs.serverWroteLog();
    return this.replies.failure(
      id,
      start,
      error,
      state.outcome.verdict(state.effect, error),
      state
    );
  }
  async serverInfo(profile) {
    return parseServerInfo(
      await this.server.read(`${profile}.rpc.call`, {
        target: "ms_tools.get_admin_init_server_data",
        args: []
      }),
      profile
    );
  }
  /**
   * Date and integer fields of the catalog, read only when a condition holds a value written as a
   * date or as a decimal ID: such a value must reach a date field as date('…') and an integer field
   * as a number, and the form is the only place that tells them from strings.
   */
  async typedFields(catalog, where) {
    const none = { dates: /* @__PURE__ */ new Set(), integers: /* @__PURE__ */ new Set() };
    if (typeof catalog !== "string" || !where || typeof where !== "object") return none;
    const values = Object.values(where).flatMap(
      (condition) => condition && typeof condition === "object" ? Object.values(condition).flat() : [condition]
    );
    if (!values.some((value) => looksLikeDate(value) || looksLikeDecimalId(value))) return none;
    const shape = await this.schemaReader.catalogShape({ catalog }).catch(() => void 0);
    return { dates: shape?.dates ?? none.dates, integers: shape?.integers ?? none.integers };
  }
  async dispatch(id, args, state) {
    switch (id) {
      case "runtime.check":
        return checkServer(
          this.config,
          (operation, input2) => this.dispatch(operation, input2, { outcome: new WriteOutcome(), effect: "read" })
        );
      case "files.exists":
        return this.files.exists(args);
      case "files.read":
        return this.files.read(args);
      case "files.list":
        return this.files.list(args, state);
      case "files.write":
        return this.files.write(args, state);
      case "files.delete":
        return this.files.delete(args, state);
      case "server.info": {
        const info = await this.serverInfo(args.profile === "web" ? "web" : "native");
        const folders = info.profile === "native" ? await this.files.folders() : void 0;
        return folders ? { ...info, dataFolders: folders.data, codeFolders: folders.code } : info;
      }
      case "runtime.status": {
        const version = await this.server.read("native.rpc.call", {
          target: "tools.get_version",
          args: [{ valueType: "string", lexicalValue: "wtv" }]
        });
        const info = await this.server.applicationInfo().catch(() => void 0);
        const userId = typeof info?.auth_object_url === "string" ? parsePhysicalDocumentId(info.auth_object_url) : void 0;
        const database2 = (await this.serverInfo("native").catch(() => void 0))?.database;
        return {
          connection: this.config.name,
          baseUrl: this.config.baseUrl,
          version: scalar(findXmlNode(version, "Result"), "версии"),
          ...database2 ? { database: database2 } : {},
          ...userId ? { userId } : {},
          operationCount: operations.length,
          permissions: this.config.permissions
        };
      }
      case "runtime.query": {
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
        const typed = args.query === void 0 ? await this.typedFields(args.catalog, args.where) : void 0;
        const query = typed ? catalogQuery(args.catalog, args.where, typed.dates, args.order, typed.integers) : requiredString(args.query, "query");
        if (args.query === void 0 && args.order !== void 0) {
          const shape2 = await this.schemaReader.catalogShape({ catalog: requiredString(args.catalog, "catalog") }).catch(() => void 0);
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
        if (args.query !== void 0 && !sql) state.effect = "read";
        let response;
        try {
          const request = {
            query,
            startPos,
            maxCount: limit,
            expectToReadAll: false,
            keepCursor: false
          };
          response = await (sql ? this.server.call("native.lds.xQuery", request, state.outcome) : this.server.read("native.lds.xQuery", request));
        } catch (error) {
          const refused = error instanceof WsHcmApiError && error.kind === "soap-fault";
          let reason;
          if (refused) this.logs.serverWroteLog();
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
              reason = await this.schemaReader.explainQuery(catalog, fields3).catch(() => void 0);
              if (reason) break;
            }
          throw reason ?? error;
        }
        const read = queryPage(response, startPos, limit, args.fields, args.query !== void 0);
        const page = { ...read, items: read.items.map(withoutFalseOffset) };
        if (!page.items.length && args.query === void 0) {
          const missing = await this.schemaReader.explainQuery(requiredString(args.catalog, "catalog"), []).catch(() => void 0);
          if (missing) throw missing;
        }
        const requested = Array.isArray(args.fields) ? args.fields : [];
        const absent = page.items.length ? requested.filter((field) => page.items.every((item) => !Object.hasOwn(item, field))) : args.query === void 0 ? requested : [];
        const lacking = page.items.some(
          (item) => requested.some((field) => !Object.hasOwn(item, field))
        );
        if (!absent.length && !lacking && !page.items.some(hasStructure)) return page;
        const shape = await this.schemaReader.catalogShape(
          args.query === void 0 ? { catalog: requiredString(args.catalog, "catalog") } : { type: rowTag(response) ?? "" }
        ).catch(() => void 0);
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
            return row;
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
      case "objects.get": {
        if (args.ids === void 0) return this.objects.get(args);
        const ids = args.ids;
        if (args.id !== void 0 || args.url !== void 0)
          throw new HcmError("INVALID_ARGUMENT", "ids: вместе с id или url не задаётся.");
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some((id2) => typeof id2 !== "string"))
          throw new HcmError("INVALID_ARGUMENT", "ids: список от 1 до 100 ID, каждый строкой.");
        const items = [];
        let failed = 0;
        for (const id2 of ids) {
          try {
            items.push(await this.objects.get({ type: args.type, fields: args.fields, id: id2 }));
          } catch (error) {
            const refusal = this.failure("objects.get", performance.now(), error).error;
            if (/^PLATFORM_(?!SOAP-FAULT)/.test(refusal.code)) throw error;
            failed++;
            items.push({ id: id2, error: { code: refusal.code, message: refusal.message } });
          }
        }
        return {
          items,
          total: items.length,
          ...failed ? { failed, hint: "PLATFORM_SOAP-FAULT у элемента: обычно объекта с таким ID нет." } : {}
        };
      }
      case "objects.create":
        return this.objects.create(args, state.outcome);
      case "objects.patch":
        return this.objects.patch(args, state.outcome);
      case "objects.delete":
        return this.objects.delete(args, state.outcome);
      case "schema.get":
        return this.schemaReader.get(args);
      case "schema.types":
        return this.schemaReader.types(args);
      case "logs.list":
        return logFiles(await this.logs.list(args));
      case "logs.read": {
        const input2 = args.tailBytes === void 0 && args.full !== true ? { ...args, tailBytes: this.replies.pageBytes } : args;
        return logText(await this.logs.read(input2));
      }
      case "logs.search":
        return logMatches(
          await this.logs.search(args),
          this.replies.pageBytes
        );
      case "logs.follow":
        return logNews(
          await this.logs.follow(args),
          args.cursor === void 0,
          this.replies.pageBytes
        );
      case "results.read":
        return this.results.read(
          requiredString(args.resultId, "resultId"),
          args.offset,
          args.limit,
          args.format
        );
      case "results.export":
        return this.results.export(args);
      case "rpc.list":
        return this.rpcCatalog.list(args);
      case "rpc.describe":
        return this.rpcCatalog.describe(requiredString(args.targetId, "targetId"), args);
      case "rpc.call": {
        const target = `${identifier(args.library, "library")}.${identifier(args.method, "method")}`;
        const supplied = args.arguments ?? [];
        if (!Array.isArray(supplied))
          throw new HcmError("INVALID_ARGUMENT", "arguments: нужен массив.");
        const encoded = supplied.map((value) => {
          if (value !== null && typeof value === "object")
            return inputObject(value, "аргумент функции");
          if (value === null) return { valueType: "null", lexicalValue: "" };
          if (typeof value === "string") return { valueType: "string", lexicalValue: value };
          if (typeof value === "boolean")
            return { valueType: "bool", lexicalValue: value ? "1" : "0" };
          if (typeof value === "number" && Number.isSafeInteger(value))
            return { valueType: "integer", lexicalValue: String(value) };
          throw new HcmError(
            "INVALID_RPC_ARGUMENT",
            "Такой аргумент функции задаётся явно: {valueType, lexicalValue}. Так передают дробные и большие числа, даты, объекты и XML."
          );
        });
        const operationId = args.async === true ? "web.spxml.callMethodAsync" : "native.rpc.call";
        const nativeArgs = { target, args: encoded };
        try {
          prepare(nativeArgs, this.describe(operationId).inputSchema);
        } catch (error) {
          const index = error instanceof TypeError && /^args\.args\[(\d+)\]/.exec(error.message);
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
          response = await this.server.call(operationId, nativeArgs, state.outcome);
        } catch (error) {
          if (error instanceof WsHcmApiError && error.status === 500) {
            this.logs.serverWroteLog();
            const reason = await this.rpcCatalog.refusal(target).catch(() => void 0);
            if (reason) throw reason;
          }
          throw error;
        }
        return args.async === true ? withoutXmlFormatting(response) : rpcValue(response);
      }
      case "execute.script":
      case "agents.run": {
        const agent = id === "agents.run" ? agentRun(args) : void 0;
        const { request, executionId } = agent ? prepareScript(agent.code, agent.params) : prepareScript(args.code, args.params);
        const data2 = await this.server.runCode({ request, executionId }, state.outcome);
        if (!agent) return data2;
        this.logs.serverWroteLog();
        return agentRunResult(data2);
      }
      case "runtime.batch":
        return this.batch(args, state);
      default:
        return plainAnswer(
          id,
          withoutXmlFormatting(
            await this.server.call(id, args, state.effect === "read" ? void 0 : state.outcome)
          )
        );
    }
  }
  async batch(args, state) {
    if (!Array.isArray(args.steps) || args.steps.length === 0 || args.steps.length > 100)
      throw new HcmError("INVALID_BATCH", "steps: в пакете должно быть от 1 до 100 шагов.");
    const labels = /* @__PURE__ */ new Set();
    for (const [index, raw] of args.steps.entries()) {
      const at = `steps[${index}]`;
      const step = inputObject(raw, at);
      const stepId = requiredString(step.id, `${at}.id`);
      if (stepId === "runtime.batch")
        throw new HcmError("NESTED_BATCH", "Пакет внутри пакета не поддерживается.");
      this.describe(stepId);
      if (step.args !== void 0) inputObject(step.args, `${at}.args`);
      if (step.as !== void 0) {
        const label = identifier(step.as, `${at}.as`);
        if (labels.has(label))
          throw new HcmError(
            "DUPLICATE_STEP",
            `${at}.as: имя ${label} уже дано другому шагу; имена шагов пакета не повторяются.`,
            void 0,
            { path: `${at}.as` },
            "not_sent"
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
    state.batchRecovery = recovery;
    const resolveRefs = (value, depth = 0) => {
      if (depth > 32)
        throw new HcmError("REFERENCE_DEPTH", "Аргументы шага вложены глубже 32 уровней.");
      if (Array.isArray(value)) return value.map((item) => resolveRefs(item, depth + 1));
      if (value === null || typeof value !== "object") return value;
      const record3 = inputObject(value);
      if (Object.keys(record3).length === 1 && typeof record3.$ref === "string") {
        const [stepName, ...path] = record3.$ref.split(".");
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
        Object.entries(record3).map(([key, item]) => [key, resolveRefs(item, depth + 1)])
      );
    };
    for (const raw of args.steps) {
      const step = inputObject(raw, "step");
      const stepId = requiredString(step.id, "step.id");
      let result;
      const childState = { outcome: new WriteOutcome(), effect: "read" };
      try {
        const resolved = step.args === void 0 ? {} : inputObject(resolveRefs(step.args), "step.args");
        result = await this.perform(stepId, resolved, performance.now(), false, childState);
      } catch (error) {
        result = this.failure(stepId, performance.now(), error);
      }
      const written = childState.outcome.verdict(childState.effect);
      if (written.sent) {
        state.outcome.sending();
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
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    return this.closePromise = this.queue.then(() => this.gateway.close()).then(() => void 0);
  }
};

// src/config.ts
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join as join3, resolve as resolve2 } from "node:path";
var MAX_CONFIG_BYTES = 1024 * 1024;
var SETUP_HINT = "Нужно задать WTCTL_URL, WTCTL_USERNAME и WTCTL_PASSWORD (для MCP-сервера — в env его записи) или создать файл подключений: wtctl config init.";
function homeDirectory() {
  return resolve2(process.env.WTCTL_HOME || join3(homedir(), ".wtctl"));
}
function defaultConfigPath() {
  return join3(homeDirectory(), "connections.json");
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
function bool2(value, fallback, field) {
  if (value === void 0) return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new HcmError("INVALID_CONFIG", `${field}: нужно true или false.`);
}
function number(value, fallback, minimum, maximum, field) {
  if (value === void 0) return fallback;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new HcmError(
      "INVALID_CONFIG",
      `${field}: нужно целое число от ${minimum} до ${maximum}.`
    );
  return parsed;
}
function string2(value, field) {
  if (value === void 0) return void 0;
  if (typeof value !== "string" || value.length === 0)
    throw new HcmError("INVALID_CONFIG", `${field}: нужна непустая строка.`);
  return value;
}
function credential(profile, field, globalOverrides) {
  const envName = string2(profile[`${field}Env`], `${field}Env`);
  if (envName !== void 0 && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName))
    throw new HcmError("INVALID_CONFIG", `${field}Env: это не имя переменной окружения.`);
  return string2(
    (globalOverrides ? process.env[`WTCTL_${field.toUpperCase()}`] : void 0) ?? (envName === void 0 ? profile[field] : process.env[envName]),
    field
  );
}
function loadConfig(options = {}) {
  const explicit = options.configPath ?? process.env.WTCTL_CONFIG;
  const path = explicit ?? (process.env.WTCTL_URL === void 0 && existsSync(defaultConfigPath()) ? defaultConfigPath() : void 0);
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
  const name3 = options.connection ?? process.env.WTCTL_CONNECTION ?? string2(document.defaultConnection, "defaultConnection") ?? "default";
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name3))
    throw new HcmError(
      "INVALID_CONFIG",
      "Имя подключения: до 64 латинских букв, цифр и знаков . _ -"
    );
  let profile = {};
  const globalOverrides = document.connections === void 0;
  if (document.connections !== void 0) {
    const connections = inputObject(document.connections, "connections");
    if (connections[name3] === void 0)
      throw new HcmError(
        "UNKNOWN_CONNECTION",
        `В файле подключений нет подключения ${name3}.`,
        `Есть: ${Object.keys(connections).slice(0, 20).join(", ") || "ни одного"}. Имя задают --connection, WTCTL_CONNECTION или defaultConnection в файле.`,
        { connection: name3 }
      );
    profile = inputObject(connections[name3], "connection");
  } else if (Object.keys(document).length > 0) profile = document;
  const baseUrl = string2(
    (globalOverrides ? process.env.WTCTL_URL : void 0) ?? profile.baseUrl,
    "baseUrl"
  );
  if (baseUrl === void 0)
    throw path === void 0 ? new HcmError("NOT_CONFIGURED", "Подключение к серверу не настроено.", SETUP_HINT) : new HcmError(
      "INVALID_CONFIG",
      `В подключении ${name3} не задан адрес сервера (baseUrl).`,
      "Образец файла показывает wtctl config example."
    );
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new HcmError(
      "INVALID_CONFIG",
      "Адрес сервера должен быть полным: http://сервер:порт или https://сервер."
    );
  }
  if (!/^(https?:)$/.test(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new HcmError(
      "INVALID_CONFIG",
      "Адрес сервера: только http или https, без имени и пароля, без ? и #."
    );
  const username = credential(profile, "username", globalOverrides);
  const password = options.password ?? credential(profile, "password", globalOverrides);
  if (username === void 0 !== (password === void 0))
    throw new HcmError(
      "INVALID_CONFIG",
      `Имя пользователя и пароль задают вместе: не задан${username === void 0 ? "о имя пользователя" : " пароль"}.`,
      globalOverrides ? "Переменные WTCTL_USERNAME и WTCTL_PASSWORD." : "Поля username и password подключения либо переменные, названные в usernameEnv и passwordEnv."
    );
  const permissions = profile.permissions === void 0 ? {} : inputObject(profile.permissions, "permissions");
  return {
    name: name3,
    baseUrl: url.href,
    ...username === void 0 ? {} : { username },
    ...password === void 0 ? {} : { password },
    timeoutMs: number(
      process.env.WTCTL_TIMEOUT_MS ?? profile.timeoutMs,
      3e4,
      1,
      6e5,
      "timeoutMs"
    ),
    maxResponseBytes: number(
      profile.maxResponseBytes,
      32 * 1024 * 1024,
      1024,
      512 * 1024 * 1024,
      "maxResponseBytes"
    ),
    outputLimitBytes: number(
      profile.outputLimitBytes,
      24 * 1024,
      1024,
      1024 * 1024,
      "outputLimitBytes"
    ),
    runtimeDir: resolve2(
      string2(process.env.WTCTL_RUNTIME_DIR ?? profile.runtimeDir, "runtimeDir") ?? join3(homeDirectory(), "runtime")
    ),
    permissions: {
      write: bool2(
        (globalOverrides ? process.env.WTCTL_ALLOW_WRITE : void 0) ?? permissions.write,
        false,
        "permissions.write"
      ),
      execute: bool2(
        (globalOverrides ? process.env.WTCTL_ALLOW_EXECUTE : void 0) ?? permissions.execute,
        false,
        "permissions.execute"
      )
    }
  };
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

// src/sdk.ts
var HcmOperationError = class extends HcmError {
  operationError;
  constructor(result, operationError = result.error) {
    super(
      operationError?.code ?? "OPERATION_FAILED",
      operationError?.message ?? "Операция не выполнена.",
      operationError?.hint,
      operationError?.details,
      operationError?.mutationOutcome
    );
    Object.defineProperty(this, "result", { value: result, enumerable: false });
    this.operationError = operationError;
  }
  toJSON() {
    return this.operationError ?? super.toJSON();
  }
};
var HcmStoredResultError = class extends HcmOperationError {
  resultId;
  constructor(result, resultId) {
    super(result, {
      code: "RESULT_STORED",
      message: "Результат сохранён локально; preview не является полными данными.",
      hint: "Читать resultId через readResult/results.read, при необходимости format:'json'.",
      retryable: false,
      details: { resultId }
    });
    this.resultId = resultId;
  }
};
var HcmCleanupError = class extends HcmError {
  constructor(value) {
    super(
      "CLEANUP_FAILED",
      "Операция завершилась, но закрыть подключение не удалось.",
      "Результат сохранён в error.value. Операцию из-за ошибки закрытия не повторять.",
      { operationSucceeded: true },
      void 0
    );
    Object.defineProperty(this, "value", { value, enumerable: false });
  }
};
function storedResultId(result) {
  if (typeof result.meta.resultId === "string") return result.meta.resultId;
  if (result.data && typeof result.data === "object" && "resultId" in result.data && typeof result.data.resultId === "string")
    return result.data.resultId;
  return void 0;
}
function unwrap(result) {
  if (!result.ok) throw new HcmOperationError(result);
  if (result.meta.truncated === true) {
    const resultId = storedResultId(result);
    if (resultId) throw new HcmStoredResultError(result, resultId);
    throw new HcmOperationError(result, {
      code: "RESULT_TRUNCATED",
      message: "Полный результат отсутствует в ответе.",
      hint: "Проверить meta и настройку outputLimitBytes; preview не является полными данными.",
      retryable: false
    });
  }
  return result.data;
}
var HcmClient = class _HcmClient {
  runtime;
  constructor(connection) {
    this.runtime = "call" in connection ? connection : new HcmRuntime(connection);
  }
  static fromRuntime(runtime) {
    return new _HcmClient(runtime);
  }
  listOperations(filter) {
    return this.runtime.listOperations(filter);
  }
  describe(id) {
    return this.runtime.describe(id);
  }
  call(id, args = {}) {
    return this.runtime.call(id, args);
  }
  /** Several objects in one call; an object that was not read has error in its element. */
  getMany(input2) {
    return this.call("objects.get", { ...input2 });
  }
  status() {
    return this.call("runtime.status");
  }
  check() {
    return this.call("runtime.check");
  }
  serverInfo(input2 = {}) {
    return this.call("server.info", { ...input2 });
  }
  fileExists(input2) {
    return this.call("files.exists", { ...input2 });
  }
  readFile(input2) {
    return this.call("files.read", { ...input2 });
  }
  listFiles(input2) {
    return this.call("files.list", { ...input2 });
  }
  writeFile(input2) {
    return this.call("files.write", { ...input2 });
  }
  deleteFile(input2) {
    return this.call("files.delete", { ...input2 });
  }
  query(input2) {
    return this.call("runtime.query", { ...input2 });
  }
  get(input2) {
    return this.call("objects.get", { ...input2 });
  }
  create(input2) {
    return this.call("objects.create", { ...input2 });
  }
  patch(input2) {
    return this.call("objects.patch", { ...input2 });
  }
  delete(input2) {
    return this.call("objects.delete", { ...input2 });
  }
  schema(input2) {
    return this.call("schema.get", { ...input2 });
  }
  types(input2 = {}) {
    return this.call("schema.types", { ...input2 });
  }
  rpc(input2) {
    return this.call("rpc.call", { ...input2 });
  }
  listRpc(input2 = {}) {
    return this.call("rpc.list", { ...input2 });
  }
  describeRpc(targetId, options = {}) {
    return this.call("rpc.describe", { targetId, ...options });
  }
  /**
   * The code as a string or, like the hcm_script tool takes it, as {code, params}.
   * The code reads params as the ready variable PARAMS.
   */
  execute(code, params) {
    return this.call(
      "execute.script",
      typeof code === "string" ? { code, ...params ? { params } : {} } : { ...code }
    );
  }
  /** Runs a server agent and waits for the end of its code; errors of the code are in the log only. */
  runAgent(input2) {
    return this.call("agents.run", { ...input2 });
  }
  batch(input2) {
    return this.call("runtime.batch", { ...input2 });
  }
  readResult(input2) {
    return this.call("results.read", { ...input2 });
  }
  exportResult(input2) {
    return this.call("results.export", { ...input2 });
  }
  uploadFile(input2) {
    return this.call("web.pages.uploadFile", { ...input2 });
  }
  uploadChunk(input2) {
    return this.call("web.pages.uploadChunk", { ...input2 });
  }
  clearUploadChunks(input2) {
    return this.call("web.pages.clearUploadChunks", { ...input2 });
  }
  heartbeat(input2 = {}) {
    return this.call("web.websocket.heartbeat", { ...input2 });
  }
  listLogs(input2 = {}) {
    return this.call("logs.list", { ...input2 });
  }
  readLog(input2) {
    return this.call("logs.read", { ...input2 });
  }
  searchLogs(input2) {
    return this.call("logs.search", { ...input2 });
  }
  followLog(input2) {
    return this.call("logs.follow", { ...input2 });
  }
  close() {
    return this.runtime.close();
  }
  /** This client owns the scope and closes exactly once after the callback, including failure. */
  use(action) {
    return scoped(this.runtime, () => action(this));
  }
};
function safeCleanupEvidence() {
  return new HcmError(
    "CLEANUP_FAILED",
    "Не удалось закрыть подключение после ошибки операции.",
    "Основная ошибка сохранена; запись без проверки её исхода не повторять."
  );
}
function getCleanupError(error) {
  if (error !== null && typeof error === "object" && "cleanupError" in error && error.cleanupError instanceof HcmError)
    return error.cleanupError;
  if (error instanceof AggregateError)
    return error.errors.find(
      (item) => item instanceof HcmError && item.code === "CLEANUP_FAILED"
    );
  return void 0;
}
async function scoped(runtime, action) {
  let value;
  let failed = false;
  let primary;
  try {
    value = await action();
  } catch (error) {
    failed = true;
    primary = error;
  }
  try {
    await runtime.close();
  } catch {
    if (!failed && value !== null && typeof value === "object" && "ok" in value && value.ok === false && "meta" in value && "error" in value && value.error !== null && typeof value.error === "object" && "code" in value.error && typeof value.error.code === "string" && "message" in value.error && typeof value.error.message === "string") {
      failed = true;
      primary = new HcmOperationError(value);
    }
    if (!failed) throw new HcmCleanupError(value);
    const cleanupError = safeCleanupEvidence();
    if (primary !== null && (typeof primary === "object" || typeof primary === "function") && Object.isExtensible(primary)) {
      try {
        Object.defineProperty(primary, "cleanupError", { value: cleanupError, enumerable: false });
      } catch {
        throw new AggregateError(
          [primary, cleanupError],
          "Операция не выполнена, и закрыть подключение не удалось."
        );
      }
    } else
      throw new AggregateError(
        [primary, cleanupError],
        "Операция не выполнена, и закрыть подключение не удалось."
      );
  }
  if (failed) throw primary;
  return value;
}
async function withHcmClient(config, action) {
  return new HcmClient(config).use(action);
}
async function withHcm(config, action) {
  const runtime = new HcmRuntime(config);
  return scoped(runtime, () => action(runtime));
}
export {
  HcmCleanupError,
  HcmClient,
  HcmError,
  HcmOperationError,
  HcmRuntime,
  HcmStoredResultError,
  LogReadUnavailableError,
  LogReader,
  NativeGateway,
  RpcCatalog,
  configExample,
  describeHcmOperation,
  getCleanupError,
  getNativeOperations,
  listHcmOperations,
  loadConfig,
  parseFileExists,
  parseServerInfo,
  unwrap,
  withHcm,
  withHcmClient
};
