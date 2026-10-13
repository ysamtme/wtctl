import { getNativeOperations } from "./native/index.js";
import { freezeRegistry } from "./immutable.js";
import { FILE_EXISTS_URL_MAX_LENGTH } from "./files.js";
import type { OperationDefinition, OperationEffect } from "./contracts.js";

const string = { type: "string" };
const integer = { type: "integer", minimum: 0 };
const boolean = { type: "boolean" };
const object = { type: "object" };
const fields = { type: "array", items: string };
function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}
function definition(
  id: string,
  effect: OperationEffect,
  description: string,
  inputSchema: Record<string, unknown>,
): OperationDefinition {
  return {
    id,
    group: id.split(".")[0]!,
    title: id,
    description,
    effect,
    status: "implemented",
    inputSchema,
  };
}
const address = { id: string, type: string, url: string, fields };
const schemaPage = { search: string, limit: { type: "integer", minimum: 1 }, cursor: integer };
const logWindow = { file: string, full: boolean, tailBytes: integer };
const composite: readonly OperationDefinition[] = [
  definition(
    "files.exists",
    "read",
    "Есть ли файл или папка по адресу x-local://…. Ответ ничего не говорит о содержимом, размере и правах на чтение. Адрес — до 256 знаков.",
    schema(
      {
        url: {
          type: "string",
          minLength: 1,
          maxLength: FILE_EXISTS_URL_MAX_LENGTH,
          pattern: "^x-local://",
        },
      },
      ["url"],
    ),
  ),
  definition(
    "files.read",
    "read",
    'Прочитать файл по адресу сервера: text, если содержимое — текст в UTF-8, иначе base64. encoding:"base64" отдаёт base64 и для текста. Документы объектов читает objects.get.',
    schema({ url: string, encoding: { type: "string", enum: ["base64"] } }, ["url"]),
  ),
  definition(
    "files.list",
    "execute",
    "Один уровень папки x-local://папка или x-local://папка/путь: items — файлы с размером (bytes) и вложенные папки (folder:true), по имени. search оставляет имена с этой частью, регистр не важен. Список даёт код на сервере: нужно право execute.",
    schema({ url: string, search: string }, ["url"]),
  ),
  definition(
    "files.write",
    "write",
    "Записать файл по адресу x-local://…: text — текст (пишется в UTF-8), base64 — двоичные данные. Файл заменяется целиком, вложенные папки сервер создаёт сам. В папку кода (wt, wtv, custom…) файл записывает код на сервере: нужно ещё право execute. Какие папки принимают запись, показывает server.info.",
    schema({ url: string, text: string, base64: string }, ["url"]),
  ),
  definition(
    "files.delete",
    "write",
    "Удалить файл по адресу x-local://…. В папке данных так же удаляется пустая папка; в папке кода — только файл, и нужно ещё право execute.",
    schema({ url: string }, ["url"]),
  ),
  definition(
    "server.info",
    "read",
    "Сведения, которые сервер отдаёт админке при запуске: версия, операционная система, маска возможностей, ограничения на число записей по типам объектов; в профиле native ещё папки: dataFolders принимают запись через LDS, codeFolders — только кодом на сервере. Маска — не права пользователя, ограничения — не список каталогов. profile: native (по умолчанию) или web.",
    schema({ profile: { type: "string", enum: ["native", "web"] } }),
  ),
  definition(
    "runtime.status",
    "read",
    "Проверить связь: версия сервера и права подключения. Ничего не меняет.",
    schema({}),
  ),
  definition(
    "runtime.check",
    "read",
    "Проверить подключение по шагам: вход, версия, запрос, документ, схема, библиотеки, логи, портал; при праве execute — ещё код RESULT = [1 + 1]. Запись не проверяется.",
    schema({}),
  ),
  definition(
    "runtime.query",
    "unknown",
    "Поиск в каталоге: {catalog, where, fields, order}, условия соединяются через «и»; order — поле или список полей каталога, по убыванию — «поле desc». Или запрос XQuery целиком: {query}; он требует права execute и заканчивается на return $elem. Ответ: items, total; nextStartPosition есть, пока строки не кончились. Запрос, который возвращает отдельные значения, выполняет native.lds.xQuery.",
    schema({
      query: string,
      catalog: string,
      where: object,
      order: { anyOf: [string, { type: "array", items: string }] },
      fields,
      limit: { type: "integer", minimum: 1, maximum: 1000 },
      startPosition: { type: "integer", minimum: 0, maximum: 1000000 },
    }),
  ),
  definition(
    "objects.get",
    "read",
    "Прочитать документ объекта по id или url; несколько объектов — ids (до 100), ответ — items, у непрочитанного в элементе error. fields — поля верхнего уровня. Повторяющийся элемент приходит списком и при одном значении. unknownFields — запрошенные имена, которых у типа нет; пустое поле в ответ не попадает.",
    schema({ ...address, ids: { type: "array", items: string, minItems: 1, maxItems: 100 } }),
  ),
  definition(
    "objects.create",
    "write",
    "Создать объект типа type с полями data. ID выдаёт сервер; после записи объект перечитывается и сверяется с запросом. Обработчики, которые админка выполняет при создании, не запускаются.",
    schema({ type: string, data: object, dbName: string, formUrl: string }, ["type", "data"]),
  ),
  definition(
    "objects.patch",
    "write",
    "Изменить поля объекта, сохранив остальное содержимое документа. patch — {путь: значение} или список {op:'set'|'remove', path, value}; remove — пути, которые удалить. preview:true ничего не записывает. Правка, которая ничего не меняет, не записывается: в ответе noop:true; resave:true записывает документ и без правок — сервер при сохранении заново заполняет поля, которые берёт из связанных объектов. expectedFingerprint отклоняет запись, если объект изменился после чтения; это сверка перед записью, а не блокировка.",
    schema({
      ...address,
      patch: {},
      remove: { type: "array", items: string },
      expectedFingerprint: string,
      preview: boolean,
      resave: boolean,
    }),
  ),
  definition(
    "objects.delete",
    "write",
    "Удалить документ объекта безвозвратно; permanent:true обязателен. catalog — проверить, что объект был в этом каталоге и исчез из него.",
    schema({ ...address, permanent: boolean, catalog: string }),
  ),
  definition(
    "schema.get",
    "read",
    "Поля типа объекта: свои, унаследованные, настраиваемые и поля каталога, с заголовками на языке сервера. deep:true — вложенные поля любой глубины сразу, а не один уровень. Ответ постраничный.",
    schema({
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
  ),
  definition(
    "schema.types",
    "read",
    "Типы объектов сервера: тип, каталог, заголовок, число настраиваемых полей. Каталога у типа может не быть. catalogs — сколько на сервере каталогов всего, считая каталоги без своего типа объекта.",
    schema(schemaPage),
  ),
  definition(
    "logs.list",
    "read",
    "Логи сервера, сначала свежие. type — имя лога без даты (xhttp, agent…); nameContains, startDate и endDate отбирают по имени и дате сервера. По умолчанию 30 файлов.",
    schema({
      type: string,
      nameContains: string,
      startDate: string,
      endDate: string,
      offset: integer,
      limit: integer,
    }),
  ),
  definition(
    "logs.read",
    "read",
    "Текст лога: конец файла (tailBytes) или весь файл (full:true). Пока сервер пишет в файл, он может его не отдать: чтение повторяется один раз, затем ошибка LOG_READ_UNAVAILABLE.",
    schema(logWindow, ["file"]),
  ),
  definition(
    "logs.search",
    "read",
    "События лога по тексту, уровню или потоку в прочитанной части файла. Многострочное событие возвращается целиком. Уровень определяется по словам в тексте, время — местное время сервера. newestFirst:true отдаёт сначала последние события. cutBySize:true — событий на странице меньше limit, потому что больше не поместилось в ответ; дальше — nextOffset. expectedFingerprint из прошлого ответа защищает следующую страницу от изменившегося файла.",
    schema(
      {
        ...logWindow,
        text: string,
        level: {
          type: "string",
          enum: ["normal", "debug", "info", "warning", "error", "critical"],
        },
        context: string,
        offset: integer,
        limit: integer,
        newestFirst: boolean,
        expectedFingerprint: string,
      },
      ["file"],
    ),
  ),
  definition(
    "logs.follow",
    "read",
    "Новые события лога с прошлого вызова по cursor. Последнее событие может повториться; gapPossible:true — часть событий могла быть пропущена. После ошибки чтения использовать прежний cursor; другой файл начинать без cursor.",
    schema({ ...logWindow, cursor: string }, ["file"]),
  ),
  definition(
    "results.export",
    "read",
    "Сохранить большой результат целиком в файл на этом компьютере: json — как есть, jsonl — по строке на элемент списка ответа, text — текст лога или файла. Папка должна существовать.",
    schema({ resultId: string, path: string, format: string, overwrite: boolean }, [
      "resultId",
      "path",
    ]),
  ),
  definition(
    "results.read",
    "read",
    "Дочитать сохранённый результат по resultId: список — по элементам, текст лога или файла — по символам. format:json читает любой результат как текст JSON по частям.",
    schema(
      {
        resultId: string,
        offset: integer,
        limit: integer,
        format: { type: "string", enum: ["auto", "json", "text"] },
      },
      ["resultId"],
    ),
  ),
  definition(
    "rpc.call",
    "execute",
    "Вызвать функцию библиотеки сервера: {library, method, arguments:[…]}. Строки, целые, логические значения и null передаются как есть; дата, объект, XML и большое целое — как {valueType, lexicalValue}. async:true запускает фоновой задачей.",
    schema({ library: string, method: string, arguments: { type: "array" }, async: boolean }, [
      "library",
      "method",
    ]),
  ),
  definition(
    "rpc.list",
    "read",
    "Найти функции библиотек сервера: query, library, method. Без all — только те, что можно вызвать с клиента (rpc.call); all:true добавляет функции, которые вызываются только из кода на сервере (serverOnly:true). builtIn:true берёт встроенную таблицу сборки 2025.1.1171 без обращения к серверу. Список не говорит о типах аргументов и о том, меняет ли функция данные.",
    schema({
      query: { type: "string", maxLength: 512 },
      library: { type: "string", maxLength: 128, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
      method: { type: "string", maxLength: 128, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
      builtIn: boolean,
      all: boolean,
      cursor: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }),
  ),
  definition(
    "rpc.describe",
    "read",
    "Параметры функции по targetId «библиотека.функция»; source:true добавляет до 8 КБ её кода. serverOnly:true в ответе — функция вызывается только из кода на сервере. Сама функция не вызывается.",
    schema(
      {
        targetId: {
          type: "string",
          maxLength: 257,
          pattern: "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$",
        },
        builtIn: boolean,
        source: boolean,
      },
      ["targetId"],
    ),
  ),
  definition(
    "execute.script",
    "execute",
    "Выполнить код SP-XML Script на сервере. Код присваивает массив переменной RESULT; числа, даты и логические значения приходят строками. params — объект JSON, в коде это готовая переменная PARAMS. На сервер ничего не устанавливается. Код может менять данные, отката нет.",
    schema(
      {
        code: { type: "string", minLength: 1, maxLength: 1048576 },
        params: { type: "object" },
      },
      ["code"],
    ),
  ),
  definition(
    "agents.run",
    "execute",
    "Запустить агента сервера и дождаться конца его кода. Ответ: started, startedAt и finishedAt — местное время сервера. Ошибку в коде агента ответ не показывает: она в логе xhttp между этими отметками. Дата последнего запуска сохраняется в агенте, как при запуске из админки.",
    schema(
      {
        id: { type: "string", description: "ID агента (server_agent)." },
        objectId: { type: "string", description: "ID объекта: в коде агента это OBJECT_ID." },
        objectIds: {
          type: "array",
          items: string,
          maxItems: 1000,
          description: "ID нескольких объектов: в коде агента это OBJECTS_ID_STR, через «;».",
        },
      },
      ["id"],
    ),
  ),
  definition(
    "runtime.batch",
    "unknown",
    "Несколько операций одним вызовом: steps — список {id, args, as}. Значение из прошлого шага: {$ref:'имя.data.items.0.id'}, где имя — as того шага, дальше путь по его ответу. Класс вызова — по самому сильному шагу: все шаги читают — чтение, есть запись — запись, есть выполнение кода — выполнение. Права проверяются для каждого шага. Это не транзакция: выполненные шаги не откатываются; первый сбой останавливает остальные, если не задано stopOnError:false.",
    schema(
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
  ),
];
export const operations = freezeRegistry([...composite, ...getNativeOperations()]);
const byId = new Map(operations.map((operation) => [operation.id, operation]));
if (byId.size !== operations.length) throw new Error("Duplicate runtime operation ID");

export function operationDefinition(id: string): OperationDefinition | undefined {
  return byId.get(id);
}

/** Exact IDs and identifier parts precede incidental description substrings. */
export function operationSearchRank(operation: OperationDefinition, query: string): number {
  const id = operation.id.toLowerCase();
  if (id === query) return 5;
  if (id.split(".").includes(query)) return 4;
  if (id.includes(query)) return 3;
  const text = `${operation.title} ${operation.description}`.toLowerCase();
  if (!text.includes(query)) return 0;
  return text.split(/[^\p{L}\p{N}_]+/u).includes(query) ? 2 : 1;
}
