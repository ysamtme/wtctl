import { operations } from "./operations.js";
import { HcmError } from "./errors.js";

interface Topic {
  readonly id: string;
  readonly title: string;
  /** Operation ID to a one-line summary; listed IDs appear in the overview. */
  readonly operations: Readonly<Record<string, string>>;
  /** Further members selected by ID prefix; shown in the overview only as a count. */
  readonly prefixes?: readonly string[];
}

const PROTOCOL = "protocol";
const TOPICS: readonly Topic[] = [
  {
    id: "functions",
    title: "Функции библиотек сервера: найти, посмотреть параметры и код, вызвать",
    operations: {
      "rpc.list":
        "Найти функции, разрешённые для вызова с клиента: query, library, method; all:true — вместе с функциями только для кода на сервере.",
      "rpc.describe":
        "Параметры функции по targetId «библиотека.функция»; source:true добавляет код. Знает и функции, которые вызываются только из кода на сервере.",
      "rpc.call":
        "Вызвать функцию: {library, method, arguments:[…]}; async:true запускает фоновой задачей.",
    },
  },
  {
    id: "tasks",
    title: "Фоновые задачи: запустить, узнать состояние, остановить",
    operations: {
      "web.spxml.callMethodAsync":
        "Запустить функцию библиотеки фоновой задачей; ответ содержит TrackingID.",
      "web.spxml.getAsyncMethodStatus":
        "Состояние задачи по TrackingID. Итог выдаётся один раз: его нужно сохранить и больше не опрашивать.",
      "web.spxml.getBackgroundTasksByName": "Найти задачи по имени библиотеки и функции.",
      "web.spxml.killAsyncMethod": "Попросить сервер остановить задачу.",
    },
  },
  {
    id: "agents",
    title: "Агенты сервера: запустить и дождаться конца",
    operations: {
      "agents.run":
        "Запустить агента по ID и дождаться конца: {id}; objectId и objectIds — объекты, над которыми он работает.",
    },
  },
  {
    id: "files",
    title:
      "Файлы сервера по адресу x-local://…: проверить, прочитать, записать, удалить, загрузить",
    operations: {
      "files.exists": "Есть ли файл или папка по адресу.",
      "files.read":
        'Прочитать файл: текст, если это текст в UTF-8, иначе base64; encoding:"base64" — всегда base64.',
      "native.lds.loadUrl": "Прочитать файл как есть (base64), с блокировкой или сжатием.",
      "native.lds.putUrl": "Записать файл по адресу.",
      "native.lds.deleteUrl": "Удалить файл по адресу.",
      "native.lds.unlockUrl": "Снять свою блокировку с адреса.",
      "web.pages.copyUrl": "Скопировать файл с одного адреса на другой.",
      "web.pages.uploadFile":
        "Загрузить файл до 8 МБ в папку загрузок сервера; ответ содержит его адрес.",
      "web.pages.uploadChunk": "Загрузить одну часть большого файла.",
      "web.pages.clearUploadChunks": "Удалить загруженные части файла.",
    },
  },
  {
    id: "documents",
    title: "Документ объекта как XML: заготовка, чтение, сохранение, удаление, большие поля",
    operations: {
      "native.lds.loadDoc": "Прочитать документ по адресу; приходит разобранным в JSON.",
      "native.lds.putDoc": "Сохранить документ по адресу из текста XML.",
      "native.lds.deleteDoc": "Удалить документ по адресу.",
      "native.lds.createDoc": "Заготовка нового документа типа без сохранения.",
      "native.lds.getNewObjectId": "Получить новый ID объекта.",
      "native.physicalDocuments.createFromXml":
        "Создать документ из готового XML; новый ID подставляется вместо {{objectId}}.",
      "native.lds.loadLargeField": "Прочитать большое поле объекта (файл, длинный текст).",
      "native.lds.putLargeField": "Записать большое поле объекта.",
      "native.lds.deleteLargeField": "Удалить большое поле объекта.",
    },
  },
  {
    id: "changes",
    title: "Учёт изменений самим сервером: на 2025.1–2025.2 отвечает пусто, см. описания операций",
    operations: {
      "native.lds.getModObjects":
        "Объекты, изменённые после даты minModDate; на 2025.1–2025.2 ответ пуст и при изменениях.",
      "native.lds.getModDeletedObjects":
        "Объекты, удалённые после даты; на 2025.1–2025.2 отвечает отказом.",
      "native.lds.getCatalogsStat":
        "Число записей по каталогам из кэша сервера; пустой ответ не значит, что записей нет.",
    },
  },
  {
    id: "server",
    title: "Сведения о сервере и проверка служб",
    operations: {
      "server.info": "Версия, операционная система и ограничения сервера.",
      "native.spxml2.getAppInfo":
        "Каталоги, типы объектов, общие документы и настройки приложения.",
      "anonymous.diagnostics.portal": "Отвечает ли портал.",
      "anonymous.diagnostics.xhttpInfo": "Служебная страница /xhttp_info.",
      "web.websocket.heartbeat": "Отвечает ли служба WebSocket.",
    },
  },
  {
    id: "forms",
    title: "Формы, тексты интерфейса и картинки",
    operations: {
      "native.spxml2.getForm": "Текст формы (.xmd, .xms) по адресу.",
      "web.pages.getScreenForm": "Текст экранной формы по адресу.",
      "web.pages.getUiText": "Тексты интерфейса.",
      "native.resources.getImage": "Картинка ресурса по ID.",
      "native.resources.getCompoundResource": "Вложение составного документа.",
    },
  },
  {
    id: "basic",
    title:
      "Основные операции. У каждой есть своя команда и свой инструмент; по ID они нужны в runtime.batch — несколько операций одним вызовом",
    operations: {},
    prefixes: ["runtime.", "objects.", "schema.", "logs.", "results.", "execute."],
  },
  {
    id: PROTOCOL,
    title:
      "Прямые вызовы протокола: те же действия через веб-профиль и старый протокол, сессии, сырые запросы. Обычно не нужны",
    operations: {},
  },
];

/** What the one-line summary leaves out. Shown by describe, written in the caller's terms. */
const NOTES: Readonly<Record<string, string>> = {
  "agents.run":
    "Вызов ждёт, пока код агента не кончится, и ограничен временем ожидания подключения (timeoutMs): долгого агента нужно запускать без ожидания — rpc.call {library:'tools', method:'start_agent', arguments:[id]} — и следить за логом agent. Параметры агента берутся из его документа. Агенты на C# и агенты выгрузки и импорта не проверялись.",
  "native.spxml2.getAppInfo":
    "Ответ большой и сохраняется целиком. Каталоги — databases[i].catalogs: {id, form_url, object_type}; основная база названа в default_db_name. Типы и их каталоги короче показывает schema.types.",
  "native.lds.loadUrl":
    "Ответ: Data — содержимое в base64 одной строкой. Текстом файл отдаёт files.read.",
  "native.lds.putUrl":
    'data — текст файла строкой или {base64:"…"} для двоичных данных. Файл заменяется целиком.',
  "native.lds.deleteUrl":
    "Так же удаляется пустая папка. strictDelete:true требует, чтобы адрес существовал.",
  "web.pages.copyUrl":
    "Оба адреса — x-local://…. Учётной записи нужны чтение источника и запись в место назначения.",
  "web.pages.uploadFile":
    'filename — имя без пути; data — текст или {base64:"…"}. Ответ: url — адрес файла, folderUrl — папка, которую сервер создал для него.',
  "web.pages.uploadChunk":
    "fileId — 32 шестнадцатеричных знака, его выбирает вызывающий. Части идут по порядку, последняя собирает файл. Ответ сервера не доказывает, что часть сохранена. При ошибке на последней части вслепую повторять нельзя: адрес итогового файла может остаться неизвестным.",
  "web.pages.clearUploadChunks":
    "Удаляет части с 0 по chunksTotal − 1 для заданного fileId. Сервер не проверяет, кто создал этот ID; пустой ответ не доказывает, что части удалены.",
  "native.lds.loadDoc":
    "Документ приходит разобранным: data.Data.<тип объекта>. Повторяемый элемент из одного элемента здесь объект, а не список. Даты записаны как на сервере, со смещением +00:00: это местное время сервера. Текст XML того же документа отдаёт files.read по тому же адресу.",
  "native.lds.putDoc":
    "data — текст XML всего документа; он заменяет документ целиком. writeDocInfo:true — сервер обновляет дату и автора изменения; без него они остаются как в тексте, и поиск по modification_date правку не видит. neverSaved:true — документ записывается впервые (так пишет новый объект objects.create). skipActions:true отключает обработку, которую сервер выполняет перед сохранением. Чужую правку операция не замечает: fingerprint из objects.get нужно сверять до записи самому.",
  "native.lds.deleteDoc": "strictDelete:true требует, чтобы документ существовал.",
  "native.lds.createDoc":
    "Сервер отдаёт заготовку не для каждого типа объекта: на остальные отвечает HTTP 500, в логе xhttp — Unregistered object type.",
  "native.lds.getNewObjectId":
    "ObjectID — новый ID десятичной записью; остальные операции принимают его и так, и в записи 0x….",
  "native.physicalDocuments.createFromXml":
    "documentXmlTemplate — текст XML документа с {{objectId}} на месте ID. После записи документ перечитывается, и его ID сверяется. Обработчики, которые админка выполняет при создании, не запускаются.",
  "native.lds.loadLargeField":
    "docUrl — адрес документа вида x-db-obj://…; из адреса x-local его не составляют.",
  "native.lds.putLargeField":
    "docUrl — адрес документа вида x-db-obj://…; из адреса x-local его не составляют.",
  "native.lds.deleteLargeField":
    "docUrl — адрес документа вида x-db-obj://…; из адреса x-local его не составляют.",
  "native.lds.getModObjects":
    "На проверенных серверах ответ пуст и при свежих изменениях. Изменённые объекты находит runtime.query по modification_date в нужном каталоге. compress передавать нельзя: сжатый ответ клиент не разбирает.",
  "native.lds.getModDeletedObjects":
    "Работает не на каждом сервере: отказ HTTP 500 значит, что этот сервер списка удалённых не даёт, лог причины не покажет. compress передавать нельзя.",
  "native.lds.getCatalogsStat":
    "Числа — из кэша сервера, а не свежий подсчёт. Каталога в ответе может не быть; пустой ответ тоже возможен.",
  "web.spxml.callMethodAsync":
    "target — «библиотека.функция». Удобнее rpc.call с async:true: он принимает обычные значения аргументов.",
  "web.spxml.getBackgroundTasksByName":
    "В списке бывают задачи других пользователей: совпадение имени не значит, что задача своя. Недавно завершённые задачи остаются в списке вместе с итогом.",
  "web.spxml.getAsyncMethodStatus":
    "trackingId — как в ответе запуска: 0x… или десятичный. Пока задача идёт, IsRunning «1»; у завершённой IsRunning «0» и value — её результат, как у обычного rpc.call. После такого ответа сервер запись о задаче удаляет: второй раз результат не получить. Опрашивать не чаще четырёх раз в секунду.",
  "web.spxml.killAsyncMethod":
    "Уже сделанные изменения не откатываются. Остановка завершённой задачи не гарантирована.",
  "anonymous.diagnostics.xhttpInfo": "Ответ — страница HTML со сведениями о сборке сервера.",
  "web.websocket.heartbeat":
    "Одна проверка: соединение, служебное сообщение, ответ. heartbeatObserved:true — служба ответила.",
  "native.resources.getCompoundResource":
    "Источник — url (адрес HTML-файла, x-local или x-app) либо docUrl и elemPath (строковое поле документа). elemPath начинается с имени корневого элемента документа: presence_state.name.",
};

const topicOfOperation = new Map<string, Topic>();
for (const operation of operations) {
  const topic =
    TOPICS.find((item) => Object.hasOwn(item.operations, operation.id)) ??
    TOPICS.find((item) => item.prefixes?.some((prefix) => operation.id.startsWith(prefix))) ??
    TOPICS.find((item) => item.id === PROTOCOL)!;
  topicOfOperation.set(operation.id, topic);
}
for (const topic of TOPICS)
  for (const id of Object.keys(topic.operations))
    if (topicOfOperation.get(id) !== topic) throw new Error(`Unknown operation in topic: ${id}`);

export interface OperationMap {
  readonly topics: readonly {
    readonly topic: string;
    readonly title: string;
    readonly operations?: readonly string[];
    readonly count?: number;
  }[];
  readonly total: number;
  /** How many operations read, write and run code; an effect is the most an operation may do. */
  readonly effects: Readonly<Record<string, number>>;
  readonly hint: string;
}

/** A fixed overview by task; the entry point when the caller does not know what to look for. */
export function operationMap(): OperationMap {
  return {
    topics: TOPICS.map((topic) => {
      const listed = Object.keys(topic.operations);
      return listed.length
        ? { topic: topic.id, title: topic.title, operations: listed }
        : {
            topic: topic.id,
            title: topic.title,
            count: operations.filter((item) => topicOfOperation.get(item.id) === topic).length,
          };
    }),
    total: operations.length,
    effects: Object.fromEntries(
      ["read", "write", "execute", "unknown"]
        .map((effect) => [effect, operations.filter((item) => item.effect === effect).length])
        .filter(([, count]) => count),
    ),
    hint: 'Операции темы с описаниями: список с topic; операции одного эффекта: query "read", "write", "execute" или "unknown". Эффект — право, которого операция требует: write может менять данные, но не обязана; unknown — зависит от аргументов (запрос, пакет, сырой вызов). Аргументы одной операции: describe по её id.',
  };
}

export function operationTopic(id: string): string {
  return topicOfOperation.get(id)?.id ?? PROTOCOL;
}

/** Position within the topic as the overview lists it; unlisted operations keep registry order. */
export function operationOrder(id: string): number {
  const position = Object.keys(topicOfOperation.get(id)?.operations ?? {}).indexOf(id);
  return position < 0 ? Number.MAX_SAFE_INTEGER : position;
}

export function operationSummary(id: string): string | undefined {
  return topicOfOperation.get(id)?.operations[id];
}

export function operationNotes(id: string): string | undefined {
  return NOTES[id];
}

export function requireTopic(id: string): string {
  if (TOPICS.some((topic) => topic.id === id)) return id;
  throw new HcmError(
    "UNKNOWN_TOPIC",
    "Такой темы нет.",
    `Темы: ${TOPICS.map((topic) => topic.id).join(", ")}.`,
  );
}

/** A query also matches the task wording of the overview, not only English identifiers. */
export function overviewMatches(id: string, query: string): boolean {
  const topic = topicOfOperation.get(id);
  return `${topic?.title} ${topic?.operations[id] ?? ""}`.toLowerCase().includes(query);
}
