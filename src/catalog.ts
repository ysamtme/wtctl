import { operations, operationDefinition, operationSearchRank } from "./operations.js";
import { HcmError, boundedInteger } from "./errors.js";
import { operationOrder, operationTopic, requireTopic, overviewMatches } from "./operation-map.js";
import type { OperationDefinition, OperationFilter, OperationPage } from "./contracts.js";

/** Только упакованные метаданные операций: без подключения, учётных данных и проверки сервера. */
export function listHcmOperations(filter: OperationFilter = {}): OperationPage {
  const asked = filter.query?.toLowerCase().trim();
  // Запрос целиком read, write или execute выбирает операции с таким эффектом.
  const effect =
    filter.effect ??
    (["read", "write", "execute", "unknown"] as const).find((name) => name === asked);
  const query = effect && effect === asked ? undefined : asked;
  const topic = filter.topic === undefined ? undefined : requireTopic(filter.topic);
  const selected = operations.filter(
    (operation) =>
      (!topic || operationTopic(operation.id) === topic) &&
      (!filter.group || operation.group === filter.group) &&
      (!effect || operation.effect === effect) &&
      (!query || operationSearchRank(operation, query) > 0 || overviewMatches(operation.id, query)),
  );
  if (topic && !query)
    selected.sort((left, right) => operationOrder(left.id) - operationOrder(right.id));
  if (query)
    selected.sort(
      (left, right) => operationSearchRank(right, query) - operationSearchRank(left, query),
    );
  const start = boundedInteger(filter.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor");
  const limit = boundedInteger(filter.limit, 30, 1000, "limit");
  if (limit === 0)
    throw new HcmError("INVALID_ARGUMENT", "limit: нужно целое число от 1 до 1000.", undefined, {
      path: "limit",
    });
  return {
    operations: selected.slice(start, start + limit),
    total: selected.length,
    ...(start + limit < selected.length ? { nextCursor: start + limit } : {}),
  };
}

/** Точное описание одной операции; без подключения и проверки сервера. */
export function describeHcmOperation(id: string): OperationDefinition {
  if (typeof id !== "string" || id.length > 128 || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(id))
    throw new HcmError(
      "INVALID_OPERATION_ID",
      "ID операции записан неверно: допустимы латинские буквы, цифры, точка и _, первой идёт буква, не больше 128 знаков.",
    );
  const operation = operationDefinition(id);
  if (!operation) {
    // Имя сравнивается по последней части: loadDocs рядом с loadDoc, query — с xQuery.
    const asked = id.split(".").at(-1)!.toLowerCase();
    const near = operations
      .map((item) => item.id)
      .filter((known) => {
        const last = known.split(".").at(-1)!.toLowerCase();
        return last.includes(asked) || asked.includes(last);
      })
      .slice(0, 5);
    throw new HcmError(
      "UNKNOWN_OPERATION",
      `Операции ${id} нет.`,
      `${near.length ? `Похожие: ${near.join(", ")}. ` : ""}Список операций показывает api.list.`,
      { operationId: id },
    );
  }
  return operation;
}
