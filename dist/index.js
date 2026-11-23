import { createRequire as __wtctlRequire } from "node:module";
const require = __wtctlRequire(import.meta.url);
import {
  HcmRuntime
} from "./chunks/chunk-UQHEU7II.js";
import {
  HcmError,
  describeHcmOperation,
  listHcmOperations,
  loadConfig
} from "./chunks/chunk-T672SCY6.js";
import "./chunks/chunk-VCNJKZJ7.js";
import "./chunks/chunk-JZ7VTFSJ.js";
import "./chunks/chunk-LV7Y4FOL.js";

// src/sdk.ts
var HcmOperationError = class extends HcmError {
  operationError;
  constructor(result, operationError = result.error) {
    super(
      operationError?.code ?? "OPERATION_FAILED",
      operationError?.message ?? "Операция не выполнена.",
      operationError?.hint,
      operationError?.details,
      operationError?.mutationOutcome
    );
    Object.defineProperty(this, "result", { value: result, enumerable: false });
    this.operationError = operationError;
  }
  /** error ответа, как его вернула операция. */
  toJSON() {
    return this.operationError ?? super.toJSON();
  }
};
var HcmStoredResultError = class extends HcmOperationError {
  /** ID сохранённого результата: его читают readResult и exportResult. */
  resultId;
  constructor(result, resultId) {
    super(result, {
      code: "RESULT_STORED",
      message: "Результат сохранён локально; в data.preview только начало данных.",
      hint: "Ответ больше outputLimitBytes. Прочитать частями — client.readResult({ resultId }), сохранить в файл — client.exportResult({ resultId, path }). Поднять предел — loadConfig({ settings: { outputLimitBytes } }).",
      retryable: false,
      details: { resultId }
    });
    this.resultId = resultId;
  }
};
var HcmCleanupError = class extends HcmError {
  constructor(value) {
    super(
      "CLEANUP_FAILED",
      "Операция завершилась, но закрыть подключение не удалось.",
      "Результат сохранён в error.value. Операцию из-за ошибки закрытия не повторять.",
      { operationSucceeded: true },
      void 0
    );
    Object.defineProperty(this, "value", { value, enumerable: false });
  }
};
function storedResultId(result) {
  if (typeof result.meta.resultId === "string") return result.meta.resultId;
  if (result.data && typeof result.data === "object" && "resultId" in result.data && typeof result.data.resultId === "string")
    return result.data.resultId;
  return void 0;
}
async function readStoredQueryPage(client, result, resultId) {
  let offset = 0;
  let text = "";
  while (offset !== void 0) {
    const chunk = await client.readResult({ resultId, offset, limit: 65536, format: "json" });
    if (!chunk.ok) throw new HcmStoredResultError(result, resultId);
    const data = chunk.data && typeof chunk.data === "object" ? chunk.data : void 0;
    if (data?.format !== "json" || typeof data.text !== "string")
      throw new HcmStoredResultError(result, resultId);
    text += data.text;
    if (data.nextOffset === void 0) {
      offset = void 0;
    } else if (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset) {
      offset = data.nextOffset;
    } else {
      throw new HcmStoredResultError(result, resultId);
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HcmStoredResultError(result, resultId);
  }
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.items))
    throw new HcmStoredResultError(result, resultId);
  return parsed;
}
function unwrap(result) {
  if (!result.ok) throw new HcmOperationError(result);
  if (result.meta.truncated === true) {
    const resultId = storedResultId(result);
    if (resultId) throw new HcmStoredResultError(result, resultId);
    throw new HcmOperationError(result, {
      code: "RESULT_TRUNCATED",
      message: "Полный результат отсутствует в ответе.",
      hint: "Проверить meta и настройку outputLimitBytes; в data.preview только начало данных.",
      retryable: false
    });
  }
  return result.data;
}
function callOperation(client, id, args = {}) {
  return client.call(id, args);
}
var HcmClient = class {
  /** @internal */
  runtime;
  constructor(connection) {
    this.runtime = "call" in connection ? connection : new HcmRuntime(connection);
  }
  /** Операции клиента, по странице: поиск по словам, теме, группе, эффекту. Сервер не вызывается. */
  listOperations(filter) {
    return this.runtime.listOperations(filter);
  }
  /** Описание операции по ID со схемой аргументов; неизвестный ID — HcmError UNKNOWN_OPERATION. */
  describe(id) {
    return this.runtime.describe(id);
  }
  /**
   * Любая операция по ID: call("native.lds.loadDoc", {url}). Аргументы — как в describe(id).
   * Тип data задаёт параметр T; клиент его не проверяет.
   */
  call(id, args = {}) {
    return this.runtime.call(id, args);
  }
  // Методы с параметром-типом и методы на низкоуровневые операции зовут this.call: тип ответа
  // здесь утверждается, обработчик общий и не знает типа вызывающего.
  /** Несколько объектов за один вызов, до 100; у непрочитанного объекта в его элементе стоит error. */
  getMany(input) {
    return this.call("objects.get", { ...input });
  }
  /** Связь с сервером: версия сервера, база данных (database), userId и права подключения. Ничего не меняет. */
  status() {
    return callOperation(this, "runtime.status");
  }
  /**
   * Проверка подключения по шагам: вход, версия, запрос, документ, схема, библиотеки, логи, портал;
   * при праве execute — ещё код на сервере. Запись не проверяется.
   */
  check() {
    return callOperation(this, "runtime.check");
  }
  /** Сведения о сервере, которые он отдаёт админке при запуске: версия, ОС, база, папки. */
  serverInfo(input = {}) {
    return callOperation(this, "server.info", { ...input });
  }
  /** Есть ли файл или папка по адресу x-local://…; о содержимом и правах ответ ничего не говорит. */
  fileExists(input) {
    return callOperation(this, "files.exists", { ...input });
  }
  readFile(input) {
    return callOperation(this, "files.read", { ...input });
  }
  /** Один уровень папки сервера: файлы с размером и вложенные папки. Нужно право execute. */
  listFiles(input) {
    return callOperation(this, "files.list", { ...input });
  }
  /**
   * Записывает файл по адресу x-local://… целиком из text, base64 или файла на диске (file) и сверяет
   * записанное; папки сервер создаёт сам. Нужно право write, в папку кода (wt, wtv, custom…) — ещё
   * execute.
   */
  writeFile(input) {
    return callOperation(this, "files.write", { ...input });
  }
  /** Удаляет файл по адресу x-local://…. Нужно право write, в папке кода — ещё execute. */
  deleteFile(input) {
    return callOperation(this, "files.delete", { ...input });
  }
  /**
   * Одна страница поиска: в каталоге по условиям или запросом XQuery (ему нужно право execute).
   * Дальше — startPosition: nextStartPosition; все страницы сразу перебирает queryRows.
   */
  query(input) {
    return this.call("runtime.query", { ...input });
  }
  /**
   * Строки каталога или запроса XQuery со всех страниц по порядку; страницы листает сам.
   * Аргументы те же, что у query. Страницу, которая не поместилась в outputLimitBytes и
   * сохранилась локально, дочитывает через readResult. Неполная страница (incomplete) —
   * ошибка QUERY_INCOMPLETE после её строк.
   */
  async *queryRows(input) {
    let args = input;
    for (; ; ) {
      const result = await this.query(args);
      const storedId = result.ok && result.meta.truncated ? storedResultId(result) : void 0;
      const page = storedId ? await readStoredQueryPage(this, result, storedId) : unwrap(result);
      yield* page.items;
      if (page.incomplete)
        throw new HcmOperationError(result, {
          code: "QUERY_INCOMPLETE",
          message: "Страница запроса неполная: строки после неё не прочитаны.",
          ...page.hint === void 0 ? {} : { hint: page.hint },
          retryable: false
        });
      if (page.nextStartPosition === void 0) return;
      args = { ...input, startPosition: page.nextStartPosition };
    }
  }
  /** Документ объекта по id или url; fields — только эти поля верхнего уровня. */
  get(input) {
    return this.call("objects.get", { ...input });
  }
  /**
   * Создаёт объект; ID выдаёт сервер, после записи объект перечитывается и сверяется. Нужно право
   * write. Обработчики, которые админка выполняет при создании, не запускаются.
   */
  create(input) {
    return callOperation(this, "objects.create", { ...input });
  }
  /**
   * Меняет поля объекта, остальное содержимое документа сохраняется. Нужно право write.
   * С preview:true или правкой без изменений ничего не записывает: ответ — PatchPreviewData.
   */
  patch(input) {
    return callOperation(this, "objects.patch", { ...input });
  }
  /** Удаляет документ объекта безвозвратно; нужны permanent:true и право write. */
  delete(input) {
    return callOperation(this, "objects.delete", { ...input });
  }
  /** Поля типа объекта по странице: свои, унаследованные, настраиваемые и поля каталога. */
  schema(input) {
    return callOperation(this, "schema.get", { ...input });
  }
  /** Типы объектов сервера: тип, каталог, заголовок, число настраиваемых полей. */
  types(input = {}) {
    return callOperation(this, "schema.types", { ...input });
  }
  rpc(input) {
    return this.call("rpc.call", { ...input });
  }
  /** Функции библиотек сервера по странице: имя и параметры. Сами функции не вызываются. */
  listRpc(input = {}) {
    return callOperation(this, "rpc.list", { ...input });
  }
  /** Параметры функции «библиотека.функция», с source:true — и её код. Функция не вызывается. */
  describeRpc(targetId, options = {}) {
    return callOperation(this, "rpc.describe", { targetId, ...options });
  }
  /**
   * Выполняет код SP-XML Script на сервере; нужно право execute, отката нет. Код присваивает
   * массив переменной RESULT, params доступен в коде как PARAMS. Код и params можно передать
   * и одним объектом {code, params}.
   */
  execute(code, params) {
    return this.call(
      "execute.script",
      typeof code === "string" ? { code, ...params ? { params } : {} } : { ...code }
    );
  }
  /**
   * Запускает агента сервера в отдельном потоке и по умолчанию ждёт завершения (до waitTimeoutMs,
   * по умолчанию 120000 мс); нужно право execute. С wait:false возвращает threadId сразу (для
   * агентов на C# threadId может отсутствовать). При истечении waitTimeoutMs возвращает
   * AGENT_WAIT_TIMEOUT (mutationOutcome: confirmed), при сбое опроса — AGENT_STATUS_FAILED
   * (confirmed). Ошибки кода агента сервера — только в логе xhttp.
   */
  runAgent(input) {
    return callOperation(this, "agents.run", { ...input });
  }
  /**
   * Список текущих и недавно завершённых запусков агентов сервера; фильтруется по id, threadId,
   * status и limit. С threadId и wait:true ждёт завершения запуска (при таймауте —
   * AGENT_WAIT_TIMEOUT). Право execute не требуется.
   */
  agentStatus(input = {}) {
    return callOperation(this, "agents.status", { ...input });
  }
  /**
   * Останавливает выполняющегося агента сервера по threadId (roleUID определяется автоматически,
   * если не задан; при отсутствии работающего потока — AGENT_NOT_RUNNING с not_sent). Нужно право
   * write; уже сделанные изменения не откатываются.
   */
  cancelAgent(input) {
    return callOperation(this, "agents.cancel", { ...input });
  }
  /**
   * Несколько операций одним вызовом; права проверяются для каждого шага. Не транзакция:
   * выполненные шаги не откатываются.
   */
  batch(input) {
    return callOperation(this, "runtime.batch", { ...input });
  }
  /** Страница сохранённого результата: список — по элементам, текст — по символам. */
  readResult(input) {
    return this.call("results.read", { ...input });
  }
  /** Записывает сохранённый результат целиком в файл на этом компьютере. */
  exportResult(input) {
    return callOperation(this, "results.export", { ...input });
  }
  /** Загружает файл в папку загрузок сервера так же, как админка; нужно право write. */
  uploadFile(input) {
    return this.call("web.pages.uploadFile", { ...input });
  }
  /**
   * Отправляет одну часть загрузки по частям; последняя часть собирает файл. Нужно право write.
   * Перед последней частью загруженное проверить чтением; после ошибки на последней части не повторять.
   */
  uploadChunk(input) {
    return this.call("web.pages.uploadChunk", { ...input });
  }
  /** Просит сервер удалить части загрузки fileId; нужно право write. Удаление ответ не подтверждает. */
  clearUploadChunks(input) {
    return this.call("web.pages.clearUploadChunks", { ...input });
  }
  /** Проверка WebSocket сервера: одно сообщение $hbt и ожидание $ok. */
  heartbeat(input = {}) {
    return this.call("web.websocket.heartbeat", { ...input });
  }
  /** Логи сервера, сначала свежие. */
  listLogs(input = {}) {
    return callOperation(this, "logs.list", { ...input });
  }
  /** Текст лога: конец файла или весь файл. */
  readLog(input) {
    return callOperation(this, "logs.read", { ...input });
  }
  /** События лога по тексту, уровню или потоку; многострочное событие приходит целиком. */
  searchLogs(input) {
    return callOperation(this, "logs.search", { ...input });
  }
  /** Новые события лога с прошлого вызова: cursor из прошлого ответа. */
  followLog(input) {
    return callOperation(this, "logs.follow", { ...input });
  }
  /** Закрывает сессию на сервере. После close методы отвечают ошибкой RUNTIME_CLOSED. */
  close() {
    return this.runtime.close();
  }
  /**
   * Вызывает action с этим клиентом и закрывает подключение ровно один раз — и после успеха,
   * и после ошибки. Как withHcmClient, но для уже созданного клиента.
   */
  use(action) {
    return scoped(this.runtime, () => action(this));
  }
};
function safeCleanupEvidence() {
  return new HcmError(
    "CLEANUP_FAILED",
    "Не удалось закрыть подключение после ошибки операции.",
    "Основная ошибка сохранена; запись без проверки её исхода не повторять."
  );
}
function getCleanupError(error) {
  if (error !== null && typeof error === "object" && "cleanupError" in error && error.cleanupError instanceof HcmError)
    return error.cleanupError;
  if (error instanceof AggregateError)
    return error.errors.find(
      (item) => item instanceof HcmError && item.code === "CLEANUP_FAILED"
    );
  return void 0;
}
async function scoped(runtime, action) {
  let value;
  let failed = false;
  let primary;
  try {
    value = await action();
  } catch (error) {
    failed = true;
    primary = error;
  }
  try {
    await runtime.close();
  } catch {
    if (!failed && value !== null && typeof value === "object" && "ok" in value && value.ok === false && "meta" in value && "error" in value && value.error !== null && typeof value.error === "object" && "code" in value.error && typeof value.error.code === "string" && "message" in value.error && typeof value.error.message === "string") {
      failed = true;
      primary = new HcmOperationError(value);
    }
    if (!failed) throw new HcmCleanupError(value);
    const cleanupError = safeCleanupEvidence();
    if (primary !== null && (typeof primary === "object" || typeof primary === "function") && Object.isExtensible(primary)) {
      try {
        Object.defineProperty(primary, "cleanupError", { value: cleanupError, enumerable: false });
      } catch {
        throw new AggregateError(
          [primary, cleanupError],
          "Операция не выполнена, и закрыть подключение не удалось."
        );
      }
    } else
      throw new AggregateError(
        [primary, cleanupError],
        "Операция не выполнена, и закрыть подключение не удалось."
      );
  }
  if (failed) throw primary;
  return value;
}
async function withHcmClient(config, action) {
  return new HcmClient(config).use(action);
}
export {
  HcmCleanupError,
  HcmClient,
  HcmError,
  HcmOperationError,
  HcmStoredResultError,
  describeHcmOperation,
  getCleanupError,
  listHcmOperations,
  loadConfig,
  unwrap,
  withHcmClient
};
