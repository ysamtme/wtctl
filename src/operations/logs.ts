import { logFiles, logMatches, logNews, logText } from "../log-output.js";
import { boolean, integer, operation, schema, string } from "../operation.js";
import type { LogFollowInput, LogReadInput, LogSearchInput } from "../logs.js";

const logWindow = { file: string, full: boolean, tailBytes: integer };

export const logOperations = [
  operation({
    id: "logs.list",
    effect: "read",
    description:
      "Логи сервера, сначала свежие. type — имя лога без даты (xhttp, agent…); nameContains, startDate и endDate отбирают по имени и дате сервера. По умолчанию 30 файлов.",
    inputSchema: schema({
      type: string,
      nameContains: string,
      startDate: string,
      endDate: string,
      offset: integer,
      limit: integer,
    }),
    run: async (context, args) => logFiles(await context.logs.list(args)),
  }),
  operation({
    id: "logs.read",
    effect: "read",
    description:
      "Текст лога: конец файла (tailBytes) или весь файл (full:true). Пока сервер пишет в файл, он может его не отдать: чтение повторяется один раз, затем ошибка LOG_READ_UNAVAILABLE.",
    inputSchema: schema(logWindow, ["file"]),
    reply: { store: "always" },
    run: async (context, args) => {
      // Без явного размера ответ — конец файла, который умещается в один ответ.
      const input = (args.tailBytes === undefined && args.full !== true
        ? { ...args, tailBytes: context.pageBytes }
        : args) as unknown as LogReadInput;
      return logText(await context.logs.read(input));
    },
  }),
  operation({
    id: "logs.search",
    effect: "read",
    description:
      "События лога по тексту, уровню или потоку в прочитанной части файла. Многострочное событие возвращается целиком. Уровень определяется по словам в тексте, время — местное время сервера. newestFirst:true отдаёт сначала последние события. cutBySize:true — событий на странице меньше limit, потому что больше не поместилось в ответ; дальше — nextOffset. expectedFingerprint из прошлого ответа защищает следующую страницу от изменившегося файла.",
    inputSchema: schema(
      {
        ...logWindow,
        text: string,
        level: {
          type: "string",
          enum: ["normal", "debug", "info", "warning", "error", "critical"],
        },
        context: string,
        offset: integer,
        limit: integer,
        newestFirst: boolean,
        expectedFingerprint: string,
      },
      ["file"],
    ),
    run: async (context, args) =>
      logMatches(await context.logs.search(args as unknown as LogSearchInput), context.pageBytes),
  }),
  operation({
    id: "logs.follow",
    effect: "read",
    description:
      "Новые события лога с прошлого вызова по cursor. Последнее событие может повториться; gapPossible:true — часть событий могла быть пропущена. После ошибки чтения использовать прежний cursor; другой файл начинать без cursor.",
    inputSchema: schema({ ...logWindow, cursor: string }, ["file"]),
    run: async (context, args) =>
      logNews(
        await context.logs.follow(args as unknown as LogFollowInput),
        args.cursor === undefined,
        context.pageBytes,
      ),
  }),
] as const;
