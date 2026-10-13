import { freezeRegistry } from "./immutable.js";
import { nativeOperations } from "./operations/native.js";
import { batchOperations } from "./operations/batch.js";
import { connectionOperations } from "./operations/connection.js";
import { fileOperations } from "./operations/files.js";
import { logOperations } from "./operations/logs.js";
import { objectOperations } from "./operations/objects.js";
import { queryOperations } from "./operations/query.js";
import { resultOperations } from "./operations/results.js";
import { rpcOperations } from "./operations/rpc.js";
import { schemaOperations } from "./operations/schema.js";
import { scriptOperations } from "./operations/scripts.js";
import { definitionOf, type Operation } from "./operation.js";
import type { OperationDefinition } from "./contracts.js";

const composite: readonly Operation[] = [
  ...fileOperations,
  ...connectionOperations,
  ...queryOperations,
  ...objectOperations,
  ...schemaOperations,
  ...logOperations,
  ...resultOperations,
  ...rpcOperations,
  ...scriptOperations,
  ...batchOperations,
];
/** Результат обработчика каждой составной операции по её ID; SDK сверяет с ним объявленные типы методов. */
export type OperationData = {
  [
    O in
      | (typeof fileOperations)[number]
      | (typeof connectionOperations)[number]
      | (typeof queryOperations)[number]
      | (typeof objectOperations)[number]
      | (typeof schemaOperations)[number]
      | (typeof logOperations)[number]
      | (typeof resultOperations)[number]
      | (typeof rpcOperations)[number]
      | (typeof scriptOperations)[number]
      | (typeof batchOperations)[number] as O["id"]
  ]: Awaited<ReturnType<O["run"]>>;
};
const specs: readonly Operation[] = [...composite, ...nativeOperations].map((spec) =>
  Object.freeze(spec),
);
export const operations: OperationDefinition[] = freezeRegistry(specs.map(definitionOf));
const byId = new Map(operations.map((operation) => [operation.id, operation]));
if (byId.size !== operations.length) throw new Error("ID операции runtime повторяется");
const specById = new Map(specs.map((spec) => [spec.id, spec]));

export function operationSpec(id: string): Operation | undefined {
  return specById.get(id);
}

export function operationDefinition(id: string): OperationDefinition | undefined {
  return byId.get(id);
}

/** Точные ID и части идентификаторов идут раньше случайных совпадений с подстрокой описания. */
export function operationSearchRank(operation: OperationDefinition, query: string): number {
  const id = operation.id.toLowerCase();
  if (id === query) return 5;
  if (id.split(".").includes(query)) return 4;
  if (id.includes(query)) return 3;
  const text = `${operation.title} ${operation.description}`.toLowerCase();
  if (!text.includes(query)) return 0;
  return text.split(/[^\p{L}\p{N}_]+/u).includes(query) ? 2 : 1;
}
