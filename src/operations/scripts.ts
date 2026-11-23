import { HcmError } from "../errors.js";
import { withRequestSignal } from "../hcm-server.js";
import { boolean, operation, schema, string, type OperationContext } from "../operation.js";
import {
  DEFAULT_AGENT_STATUS_LIMIT,
  MAX_AGENT_STATUS_LIMIT,
  MAX_AGENT_WAIT_TIMEOUT_MS,
  MIN_AGENT_WAIT_TIMEOUT_MS,
  agentRun,
  agentRunHint,
  decodeAgentListResponse,
  filterAgentRuns,
  isAgentLaunchIdle,
  parseAgentId,
  parseAgentLaunch,
  parseAgentRoleUID,
  parseAgentThreadId,
  parseAgentWaitTimeout,
  prepareScript,
  waitForAgentThread,
  type AgentCancelData,
  type AgentListStatus,
  type AgentRunData,
  type AgentRunRecord,
  type AgentStatusData,
} from "../scripts.js";
import { rpcArgument } from "../server-value.js";

const AGENT_LIST_TARGET = "tools.amgr_get_agent_list_json";
const AGENT_CANCEL_TARGET = "tools.amgr_cancel_agent";

function readAgentRunList(
  context: OperationContext,
  signal?: AbortSignal,
): Promise<AgentRunRecord[]> {
  return withRequestSignal(signal, async () =>
    decodeAgentListResponse(
      await context.server.read("native.rpc.call", { target: AGENT_LIST_TARGET, args: [] }),
    ),
  );
}

export const scriptOperations = [
  operation({
    id: "execute.script",
    effect: "execute",
    description:
      "Выполнить код SP-XML Script на сервере. Код присваивает массив переменной RESULT; числа и логические значения приходят строками, дату нужно приводить к строке в коде (StrDate, StrXmlDate): на части версий сервера сама дата в ответ не попадает. params — объект JSON, в коде это готовая переменная PARAMS. На сервер ничего не устанавливается. Код может менять данные, отката нет.",
    inputSchema: schema(
      {
        code: { type: "string", minLength: 1 },
        params: { type: "object" },
      },
      ["code"],
    ),
    run: (context, args, call) =>
      context.server.runCode(prepareScript(args.code, args.params), call.outcome),
  }),
  operation({
    id: "agents.run",
    effect: "execute",
    description:
      "Запустить агента сервера в отдельном штатном потоке и по умолчанию дождаться завершения по списку запусков (до waitTimeoutMs, по умолчанию 120000 мс). С wait:false возвращает threadId сразу. Повторный запуск уже работающего агента отклоняется (started:false), если не задан allowConcurrent:true. Ошибку в коде агента ответ не показывает: она в логе xhttp.",
    inputSchema: schema(
      {
        id: { type: "string", description: "ID агента сервера (server_agent)." },
        objectId: { type: "string", description: "ID объекта: в коде агента это OBJECT_ID." },
        objectIds: {
          type: "array",
          items: string,
          maxItems: 1000,
          description: "ID нескольких объектов: в коде агента это OBJECTS_ID_STR, через «;».",
        },
        wait: {
          type: "boolean",
          description:
            "Ждать завершения агента по списку запусков (по умолчанию true). false запускает в фоне и сразу возвращает threadId.",
        },
        waitTimeoutMs: {
          type: "integer",
          minimum: MIN_AGENT_WAIT_TIMEOUT_MS,
          maximum: MAX_AGENT_WAIT_TIMEOUT_MS,
          description:
            "Предел ожидания завершения в миллисекундах (1000–3600000, по умолчанию 120000). Несовместим с wait:false.",
        },
        allowConcurrent: {
          type: "boolean",
          description:
            "Разрешить параллельный запуск, если этот агент уже выполняется (по умолчанию false).",
        },
      },
      ["id"],
    ),
    summary:
      "Запустить агента сервера в отдельном потоке по ID: {id, wait?, waitTimeoutMs?, allowConcurrent?, objectId?, objectIds?}.",
    details:
      "Запускает отдельный поток сервера, не держит HTTP-запрос на время работы агента и сохраняет дату последнего запуска. Проверка дубля смотрит очередь ag_running до запуска (это не атомарная блокировка при одновременных запросах; для агентов на C# очередь сервером не ведётся). По умолчанию ждёт завершения через опрос списка запусков (до waitTimeoutMs, по умолчанию 120000 мс); при таймауте возвращает AGENT_WAIT_TIMEOUT с mutationOutcome:'confirmed' и threadId в details — повторять запуск не нужно, дождаться можно через agents.status {threadId, wait:true}, остановить — через agents.cancel. Параметры агента берутся из его документа. Агенты на C# не публикуют статус в списке запусков.",
    run: async (context, args, call): Promise<AgentRunData> => {
      const agent = agentRun(args);
      const data = await context.server.runCode(
        prepareScript(agent.code, agent.params),
        call.outcome,
        isAgentLaunchIdle,
      );
      const launch = parseAgentLaunch(data);

      if (launch.kind === "already_running") {
        const running = launch.runningRecord;
        return {
          started: false,
          status: "running",
          ...(running?.threadId ? { threadId: running.threadId } : {}),
          ...(running?.roleUID !== undefined ? { roleUID: running.roleUID } : {}),
          startedAt: running?.startedAt || launch.startedAt,
          hint: agentRunHint("already_running", running?.threadId),
        };
      }

      // run_agent записал строки запуска или отказа в лог agent: следующее чтение лога дожидается сервера.
      context.logs.serverWroteLog();

      if (launch.kind === "refused") {
        return {
          started: false,
          startedAt: launch.startedAt,
          finishedAt: launch.finishedAt,
          hint: agentRunHint("refused"),
        };
      }

      // Запуск на сервере подтверждён: дальнейший таймаут или сбой опроса не должен выглядеть indeterminate.
      call.outcome.confirm();
      if (launch.threadId) call.outcome.note({ threadId: launch.threadId });

      if (launch.codeType === "cs") {
        return {
          started: true,
          status: agent.wait ? "unknown" : "running",
          ...(launch.threadId ? { threadId: launch.threadId } : {}),
          ...(launch.roleUID !== undefined ? { roleUID: launch.roleUID } : {}),
          startedAt: launch.startedAt,
          hint: agentRunHint("unknown_cs"),
        };
      }

      if (!launch.threadId) {
        throw new HcmError(
          "SCRIPT_RESPONSE",
          "Агент сервера запущен, но сервер не вернул ID потока (threadId).",
          "Повторять запуск не нужно: проверить запуски агента через agents.status.",
          {
            started: true,
            ...(launch.roleUID !== undefined ? { roleUID: launch.roleUID } : {}),
            startedAt: launch.startedAt,
          },
          "confirmed",
        );
      }

      if (!agent.wait) {
        return {
          started: true,
          status: "running",
          threadId: launch.threadId,
          ...(launch.roleUID !== undefined ? { roleUID: launch.roleUID } : {}),
          startedAt: launch.startedAt,
          hint: agentRunHint("running"),
        };
      }

      let waited;
      try {
        waited = await waitForAgentThread((signal) => readAgentRunList(context, signal), {
          threadId: launch.threadId,
          timeoutMs: agent.waitTimeoutMs,
          mode: "run",
          ...(launch.roleUID !== undefined ? { initialRoleUID: launch.roleUID } : {}),
          initialStartedAt: launch.startedAt,
        });
      } catch {
        throw new HcmError(
          "AGENT_STATUS_FAILED",
          "Агент сервера запущен, но проверить его состояние не удалось.",
          `Повторять запуск не нужно (поток ${launch.threadId}): проверить состояние через agents.status или остановить через agents.cancel.`,
          {
            started: true,
            threadId: launch.threadId,
            ...(launch.roleUID !== undefined ? { roleUID: launch.roleUID } : {}),
            startedAt: launch.startedAt,
          },
          "confirmed",
        );
      }

      if (waited.kind === "timeout") {
        const roleUID = waited.roleUID ?? launch.roleUID;
        const startedAt = waited.startedAt || launch.startedAt;
        throw new HcmError(
          "AGENT_WAIT_TIMEOUT",
          `Агент сервера не завершился за ${agent.waitTimeoutMs} мс и продолжает работу.`,
          `Повторять запуск не нужно (поток ${launch.threadId}): проверить состояние через agents.status или остановить через agents.cancel.`,
          {
            started: true,
            threadId: launch.threadId,
            ...(roleUID !== undefined ? { roleUID } : {}),
            startedAt,
          },
          "confirmed",
        );
      }

      if (waited.kind === "missing") {
        const roleUID = waited.roleUID ?? launch.roleUID;
        return {
          started: true,
          status: "unknown",
          threadId: launch.threadId,
          ...(roleUID !== undefined ? { roleUID } : {}),
          startedAt: waited.startedAt || launch.startedAt,
          hint: agentRunHint("unknown_missing"),
        };
      }

      context.logs.serverWroteLog();
      const record = waited.record;
      const roleUID = record.roleUID ?? launch.roleUID;
      return {
        started: true,
        status: record.status,
        threadId: record.threadId,
        ...(roleUID !== undefined ? { roleUID } : {}),
        startedAt: record.startedAt || launch.startedAt,
        ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
        hint: agentRunHint(record.status === "cancelled" ? "cancelled" : "finished"),
      };
    },
  }),
  operation({
    id: "agents.status",
    effect: "read",
    description:
      "Показать текущие и недавно завершённые запуски агентов сервера (до 100 последних завершённых). Фильтры: id, threadId, status, limit. При заданном threadId можно включить wait:true для ожидания завершения (до waitTimeoutMs, по умолчанию 120000 мс).",
    inputSchema: schema({
      id: { type: "string", description: "Фильтр по ID агента сервера (0x… или десятичный)." },
      threadId: {
        type: "string",
        description: "Фильтр по ID потока запуска (64-битное целое строкой).",
      },
      status: {
        type: "string",
        enum: ["running", "finished", "cancelled"],
        description: "Фильтр по состоянию: running, finished или cancelled.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: MAX_AGENT_STATUS_LIMIT,
        description: `Количество записей в ответе (1–${MAX_AGENT_STATUS_LIMIT}, по умолчанию ${DEFAULT_AGENT_STATUS_LIMIT}).`,
      },
      wait: {
        type: "boolean",
        description: "Ждать завершения запуска с заданным threadId (требует threadId).",
      },
      waitTimeoutMs: {
        type: "integer",
        minimum: MIN_AGENT_WAIT_TIMEOUT_MS,
        maximum: MAX_AGENT_WAIT_TIMEOUT_MS,
        description:
          "Предел ожидания в миллисекундах (1000–3600000, по умолчанию 120000; требует wait:true и threadId).",
      },
    }),
    summary:
      "Состояние запусков агентов сервера: {id?, threadId?, status?, limit?, wait?, waitTimeoutMs?}.",
    details:
      "Читает список запусков без права execute (сначала выполняющиеся, затем свежие завершённые). При wait:true ждёт завершения или отмены указанного threadId; по истечении waitTimeoutMs отвечает AGENT_WAIT_TIMEOUT.",
    reply: {
      list: {
        key: "runs",
        summary: (item) => {
          const r = item as Partial<AgentRunRecord>;
          return {
            id: r.id,
            code: r.code,
            status: r.status,
            threadId: r.threadId,
            startedAt: r.startedAt,
            ...(r.finishedAt ? { finishedAt: r.finishedAt } : {}),
          };
        },
      },
    },
    run: async (context, args): Promise<AgentStatusData> => {
      const id = args.id === undefined ? undefined : parseAgentId(args.id, "id");
      const threadId =
        args.threadId === undefined ? undefined : parseAgentThreadId(args.threadId, "threadId");
      const status = args.status as AgentListStatus | undefined;
      const limit = args.limit === undefined ? DEFAULT_AGENT_STATUS_LIMIT : (args.limit as number);
      const wait = args.wait === true;
      if (wait && threadId === undefined) {
        throw new HcmError(
          "INVALID_ARGUMENT",
          "wait: true требует указать threadId.",
          "Передать threadId из ответа agents.run или agents.status.",
        );
      }
      if (!wait && args.waitTimeoutMs !== undefined) {
        throw new HcmError(
          "INVALID_ARGUMENT",
          "waitTimeoutMs используется только вместе с wait: true и threadId.",
        );
      }
      const waitTimeoutMs = parseAgentWaitTimeout(args.waitTimeoutMs);

      if (!wait) {
        const records = await readAgentRunList(context);
        return filterAgentRuns(records, {
          ...(id === undefined ? {} : { id }),
          ...(threadId === undefined ? {} : { threadId }),
          ...(status === undefined ? {} : { status }),
          limit,
        });
      }

      const waited = await waitForAgentThread((signal) => readAgentRunList(context, signal), {
        threadId: threadId!,
        timeoutMs: waitTimeoutMs,
        mode: "status",
      });
      if (waited.kind === "timeout") {
        throw new HcmError(
          "AGENT_WAIT_TIMEOUT",
          `Агент сервера (поток ${threadId!}) не завершился за ${waitTimeoutMs} мс и продолжает работу.`,
          "Повторить ожидание через agents.status или остановить запуск через agents.cancel.",
          {
            threadId: threadId!,
            ...(waited.roleUID !== undefined ? { roleUID: waited.roleUID } : {}),
            ...(waited.startedAt ? { startedAt: waited.startedAt } : {}),
          },
        );
      }
      if (waited.kind === "missing") {
        return { runs: [], total: 0 };
      }
      return filterAgentRuns([waited.record], {
        ...(id === undefined ? {} : { id }),
        threadId: threadId!,
        ...(status === undefined ? {} : { status }),
        limit,
      });
    },
  }),
  operation({
    id: "agents.cancel",
    effect: "write",
    description:
      "Остановить выполняющегося агента сервера по ID потока (threadId). Если roleUID не указан, клиент находит его среди работающих запусков; если агент не выполняется, отвечает AGENT_NOT_RUNNING без отправки запроса. Уже сделанные изменения не откатываются.",
    inputSchema: schema(
      {
        threadId: {
          type: "string",
          description: "ID потока работающего агента сервера (из agents.run или agents.status).",
        },
        roleUID: {
          type: "string",
          maxLength: 128,
          description:
            "Идентификатор роли сервера (на одиночном сервере 2025.2 может быть пустой строкой). Если не указан, определяется по threadId среди работающих запусков.",
        },
      },
      ["threadId"],
    ),
    summary: "Остановить работающего агента сервера по threadId: {threadId, roleUID?}.",
    details:
      "Ставит поток в очередь отмены роли сервера (обрабатывается сервером за несколько секунд). Уже сделанные изменения не откатываются; итоговое состояние показывает agents.status.",
    run: async (context, args, call): Promise<AgentCancelData> => {
      const threadId = parseAgentThreadId(args.threadId, "threadId");
      let roleUID =
        args.roleUID === undefined ? undefined : parseAgentRoleUID(args.roleUID, "roleUID");

      if (roleUID === undefined) {
        const records = await readAgentRunList(context);
        const record = records.find((item) => item.threadId === threadId);
        if (!record) {
          throw new HcmError(
            "AGENT_NOT_RUNNING",
            `Работающий агент сервера с потоком ${threadId} не найден.`,
            "Проверить список запусков через agents.status.",
            { threadId },
            "not_sent",
          );
        }
        if (record.status !== "running") {
          throw new HcmError(
            "AGENT_NOT_RUNNING",
            `Агент сервера (поток ${threadId}) уже завершился (${record.status}).`,
            "Проверить список запусков через agents.status.",
            { threadId, status: record.status },
            "not_sent",
          );
        }
        if (record.roleUID === undefined) {
          throw new HcmError(
            "AGENT_STATUS_RESPONSE",
            `Сервер не вернул roleUID для работающего потока ${threadId}.`,
            "Передать roleUID явно или проверить список запусков через agents.status.",
            { threadId },
            "not_sent",
          );
        }
        // На одиночном сервере 2025.2 GetRoleUID() возвращает пустую строку, и очередь отмены
        // называется ag_cancel_ без суффикса: передаём roleUID как есть.
        roleUID = record.roleUID;
      }

      await context.server.call(
        "native.rpc.call",
        {
          target: AGENT_CANCEL_TARGET,
          args: [rpcArgument(roleUID), rpcArgument(threadId)],
        },
        call.outcome,
      );
      context.logs.serverWroteLog();

      return {
        cancelled: true,
        threadId,
        roleUID,
        mutationOutcome: "confirmed",
        hint: "Запрос на отмену передан в очередь роли сервера (обрабатывается в течение нескольких секунд). Уже сделанные изменения не откатываются; итоговое состояние покажет agents.status.",
      };
    },
  }),
] as const;
