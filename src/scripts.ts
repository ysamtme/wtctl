import { randomUUID } from "node:crypto";
import { HcmError, inputObject, requiredString } from "./errors.js";
import { escapeXml, findXmlNode } from "./protocol/xml.js";
import { decodeRpcValue } from "./server-value.js";

const TARGET = "ms_tools.evaluate_remote_collection_obj";
const FORM = "x-local://wtv/wtv_remote_collection.xmd";

export interface ScriptData<T = unknown> {
  readonly result: readonly T[];
  /** Описания столбцов и дополнительные данные коллекции, если сервер их вернул. */
  readonly columns?: readonly unknown[];
  readonly data?: Readonly<Record<string, unknown>>;
  /** Имя несохранённой коллекции, несшей код; оно попадает в строки лога сервера. */
  readonly executionId: string;
}

/** PARAMS уходят в код текстом JSON; скрипт с SDK может передать и то, что JSON не записывает. */
function paramsJson(params: unknown): string {
  const value = inputObject(params, "params");
  try {
    return JSON.stringify(value);
  } catch {
    throw new HcmError(
      "INVALID_ARGUMENT",
      "params: значение нельзя записать как JSON.",
      "Большое целое передаётся строкой; объект не может ссылаться на самого себя.",
    );
  }
}

/** Существующий RPC Administrator получает несохранённый XmElem с приложенной штатной формой. */
export function prepareScript(
  value: unknown,
  params?: unknown,
): {
  request: Record<string, unknown>;
  executionId: string;
} {
  // Base64 защищает любой текст от правил строк языка; та же строка сохраняет номера
  // строк кода вызывающего в сообщениях об ошибках.
  const code =
    (params === undefined
      ? ""
      : `var PARAMS = ParseJson(DecodeCharset(Base64Decode("${Buffer.from(paramsJson(params)).toString("base64")}"), "utf-8")); `) +
    requiredString(value, "code");
  if (Buffer.byteLength(code) > 1024 * 1024)
    throw new HcmError("SCRIPT_TOO_LARGE", "Код SP-XML Script больше 1 МиБ.");
  const marker = `hcm_inline_${randomUUID().replaceAll("-", "")}`;
  const xml = `<remote_collection SPXML-FORM="${FORM}" SPXML-FORM-ELEM="remote_collection"><code>${marker}</code><name>${marker}</name><use_cache>0</use_cache><script>${escapeXml(code)}</script></remote_collection>`;
  return { request: { target: TARGET, args: [{ lexicalValue: { xml } }] }, executionId: marker };
}

const ID = /^(?:0x[0-9a-f]{1,16}|\d{1,20})$/i;
// Штатный метод формы агента, которым интерфейс администратора запускает агента; его четвёртый
// аргумент заставляет вызов ждать конца кода агента.
const AGENT_RUN = `var doc = OpenDoc(UrlFromDocID(Int(PARAMS.id)));
if (doc.TopElem.Name != 'server_agent') throw 'Объект с этим ID — не агент сервера (server_agent).';
var from = StrXmlDate(Date());
var started = doc.TopElem.run_agent(PARAMS.objectId, PARAMS.objectIds, Date(), true);
if (started) doc.Save();
RESULT = [{ started: started, from: from, to: StrXmlDate(Date()) }];`;

export interface AgentRunData {
  /** false: сервер не запустил агента; причина — в логе `agent`. */
  readonly started: boolean;
  /** Местное время сервера вокруг запуска: строки агента в логах лежат между ними. */
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly hint: string;
}

/** Код и параметры запуска агента на месте. ID идут в код агента, поэтому проходят только ID. */
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

/** Сырые пробы могут идти тем же запросом, не меняя свой низкоуровневый контракт аргументов. */
export function scriptRequest(value: unknown, params?: unknown): Record<string, unknown> {
  return prepareScript(value, params).request;
}

/** Успешного транспорта мало: коллекция может сообщить о пойманной ошибке скрипта. */
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
    // Вызывающий написал этот код и должен узнать причину, чтобы исправить. Первая строка лишь
    // повторяет имя коллекции, а последние кадры принадлежат штатной форме, выполнявшей код.
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
    // Сервер читает весь код до запуска: при синтаксической ошибке ничего не выполнилось.
    // Синтаксическая ошибка с кадрами вызовов под ней приходит из eval() в выполняющемся коде.
    const unread = /syntax error/i.test(reason) && !/^\(/m.test(reason);
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
