import { operation, schema, string } from "../operation.js";
import { agentRun, agentRunResult, prepareScript } from "../scripts.js";

export const scriptOperations = [
  operation({
    id: "execute.script",
    effect: "execute",
    description:
      "Выполнить код SP-XML Script на сервере. Код присваивает массив переменной RESULT; числа, даты и логические значения приходят строками. params — объект JSON, в коде это готовая переменная PARAMS. На сервер ничего не устанавливается. Код может менять данные, отката нет.",
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
      "Запустить агента сервера и дождаться конца его кода. Ответ: started, startedAt и finishedAt — местное время сервера. Ошибку в коде агента ответ не показывает: она в логе xhttp между этими отметками. Дата последнего запуска сохраняется в агенте, как при запуске из админки.",
    inputSchema: schema(
      {
        id: { type: "string", description: "ID агента (server_agent)." },
        objectId: { type: "string", description: "ID объекта: в коде агента это OBJECT_ID." },
        objectIds: {
          type: "array",
          items: string,
          maxItems: 1000,
          description: "ID нескольких объектов: в коде агента это OBJECTS_ID_STR, через «;».",
        },
      },
      ["id"],
    ),
    summary:
      "Запустить агента по ID и дождаться конца: {id}; objectId и objectIds — объекты, над которыми он работает.",
    details:
      "Вызов ждёт, пока код агента не кончится, и ограничен временем ожидания подключения (timeoutMs): долгого агента нужно запускать без ожидания — rpc.call {library:'tools', method:'start_agent', arguments:[id]} — и следить за логом agent. Параметры агента берутся из его документа. Агенты на C# и агенты выгрузки и импорта не проверялись.",
    run: async (context, args, call) => {
      const agent = agentRun(args);
      const data = await context.server.runCode(
        prepareScript(agent.code, agent.params),
        call.outcome,
      );
      // Агент только что записал свои строки: следующее чтение лога дожидается сервера.
      context.logs.serverWroteLog();
      return agentRunResult(data);
    },
  }),
] as const;
