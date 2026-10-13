import type {
  ConnectionConfig,
  JsonSchema,
  NativeOperation,
  OperationDefinition,
  OperationEffect,
  OperationError,
  OperationResult,
} from "./contracts.js";
import type { HcmServer } from "./hcm-server.js";
import type { ServerFiles } from "./files.js";
import type { ServerObjects } from "./objects.js";
import type { LogReader } from "./logs.js";
import type { ResultStore } from "./results.js";
import type { RpcCatalog } from "./rpc-catalog.js";
import type { BatchRecovery } from "./reply.js";
import type { SchemaReader } from "./schema.js";
import type { WriteOutcome } from "./write-outcome.js";

/** Право для этих аргументов; undefined — базовое право операции. */
export type EffectFor = (
  args: Readonly<Record<string, unknown>>,
  /** Право другой операции: ID проверяется сразу, аргументы — во втором вызове. Нужно пакету. */
  effectOf: (id: string) => (args: Record<string, unknown>) => OperationEffect,
) => OperationEffect | undefined;

/** Что обработчик сообщает конвейеру об одном вызове. */
export interface OperationCall {
  readonly outcome: WriteOutcome;
  effect: OperationEffect;
  /** Обычная причина отказа к этому вызову не относится: подсказка отказа её не называет. */
  causeRuledOut?: true;
  batchRecovery?: BatchRecovery;
}

/** Правила упаковки ответа операции. */
export interface ReplyRules {
  /** "never" — ответ отдаётся целиком при любом размере; "always" — сохраняется, даже когда помещается. */
  readonly store?: "never" | "always";
  /** Ответ, который сам отказ: ошибка поверх данных. stored — данные не поместились и сохранены. */
  readonly failed?: (data: unknown, stored: boolean) => OperationError | undefined;
  /** Список сохранённого ответа, который превью показывает поэлементно: ключ ответа → строка об элементе. */
  readonly preview?: Readonly<Record<string, (item: unknown) => unknown>>;
}

/** Что обработчику доступно от подключения; собирается один раз в конструкторе HcmRuntime. */
export interface OperationContext {
  readonly config: ConnectionConfig;
  readonly server: HcmServer;
  readonly objects: ServerObjects;
  readonly files: ServerFiles;
  readonly schema: SchemaReader;
  readonly logs: LogReader;
  readonly results: ResultStore;
  readonly rpcCatalog: RpcCatalog;
  /** Сколько данных помещается в один ответ. */
  readonly pageBytes: number;
  /** Сколько операций в реестре. */
  readonly operationCount: number;
  /** То, что нужно от самого конвейера; обычной операции не требуется. */
  readonly pipeline: {
    /** Описание другой операции; неверный или неизвестный ID — прежний отказ. */
    describe(id: string): OperationDefinition;
    /** Ответ-отказ операции из брошенной ошибки — как у вызова, который ничего не отправлял. */
    failure(id: string, error: unknown): OperationResult;
    /** Шаг пакета: весь конвейер для другой операции со своим вызовом, ответ без предела размера. */
    step(id: string, args: Record<string, unknown>, call: OperationCall): Promise<OperationResult>;
    /** Обработчик другой операции без проверок и упаковки, со своим вызовом. */
    invoke(id: string, args: Record<string, unknown>): Promise<unknown>;
  };
}

export interface Operation<Id extends string = string, Data = unknown> {
  readonly id: Id;
  /** Самое большее, что операция может; это право показывают списки. */
  readonly effect: OperationEffect;
  readonly effectFor?: EffectFor;
  readonly description: string;
  /** Строка обзора: её показывают `api list` и `api describe`. */
  readonly summary?: string;
  /** То, что строка обзора опускает; показывает `api describe`. */
  readonly details?: string;
  readonly inputSchema: JsonSchema;
  /** Обычная причина HTTP 500: сервер её не сообщает, она вставляется в подсказку отказа. */
  readonly usualCause?: string;
  readonly reply?: ReplyRules;
  /** Низкоуровневая операция: запись её реестра как есть. */
  readonly native?: NativeOperation;
  run(context: OperationContext, args: Record<string, unknown>, call: OperationCall): Promise<Data>;
}

/** Возвращает определение как есть; нужна только для вывода типов Id и Data. */
export function operation<Id extends string, Data>(spec: Operation<Id, Data>): Operation<Id, Data> {
  return spec;
}

/** Запись списка операций: у низкоуровневой — её запись реестра, у составной — собранная из определения. */
export function definitionOf(spec: Operation): OperationDefinition {
  return (
    spec.native ?? {
      id: spec.id,
      group: spec.id.split(".")[0]!,
      title: spec.id,
      description: spec.description,
      effect: spec.effect,
      status: "implemented",
      inputSchema: spec.inputSchema,
    }
  );
}

export const string = { type: "string" };
export const integer = { type: "integer", minimum: 0 };
export const boolean = { type: "boolean" };
export const object = { type: "object" };
export const fields = { type: "array", items: string };
export function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}
