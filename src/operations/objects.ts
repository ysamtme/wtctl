import { HcmError, requiredString } from "../errors.js";
import {
  boolean,
  fields,
  object,
  operation,
  schema,
  string,
  type EffectFor,
} from "../operation.js";
import { validateDbName } from "../protocol/physical-documents.js";
import { identifier } from "../query.js";

const patchEffect: EffectFor = (args) => (args.preview === true ? "read" : undefined);
const dbName = { type: "string", description: "База сервера, если объект не в основной базе." };
const target = { id: string, type: string, url: string, dbName };

export const objectOperations = [
  operation({
    id: "objects.get",
    effect: "read",
    description:
      "Прочитать документ объекта по id или url; несколько объектов — ids (до 100), ответ — items, у непрочитанного в элементе error. fields — поля верхнего уровня. Повторяющийся элемент приходит списком и при одном значении. Из запрошенных полей: emptyFields — без значения (в data.data не попадают), fromCatalog — вычисляемые поля строки каталога, unknownFields — которых у типа нет.",
    inputSchema: schema({
      ...target,
      fields,
      ids: { type: "array", items: string, minItems: 1, maxItems: 100 },
    }),
    usualCause:
      "объекта с таким ID или адресом нет; ID строки каталога без своего типа объекта — не ID документа",
    run: async (context, args) => {
      if (args.ids === undefined) return context.objects.get(args);
      // Несколько объектов за вызов: каждый читается как одиночный, пропавший не мешает остальным.
      const ids = args.ids;
      if (args.id !== undefined || args.url !== undefined)
        throw new HcmError("INVALID_ARGUMENT", "ids: вместе с id или url не задаётся.");
      if (
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > 100 ||
        ids.some((id) => typeof id !== "string")
      )
        throw new HcmError("INVALID_ARGUMENT", "ids: список от 1 до 100 ID, каждый строкой.");
      // Общие аргументы проверяются один раз до цикла, иначе их ошибка маскировалась бы под отказ каждого ID.
      const checkedType = args.type === undefined ? undefined : identifier(args.type, "type");
      const checkedDb =
        args.dbName === undefined
          ? undefined
          : validateDbName(requiredString(args.dbName, "dbName"), "dbName");
      const items: unknown[] = [];
      let failed = 0;
      for (const id of ids as string[]) {
        try {
          items.push(
            await context.objects.get({
              ...(checkedType === undefined ? {} : { type: checkedType }),
              fields: args.fields,
              ...(checkedDb === undefined ? {} : { dbName: checkedDb }),
              id,
            }),
          );
        } catch (error) {
          const refusal = context.pipeline.failure("objects.get", error).error!;
          // Сервер, который не отвечает или отклоняет вход, — это не про один объект.
          if (/^PLATFORM_(?!SOAP-FAULT)/.test(refusal.code)) throw error;
          failed++;
          items.push({ id, error: { code: refusal.code, message: refusal.message } });
        }
      }
      return {
        items,
        total: items.length,
        ...(failed
          ? { failed, hint: "PLATFORM_SOAP-FAULT у элемента: обычно объекта с таким ID нет." }
          : {}),
      };
    },
  }),
  operation({
    id: "objects.create",
    effect: "write",
    description:
      "Создать объект типа type с полями data. ID выдаёт сервер; после записи объект перечитывается и сверяется с запросом. Обработчики, которые админка выполняет при создании, не запускаются.",
    inputSchema: schema({ type: string, data: object, dbName, formUrl: string }, ["type", "data"]),
    usualCause: "значение, которое тип объекта не принимает",
    run: (context, args, call) => context.objects.create(args, call.outcome),
  }),
  operation({
    id: "objects.patch",
    effect: "write",
    effectFor: patchEffect,
    description:
      "Изменить поля объекта, сохранив остальное содержимое документа. patch — {путь: значение} или список {op:'set'|'remove', path, value}; remove — пути, которые удалить; путь, которого в документе нет, — отказ, ничего не записано. preview:true ничего не записывает. Правка, которая ничего не меняет, не записывается: в ответе noop:true; resave:true записывает документ и без правок — сервер при сохранении заново заполняет поля, которые берёт из связанных объектов. expectedFingerprint отклоняет запись, если объект изменился после чтения; это сверка перед записью, а не блокировка.",
    inputSchema: schema({
      ...target,
      patch: {},
      remove: { type: "array", items: string },
      expectedFingerprint: string,
      preview: boolean,
      resave: boolean,
    }),
    usualCause: "объекта с таким ID или адресом нет",
    run: (context, args, call) => context.objects.patch(args, call.outcome),
  }),
  operation({
    id: "objects.delete",
    effect: "write",
    description:
      'Удалить документ объекта безвозвратно; permanent:true обязателен. Если у типа один каталог, клиент сам проверяет наличие и исчезновение в нём (иначе verification:"server"); catalog задаёт каталог явно.',
    inputSchema: schema({ ...target, permanent: boolean, catalog: string }),
    usualCause: "объекта с таким ID или адресом нет",
    run: (context, args, call) => context.objects.delete(args, call.outcome),
  }),
] as const;
