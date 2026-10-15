import { integer, boolean, operation, schema, string } from "../operation.js";
import type { SchemaInput, SchemaTypesInput } from "../schema.js";

const schemaPage = { search: string, limit: { type: "integer", minimum: 1 }, cursor: integer };

export const schemaOperations = [
  operation({
    id: "schema.get",
    effect: "read",
    description:
      "Поля типа объекта: свои, унаследованные, настраиваемые и поля каталога, с заголовками на языке сервера. deep:true — вложенные поля любой глубины сразу, а не один уровень. Ответ постраничный.",
    inputSchema: schema({
      ...schemaPage,
      type: string,
      url: string,
      path: string,
      deep: boolean,
      origin: {
        type: "array",
        items: { type: "string", enum: ["own", "inherited", "custom", "catalog"] },
      },
      kind: string,
      include: { type: "array", items: { type: "string", enum: ["methods"] } },
      language: string,
    }),
    usualCause: "формы по этому адресу нет",
    run: (context, args) => context.schema.get(args as SchemaInput),
  }),
  operation({
    id: "schema.types",
    effect: "read",
    description:
      "Типы объектов сервера: тип, каталог, заголовок, число настраиваемых полей. Каталога у типа может не быть. За типами — каталоги без своего типа объекта: строка без type, документов у их строк нет.",
    inputSchema: schema(schemaPage),
    run: (context, args) => context.schema.types(args as SchemaTypesInput),
  }),
] as const;
