import { randomUUID } from "node:crypto";
import { HcmError, inputObject, requiredString } from "./errors.js";
import { escapeXml, findXmlNode } from "./protocol/xml.js";

const TARGET = "ms_tools.evaluate_remote_collection_obj";
const FORM = "x-local://wtv/wtv_remote_collection.xmd";

export interface ScriptData<T = unknown> {
  readonly result: readonly T[];
  /** Column descriptions and extra data of the collection, when the server returned any. */
  readonly columns?: readonly unknown[];
  readonly data?: Readonly<Record<string, unknown>>;
  /** Name of the unsaved collection that carried the code; it appears in server log lines. */
  readonly executionId: string;
}

/** Existing Administrator RPC receives an unsaved XmElem with the shipped form attached. */
export function prepareScript(
  value: unknown,
  params?: unknown,
): {
  request: Record<string, unknown>;
  executionId: string;
} {
  // Base64 keeps any text clear of the string rules of the language; the same line keeps the
  // line numbers of the caller's code in error messages.
  const code =
    (params === undefined
      ? ""
      : `var PARAMS = ParseJson(DecodeCharset(Base64Decode("${Buffer.from(JSON.stringify(inputObject(params, "params"))).toString("base64")}"), "utf-8")); `) +
    requiredString(value, "code");
  if (Buffer.byteLength(code) > 1024 * 1024)
    throw new HcmError("SCRIPT_TOO_LARGE", "Код SP-XML Script больше 1 МиБ.");
  const marker = `hcm_inline_${randomUUID().replaceAll("-", "")}`;
  const xml = `<remote_collection SPXML-FORM="${FORM}" SPXML-FORM-ELEM="remote_collection"><code>${marker}</code><name>${marker}</name><use_cache>0</use_cache><script>${escapeXml(code)}</script></remote_collection>`;
  return { request: { target: TARGET, args: [{ lexicalValue: { xml } }] }, executionId: marker };
}

const ID = /^(?:0x[0-9a-f]{1,16}|\d{1,20})$/i;
// The stock method of the agent's form, the one the administrator interface starts an agent
// with; its fourth argument makes the call wait for the end of the agent's code.
const AGENT_RUN = `var doc = OpenDoc(UrlFromDocID(Int(PARAMS.id)));
if (doc.TopElem.Name != 'server_agent') throw 'Объект с этим ID — не агент сервера (server_agent).';
var from = StrXmlDate(Date());
var started = doc.TopElem.run_agent(PARAMS.objectId, PARAMS.objectIds, Date(), true);
if (started) doc.Save();
RESULT = [{ started: started, from: from, to: StrXmlDate(Date()) }];`;

export interface AgentRunData {
  /** false: the server did not start the agent; its reason is in the log `agent`. */
  readonly started: boolean;
  /** Server local time around the run: the agent's lines in the logs lie between them. */
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly hint: string;
}

/** Code and parameters that run an agent in place. IDs go into the agent's code, so only IDs pass. */
export function agentRun(args: Record<string, unknown>): { code: string; params: object } {
  const id = (value: unknown, path: string): string => {
    if (typeof value !== "string" || !ID.test(value))
      throw new HcmError("INVALID_ARGUMENT", `${path}: нужен ID строкой, 0x… или десятичный.`);
    return BigInt(value).toString();
  };
  const list = args.objectIds ?? [];
  if (!Array.isArray(list) || list.length > 1000)
    throw new HcmError("INVALID_ARGUMENT", "objectIds: нужен список до 1000 ID.");
  return {
    code: AGENT_RUN,
    params: {
      id: id(args.id, "id"),
      objectId: args.objectId === undefined ? null : id(args.objectId, "objectId"),
      objectIds: list.map((item, index) => id(item, `objectIds[${index}]`)).join(";"),
    },
  };
}

export function agentRunResult(data: ScriptData): AgentRunData {
  const row = data.result[0] as { started?: unknown; from?: unknown; to?: unknown } | undefined;
  const time = (value: unknown): string => String(value ?? "").slice(0, 19);
  const started = row?.started === "1";
  return {
    started,
    startedAt: time(row?.from),
    finishedAt: time(row?.to),
    hint: started
      ? "Код агента отработал до конца или до ошибки: ошибку сервер пишет только в лог. Строки запуска — лог agent, alert и ошибки кода — лог xhttp, между startedAt и finishedAt."
      : "Сервер агента не запустил; причину он пишет в лог agent.",
  };
}

/** Raw probes can use the same request without changing their low-level argument contract. */
export function scriptRequest(value: unknown, params?: unknown): Record<string, unknown> {
  return prepareScript(value, params).request;
}

/** Preserve scalar lexical representations, including every 64-bit integer and date. */
export function decodeRpcValue(value: unknown, depth = 0): unknown {
  if (depth > 64) throw new HcmError("SCRIPT_RESPONSE", "Результат вложен глубже 64 уровней.");
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new HcmError("SCRIPT_RESPONSE", "В результате нет элемента с VALUE-TYPE.");
  const node = value as Record<string, unknown>;
  const typeValue = node["@_VALUE-TYPE"];
  if (typeof typeValue !== "string" || typeValue === "")
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "В результате есть элемент XML без типа.",
      "Возвращать можно простые значения, массивы и обычные объекты. Элементы и документы XML (XmElem, XmDoc) нужно превращать в строку в самом коде. Ответ сервера как есть покажет web.rpc.call.",
    );
  const type = typeValue.toLowerCase();
  const children = Object.keys(node).filter((key) => !key.startsWith("@_") && key !== "#text");
  const text = node["#text"] ?? "";
  if (typeof text !== "string")
    throw new HcmError("SCRIPT_RESPONSE", "Значение в результате — не текст.");
  if (["array", "object", "null", "undefined"].includes(type) && text.trim() !== "")
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "В массиве, объекте или null результата есть посторонний текст.",
    );
  if (type === "array") {
    if (children.some((key) => key !== "e"))
      throw new HcmError("SCRIPT_RESPONSE", "В массиве результата есть посторонние элементы.");
    const items = node.e === undefined ? [] : Array.isArray(node.e) ? node.e : [node.e];
    return items.map((item) => decodeRpcValue(item, depth + 1));
  }
  if (type === "object") {
    return Object.fromEntries(children.map((key) => [key, decodeRpcValue(node[key], depth + 1)]));
  }
  if (type === "null" || type === "undefined") {
    if (children.length !== 0)
      throw new HcmError("SCRIPT_RESPONSE", "В значении null результата есть вложенные элементы.");
    return null;
  }
  if (!["string", "integer", "real", "bool", "date"].includes(type))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "В результате есть значение неподдерживаемого типа (VALUE-TYPE).",
      "Возвращать можно простые значения, массивы и обычные объекты. Элементы и документы XML (XmElem, XmDoc) нужно превращать в строку в самом коде. Ответ сервера как есть покажет web.rpc.call.",
    );
  if (children.length !== 0)
    throw new HcmError("SCRIPT_RESPONSE", "В простом значении результата есть вложенные элементы.");
  return text;
}

/**
 * What a library function returned, as plain JSON. A value the typed form cannot express
 * (a document, a form element) is left as the parsed response.
 */
export function rpcValue(response: unknown): unknown {
  try {
    return { value: decodeRpcValue(findXmlNode(response, "Result")) };
  } catch (error) {
    if (error instanceof HcmError && error.code === "SCRIPT_RESPONSE") return response;
    throw error;
  }
}

/** A transport success is insufficient: the collection can report a caught script error. */
export function scriptResult(response: unknown, executionId: string): ScriptData {
  const decoded = decodeRpcValue(findXmlNode(response, "Result"));
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "Сервер вернул результат кода в неожиданном виде: это не объект.",
    );
  const value = decoded as Record<string, unknown>;
  if (typeof value.error !== "string" || !/^\d+$/.test(value.error))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "Сервер вернул результат кода без числового кода ошибки.",
    );
  if (value.error !== "0") {
    // The caller wrote this code and needs the reason to fix it. The first line only repeats the
    // collection name and the last frames belong to the stock form that evaluated the code.
    const reason = (typeof value.error_text === "string" ? value.error_text : "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line !== "" &&
          !line.startsWith("Error evaluating collection") &&
          !line.includes("wtv_remote_collection.xmd"),
      )
      .join("\n");
    // The server reads the whole code before it runs it: with a syntax error nothing was executed.
    const unread = /syntax error/i.test(reason);
    throw new HcmError(
      "SCRIPT_FAILED",
      "Сервер сообщил об ошибке в коде SP-XML Script.",
      unread
        ? "Сообщение сервера — в details.scriptError. Код не разобран и не выполнялся: данные не менялись."
        : "Сообщение сервера — в details.scriptError. До ошибки код мог изменить данные: их нужно проверить перед повтором.",
      reason === "" ? undefined : { scriptError: reason },
      unread ? "not_sent" : "indeterminate",
    );
  }
  if (!Array.isArray(value.result))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "RESULT — не массив.",
      "Нужно присвоить RESULT массив, даже когда возвращать нечего: RESULT = [];",
    );
  if (
    !Array.isArray(value.columns) ||
    value.data === null ||
    typeof value.data !== "object" ||
    Array.isArray(value.data)
  )
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "Сервер вернул результат кода не полностью: нет columns или data.",
    );
  const total = value.total;
  const serverTicks = value.ticks;
  if (
    typeof total !== "string" ||
    typeof serverTicks !== "string" ||
    !/^\d+$/.test(total) ||
    !/^\d+$/.test(serverTicks)
  )
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "Сервер вернул результат кода с неверными счётчиками total или ticks.",
    );
  const data = value.data as Record<string, unknown>;
  return {
    result: value.result,
    ...(value.columns.length ? { columns: value.columns } : {}),
    ...(Object.keys(data).length ? { data } : {}),
    executionId,
  };
}
