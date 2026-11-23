import { randomUUID } from "node:crypto";
import { HcmError, inputObject, requiredString } from "./errors.js";
import { escapeXml, findXmlNode } from "./protocol/xml.js";
import { decodeRpcValue, rpcValue } from "./server-value.js";

const TARGET = "ms_tools.evaluate_remote_collection_obj";
const FORM = "x-local://wtv/wtv_remote_collection.xmd";

/** Предел ожидания завершения агента сервера по умолчанию (мс). */
export const DEFAULT_AGENT_WAIT_TIMEOUT_MS = 120_000;
/** Минимальный предел ожидания завершения агента сервера (мс). */
export const MIN_AGENT_WAIT_TIMEOUT_MS = 1_000;
/** Максимальный предел ожидания завершения агента сервера (мс). */
export const MAX_AGENT_WAIT_TIMEOUT_MS = 3_600_000;
/** Количество записей `agents.status` по умолчанию. */
export const DEFAULT_AGENT_STATUS_LIMIT = 20;
/** Максимальное количество записей `agents.status`. */
export const MAX_AGENT_STATUS_LIMIT = 200;

const AGENT_POLL_DELAYS_MS = [250, 500, 1000, 2000] as const;
const AGENT_MISSING_GRACE_MS = 2_000;
const AGENT_FINISHED_CAPACITY = 100;

/** Часы и пауза опроса состояния агентов (подменяются в тестах). @internal */
export interface AgentWaitClock {
  readonly now: () => number;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_AGENT_WAIT_CLOCK: AgentWaitClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

let agentWaitClock: AgentWaitClock = DEFAULT_AGENT_WAIT_CLOCK;

/** @internal */
export function setAgentWaitClock(clock?: AgentWaitClock): void {
  agentWaitClock = clock ?? DEFAULT_AGENT_WAIT_CLOCK;
}

/** Ответ execute. */
export interface ScriptData<T = unknown> {
  /**
   * Массив RESULT из кода; числа и логические значения приходят строками. Дату нужно приводить к
   * строке в самом коде (StrDate, StrXmlDate): на части версий сервера она в ответ не попадает.
   */
  readonly result: readonly T[];
  /** Описания столбцов, если сервер их вернул. */
  readonly columns?: readonly unknown[];
  /** Дополнительные данные коллекции, если сервер их вернул. */
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

/**
 * Существующий RPC Administrator получает несохранённый XmElem с приложенной штатной формой.
 * @internal
 */
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
  const marker = `hcm_inline_${randomUUID().replaceAll("-", "")}`;
  const xml = `<remote_collection SPXML-FORM="${FORM}" SPXML-FORM-ELEM="remote_collection"><code>${marker}</code><name>${marker}</name><use_cache>0</use_cache><script>${escapeXml(code)}</script></remote_collection>`;
  return { request: { target: TARGET, args: [{ lexicalValue: { xml } }] }, executionId: marker };
}

const ID = /^(?:0x[0-9a-f]{1,16}|\d{1,20})$/i;
const THREAD_ID = /^-?\d{1,20}$/;
const ROLE_UID = /^[^\s\u0000-\u001f\u007f]{0,128}$/;

// Штатный метод формы агента запускает отдельный поток сервера (bInPlace = false), очищает obj до
// запуска и проверяет очередь ag_running, если не разрешён параллельный запуск.
const AGENT_RUN = `var doc = OpenDoc(UrlFromDocID(Int(PARAMS.id)));
if (doc.TopElem.Name != 'server_agent') throw 'Объект с этим ID — не агент сервера (server_agent).';
var from = StrXmlDate(Date());
var targetId = doc.TopElem.id + '';
var running = false;
if (!PARAMS.allowConcurrent) {
  var q = tools.spxml_unibridge.Object.provider.PeekMessagesFromQueue('ag_running');
  if (q != undefined) {
    var item;
    for (item in q) {
      if (item + '' == targetId) { running = true; break; }
    }
  }
}
if (running) {
  var info = tools.spxml_unibridge.Object.provider.GetUserData('ag_info_' + targetId);
  var runningInfo = '';
  if (info != undefined) runningInfo = info + '';
  RESULT = [{ started: false, alreadyRunning: true, runningInfo: runningInfo, from: from, to: StrXmlDate(Date()) }];
} else {
  doc.TopElem.obj.Clear();
  var started = doc.TopElem.run_agent(PARAMS.objectId, PARAMS.objectIds, Date(), false);
  var threadId = '';
  var codeType = '';
  var roleUID = '';
  try { codeType = doc.TopElem.exec_code.code_type + ''; } catch (e) {}
  if (started) {
    try { threadId = doc.TopElem.obj.Object.UniqueThreadId + ''; } catch (e) {}
    try { roleUID = tools.get_object_assembly('DatexCore').CallClassStaticMethod('Datex.Core.StaticPrime', 'GetRoleUID', []) + ''; } catch (e) {}
    doc.Save();
  }
  RESULT = [{ started: started, alreadyRunning: false, threadId: threadId, codeType: codeType, roleUID: roleUID, from: from, to: StrXmlDate(Date()) }];
}`;

/** Состояние запуска агента сервера в ответе runAgent. */
export type AgentRunStatus = "running" | "finished" | "cancelled" | "unknown";

/** Состояние записи в списке запусков агентов сервера. */
export type AgentListStatus = "running" | "finished" | "cancelled";

/** Одна запись о запуске агента сервера из списка запусков. */
export interface AgentRunRecord {
  /** ID агента сервера (server_agent) в десятичной записи. */
  readonly id: string;
  /** Код агента сервера. */
  readonly code: string;
  /** Название агента сервера. */
  readonly name: string;
  /** Состояние запуска: выполняется, завершён или отменён. */
  readonly status: AgentListStatus;
  /** ID потока запуска (строка, 64-битное целое без потери точности). */
  readonly threadId: string;
  /** Идентификатор роли сервера, на которой выполняется или выполнялся агент. */
  readonly roleUID: string;
  /** Местное время сервера при запуске. */
  readonly startedAt: string;
  /** Местное время сервера при завершении или отмене (отсутствует у выполняющегося агента). */
  readonly finishedAt?: string;
}

/** Ответ runAgent. */
export interface AgentRunData {
  /** false: агент не запущен (уже выполняется при allowConcurrent:false или отклонён сервером). */
  readonly started: boolean;
  /** Состояние запуска: running, finished, cancelled или unknown. */
  readonly status?: AgentRunStatus;
  /** ID потока запуска (или уже выполняющегося экземпляра, если запуск отклонён из-за дубля). */
  readonly threadId?: string;
  /** Идентификатор роли сервера, на которой выполняется или выполнялся агент. */
  readonly roleUID?: string;
  /** Местное время сервера при запуске: строки агента в логах лежат после него. */
  readonly startedAt: string;
  /** Местное время сервера после завершения или отмены (отсутствует при wait:false). */
  readonly finishedAt?: string;
  /** В каком логе искать строки агента и как проверить или остановить запуск. */
  readonly hint: string;
}

/** Ответ agentStatus. */
export interface AgentStatusData {
  /** Запуски агентов сервера, подошедшие под фильтр (сначала выполняющиеся, затем свежие завершённые). */
  readonly runs: readonly AgentRunRecord[];
  /** Сколько запусков подошло под фильтр (до ограничения limit). */
  readonly total: number;
}

/** Ответ cancelAgent. */
export interface AgentCancelData {
  /** Запрос на отмену передан в очередь роли сервера. */
  readonly cancelled: true;
  /** ID потока агента сервера. */
  readonly threadId: string;
  /** Идентификатор роли сервера, в очередь которой отправлена отмена. */
  readonly roleUID: string;
  /** Исход записи: запрос на отмену подтверждён сервером. */
  readonly mutationOutcome: "confirmed";
  /** Что делать дальше: уже сделанные изменения не откатываются. */
  readonly hint: string;
}

const formatAgentTime = (value: unknown): string => String(value ?? "").slice(0, 19);

/** @internal */
export function parseAgentId(value: unknown, path: string): string {
  if (typeof value !== "string" || !ID.test(value) || BigInt(value) > 0xffffffffffffffffn)
    throw new HcmError("INVALID_ARGUMENT", `${path}: нужен ID строкой, 0x… или десятичный.`);
  return BigInt(value).toString();
}

/** @internal */
export function parseAgentThreadId(value: unknown, path = "threadId"): string {
  if (typeof value !== "string" || !THREAD_ID.test(value))
    throw new HcmError("INVALID_ARGUMENT", `${path}: нужен ID потока агента десятичной строкой.`);
  return value;
}

/** @internal */
export function parseAgentRoleUID(value: unknown, path = "roleUID"): string {
  if (typeof value !== "string" || !ROLE_UID.test(value))
    throw new HcmError(
      "INVALID_ARGUMENT",
      `${path}: нужен идентификатор роли сервера без пробелов (до 128 знаков).`,
    );
  return value;
}

/** @internal */
export function parseAgentWaitTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_AGENT_WAIT_TIMEOUT_MS;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_AGENT_WAIT_TIMEOUT_MS ||
    value > MAX_AGENT_WAIT_TIMEOUT_MS
  ) {
    throw new HcmError(
      "INVALID_ARGUMENT",
      `waitTimeoutMs: нужно целое число от ${MIN_AGENT_WAIT_TIMEOUT_MS} до ${MAX_AGENT_WAIT_TIMEOUT_MS}.`,
    );
  }
  return value;
}

/**
 * Код и параметры запуска агента в отдельном потоке. ID идут в код агента, поэтому проходят только ID.
 * @internal
 */
export function agentRun(args: Record<string, unknown>): {
  code: string;
  params: {
    id: string;
    objectId: string | null;
    objectIds: string;
    allowConcurrent: boolean;
  };
  wait: boolean;
  waitTimeoutMs: number;
} {
  const list = args.objectIds ?? [];
  if (!Array.isArray(list) || list.length > 1000)
    throw new HcmError("INVALID_ARGUMENT", "objectIds: нужен список до 1000 ID.");
  const wait = args.wait !== false;
  if (!wait && args.waitTimeoutMs !== undefined) {
    throw new HcmError(
      "INVALID_ARGUMENT",
      "waitTimeoutMs нельзя задавать при wait: false.",
      "Уберите waitTimeoutMs или включите ожидание (wait: true).",
    );
  }
  const waitTimeoutMs = parseAgentWaitTimeout(args.waitTimeoutMs);
  return {
    code: AGENT_RUN,
    params: {
      id: parseAgentId(args.id, "id"),
      objectId: args.objectId === undefined ? null : parseAgentId(args.objectId, "objectId"),
      objectIds: list.map((item, index) => parseAgentId(item, `objectIds[${index}]`)).join(";"),
      allowConcurrent: args.allowConcurrent === true,
    },
    wait,
    waitTimeoutMs,
  };
}

function mapAgentListStatus(raw: unknown): AgentListStatus | undefined {
  if (raw === 1 || raw === "1") return "running";
  if (raw === 2 || raw === "2") return "finished";
  if (raw === 3 || raw === "3") return "cancelled";
  return undefined;
}

/**
 * Разбирает JSON из tools.amgr_get_agent_list_json, сохраняя 64-битный UniqueId строкой без потери
 * точности через context.source reviver в Node 22.16+.
 * @internal
 */
export function parseAgentListJson(raw: string): AgentRunRecord[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed, ((
      key: string,
      value: unknown,
      context?: { readonly source?: string },
    ) => {
      if (
        (key === "UniqueId" || key === "id") &&
        typeof value === "number" &&
        typeof context?.source === "string"
      ) {
        return context.source;
      }
      return value;
    }) as (key: string, value: unknown) => unknown);
  } catch {
    throw new HcmError(
      "AGENT_STATUS_RESPONSE",
      "Сервер вернул список запусков агентов в неверном формате JSON.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new HcmError(
      "AGENT_STATUS_RESPONSE",
      "Сервер вернул список запусков агентов в неожиданном виде: это не массив.",
    );
  }

  // При параллельном запуске или на границе завершения один threadId может встретиться дважды:
  // оставляем конечный статус поверх running и сохраняем порядок очереди для свежих записей.
  const byThread = new Map<string, { record: AgentRunRecord; order: number }>();
  for (let index = 0; index < parsed.length; index++) {
    const entry = parsed[index];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const status = mapAgentListStatus(obj.status);
    const threadId =
      typeof obj.UniqueId === "string" || typeof obj.UniqueId === "number"
        ? String(obj.UniqueId).trim()
        : "";
    if (!status || !threadId) continue;
    const startedAt = formatAgentTime(obj.started);
    const finishedRaw =
      typeof obj.finished === "string" && obj.finished.trim() !== ""
        ? formatAgentTime(obj.finished)
        : undefined;
    const record: AgentRunRecord = {
      id: typeof obj.id === "string" || typeof obj.id === "number" ? String(obj.id) : "",
      code: typeof obj.code === "string" ? obj.code : "",
      name: typeof obj.name === "string" ? obj.name : "",
      status,
      threadId,
      roleUID: typeof obj.roleUID === "string" ? obj.roleUID : "",
      startedAt,
      ...(finishedRaw ? { finishedAt: finishedRaw } : {}),
    };
    const existing = byThread.get(threadId);
    if (!existing || (existing.record.status === "running" && record.status !== "running")) {
      byThread.set(threadId, { record, order: index });
    }
  }

  const entries = [...byThread.values()];
  entries.sort((left, right) => {
    const leftRunning = left.record.status === "running" ? 0 : 1;
    const rightRunning = right.record.status === "running" ? 0 : 1;
    if (leftRunning !== rightRunning) return leftRunning - rightRunning;
    const leftTime = left.record.finishedAt ?? left.record.startedAt;
    const rightTime = right.record.finishedAt ?? right.record.startedAt;
    if (leftTime !== rightTime) return rightTime.localeCompare(leftTime);
    return right.order - left.order;
  });
  return entries.map((entry) => entry.record);
}

/** @internal */
export function decodeAgentListResponse(response: unknown): AgentRunRecord[] {
  const decoded = rpcValue(response);
  if (decoded === null || typeof decoded !== "object" || !("value" in decoded)) {
    throw new HcmError(
      "AGENT_STATUS_RESPONSE",
      "Сервер вернул список запусков агентов в неожиданном виде.",
    );
  }
  const value = (decoded as { value: unknown }).value;
  if (value === null || value === "") return [];
  if (typeof value !== "string") {
    throw new HcmError(
      "AGENT_STATUS_RESPONSE",
      "Сервер вернул список запусков агентов не строкой JSON.",
    );
  }
  return parseAgentListJson(value);
}

/** @internal */
export function filterAgentRuns(
  records: readonly AgentRunRecord[],
  options: {
    readonly id?: string;
    readonly threadId?: string;
    readonly status?: AgentListStatus;
    readonly limit?: number;
  },
): AgentStatusData {
  const filtered = records.filter((record) => {
    if (options.id !== undefined && record.id !== options.id) return false;
    if (options.threadId !== undefined && record.threadId !== options.threadId) return false;
    if (options.status !== undefined && record.status !== options.status) return false;
    return true;
  });
  const limit = options.limit ?? DEFAULT_AGENT_STATUS_LIMIT;
  return {
    runs: filtered.slice(0, limit),
    total: filtered.length,
  };
}

/** Разобранный итог кода запуска агента до опроса списка запусков. @internal */
export type AgentLaunchOutcome =
  | {
      readonly kind: "already_running";
      readonly startedAt: string;
      readonly runningRecord?: AgentRunRecord;
    }
  | {
      readonly kind: "refused";
      readonly startedAt: string;
      readonly finishedAt: string;
    }
  | {
      readonly kind: "started";
      readonly threadId: string;
      readonly codeType: string;
      readonly roleUID?: string;
      readonly startedAt: string;
    };

/**
 * true только когда сервер явно подтвердил, что запуск агента не состоялся (started === "0").
 * При пустом или повреждённом RESULT возвращает false, чтобы WriteOutcome сохранил indeterminate.
 * @internal
 */
export function isAgentLaunchIdle(data: ScriptData): boolean {
  const row = data.result[0];
  if (row === null || typeof row !== "object" || Array.isArray(row)) return false;
  return (row as { started?: unknown }).started === "0";
}

/** @internal */
export function parseAgentLaunch(data: ScriptData): AgentLaunchOutcome {
  const raw = data.result[0];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "Сервер вернул ответ запуска агента в неожиданном виде.",
      "Запрос уже отправлен на сервер: проверьте состояние запусков через agents.status, прежде чем повторять.",
    );
  }
  const row = raw as {
    started?: unknown;
    alreadyRunning?: unknown;
    runningInfo?: unknown;
    threadId?: unknown;
    codeType?: unknown;
    roleUID?: unknown;
    from?: unknown;
    to?: unknown;
  };
  const startedAt = formatAgentTime(row.from);
  const finishedAt = formatAgentTime(row.to);
  if (row.started === "0" && row.alreadyRunning === "1") {
    let runningRecord: AgentRunRecord | undefined;
    if (typeof row.runningInfo === "string" && row.runningInfo.trim() !== "") {
      try {
        runningRecord = parseAgentListJson(`[${row.runningInfo}]`)[0];
      } catch {
        // Если запись ag_info успела устареть или измениться, всё равно возвращаем started:false.
      }
    }
    return {
      kind: "already_running",
      startedAt,
      ...(runningRecord ? { runningRecord } : {}),
    };
  }
  if (row.started === "0") {
    return { kind: "refused", startedAt, finishedAt };
  }
  if (row.started !== "1") {
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "Сервер вернул ответ запуска агента без признака started.",
      "Запрос уже отправлен на сервер: проверьте состояние запусков через agents.status, прежде чем повторять.",
    );
  }
  const rawThreadId = typeof row.threadId === "string" ? row.threadId.trim() : "";
  const threadId = THREAD_ID.test(rawThreadId) ? rawThreadId : "";
  const codeType = typeof row.codeType === "string" ? row.codeType.trim().toLowerCase() : "";
  const roleUID =
    typeof row.roleUID === "string" && row.roleUID.trim() !== "" ? row.roleUID.trim() : undefined;
  return {
    kind: "started",
    threadId,
    codeType,
    ...(roleUID ? { roleUID } : {}),
    startedAt,
  };
}

/** @internal */
export type AgentWaitResult =
  | { readonly kind: "done"; readonly record: AgentRunRecord }
  | { readonly kind: "missing"; readonly roleUID?: string; readonly startedAt?: string }
  | { readonly kind: "timeout"; readonly roleUID?: string; readonly startedAt?: string };

/**
 * Поток мог быть вытеснен из кольцевого буфера ag_finished (100 записей), только если в буфере
 * не меньше 100 завершённых записей и самая старая из них не старше времени запуска потока.
 */
function couldBeEvictedFromFinished(
  records: readonly AgentRunRecord[],
  startedAt: string | undefined,
): boolean {
  let finishedCount = 0;
  let oldestFinishedTime: string | undefined;
  for (const record of records) {
    if (record.status === "running") continue;
    finishedCount++;
    const time = record.finishedAt ?? record.startedAt;
    if (time && (oldestFinishedTime === undefined || time < oldestFinishedTime)) {
      oldestFinishedTime = time;
    }
  }
  if (finishedCount < AGENT_FINISHED_CAPACITY) return false;
  if (!startedAt || !oldestFinishedTime) return true;
  return oldestFinishedTime >= startedAt;
}

/**
 * Опрашивает список запусков сервера по threadId до завершения/отмены, вытеснения из списка
 * или истечения timeoutMs. Ограничивает по дедлайну и длительность самого запроса списка.
 * @internal
 */
export async function waitForAgentThread(
  readList: (signal: AbortSignal) => Promise<AgentRunRecord[]>,
  options: {
    readonly threadId: string;
    readonly timeoutMs: number;
    readonly mode: "run" | "status";
    readonly initialRoleUID?: string;
    readonly initialStartedAt?: string;
  },
): Promise<AgentWaitResult> {
  const clock = agentWaitClock;
  const deadline = clock.now() + options.timeoutMs;
  let attempt = 0;
  let seenRunning = false;
  let evictedSince: number | undefined;
  let lastRoleUID = options.initialRoleUID;
  let lastStartedAt = options.initialStartedAt;

  const finishOnDeadline = (): AgentWaitResult =>
    options.mode === "status" && !seenRunning
      ? {
          kind: "missing",
          ...(lastRoleUID ? { roleUID: lastRoleUID } : {}),
          ...(lastStartedAt ? { startedAt: lastStartedAt } : {}),
        }
      : {
          kind: "timeout",
          ...(lastRoleUID ? { roleUID: lastRoleUID } : {}),
          ...(lastStartedAt ? { startedAt: lastStartedAt } : {}),
        };

  for (;;) {
    const remainingBeforePoll = deadline - clock.now();
    if (remainingBeforePoll <= 0 && attempt > 0) {
      return finishOnDeadline();
    }
    const pollBudget = Math.max(1, remainingBeforePoll);
    const pollController = new AbortController();
    const timerController = new AbortController();
    let timedOut = false;
    let records: AgentRunRecord[];
    try {
      const timeoutPromise = clock.sleep(pollBudget, timerController.signal).then(() => {
        if (!timerController.signal.aborted) {
          timedOut = true;
          pollController.abort();
        }
        return null;
      });
      const readPromise = readList(pollController.signal).then((value) => {
        timerController.abort();
        return value;
      });
      readPromise.catch(() => undefined);
      const winner = await Promise.race([readPromise, timeoutPromise]);
      if (timedOut || winner === null || clock.now() > deadline) {
        return finishOnDeadline();
      }
      records = winner;
    } finally {
      timerController.abort();
    }

    const match = records.find((item) => item.threadId === options.threadId);
    if (match) {
      if (match.roleUID) lastRoleUID = match.roleUID;
      if (match.startedAt) lastStartedAt = match.startedAt;
      if (match.status === "finished" || match.status === "cancelled") {
        return { kind: "done", record: match };
      }
      seenRunning = true;
      evictedSince = undefined;
    } else if (seenRunning && couldBeEvictedFromFinished(records, lastStartedAt)) {
      const current = clock.now();
      evictedSince ??= current;
      if (current - evictedSince >= AGENT_MISSING_GRACE_MS) {
        return {
          kind: "missing",
          ...(lastRoleUID ? { roleUID: lastRoleUID } : {}),
          ...(lastStartedAt ? { startedAt: lastStartedAt } : {}),
        };
      }
    } else {
      // Если буфер завершённых не переполнен, поток либо ещё запускается, либо временно скрыт
      // после перезаписи/удаления общей записи ag_info_<id> параллельным экземпляром: ждём до дедлайна.
      evictedSince = undefined;
    }

    const remaining = deadline - clock.now();
    if (remaining <= 0) {
      return finishOnDeadline();
    }

    const step = AGENT_POLL_DELAYS_MS[Math.min(attempt, AGENT_POLL_DELAYS_MS.length - 1)]!;
    attempt++;
    let delay = Math.min(step, remaining);
    if (evictedSince !== undefined) {
      const graceRemaining = Math.max(0, AGENT_MISSING_GRACE_MS - (clock.now() - evictedSince));
      if (graceRemaining === 0) {
        return {
          kind: "missing",
          ...(lastRoleUID ? { roleUID: lastRoleUID } : {}),
          ...(lastStartedAt ? { startedAt: lastStartedAt } : {}),
        };
      }
      delay = Math.min(delay, graceRemaining);
    }
    await clock.sleep(delay);
  }
}

/** @internal */
export function agentRunHint(
  kind:
    | "running"
    | "finished"
    | "cancelled"
    | "unknown_cs"
    | "unknown_missing"
    | "already_running"
    | "refused",
  threadId?: string,
): string {
  switch (kind) {
    case "running":
      return "Агент сервера запущен в отдельном потоке. Проверить состояние — agents.status, остановить — agents.cancel. Строки запуска — лог agent, alert и ошибки кода — лог xhttp после startedAt.";
    case "finished":
      return "Код агента отработал до конца или до ошибки: ошибку сервер пишет только в лог. Строки запуска — лог agent, alert и ошибки кода — лог xhttp, между startedAt и finishedAt.";
    case "cancelled":
      return "Агент сервера остановлен. Уже сделанные изменения не откатываются. Строки запуска — лог agent, alert и ошибки кода — лог xhttp, между startedAt и finishedAt.";
    case "unknown_cs":
      return "Агент сервера на C# запущен, но сервер не публикует его состояние в списке запусков. Результат и ошибки смотрите в логах agent и xhttp после startedAt.";
    case "unknown_missing":
      return "Агент сервера запущен, но запись о потоке не найдена среди выполняющихся и последних 100 завершённых. Проверьте логи agent и xhttp после startedAt.";
    case "already_running":
      return threadId
        ? `Агент сервера уже выполняется (поток ${threadId}). Проверить состояние — agents.status, остановить — agents.cancel, запустить параллельно — allowConcurrent: true.`
        : "Агент сервера уже выполняется. Проверить состояние — agents.status, запустить параллельно — allowConcurrent: true.";
    case "refused":
      return "Сервер агента не запустил; причину он пишет в лог agent.";
  }
}

/**
 * Сырые пробы могут идти тем же запросом, не меняя свой низкоуровневый контракт аргументов.
 * @internal
 */
export function scriptRequest(value: unknown, params?: unknown): Record<string, unknown> {
  return prepareScript(value, params).request;
}

/**
 * Успешного транспорта мало: коллекция может сообщить о пойманной ошибке скрипта.
 * @internal
 */
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
    // Сервер разбирает весь код до запуска, и отказ разбора на 1171–1535 — ровно эти две строки.
    // Ошибка выполнения, в том числе синтаксическая из eval() или throw с тем же текстом, несёт
    // кадры вызовов в скобках.
    const unread = /^JavaScript syntax error\.\nUnknown source,\s+line \d+$/.test(reason);
    const where = reason === "" ? "" : "Сообщение сервера — в details.scriptError. ";
    throw new HcmError(
      "SCRIPT_FAILED",
      "Сервер сообщил об ошибке в коде SP-XML Script.",
      unread
        ? where + "Код не разобран и не выполнялся: данные не менялись."
        : where +
            "Код выполнялся до ошибки. Если он только читал, его можно повторить; если менял данные — сначала проверить их.",
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
