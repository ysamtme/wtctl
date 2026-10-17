import { HcmError, boundedInteger, inputObject, requiredString } from "../errors.js";
import { fields, object, operation, schema, string, type EffectFor } from "../operation.js";
import { WsHcmApiError } from "../protocol/error.js";
import {
  catalogQuery,
  hasStructure,
  looksLikeDate,
  looksLikeDecimalId,
  looksLikeHexId,
  orderFields,
  projectFields,
  queryPage,
  rowTag,
  withoutFalseOffset,
  xqueryNames,
} from "../query.js";
import { withRepeated, type SchemaReader } from "../schema.js";

/** Запрос с query или со ссылкой $ref выполняет код на сервере; запрос по каталогу читает. */
const queryEffect: EffectFor = (args) => {
  const deferredArguments = Object.keys(args).length === 1 && typeof args.$ref === "string";
  return deferredArguments || args.query !== undefined ? "execute" : "read";
};

/**
 * Типы полей каталога, которые читаются, только когда условие содержит значение, записанное
 * как дата или как ID: такое значение должно дойти до поля даты как date('…'), до целого поля —
 * как число, а до строкового — строкой, и отличить их может только форма.
 */
async function fieldTypes(
  schemaReader: SchemaReader,
  catalog: unknown,
  where: unknown,
): Promise<ReadonlyMap<string, string> | undefined> {
  if (typeof catalog !== "string" || !where || typeof where !== "object") return undefined;
  const values = Object.values(where).flatMap((condition) =>
    condition && typeof condition === "object" ? Object.values(condition).flat() : [condition],
  );
  if (
    !values.some(
      (value) => looksLikeDate(value) || looksLikeDecimalId(value) || looksLikeHexId(value),
    )
  )
    return undefined;
  const shape = await schemaReader.catalogShape({ catalog }).catch(() => undefined);
  return shape?.types.size ? shape.types : undefined;
}

export const queryOperations = [
  operation({
    id: "runtime.query",
    effect: "unknown",
    effectFor: queryEffect,
    description:
      "Поиск в каталоге: {catalog, where, fields, order}, условия соединяются через «и»; order — поле или список полей каталога, по убыванию — «поле desc». Или запрос XQuery целиком: {query}; он требует права execute и заканчивается на return $elem. Ответ: items, total; nextStartPosition есть, пока строки не кончились. Запрос, который возвращает отдельные значения, выполняет native.lds.xQuery.",
    inputSchema: schema({
      query: string,
      catalog: string,
      where: object,
      order: { anyOf: [string, { type: "array", items: string }] },
      fields,
      limit: { type: "integer", minimum: 1, maximum: 1000 },
      startPosition: { type: "integer", minimum: 0, maximum: 1000000 },
    }),
    usualCause: "нет такого каталога или поля, ошибка в запросе XQuery",
    run: async (context, args, call) => {
      if (args.query !== undefined && args.catalog !== undefined)
        throw new HcmError("QUERY_ARGUMENT", "Нужно указать query или catalog, но не оба.");
      if (args.query !== undefined && args.order !== undefined)
        throw new HcmError(
          "QUERY_ARGUMENT",
          "order работает с catalog.",
          "В тексте XQuery сортировку пишут сами: order by $e/поле.",
        );
      if (typeof args.catalog === "string" && /^[A-Za-z_]\w*\.[\w.]+$/.test(args.catalog))
        throw new HcmError(
          "UNKNOWN_CATALOG",
          `${args.catalog} — общий список сервера, а не каталог.`,
          `Его элементы читает запрос XQuery: for $e in ${args.catalog} return $e.`,
        );
      const query =
        args.query === undefined
          ? catalogQuery(
              args.catalog,
              args.where,
              args.order,
              await fieldTypes(context.schema, args.catalog, args.where),
            )
          : requiredString(args.query, "query");
      if (args.query === undefined && args.order !== undefined) {
        // MS SQL не сортирует по многозначному полю, PostgreSQL сортирует как получится.
        const shape = await context.schema
          .catalogShape({ catalog: requiredString(args.catalog, "catalog") })
          .catch(() => undefined);
        const repeated = orderFields(args.order)
          .map((item) => item.field)
          .filter((field) => shape?.repeated.has(field));
        if (repeated.length)
          throw new HcmError(
            "INVALID_ARGUMENT",
            `order: поле хранит несколько значений, сортировать по нему нельзя: ${repeated.join(", ")}.`,
            "Нужно выбрать поле с одним значением: у такого в schema.get нет multiple:true.",
            { fields: repeated },
          );
      }
      const limit = boundedInteger(args.limit, 20, 1000, "limit");
      if (limit === 0)
        throw new HcmError("INVALID_ARGUMENT", "limit: нужно целое число от 1 до 1000.");
      const startPos = boundedInteger(args.startPosition, 0, 1000000, "startPosition");
      // Запрос только читает, кроме того, что передаёт базе текст SQL.
      const sql = args.query !== undefined && /^\s*sql\s*:/i.test(query);
      if (args.query !== undefined && !sql) call.effect = "read";
      let response: unknown;
      try {
        const request = {
          query,
          startPos,
          maxCount: limit,
          expectToReadAll: false,
          keepCursor: false,
        };
        response = await (sql
          ? context.server.call("native.lds.xQuery", request, call.outcome)
          : context.server.read("native.lds.xQuery", request));
      } catch (error) {
        const refused = error instanceof WsHcmApiError && error.kind === "soap-fault";
        let reason: HcmError | undefined;
        // Отказ есть в логе сервера, как бы он тут ни назывался: чтение лога его дожидается.
        if (refused) context.logs.serverWroteLog();
        if (refused)
          for (const [catalog, fields] of args.query === undefined
            ? [
                [
                  requiredString(args.catalog, "catalog"),
                  [
                    ...Object.keys(inputObject(args.where ?? {}, "where")),
                    ...orderFields(args.order).map((item) => item.field),
                  ],
                ] as const,
              ]
            : xqueryNames(query)) {
            reason = await context.schema.explainQuery(catalog, fields).catch(() => undefined);
            if (reason) break;
          }
        throw reason ?? error;
      }
      const read = queryPage(response, startPos, limit, args.fields, args.query !== undefined);
      const page = { ...read, items: read.items.map(withoutFalseOffset) as typeof read.items };
      // Пустая таблица базы пропускает неверное имя каталога: ответ пуст, а не отклонён.
      if (!page.items.length && args.query === undefined) {
        const missing = await context.schema
          .explainQuery(requiredString(args.catalog, "catalog"), [])
          .catch(() => undefined);
        if (missing) throw missing;
      }
      const requested = Array.isArray(args.fields) ? (args.fields as string[]) : [];
      // Запрошено и нет ни в одной строке: пусто в этих строках либо не поле каталога.
      // На пустой странице поиска по каталогу каждое запрошенное имя сверяется с каталогом.
      const absent = page.items.length
        ? requested.filter((field) => page.items.every((item) => !Object.hasOwn(item, field)))
        : args.query === undefined
          ? requested
          : [];
      const lacking = page.items.some((item) =>
        requested.some((field) => !Object.hasOwn(item, field)),
      );
      if (!absent.length && !lacking && !page.items.some(hasStructure)) return page;
      const shape = await context.schema
        .catalogShape(
          args.query === undefined
            ? { catalog: requiredString(args.catalog, "catalog") }
            : { type: rowTag(response) ?? "" },
        )
        .catch(() => undefined);
      if (!shape) return page;
      const unknownFields = shape.fields.size
        ? absent.filter((field) => !shape.fields.has(field))
        : [];
      // Сервер опускает пустое поле строки. Поле, запрошенное по имени, возвращается всё равно,
      // пустым: так у строки те же столбцы, что у следующей.
      // Поле со структурой остаётся таким, как его дал сервер.
      const asked = requested.filter(
        (field) =>
          shape.fields.has(field) &&
          ![...shape.repeated].some((path) => path.startsWith(`${field}.`)),
      );
      return {
        ...page,
        items: page.items.map((item) => {
          const row = withRepeated(item, shape.repeated) as Record<string, unknown>;
          for (const field of asked)
            if (!Object.hasOwn(row, field)) row[field] = shape.repeated.has(field) ? [] : "";
          // Дописанное поле встаёт на своё место: столбцы идут в порядке fields.
          return projectFields(row, args.fields);
        }),
        ...(unknownFields.length
          ? {
              unknownFields,
              hint: [
                page.hint,
                "Полей из unknownFields нет в строке каталога. Поле документа читает objects.get.",
              ]
                .filter(Boolean)
                .join(" "),
            }
          : {}),
      };
    },
  }),
] as const;
