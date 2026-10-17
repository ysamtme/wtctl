import type { OperationResult } from "../contracts.js";
import { HcmError, inputObject, requiredString } from "../errors.js";
import {
  boolean,
  operation,
  schema,
  type EffectFor,
  type OperationCall,
  type ReplyRules,
} from "../operation.js";
import { identifier } from "../query.js";
import type { BatchRecovery } from "../reply.js";
import { WriteOutcome } from "../write-outcome.js";

const batchEffect: EffectFor = (args, effectOf) => {
  const steps = args.steps;
  if (!Array.isArray(steps)) return "unknown";
  const effects = steps.map((raw) => {
    const step = inputObject(raw, "step");
    const id = requiredString(step.id, "step.id");
    if (id === "runtime.batch")
      throw new HcmError("NESTED_BATCH", "Пакет внутри пакета не поддерживается.");
    // Сначала ID шага, затем его аргументы: неизвестная операция — отказ раньше, чем неверные аргументы.
    return effectOf(id)(step.args === undefined ? {} : inputObject(step.args));
  });
  if (effects.includes("unknown") || (effects.includes("write") && effects.includes("execute")))
    return "unknown";
  return effects.includes("execute") ? "execute" : effects.includes("write") ? "write" : "read";
};

/** Отказавший пакет: ошибка поверх данных. Отказавшие шаги названы в ней: ответы длинного пакета сохраняются. */
const batchFailed: NonNullable<ReplyRules["failed"]> = (data, stored) => {
  if (data === null || typeof data !== "object" || !("ok" in data) || data.ok !== false)
    return undefined;
  const batch = data as unknown as {
    results: OperationResult[];
    completed: number;
    requested: number;
  };
  const failedSteps = batch.results.flatMap((result, index) =>
    result.ok
      ? []
      : [{ index, id: result.meta.operationId, code: result.error?.code ?? "UNKNOWN" }],
  );
  return {
    code: "BATCH_FAILED",
    message: `Отказало шагов пакета: ${failedSteps.length} из ${batch.requested}${batch.requested > batch.completed ? `; после отказа не запускались: ${batch.requested - batch.completed}` : ""}. До повтора нужно посмотреть исход каждого шага.`,
    hint: stored
      ? "Номера и коды отказавших шагов — в error.details.failed; ответы шагов сохранены, их читает results.read."
      : "Номера и коды отказавших шагов — в error.details.failed, ответы шагов — в data.results.",
    retryable: false,
    details: {
      failed: failedSteps.slice(0, 20),
      ...(failedSteps.length > 20 ? { failedTotal: failedSteps.length } : {}),
    },
  };
};

/** Строка шага сохранённого ответа пакета: какой это шаг и сколько он вернул. */
function stepSummary(step: unknown): unknown {
  const { as, ok, data, error } = step as {
    as?: string;
    ok?: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string };
  };
  return {
    ...(as === undefined ? {} : { as }),
    ok,
    ...(error?.code ? { code: error.code } : {}),
    ...(typeof data?.total === "number" ? { total: data.total } : {}),
    ...(Array.isArray(data?.items) ? { rows: data.items.length } : {}),
    ...(data?.incomplete ? { incomplete: true } : {}),
  };
}

export const batchOperations = [
  operation({
    id: "runtime.batch",
    effect: "unknown",
    effectFor: batchEffect,
    reply: { failed: batchFailed, list: { key: "results", summary: stepSummary } },
    description:
      "Несколько операций одним вызовом: steps — список {id, args, as}. Значение из прошлого шага: {$ref:'имя.data.items.0.id'}, где имя — as того шага, дальше путь по его ответу. Класс вызова — по самому сильному шагу: все шаги читают — чтение, есть запись — запись, есть выполнение кода — выполнение. Права проверяются для каждого шага. Это не транзакция: выполненные шаги не откатываются; первый сбой останавливает остальные, если не задано stopOnError:false.",
    inputSchema: schema(
      {
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "ID операции шага." },
              args: {
                type: "object",
                description: "Аргументы операции; значение из прошлого шага — {$ref:'имя.путь'}.",
              },
              as: {
                type: "string",
                description:
                  "Имя шага для ссылок из следующих шагов: латинские буквы, цифры и _, первой не цифра.",
              },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
        stopOnError: boolean,
      },
      ["steps"],
    ),
    run: async (context, args, call) => {
      if (!Array.isArray(args.steps) || args.steps.length === 0 || args.steps.length > 100)
        throw new HcmError("INVALID_BATCH", "steps: в пакете должно быть от 1 до 100 шагов.");
      const labels = new Set<string>();
      for (const [index, raw] of args.steps.entries()) {
        const at = `steps[${index}]`;
        const step = inputObject(raw, at);
        const stepId = requiredString(step.id, `${at}.id`);
        if (stepId === "runtime.batch")
          throw new HcmError("NESTED_BATCH", "Пакет внутри пакета не поддерживается.");
        context.pipeline.describe(stepId);
        if (step.args !== undefined) inputObject(step.args, `${at}.args`);
        if (step.as !== undefined) {
          const label = identifier(step.as, `${at}.as`);
          if (labels.has(label))
            throw new HcmError(
              "DUPLICATE_STEP",
              `${at}.as: имя ${label} уже дано другому шагу; имена шагов пакета не повторяются.`,
              undefined,
              { path: `${at}.as` },
            );
          labels.add(label);
        }
      }
      const named = new Map<string, OperationResult>();
      const results: OperationResult[] = [];
      const recovery: BatchRecovery = {
        completed: 0,
        requested: args.steps.length,
        sentMutationSteps: 0,
        receipts: [],
      };
      call.batchRecovery = recovery;
      const resolveRefs = (value: unknown, depth = 0): unknown => {
        if (depth > 32)
          throw new HcmError("REFERENCE_DEPTH", "Аргументы шага вложены глубже 32 уровней.");
        if (Array.isArray(value)) return value.map((item) => resolveRefs(item, depth + 1));
        if (value === null || typeof value !== "object") return value;
        const record = inputObject(value);
        if (Object.keys(record).length === 1 && typeof record.$ref === "string") {
          const [stepName, ...path] = record.$ref.split(".");
          let result: unknown = named.get(stepName!);
          for (const key of path) {
            if (
              ["__proto__", "constructor", "prototype"].includes(key) ||
              result === null ||
              typeof result !== "object" ||
              !Object.hasOwn(result, key)
            )
              throw new HcmError(
                "INVALID_REFERENCE",
                "Ссылка $ref не находит значение: такого шага раньше не было, или в его результате нет такого поля.",
              );
            result = (result as Record<string, unknown>)[key];
          }
          if (result === undefined)
            throw new HcmError(
              "INVALID_REFERENCE",
              "Ссылка $ref называет шаг, которого раньше в пакете не было.",
            );
          return result;
        }
        return Object.fromEntries(
          Object.entries(record).map(([key, item]) => [key, resolveRefs(item, depth + 1)]),
        );
      };
      for (const raw of args.steps) {
        const step = inputObject(raw, "step");
        const stepId = requiredString(step.id, "step.id");
        let result: OperationResult;
        const childState: OperationCall = { outcome: new WriteOutcome(), effect: "read" };
        try {
          const resolved =
            step.args === undefined ? {} : inputObject(resolveRefs(step.args), "step.args");
          result = await context.pipeline.step(stepId, resolved, childState);
        } catch (error) {
          result = context.pipeline.failure(stepId, error);
        }
        const written = childState.outcome.verdict(childState.effect);
        if (written.sent) {
          call.outcome.sending();
          recovery.sentMutationSteps++;
        }
        // Названный шаг несёт своё имя: ответы сопоставляются шагам без подсчёта позиций.
        results.push(
          typeof step.as === "string" ? ({ as: step.as, ...result } as OperationResult) : result,
        );
        recovery.completed = results.length;
        const returned =
          result.data !== null && typeof result.data === "object"
            ? (result.data as Record<string, unknown>)
            : undefined;
        recovery.receipts.push({
          index: results.length - 1,
          operationId: stepId,
          ok: result.ok,
          ...(result.error === undefined
            ? {}
            : {
                errorCode: result.error.code,
                ...(result.error.mutationOutcome === undefined
                  ? {}
                  : { mutationOutcome: result.error.mutationOutcome }),
              }),
          ...(returned?.mutationOutcome === "confirmed" ? { mutationOutcome: "confirmed" } : {}),
          ...(written.ids.mutationId === undefined ? {} : { mutationId: written.ids.mutationId }),
          ...(written.ids.objectId === undefined ? {} : { objectId: written.ids.objectId }),
          ...(written.ids.executionId === undefined
            ? {}
            : { executionId: written.ids.executionId }),
          ...(written.ids.url === undefined ? {} : { url: written.ids.url }),
        });
        if (step.as !== undefined) named.set(identifier(step.as, "step.as"), result);
        if (!result.ok && args.stopOnError !== false) break;
      }
      return {
        results,
        completed: results.length,
        requested: args.steps.length,
        atomic: false as const,
        ok: results.every((result) => result.ok),
      };
    },
  }),
] as const;
