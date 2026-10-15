import { unknownOperationHint } from "./catalog.js";
import type { OperationResult } from "./contracts.js";

// Тексты ошибок пишутся один раз, в runtime, с ID операций. Вызывающий MCP-сервер знает
// инструменты, вызывающий команду — подкоманды: каждый интерфейс показывает свои имена.
export const NAMES: Readonly<Record<string, readonly [tool: string, command: string]>> = {
  "runtime.status": ["hcm_status", "wtctl status"],
  "runtime.check": ["hcm_check", "wtctl check"],
  "runtime.query": ["hcm_query", "wtctl query"],
  "schema.types": ["hcm_types", "wtctl types"],
  "schema.get": ["hcm_schema", "wtctl schema"],
  "objects.get": ["hcm_object_get", "wtctl object get"],
  "objects.create": ["hcm_object_create", "wtctl object create"],
  "objects.patch": ["hcm_object_patch", "wtctl object patch"],
  "objects.delete": ["hcm_object_delete", "wtctl object delete"],
  "execute.script": ["hcm_script", "wtctl exec"],
  "logs.list": ["hcm_logs_list", "wtctl logs list"],
  "logs.read": ["hcm_logs_read", "wtctl logs read"],
  "logs.search": ["hcm_logs_search", "wtctl logs search"],
  "logs.follow": ["hcm_logs_follow", "wtctl logs follow"],
  "results.read": ["hcm_result_read", "wtctl result read"],
  "results.export": ["hcm_result_export", "wtctl result export"],
  "api.list": ["hcm_api_list", "wtctl api list"],
  "api.describe": ["hcm_api_describe", "wtctl api describe"],
};
// ID внутри длинного имени через точку не трогается; точка в конце предложения — не часть имени.
const PATTERN = new RegExp(
  `(?<![\\w.])(?:${Object.keys(NAMES)
    .map((id) => id.replace(".", "\\."))
    .join("|")})(?!\\w|\\.\\w)`,
  "g",
);

export type Frontend = "mcp" | "cli";

function name(id: string, frontend: Frontend): string {
  return NAMES[id]?.[frontend === "mcp" ? 0 : 1] ?? id;
}

function renamed(text: string, frontend: Frontend): string {
  return text.replace(PATTERN, (id) => name(id, frontend));
}

/** Тот же отказ, где ID операций в сообщении и подсказке заменены именами вызывающего. */
export function errorInFrontendTerms(result: OperationResult, frontend: Frontend): OperationResult {
  // Пакет несёт ответы своих шагов: упавший шаг переименовывается так же.
  const steps = (result.data as { results?: unknown } | null | undefined)?.results;
  if (result.meta.operationId === "runtime.batch" && Array.isArray(steps))
    result = {
      ...result,
      data: {
        ...(result.data as object),
        results: steps.map((step: OperationResult) =>
          step && typeof step === "object" && step.meta
            ? errorInFrontendTerms(step, frontend)
            : step,
        ),
      },
    };
  // Подсказка в ответе называет операции для продолжения; вызывающий знает их по своим именам.
  const stored = result.data as { hint?: unknown } | null | undefined;
  if (typeof stored?.hint === "string")
    result = {
      ...result,
      data: { ...(result.data as object), hint: renamed(stored.hint, frontend) },
    };
  const error = result.error;
  if (!error) return result;
  // Неизвестный ID показывается так, как его передали, а похожие на него — ID операций:
  // подсказка строится заново по ID из details.
  const unknown = error.code === "UNKNOWN_OPERATION";
  const asked = error.details?.operationId;
  return {
    ...result,
    error: {
      ...error,
      message: unknown ? error.message : renamed(error.message, frontend),
      ...(error.hint === undefined
        ? {}
        : {
            hint:
              unknown && typeof asked === "string"
                ? unknownOperationHint(asked, (id) => name(id, frontend))
                : renamed(error.hint, frontend),
          }),
    },
  };
}
