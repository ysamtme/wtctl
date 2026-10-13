import { requiredString } from "../errors.js";
import { boolean, integer, operation, schema, string } from "../operation.js";
import type { ResultExportInput } from "../results.js";

export const resultOperations = [
  operation({
    id: "results.export",
    effect: "read",
    description:
      "Сохранить большой результат целиком в файл на этом компьютере: json — как есть, jsonl — по строке на элемент списка ответа, text — текст лога или файла. Папка должна существовать.",
    inputSchema: schema({ resultId: string, path: string, format: string, overwrite: boolean }, [
      "resultId",
      "path",
    ]),
    run: (context, args) => context.results.export(args as unknown as ResultExportInput),
  }),
  operation({
    id: "results.read",
    effect: "read",
    description:
      "Дочитать сохранённый результат по resultId: список — по элементам, текст лога или файла — по символам. format:json читает любой результат как текст JSON по частям.",
    inputSchema: schema(
      {
        resultId: string,
        offset: integer,
        limit: integer,
        format: { type: "string", enum: ["auto", "json", "text"] },
      },
      ["resultId"],
    ),
    reply: { store: "never" },
    run: (context, args) =>
      context.results.read(
        requiredString(args.resultId, "resultId"),
        args.offset,
        args.limit,
        args.format,
      ),
  }),
] as const;
