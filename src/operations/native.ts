import type { NativeOperation } from "../contracts.js";
import { HcmError } from "../errors.js";
import { getNativeOperations, getEffectiveNativeEffect } from "../native/index.js";
import { WsHcmApiError } from "../protocol/error.js";
import { createPhysicalDocument, parsePhysicalDocumentId } from "../protocol/physical-documents.js";
import { rawXml } from "../protocol/xml.js";
import { operation, type Operation } from "../operation.js";
import { rpcValue } from "../server-value.js";
import { WriteOutcome } from "../write-outcome.js";

/** Сырой ответ протокола несёт форматирование XML: отступы между элементами и атрибут xmlns. */
export function withoutXmlFormatting(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutXmlFormatting);
  if (!value || typeof value !== "object" || value instanceof Uint8Array) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, child]) =>
          key !== "@_xmlns" &&
          !(key === "#text" && typeof child === "string" && child.trim() === ""),
      )
      .map(([key, child]) => [
        key,
        // Перевод строки и отступ закрывающего тега — форматирование пустого элемента.
        typeof child === "string" && /^\s*\n[ \t]+$/.test(child) ? "" : withoutXmlFormatting(child),
      ]),
  );
}

/**
 * Сырой ответ в виде, пригодном вызывающему. Сервер называет загруженный файл путём внутри папки
 * загрузок, разбивает base64 на строки и отдаёт результат фоновой задачи типизированным XML;
 * вызывающему нужны адрес файла, base64 одним куском и значение обычным JSON.
 */
function uploadedFile(answer: unknown): unknown {
  if (answer === null || typeof answer !== "object" || Array.isArray(answer)) return answer;
  const data = answer as Record<string, unknown>;
  if (typeof data.Url === "string" && data.Url) {
    const url = `x-local://share/uploaded_files/${data.Url}`;
    const { Url: _, ...rest } = data;
    return { ...rest, url, folderUrl: url.slice(0, url.lastIndexOf("/")) };
  }
  return answer;
}
/**
 * Отказ политики загрузки сервера — UPLOAD_REFUSED с текстом сервера, если он его прислал. Сбой
 * части на сервере — PLATFORM_HTTP без текста сервера: в тексте исключения бывают пути сервера.
 * В лог xhttp сервер пишет только исключение при сборке файла (HTTP 503).
 */
function uploadFailure(error: unknown): unknown {
  if (!(error instanceof WsHcmApiError)) return error;
  if (error.details?.chunkFailed === true) {
    const joining = error.status === 503;
    return new HcmError(
      "PLATFORM_HTTP",
      joining
        ? "Сервер не собрал файл из частей (HTTP 503)."
        : `Сервер не записал часть файла (HTTP ${error.status}).`,
      `Загрузку повторить целиком.${joining ? " Если сборка упала, причина — в строке ERROR[upload_big_file] лога xhttp: последние строки показывает logs.follow." : ""}`,
      { status: error.status },
    );
  }
  if (error.details?.uploadRefused !== true) return error;
  const reason = error.details.reason;
  return new HcmError(
    "UPLOAD_REFUSED",
    typeof reason === "string"
      ? reason
      : `Сервер не принял файл в загрузку (HTTP ${error.status}). Причину он пишет только в свой лог xhttp за сегодня: последние строки показывает logs.follow.`,
    "Сервер принимает в загрузку только имена из своей политики загрузки (resource_sec.json): обычно .txt, .xml, .zip, документы и картинки; .js, .json, .css, .html, .svg, .bin и имена без расширения — нет. Файл по своему адресу записывает files.write.",
  );
}
function asyncStatus(answer: unknown): unknown {
  if (answer === null || typeof answer !== "object" || Array.isArray(answer)) return answer;
  const data = answer as Record<string, unknown>;
  if (data.ResultData !== undefined)
    try {
      const decoded = rpcValue(data);
      if (decoded !== data) {
        const { ResultData: _typed, ...state } = data;
        return { ...state, ...(decoded as Record<string, unknown>) };
      }
    } catch {
      // Результат без простого вида остаётся таким, как его дал сервер.
    }
  return answer;
}
/**
 * Документ создаётся отдельными запросами реестра. После сброса сессии шлюз повторяет только
 * отклонённый запрос: записанный документ второй раз не пишется, а неудавшийся новый вход после
 * PutDoc оставляет исход неопределённым и называет адрес документа.
 */
const createFromXml: Operation["run"] = async ({ server }, args, { outcome }) => {
  // Исход вызова решает PutDoc. Выданный ID и удаление документа после сбоя — запросы в стороне:
  // отказ шаблона после выдачи ID — по-прежнему not_sent.
  const aside = new WriteOutcome();
  const created = await createPhysicalDocument(
    {
      getNewObjectId: async (request) => ({
        data: await server.call("native.lds.getNewObjectId", request, aside),
      }),
      putDoc: async ({ data, ...request }) => {
        outcome.note({ url: request.url, objectId: parsePhysicalDocumentId(request.url) });
        return {
          data: await server.call("native.lds.putDoc", { ...request, data: data.xml }, outcome),
        };
      },
      loadDoc: async (request) => ({ data: await server.call("native.lds.loadDoc", request) }),
      deleteDoc: (request) => server.call("native.lds.deleteDoc", request, aside),
    },
    {
      ...(args.dbName === undefined ? {} : { dbName: args.dbName as string }),
      ...(args.writeDocInfo === undefined ? {} : { writeDocInfo: args.writeDocInfo as boolean }),
      ...(args.skipActions === undefined ? {} : { skipActions: args.skipActions as boolean }),
      ...(args.neverSaved === undefined ? {} : { neverSaved: args.neverSaved as boolean }),
      document: ({ objectId }) =>
        rawXml((args.documentXmlTemplate as string).replaceAll("{{objectId}}", objectId)),
    },
  );
  return { objectId: created.objectId, url: created.url, document: created.loadResponse.data };
};
/** Низкоуровневая операция из нескольких запросов реестра: её обработчик — в runtime, не в шлюзе. */
const composite: NativeOperation[] = [
  {
    id: "native.physicalDocuments.createFromXml",
    profile: "native",
    group: "physicalDocuments",
    method: "createFromXml",
    title: "Create a physical XML document",
    description:
      "Выделить ID, подставить его вместо {{objectId}} в documentXmlTemplate, сохранить через PutDoc и сверить ID корня через LoadDoc. Обработка XMD, как в клиенте администратора, не воспроизводится.",
    effect: "write",
    inputSchema: {
      type: "object",
      properties: {
        documentXmlTemplate: { type: "string" },
        dbName: { type: "string" },
        writeDocInfo: { type: "boolean" },
        skipActions: { type: "boolean" },
        neverSaved: { type: "boolean" },
      },
      required: ["documentXmlTemplate"],
      additionalProperties: false,
    },
  },
];
/** Что вызывающий получает от низкоуровневой операции поверх реестра протокола. */
interface Face {
  /** Строка обзора. */
  summary?: string;
  /** То, что строка обзора опускает. */
  details?: string;
  /** Обычная причина HTTP 500 для подсказки отказа. */
  usualCause?: string;
  /** Сырой ответ в виде, которым вызывающий может пользоваться. */
  answer?: (raw: unknown) => unknown;
  /** Отказ сервера в виде, который называет причину; другая ошибка возвращается как есть. */
  failure?: (error: unknown) => unknown;
  /** Обработчик операции из нескольких запросов вместо одного запроса реестра. */
  run?: Operation["run"];
}
/** Строка на операцию; строки идут по темам обзора. */
const FACES: Readonly<Record<string, Face>> = {
  // Тема tasks.
  "web.spxml.callMethodAsync": {
    summary: "Запустить функцию библиотеки фоновой задачей; ответ содержит TrackingID.",
    details:
      "target — «библиотека.функция». Удобнее rpc.call с async:true: он принимает обычные значения аргументов.",
  },
  "web.spxml.getAsyncMethodStatus": {
    summary:
      "Состояние задачи по TrackingID. Итог выдаётся один раз: его нужно сохранить и больше не опрашивать.",
    details:
      "trackingId — как в ответе запуска: 0x… или десятичный. Пока задача идёт, IsRunning «1»; у завершённой IsRunning «0» и value — её результат, как у обычного rpc.call. После такого ответа сервер запись о задаче удаляет: второй раз результат не получить. Опрашивать не чаще четырёх раз в секунду.",
    answer: asyncStatus,
  },
  "web.spxml.getBackgroundTasksByName": {
    summary: "Найти задачи по имени библиотеки и функции.",
    details:
      "В списке бывают задачи других пользователей: совпадение имени не значит, что задача своя. Недавно завершённые задачи остаются в списке вместе с итогом.",
  },
  "web.spxml.killAsyncMethod": {
    summary: "Попросить сервер остановить задачу.",
    details:
      "Уже сделанные изменения не откатываются. Остановка завершённой задачи не гарантирована.",
  },
  // Тема files.
  "web.pages.uploadFile": {
    summary: "Загрузить файл в папку загрузок сервера; ответ содержит его адрес.",
    details:
      'filename — имя без пути; data — текст или {base64:"…"}. Ответ: url — адрес файла, folderUrl — папка, которую сервер создал для него.',
    answer: uploadedFile,
    failure: uploadFailure,
  },
  "web.pages.uploadChunk": {
    summary: "Загрузить одну часть большого файла.",
    details:
      "fileId — 32 шестнадцатеричных знака, его выбирает вызывающий. Части идут по порядку, последняя собирает файл. Ответ сервера не доказывает, что часть сохранена. При ошибке на последней части вслепую повторять нельзя: адрес итогового файла может остаться неизвестным.",
    failure: uploadFailure,
  },
  "web.pages.clearUploadChunks": {
    summary: "Удалить загруженные части файла.",
    details:
      "Удаляет части с 0 по chunksTotal − 1 для заданного fileId. Сервер не проверяет, кто создал этот ID; пустой ответ не доказывает, что части удалены.",
  },
  // Тема documents.
  "native.lds.loadDoc": {
    summary: "Прочитать документ по адресу; приходит разобранным в JSON.",
    details:
      "Документ приходит разобранным: data.Data.<тип объекта>. Повторяемый элемент из одного элемента здесь объект, а не список. Даты записаны как на сервере, со смещением +00:00: это местное время сервера. Текст XML того же документа отдаёт files.read по тому же адресу.",
    usualCause: "по этому адресу ничего нет",
  },
  "native.lds.putDoc": {
    summary: "Сохранить документ по адресу из текста XML.",
    details:
      "data — текст XML всего документа; он заменяет документ целиком. writeDocInfo:true — сервер обновляет дату и автора изменения; без него они остаются как в тексте, и поиск по modification_date правку не видит. neverSaved:true — документ записывается впервые (так пишет новый объект objects.create). skipActions:true отключает обработку, которую сервер выполняет перед сохранением. Чужую правку операция не замечает: fingerprint из objects.get нужно сверять до записи самому.",
  },
  "native.lds.deleteDoc": {
    summary: "Удалить документ по адресу.",
    details: "strictDelete:true требует, чтобы документ существовал.",
  },
  "native.lds.getNewObjectId": {
    summary: "Выделить новый ID объекта; каждый вызов расходует ID.",
    details:
      "ObjectID — новый ID десятичной записью; остальные операции принимают его и так, и в записи 0x….",
  },
  "native.physicalDocuments.createFromXml": {
    run: createFromXml,
    summary: "Создать документ из готового XML; новый ID подставляется вместо {{objectId}}.",
    details:
      "documentXmlTemplate — текст XML документа с {{objectId}} на месте ID. После записи документ перечитывается, и его ID сверяется. Обработчики, которые админка выполняет при создании, не запускаются.",
  },
  // Тема changes.
  "native.lds.getModObjects": {
    summary:
      "Объекты, изменённые после даты minModDate; на 2025.1–2025.2 ответ пуст и при изменениях.",
    details:
      "На проверенных серверах ответ пуст и при свежих изменениях. Изменённые объекты находит runtime.query по modification_date в нужном каталоге. compress передавать нельзя: сжатый ответ клиент не разбирает.",
  },
  "native.lds.getCatalogsStat": {
    summary: "Число записей по каталогам из кэша сервера; пустой ответ не значит, что записей нет.",
    details:
      "Числа — из кэша сервера, а не свежий подсчёт. Каталога в ответе может не быть; пустой ответ тоже возможен.",
  },
  // Тема server.
  "native.spxml2.getAppInfo": {
    summary: "Каталоги, типы объектов, общие документы и настройки приложения.",
    details:
      "Ответ большой и сохраняется целиком. Каталоги — databases[i].catalogs: {id, form_url, object_type}; основная база названа в default_db_name. Типы и их каталоги короче показывает schema.types.",
  },
  "anonymous.diagnostics.portal": {
    summary: "Отвечает ли портал.",
  },
  "anonymous.diagnostics.xhttpInfo": {
    summary: "Служебная страница /xhttp_info.",
    details: "Ответ — страница HTML со сведениями о сборке сервера.",
  },
  "web.websocket.heartbeat": {
    summary: "Отвечает ли служба WebSocket.",
    details:
      "Одна проверка: соединение, служебное сообщение, ответ. heartbeatObserved:true — служба ответила.",
  },
  // Тема forms.
  "native.spxml2.getForm": {
    summary: "Текст формы (.xmd, .xms) по адресу.",
  },
  "web.pages.getScreenForm": {
    summary: "Текст экранной формы по адресу.",
  },
  "web.pages.getUiText": {
    summary: "Тексты интерфейса.",
  },
  "native.resources.getImage": {
    summary: "Картинка ресурса по ID.",
  },
  "native.resources.getCompoundResource": {
    summary: "Вложение составного документа.",
    details:
      "Источник — url (адрес HTML-файла, x-local или x-app) либо docUrl и elemPath (строковое поле документа). elemPath начинается с имени корневого элемента документа: presence_state.name.",
  },
};

export const nativeOperations: readonly Operation[] = [...getNativeOperations(), ...composite].map(
  (native) => {
    const { answer, failure, run, ...texts } = FACES[native.id] ?? {};
    return operation({
      id: native.id,
      effect: native.effect,
      effectFor: (args) => getEffectiveNativeEffect(native, args),
      description: native.description,
      ...texts,
      inputSchema: native.inputSchema,
      native,
      run: async (context, args, call) => {
        const raw = withoutXmlFormatting(
          await (
            run
              ? run(context, args, call)
              : context.server.call(
                  native.id,
                  args,
                  call.effect === "read" ? undefined : call.outcome,
                )
          ).catch((error: unknown) => {
            throw failure ? failure(error) : error;
          }),
        );
        return answer ? answer(raw) : raw;
      },
    });
  },
);
for (const id of Object.keys(FACES))
  if (!nativeOperations.some((item) => item.id === id))
    throw new Error(`Строка таблицы для неизвестной низкоуровневой операции: ${id}`);
