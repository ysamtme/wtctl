import type { OperationResult } from "./contracts.js";

// Error texts are written once, in the runtime, and name operations by ID. A caller of the MCP
// server knows tools and a caller of the command knows subcommands, so each front end shows its own name.
const NAMES: Readonly<Record<string, readonly [tool: string, command: string]>> = {
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
  "logs.read": ["hcm_log_read", "wtctl logs read"],
  "logs.search": ["hcm_logs_search", "wtctl logs search"],
  "logs.follow": ["hcm_log_follow", "wtctl logs follow"],
  "results.read": ["hcm_result_read", "wtctl result read"],
  "results.export": ["hcm_result_export", "wtctl result export"],
  "api.list": ["hcm_api_list", "wtctl api list"],
  "api.describe": ["hcm_api_describe", "wtctl api describe"],
};
// An ID inside a longer dotted name is left alone; a full stop that ends the sentence is not part of a name.
const PATTERN = new RegExp(
  `(?<![\\w.])(?:${Object.keys(NAMES)
    .map((id) => id.replace(".", "\\."))
    .join("|")})(?!\\w|\\.\\w)`,
  "g",
);

export type Frontend = "mcp" | "cli";

function renamed(text: string, frontend: Frontend): string {
  return text.replace(PATTERN, (id) => NAMES[id]![frontend === "mcp" ? 0 : 1]);
}

/** The same failure with operation IDs in its message and hint replaced by the caller's names. */
export function errorInFrontendTerms(result: OperationResult, frontend: Frontend): OperationResult {
  // A batch carries the answers of its steps: a failed step is renamed the same way.
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
  // A hint in the answer names the operations to go on with; the caller knows them by its own names.
  const stored = result.data as { hint?: unknown } | null | undefined;
  if (typeof stored?.hint === "string")
    result = {
      ...result,
      data: { ...(result.data as object), hint: renamed(stored.hint, frontend) },
    };
  const error = result.error;
  if (!error) return result;
  return {
    ...result,
    error: {
      ...error,
      message: renamed(error.message, frontend),
      ...(error.hint === undefined ? {} : { hint: renamed(error.hint, frontend) }),
    },
  };
}
