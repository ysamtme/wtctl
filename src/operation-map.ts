import { operations, operationSpec } from "./operations.js";
import { HcmError } from "./errors.js";

interface Topic {
  readonly id: string;
  readonly title: string;
  /** ID операций в порядке обзора; краткое описание каждой — поле её определения. */
  readonly operations: readonly string[];
  /** Остальные операции темы, выбираемые по префиксу ID; в обзоре показаны только числом. */
  readonly prefixes?: readonly string[];
}

const PROTOCOL = "protocol";
const TOPICS: readonly Topic[] = [
  {
    id: "functions",
    title: "Функции библиотек сервера: найти, посмотреть параметры и код, вызвать",
    operations: ["rpc.list", "rpc.describe", "rpc.call"],
  },
  {
    id: "tasks",
    title: "Фоновые задачи: запустить, узнать состояние, остановить",
    operations: [
      "web.spxml.callMethodAsync",
      "web.spxml.getAsyncMethodStatus",
      "web.spxml.getBackgroundTasksByName",
      "web.spxml.killAsyncMethod",
    ],
  },
  {
    id: "agents",
    title: "Агенты сервера: запустить и дождаться конца",
    operations: ["agents.run"],
  },
  {
    id: "files",
    title:
      "Файлы сервера по адресу x-local://…: проверить, прочитать, показать папку, записать, удалить, загрузить",
    operations: [
      "files.exists",
      "files.read",
      "files.list",
      "files.write",
      "files.delete",
      "web.pages.uploadFile",
      "web.pages.uploadChunk",
      "web.pages.clearUploadChunks",
    ],
  },
  {
    id: "documents",
    title: "Документ объекта как XML: чтение, сохранение, удаление",
    operations: [
      "native.lds.loadDoc",
      "native.lds.putDoc",
      "native.lds.deleteDoc",
      "native.lds.getNewObjectId",
      "native.physicalDocuments.createFromXml",
    ],
  },
  {
    id: "changes",
    title: "Учёт изменений самим сервером: на 2025.1–2025.2 отвечает пусто, см. описания операций",
    operations: ["native.lds.getModObjects", "native.lds.getCatalogsStat"],
  },
  {
    id: "server",
    title: "Сведения о сервере и проверка служб",
    operations: [
      "server.info",
      "native.spxml2.getAppInfo",
      "anonymous.diagnostics.portal",
      "anonymous.diagnostics.xhttpInfo",
      "web.websocket.heartbeat",
    ],
  },
  {
    id: "forms",
    title: "Формы, тексты интерфейса и картинки",
    operations: [
      "native.spxml2.getForm",
      "web.pages.getScreenForm",
      "web.pages.getUiText",
      "native.resources.getImage",
      "native.resources.getCompoundResource",
    ],
  },
  {
    id: "basic",
    title:
      "Основные операции. У каждой есть своя команда и свой инструмент; по ID они нужны в runtime.batch — несколько операций одним вызовом",
    operations: [],
    prefixes: ["runtime.", "objects.", "schema.", "logs.", "results.", "execute."],
  },
  {
    id: PROTOCOL,
    title:
      "Прямые вызовы протокола: те же действия через веб-профиль, сессии, сырые запросы. Обычно не нужны",
    operations: [],
  },
];

const topicOfOperation = new Map<string, Topic>();
for (const operation of operations) {
  const topic =
    TOPICS.find((item) => item.operations.includes(operation.id)) ??
    TOPICS.find((item) => item.prefixes?.some((prefix) => operation.id.startsWith(prefix))) ??
    TOPICS.find((item) => item.id === PROTOCOL)!;
  topicOfOperation.set(operation.id, topic);
  const listed = topic.operations.includes(operation.id);
  if (listed !== Boolean(operationSpec(operation.id)?.summary))
    throw new Error(
      `${listed ? "Операция темы без summary" : "Операция с summary не названа в теме"}: ${operation.id}`,
    );
}
for (const topic of TOPICS)
  for (const id of topic.operations)
    if (topicOfOperation.get(id) !== topic) throw new Error(`Неизвестная операция в теме: ${id}`);

export interface OperationMap {
  readonly topics: readonly {
    readonly topic: string;
    readonly title: string;
    readonly operations?: readonly string[];
    readonly count?: number;
  }[];
  readonly total: number;
  /** Сколько операций читают, пишут и выполняют код; эффект — самое большее, что операция может. */
  readonly effects: Readonly<Record<string, number>>;
  readonly hint: string;
}

/** Фиксированный обзор по задачам; точка входа, когда вызывающий не знает, что искать. */
export function operationMap(): OperationMap {
  return {
    topics: TOPICS.map((topic) => ({
      topic: topic.id,
      title: topic.title,
      ...(topic.operations.length
        ? { operations: [...topic.operations] }
        : { count: operations.filter((item) => topicOfOperation.get(item.id) === topic).length }),
    })),
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

/** Положение в теме в порядке обзора; неперечисленные операции идут в порядке реестра. */
export function operationOrder(id: string): number {
  const position = (topicOfOperation.get(id)?.operations ?? []).indexOf(id);
  return position < 0 ? Number.MAX_SAFE_INTEGER : position;
}

export function operationSummary(id: string): string | undefined {
  return operationSpec(id)?.summary;
}

export function operationNotes(id: string): string | undefined {
  return operationSpec(id)?.details;
}

export function requireTopic(id: string): string {
  if (TOPICS.some((topic) => topic.id === id)) return id;
  throw new HcmError(
    "UNKNOWN_TOPIC",
    "Такой темы нет.",
    `Темы: ${TOPICS.map((topic) => topic.id).join(", ")}.`,
  );
}

/** Запрос совпадает и с формулировками задач в обзоре, а не только с английскими ID. */
export function overviewMatches(id: string, query: string): boolean {
  const topic = topicOfOperation.get(id);
  return `${topic?.title} ${operationSummary(id) ?? ""}`.toLowerCase().includes(query);
}
