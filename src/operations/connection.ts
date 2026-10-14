import { operation, schema, type OperationContext, type ReplyRules } from "../operation.js";
import { scalar } from "../errors.js";
import { findXmlNode } from "../protocol/xml.js";
import { parsePhysicalDocumentId } from "../protocol/physical-documents.js";
import { checkServer, type CheckData } from "../self-check.js";
import { rpcArgument } from "../server-value.js";
import { readServerInfo } from "../server-info.js";

/** Проверка подключения, в которой отказал хотя бы один шаг: ошибка поверх данных. */
const checkFailed: NonNullable<ReplyRules["failed"]> = (data) => {
  const check = data as CheckData;
  if (!(check.summary.failed > 0)) return undefined;
  return {
    code: "CHECK_FAILED",
    message: `Проверка подключения не пройдена: ${check.checks
      .filter((item) => item.result === "failed")
      .map((item) => item.name)
      .join(", ")}.`,
    hint:
      check.checks.find((item) => item.result === "failed")?.reason ?? "Причины — в data.checks.",
    retryable: false,
  };
};

export const connectionOperations = [
  operation({
    id: "server.info",
    effect: "read",
    description:
      "Сведения, которые сервер отдаёт админке при запуске: версия, операционная система, маска возможностей, ограничения на число записей по типам объектов; в профиле native ещё папки: dataFolders принимают запись через LDS, codeFolders — только кодом на сервере. Маска — не права пользователя, ограничения — не список каталогов. profile: native (по умолчанию) или web.",
    inputSchema: schema({ profile: { type: "string", enum: ["native", "web"] } }),
    summary: "Версия, операционная система и ограничения сервера.",
    run: async (context, args) => {
      const info = await readServerInfo(context.server, args.profile === "web" ? "web" : "native");
      const folders = info.profile === "native" ? await context.files.folders() : undefined;
      return folders ? { ...info, dataFolders: folders.data, codeFolders: folders.code } : info;
    },
  }),
  operation({
    id: "runtime.status",
    effect: "read",
    description: "Проверить связь: версия сервера и права подключения. Ничего не меняет.",
    inputSchema: schema({}),
    run: async (context) => {
      const version = await context.server.read("native.rpc.call", {
        target: "tools.get_version",
        args: [rpcArgument("wtv")],
      });
      // Сервер называет документ вошедшего пользователя; без него в ответе просто нет userId.
      const info = await context.server.applicationInfo().catch(() => undefined);
      const userId =
        typeof info?.auth_object_url === "string"
          ? parsePhysicalDocumentId(info.auth_object_url)
          : undefined;
      const database = (await readServerInfo(context.server).catch(() => undefined))?.database;
      return {
        connection: context.config.name,
        baseUrl: context.config.baseUrl,
        version: scalar(findXmlNode(version, "Result"), "версии"),
        ...(database ? { database } : {}),
        ...(userId ? { userId } : {}),
        operationCount: context.operationCount,
        permissions: context.config.permissions,
      };
    },
  }),
  operation({
    id: "runtime.check",
    effect: "read",
    description:
      "Проверить подключение по шагам: вход, версия, запрос, документ, схема, библиотеки, логи, портал; при праве execute — ещё код RESULT = [1 + 1]. Запись не проверяется.",
    inputSchema: schema({}),
    reply: { store: "never", failed: checkFailed },
    run: (context) =>
      checkServer(context.config, (id, input) => context.pipeline.invoke(id, input)),
  }),
] as const;
