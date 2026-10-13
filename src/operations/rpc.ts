import { HcmError, inputObject, requiredString } from "../errors.js";
import { prepare } from "../native/validation.js";
import { boolean, operation, schema, string } from "../operation.js";
import { WsHcmApiError } from "../protocol/error.js";
import { escapeXml } from "../protocol/xml.js";
import { identifier } from "../query.js";
import { rpcArgument, rpcValue } from "../server-value.js";
import { withoutXmlFormatting } from "./native.js";

export const rpcOperations = [
  operation({
    id: "rpc.call",
    effect: "execute",
    description:
      "Вызвать функцию библиотеки сервера: {library, method, arguments:[…]}. Строки, целые, логические значения и null передаются как есть; дата, объект, XML и большое целое — как {valueType, lexicalValue}. async:true запускает фоновой задачей.",
    inputSchema: schema(
      { library: string, method: string, arguments: { type: "array" }, async: boolean },
      ["library", "method"],
    ),
    summary:
      "Вызвать функцию: {library, method, arguments:[…]}; async:true запускает фоновой задачей.",
    usualCause: "нет такой функции, неверные аргументы или ошибка внутри функции",
    run: async (context, args, call) => {
      const target = `${identifier(args.library, "library")}.${identifier(args.method, "method")}`;
      const supplied = args.arguments ?? [];
      if (!Array.isArray(supplied))
        throw new HcmError("INVALID_ARGUMENT", "arguments: нужен массив.");
      const encoded = supplied.map((value) =>
        value !== null && typeof value === "object"
          ? inputObject(value, "аргумент функции")
          : rpcArgument(value),
      );
      const operationId = args.async === true ? "web.spxml.callMethodAsync" : "native.rpc.call";
      const nativeArgs = { target, args: encoded };
      try {
        prepare(nativeArgs, context.pipeline.describe(operationId).inputSchema);
      } catch (error) {
        // Вызывающий написал arguments[i]; имя списка в протоколе ему знать не нужно.
        const index = error instanceof TypeError && /^args\.args\[(\d+)\]/.exec(error.message);
        if (!index) throw error;
        throw new HcmError(
          "INVALID_RPC_ARGUMENT",
          `arguments[${index[1]}]: объект должен быть вида {valueType, lexicalValue}.`,
          "Строки, целые числа, true, false и null передаются как есть. Остальное — явно: {valueType:'date', lexicalValue:'2026-10-01T00:00:00'}, {valueType:'integer', lexicalValue:'6148914691236517121'}, {valueType:'real', lexicalValue:'1.5'}.",
        );
      }
      for (const argument of encoded)
        if (typeof argument.lexicalValue === "string") escapeXml(argument.lexicalValue);
      let response: unknown;
      try {
        response = await context.server.call(operationId, nativeArgs, call.outcome);
      } catch (error) {
        // Сервер не называет причину; обычная — опечатка в имени или функция, закрытая клиентам.
        if (error instanceof WsHcmApiError && error.status === 500) {
          context.logs.serverWroteLog();
          const reason = await context.rpcCatalog.refusal(target).catch(() => undefined);
          if (reason) throw reason;
        }
        throw error;
      }
      return args.async === true ? withoutXmlFormatting(response) : rpcValue(response);
    },
  }),
  operation({
    id: "rpc.list",
    effect: "read",
    description:
      "Найти функции библиотек сервера: query, library, method. Без all — только те, что можно вызвать с клиента (rpc.call); all:true добавляет функции, которые вызываются только из кода на сервере (serverOnly:true). builtIn:true берёт встроенную таблицу сборки 2025.1.1171 без обращения к серверу. Список не говорит о типах аргументов и о том, меняет ли функция данные.",
    inputSchema: schema({
      query: { type: "string", maxLength: 512 },
      library: { type: "string", maxLength: 128, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
      method: { type: "string", maxLength: 128, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
      builtIn: boolean,
      all: boolean,
      cursor: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }),
    summary:
      "Найти функции, разрешённые для вызова с клиента: query, library, method; all:true — вместе с функциями только для кода на сервере.",
    run: (context, args) => context.rpcCatalog.list(args),
  }),
  operation({
    id: "rpc.describe",
    effect: "read",
    description:
      "Параметры функции по targetId «библиотека.функция»; source:true добавляет до 8 КБ её кода. serverOnly:true в ответе — функция вызывается только из кода на сервере. Сама функция не вызывается.",
    inputSchema: schema(
      {
        targetId: {
          type: "string",
          maxLength: 257,
          pattern: "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$",
        },
        builtIn: boolean,
        source: boolean,
      },
      ["targetId"],
    ),
    summary:
      "Параметры функции по targetId «библиотека.функция»; source:true добавляет код. Знает и функции, которые вызываются только из кода на сервере.",
    run: (context, args) =>
      context.rpcCatalog.describe(requiredString(args.targetId, "targetId"), args),
  }),
] as const;
