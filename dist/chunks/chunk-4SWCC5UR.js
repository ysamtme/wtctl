import { createRequire as __wtctlRequire } from "node:module";
const require = __wtctlRequire(import.meta.url);
import {
  WsHcmApiError,
  WsHcmBinaryResponse,
  WsHcmClient,
  attachCleanupError,
  isTransportFailure,
  rawXml,
  rawXmlElement
} from "./chunk-ZUGZZAWL.js";

// src/native/validation.ts
function sameJson(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameJson(item, right[index]));
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = left, b = right;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
function validate(value, schema, path = "args") {
  if ("const" in schema && !sameJson(value, schema.const))
    throw new TypeError(`${path}: значение не совпадает с требуемым.`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => sameJson(value, item)))
    throw new TypeError(`${path}: такого значения нет среди допустимых.`);
  if (Array.isArray(schema.anyOf)) {
    for (const option of schema.anyOf) {
      try {
        validate(value, option, path);
        return;
      } catch {
      }
    }
    throw new TypeError(`${path}: значение не подходит ни под один из допустимых вариантов.`);
  }
  if (schema.type === "string") {
    if (typeof value !== "string") throw new TypeError(`${path}: нужна строка.`);
    const length = Array.from(value).length;
    if (typeof schema.minLength === "number" && length < schema.minLength)
      throw new TypeError(`${path}: строка короче допустимого.`);
    if (typeof schema.maxLength === "number" && length > schema.maxLength)
      throw new TypeError(`${path}: строка длиннее допустимого.`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value))
      throw new TypeError(`${path}: значение записано неверно.`);
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new TypeError(`${path}: нужно число.`);
    if (schema.type === "integer" && !Number.isInteger(value))
      throw new TypeError(`${path}: нужно целое число.`);
    if (typeof schema.minimum === "number" && value < schema.minimum)
      throw new TypeError(`${path}: число меньше допустимого, не меньше ${schema.minimum}.`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      throw new TypeError(`${path}: число больше допустимого, не больше ${schema.maximum}.`);
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum)
      throw new TypeError(`${path}: число меньше допустимого.`);
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum)
      throw new TypeError(`${path}: число больше допустимого.`);
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") throw new TypeError(`${path}: нужно true или false.`);
  } else if (schema.type === "null") {
    if (value !== null) throw new TypeError(`${path}: нужно null.`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) throw new TypeError(`${path}: нужен массив.`);
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      throw new TypeError(`${path}: в массиве меньше элементов, чем нужно.`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      throw new TypeError(`${path}: в массиве больше элементов, чем допустимо.`);
    for (const [index, item] of value.entries())
      validate(item, schema.items ?? {}, `${path}[${index}]`);
  } else if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new TypeError(`${path}: нужен объект.`);
    const object = value;
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(object, key) || object[key] === void 0)
        throw new TypeError(`${path}.${key}: обязательное значение не задано.`);
    for (const [key, child] of Object.entries(object)) {
      const childSchema = Object.hasOwn(properties, key) ? properties[key] : void 0;
      if (childSchema) validate(child, childSchema, `${path}.${key}`);
      else if (schema.additionalProperties === false)
        throw new TypeError(`${path}.${key}: такого аргумента у операции нет.`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object")
        validate(child, schema.additionalProperties, `${path}.${key}`);
    }
  }
}
function normalized(value, schema) {
  if (Array.isArray(schema.anyOf)) {
    let matchError;
    let normalizationError;
    for (const option of schema.anyOf) {
      try {
        validate(value, option);
      } catch (error2) {
        matchError = error2;
        continue;
      }
      try {
        return normalized(value, option);
      } catch (error2) {
        normalizationError ??= error2;
      }
    }
    const error = normalizationError ?? matchError;
    throw error instanceof Error ? error : new TypeError("Аргументы не подходят ни под один из допустимых вариантов.");
  }
  if (schema["x-normalization"] === "xml") return rawXml(value);
  if (schema["x-normalization"] === "xml-box") return rawXml(value.xml);
  if (schema["x-normalization"] === "xml-element") return rawXmlElement(value);
  if (schema["x-normalization"] === "xml-element-box")
    return rawXmlElement(value.xml);
  if (schema["x-normalization"] === "binary") {
    const encoded = value.base64;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
      throw new TypeError("Значение base64 записано неверно.");
    return new Uint8Array(Buffer.from(encoded, "base64"));
  }
  if (schema.type === "array")
    return value.map((item) => normalized(item, schema.items ?? {}));
  if (schema.type === "object" && value && typeof value === "object") {
    const properties = schema.properties ?? {};
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalized(child, Object.hasOwn(properties, key) ? properties[key] : {})
      ])
    );
  }
  return value;
}
function prepare(value, schema) {
  validate(value, schema);
  return normalized(value, schema);
}

// src/native/metadata.ts
var compatibilityDescriptions = {
  "web.experimental.authenticate": "Войти штатным способом браузера через JSON (поддержан частично); нужен свой токен страницы входа. На сервере 2025.1.1171 во встроенном API SPXML2 маршрута authenticate нет; расширения приложения могут его добавлять. На проверенной установке штатная страница входа вернула HTTP 200 с текстом ошибки и без токена, поэтому POST authenticate и отзыв выданного билета не проверялись. Тело и cookie успешного ответа не проверены."
};
var isReference = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.$ref === "string";
var lockable = (args) => isReference(args) || args.tryLock === true || isReference(args.tryLock) ? "write" : void 0;
var byHttpVerb = (args) => {
  if (typeof args.method !== "string") return void 0;
  const verb = args.method.toUpperCase();
  return verb === "GET" || verb === "HEAD" ? "read" : void 0;
};
var RIGHTS = {
  "native.lds.getCatalogsStat": "read",
  "native.lds.getModObjects": "read",
  "native.lds.releaseCursor": "read",
  "native.lds.idle": "read",
  "web.lds.releaseCursor": "read",
  "web.spxml.getBackgroundTasksByName": "read",
  "web.spxml.getAsyncMethodStatus": "read",
  "native.spxml2.getAppInfo": "read",
  "native.spxml2.getForm": "read",
  "web.spxml2.getAppInfo": "read",
  "web.spxml2.getForm": "read",
  "web.spxml2.getImage": "read",
  "web.spxml2.getPreloadedDesignFiles": "read",
  "web.spxml2.stdEncrypt": "read",
  "web.pages.filePreviewPdf": "read",
  "web.pages.getForm": "read",
  "web.pages.getScreenForm": "read",
  "web.pages.getImage": "read",
  "web.pages.getUiText": "read",
  "web.pages.getUrl": "read",
  "native.resources.getImage": "read",
  "native.resources.getCompoundResource": "read",
  "web.resources.getImage": "read",
  "web.resources.getCompoundResource": "read",
  "anonymous.diagnostics.xhttpInfo": "read",
  "web.lifecycle.admin": "read",
  "web.lifecycle.main": "read",
  "web.lifecycle.logout": "read",
  "native.lds.loadDoc": { effect: "read", byArguments: lockable },
  "web.spxml.getDoc": { effect: "read", byArguments: lockable },
  "native.lds.loadUrl": { effect: "read", internal: true },
  "native.lds.putDoc": "write",
  "native.lds.deleteDoc": "write",
  "native.lds.getNewObjectId": "write",
  "web.lds.deleteDoc": "write",
  "web.spxml.killAsyncMethod": "write",
  "web.spxml.putDoc": "write",
  "web.pages.uploadFile": "write",
  "web.pages.uploadChunk": "write",
  "web.pages.clearUploadChunks": "write",
  "native.lds.putUrl": { effect: "write", internal: true },
  "native.lds.deleteUrl": { effect: "write", internal: true },
  "native.lds.xQuery": "execute",
  "native.lds.runMethod": "execute",
  "web.lds.xQuery": "execute",
  "web.lds.runMethod": "execute",
  "native.rpc.call": "execute",
  "web.rpc.call": "execute",
  "native.spxml.call": "execute",
  "web.spxml.callMethod": "execute",
  "web.spxml.callMethodAsync": "execute",
  "web.experimental.authenticate": "execute",
  "anonymous.experimental.rawRequest": { effect: "unknown", byArguments: byHttpVerb },
  "native.experimental.rawRequest": { effect: "unknown", byArguments: byHttpVerb },
  "web.experimental.rawRequest": { effect: "unknown", byArguments: byHttpVerb }
};
function rightOf(id) {
  if (!Object.hasOwn(RIGHTS, id)) return void 0;
  const row = RIGHTS[id];
  return typeof row === "string" ? { effect: row } : row;
}
function decorateOperation(operation) {
  const right = rightOf(operation.id);
  if (!right) throw new Error(`Для ${operation.id} не указано право`);
  const description = compatibilityDescriptions[operation.id];
  const { status, inputSchema, ...head } = operation;
  return {
    ...head,
    ...description === void 0 ? {} : { description },
    effect: right.effect,
    status,
    inputSchema
  };
}
function isInternalNative(id) {
  return rightOf(id)?.internal === true;
}
function getEffectiveNativeEffect(operation, args) {
  return rightOf(operation.id)?.byArguments?.(args) ?? operation.effect;
}

// src/native/generated.ts
var NATIVE_ENTRIES = [
  { operation: decorateOperation({ "id": "native.lds.getCatalogsStat", "profile": "native", "group": "lds", "method": "getCatalogsStat", "title": "native lds getCatalogsStat", "description": "Прочитать готовые записи из кэша статистики каталогов текущей сессии.\nПустой ответ Catalogs допустим: неготовые и пропускаемые каталоги в него не попадают.\nRecordsNum — число из кэша, а не свежий SQL COUNT и не перечень типов объектов.", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.getCatalogsStat() },
  { operation: decorateOperation({ "id": "native.lds.getModObjects", "profile": "native", "group": "lds", "method": "getModObjects", "title": "native lds getModObjects", "description": "Прочитать объекты, изменённые после `minModDate`; дата необязательна.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "minModDate": { "type": "string" }, "compress": { "type": "boolean" } }, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.getModObjects(prepare(args, { "type": "object", "properties": { "minModDate": { "type": "string" }, "compress": { "type": "boolean" } }, "required": [], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.loadUrl", "profile": "native", "group": "lds", "method": "loadUrl", "title": "native lds loadUrl", "description": "Прочитать данные по URL; флаги ответа выбирают поток, а `tryLock` меняет состояние блокировки.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "useBinaryResponse": { "type": "boolean" }, "useMultipartResponse": { "type": "boolean" }, "tryLock": { "type": "boolean" }, "compress": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.loadUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "useBinaryResponse": { "type": "boolean" }, "useMultipartResponse": { "type": "boolean" }, "tryLock": { "type": "boolean" }, "compress": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.putUrl", "profile": "native", "group": "lds", "method": "putUrl", "title": "native lds putUrl", "description": "Записать по URL текст или двоичные данные как есть, вложением XOP.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] } }, "required": ["url", "data"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.putUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] } }, "required": ["url", "data"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.deleteUrl", "profile": "native", "group": "lds", "method": "deleteUrl", "title": "native lds deleteUrl", "description": "Удалить данные по URL; можно потребовать, чтобы они существовали.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.deleteUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.loadDoc", "profile": "native", "group": "lds", "method": "loadDoc", "title": "native lds loadDoc", "description": "Прочитать документ; `tryLock` меняет состояние блокировки.\nНа сервере 2025.1.1171 LoadDoc отвечает SOAP и при флагах двоичного или multipart-ответа.\nФлаги включают выдачу ответа потоком байтов, в котором может оказаться конверт SOAP;\nвида ответа они не гарантируют.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "useBinaryResponse": { "type": "boolean" }, "useMultipartResponse": { "type": "boolean" }, "tryLock": { "type": "boolean" }, "compress": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.loadDoc(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "useBinaryResponse": { "type": "boolean" }, "useMultipartResponse": { "type": "boolean" }, "tryLock": { "type": "boolean" }, "compress": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.putDoc", "profile": "native", "group": "lds", "method": "putDoc", "title": "native lds putDoc", "description": "Сохранить свой XML вложением XOP.\nБез `skipActions` или с `false` сервер выполняет обработку перед сохранением; `true` её отключает.\n`data` — только результат `rawXml()`.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "writeDocInfo": { "type": "boolean" }, "skipActions": { "type": "boolean" }, "neverSaved": { "type": "boolean" }, "data": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["url", "data"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.putDoc(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "writeDocInfo": { "type": "boolean" }, "skipActions": { "type": "boolean" }, "neverSaved": { "type": "boolean" }, "data": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["url", "data"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.deleteDoc", "profile": "native", "group": "lds", "method": "deleteDoc", "title": "native lds deleteDoc", "description": "Удалить документ по URL; можно потребовать, чтобы он существовал.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.deleteDoc(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.getNewObjectId", "profile": "native", "group": "lds", "method": "getNewObjectId", "title": "native lds getNewObjectId", "description": "Выделить новый ID объекта в выбранной базе, без потери точности.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "dbName": { "type": "string" }, "objectType": { "type": "string" } }, "required": ["dbName"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.getNewObjectId(prepare(args, { "type": "object", "properties": { "dbName": { "type": "string" }, "objectType": { "type": "string" } }, "required": ["dbName"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.xQuery", "profile": "native", "group": "lds", "method": "xQuery", "title": "native lds xQuery", "description": "Выполнить XQuery; постраничное чтение и курсор необязательны.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" }, "startPos": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "maxCount": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "expectToReadAll": { "type": "boolean" }, "keepCursor": { "type": "boolean" }, "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["query"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.xQuery(prepare(args, { "type": "object", "properties": { "query": { "type": "string" }, "startPos": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "maxCount": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "expectToReadAll": { "type": "boolean" }, "keepCursor": { "type": "boolean" }, "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["query"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.releaseCursor", "profile": "native", "group": "lds", "method": "releaseCursor", "title": "native lds releaseCursor", "description": "Освободить курсор, выданный ранее этой сессии LDS.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["cursorId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.releaseCursor(prepare(args, { "type": "object", "properties": { "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["cursorId"], "additionalProperties": false })["cursorId"]) },
  { operation: decorateOperation({ "id": "native.lds.runMethod", "profile": "native", "group": "lds", "method": "runMethod", "title": "native lds runMethod", "description": "Выполнить функцию библиотеки сервера; аргументы — дочерние элементы XML в `ArgData`.\nНа сервере 2025.1.1171 аргументы принимаются только как XML в теле SOAP:\nвнешнее вложение XOP отклоняется с Parameter is not XML.\nRunAsync выполняет функцию в отдельном внутреннем потоке и не возвращает ID задачи;\nпервый ResultData может прийти с типом undefined и не означает завершения.\nGetAsyncMethodStatus и KillAsyncMethod такое выполнение не отслеживают.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" }, "runAsync": { "type": "boolean" }, "errorLogName": { "type": "string" }, "argData": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["libName", "methodName", "argData"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.runMethod(prepare(args, { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" }, "runAsync": { "type": "boolean" }, "errorLogName": { "type": "string" }, "argData": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["libName", "methodName", "argData"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.idle", "profile": "native", "group": "lds", "method": "idle", "title": "native lds idle", "description": "Продлить текущую сессию native LDS.", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.idle() },
  { operation: decorateOperation({ "id": "web.lds.xQuery", "profile": "web", "group": "lds", "method": "xQuery", "title": "web lds xQuery", "description": "Выполнить XQuery через web LDS. `keepCursor` по умолчанию `true`; для разового чтения нужен `false`.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" }, "startPos": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "maxCount": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "keepCursor": { "type": "boolean" }, "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["query"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lds.xQuery(prepare(args, { "type": "object", "properties": { "query": { "type": "string" }, "startPos": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "maxCount": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "keepCursor": { "type": "boolean" }, "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["query"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.lds.releaseCursor", "profile": "web", "group": "lds", "method": "releaseCursor", "title": "web lds releaseCursor", "description": "Освободить свой курсор web LDS.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["cursorId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lds.releaseCursor(prepare(args, { "type": "object", "properties": { "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["cursorId"], "additionalProperties": false })["cursorId"]) },
  { operation: decorateOperation({ "id": "web.lds.runMethod", "profile": "web", "group": "lds", "method": "runMethod", "title": "web lds runMethod", "description": "Выполнить штатный RunMethod LDS в этой веб-сессии по SOAP 1.1.\nArgData содержит дочерние элементы XML с типами; SessionID идёт перед ними.\nRunAsync выполняет функцию в отдельном внутреннем потоке и не возвращает ID задачи;\nпервый ResultData может прийти с типом undefined и не означает завершения.\nGetAsyncMethodStatus и KillAsyncMethod такое выполнение не отслеживают.\nПрава сервера на вызываемую функцию действуют и здесь, независимо от профиля web.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" }, "runAsync": { "type": "boolean" }, "errorLogName": { "type": "string" }, "argData": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["libName", "methodName", "argData"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lds.runMethod(prepare(args, { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" }, "runAsync": { "type": "boolean" }, "errorLogName": { "type": "string" }, "argData": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["libName", "methodName", "argData"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.lds.deleteDoc", "profile": "web", "group": "lds", "method": "deleteDoc", "title": "web lds deleteDoc", "description": "Удалить документ; `StrictDelete=1` отправляется, только когда он включён.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lds.deleteDoc(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.rpc.call", "profile": "native", "group": "rpc", "method": "call", "title": "native rpc call", "description": "Вызвать функцию библиотеки сервера; своим списком функций клиент вызов не ограничивает.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).rpc.call(prepare(args, { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.rpc.call", "profile": "web", "group": "rpc", "method": "call", "title": "web rpc call", "description": "Вызвать функцию библиотеки сервера; своим списком функций клиент вызов не ограничивает.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).rpc.call(prepare(args, { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.spxml.call", "profile": "native", "group": "spxml", "method": "call", "title": "native spxml call", "description": "Вызвать функцию библиотеки сервера; своим списком функций клиент вызов не ограничивает.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).spxml.call(prepare(args, { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.callMethod", "profile": "web", "group": "spxml", "method": "callMethod", "title": "web spxml callMethod", "description": "Вызвать функцию библиотеки синхронно. Вызванная функция может менять данные.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.callMethod(prepare(args, { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.callMethodAsync", "profile": "web", "group": "spxml", "method": "callMethodAsync", "title": "web spxml callMethodAsync", "description": "Запустить функцию библиотеки фоновой задачей; ответ содержит TrackingID без потери точности.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.callMethodAsync(prepare(args, { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.getBackgroundTasksByName", "profile": "web", "group": "spxml", "method": "getBackgroundTasksByName", "title": "web spxml getBackgroundTasksByName", "description": "Перечислить фоновые задачи по имени библиотеки и функции.\nНа сервере 2025.1.1171 пул задач общий для приложения, в нём бывают чужие задачи;\nсовпадение имени не значит, что задача своя. Устаревшие записи о завершённых задачах\nудаляются до отбора. Недавно завершённые задачи этот список\nне расходует: их состояние и результат входят в каждый Task.\nДля опроса и остановки нужен TrackingID, записанный отдельно при запуске.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" } }, "required": ["libName", "methodName"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.getBackgroundTasksByName(prepare(args, { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" } }, "required": ["libName", "methodName"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.getAsyncMethodStatus", "profile": "web", "group": "spxml", "method": "getAsyncMethodStatus", "title": "web spxml getAsyncMethodStatus", "description": "Прочитать состояние фоновой задачи по TrackingID в исходной записи: десятичной или `0x`.\nНа сервере 2025.1.1171 первый ответ о завершении расходует запись о задаче.\nЭтот ответ нужно сохранить сразу и завершённый ID больше не опрашивать:\nесли ответ HTTP потерян, результат уже израсходован. Другие сборки проверяются отдельно.\nИдущую задачу опрашивать не чаще раза в 250 мс.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.getAsyncMethodStatus(prepare(args, { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false })["trackingId"]) },
  { operation: decorateOperation({ "id": "web.spxml.killAsyncMethod", "profile": "web", "group": "spxml", "method": "killAsyncMethod", "title": "web spxml killAsyncMethod", "description": "Запросить остановку задачи; остановка уже завершённой задачи не гарантирована.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.killAsyncMethod(prepare(args, { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false })["trackingId"]) },
  { operation: decorateOperation({ "id": "web.spxml.getDoc", "profile": "web", "group": "spxml", "method": "getDoc", "title": "web spxml getDoc", "description": "Прочитать XML документа в UTF-8, если не задан `charset`; кодировка из заголовков ответа важнее.\nСервер 2025.1.1171 не принимает параметр TryLock на этом маршруте:\nзначение в строке запроса отклоняется.\nПроверенный способ заблокировать документ — LoadDoc через native LDS.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string" }, "charset": { "type": "string" }, "tryLock": { "type": "boolean" } }, "required": ["docUrl"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.getDoc(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string" }, "charset": { "type": "string" }, "tryLock": { "type": "boolean" } }, "required": ["docUrl"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.putDoc", "profile": "web", "group": "spxml", "method": "putDoc", "title": "web spxml putDoc", "description": "Сохранить свой XML через web SPXML; сервер выполняет обработку перед сохранением.\n`neverSaved=true` отправляет `NeverSaved=1`; при false или без значения флаг не отправляется. Управления `SkipActions` на этом маршруте нет.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string" }, "document": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, "writeDocInfo": { "type": "boolean" }, "neverSaved": { "type": "boolean" } }, "required": ["docUrl", "document"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.putDoc(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string" }, "document": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, "writeDocInfo": { "type": "boolean" }, "neverSaved": { "type": "boolean" } }, "required": ["docUrl", "document"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.spxml2.getAppInfo", "profile": "native", "group": "spxml2", "method": "getAppInfo", "title": "native spxml2 getAppInfo", "description": "Прочитать сведения сервера о приложении; `application_module` необязателен и может отсутствовать.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "fastStart": { "type": "boolean" }, "anonymous": { "type": "boolean" }, "openSession": { "type": "boolean" }, "rnd": { "type": "number" } }, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).spxml2.getAppInfo(prepare(args, { "type": "object", "properties": { "fastStart": { "type": "boolean" }, "anonymous": { "type": "boolean" }, "openSession": { "type": "boolean" }, "rnd": { "type": "number" } }, "required": [], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.spxml2.getForm", "profile": "native", "group": "spxml2", "method": "getForm", "title": "native spxml2 getForm", "description": "Прочитать форму по локальному URL сервера как текст в кодировке ответа.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).spxml2.getForm(prepare(args, { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml2.getAppInfo", "profile": "web", "group": "spxml2", "method": "getAppInfo", "title": "web spxml2 getAppInfo", "description": "Прочитать сведения сервера о приложении; по умолчанию отправляет `fast_start=1` и случайный `rnd`.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "fastStart": { "type": "boolean" }, "anonymous": { "type": "boolean" }, "openSession": { "type": "boolean" }, "rnd": { "type": "number" } }, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml2.getAppInfo(prepare(args, { "type": "object", "properties": { "fastStart": { "type": "boolean" }, "anonymous": { "type": "boolean" }, "openSession": { "type": "boolean" }, "rnd": { "type": "number" } }, "required": [], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml2.getForm", "profile": "web", "group": "spxml2", "method": "getForm", "title": "web spxml2 getForm", "description": "Прочитать форму по локальному URL сервера как текст в кодировке ответа.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml2.getForm(prepare(args, { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml2.getImage", "profile": "web", "group": "spxml2", "method": "getImage", "title": "web spxml2 getImage", "description": "Прочитать потоком картинку web SPXML2; параметры эффектов необязательны.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "effects": { "type": "object", "additionalProperties": { "anyOf": [{ "type": "string" }, { "type": "number" }, { "type": "boolean" }, { "type": "null" }] } } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml2.getImage(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "effects": { "type": "object", "additionalProperties": { "anyOf": [{ "type": "string" }, { "type": "number" }, { "type": "boolean" }, { "type": "null" }] } } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml2.getPreloadedDesignFiles", "profile": "web", "group": "spxml2", "method": "getPreloadedDesignFiles", "title": "web spxml2 getPreloadedDesignFiles", "description": "Прочитать набор предзагружаемых файлов оформления default.", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml2.getPreloadedDesignFiles() },
  { operation: decorateOperation({ "id": "web.spxml2.stdEncrypt", "profile": "web", "group": "spxml2", "method": "stdEncrypt", "title": "web spxml2 stdEncrypt", "description": "Вызвать штатную службу сервера `std_encrypt`; это не средство шифрования общего назначения на стороне клиента.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml2.stdEncrypt(prepare(args, { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"], "additionalProperties": false })["text"]) },
  { operation: decorateOperation({ "id": "web.pages.filePreviewPdf", "profile": "web", "group": "pages", "method": "filePreviewPdf", "title": "web pages filePreviewPdf", "description": "Прочитать штатную страницу предпросмотра PDF как текст.", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.filePreviewPdf() },
  { operation: decorateOperation({ "id": "web.pages.getForm", "profile": "web", "group": "pages", "method": "getForm", "title": "web pages getForm", "description": "Прочитать форму по локальному URL сервера как текст.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.getForm(prepare(args, { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.getScreenForm", "profile": "web", "group": "pages", "method": "getScreenForm", "title": "web pages getScreenForm", "description": "Прочитать экранную форму по локальному URL сервера как текст.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.getScreenForm(prepare(args, { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.getImage", "profile": "web", "group": "pages", "method": "getImage", "title": "web pages getImage", "description": 'Прочитать потоком SVG через штатную страницу картинок веб-интерфейса. Сервер принимает\nURL SVG в x-app и x-local и проверяет право чтения источника. Необязательные значения state\nhover, pressed и disabled включают штатную подмену цветов; при других значениях\nсодержимое остаётся исходным. Без значения отправляется state="": штатная\nстраница требует это поле запроса. Тело ответа нужно дочитать или отменить.', "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "state": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.getImage(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "state": { "type": "string" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.getUiText", "profile": "web", "group": "pages", "method": "getUiText", "title": "web pages getUiText", "description": "Прочитать и разобрать XML текстов веб-интерфейса в кодировке, объявленной приложением.", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.getUiText() },
  { operation: decorateOperation({ "id": "web.pages.getUrl", "profile": "web", "group": "pages", "method": "getUrl", "title": "web pages getUrl", "description": "Прочитать потоком ответ службы страниц по URL; тело нужно дочитать или отменить.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "navigate": { "type": "boolean" }, "download": { "type": "boolean" }, "base64": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.getUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "navigate": { "type": "boolean" }, "download": { "type": "boolean" }, "base64": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.uploadFile", "profile": "web", "group": "pages", "method": "uploadFile", "title": "web pages uploadFile", "description": "Загрузить один файл штатным способом: multipart с полями f и session_token.\nТекущий токен страницы подставляет веб-сессия, которой принадлежит вызов. Размер\nограничен maxResponseBytes и пределом клиента 8 МиБ; части и старый вариант\nс base64 не используются. Успешный ответ содержит Url.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "filename": { "type": "string", "minLength": 1, "maxLength": 255, "pattern": "^(?!\\.\\.)(?!.*\\.\\.$)(?!\\.$)[^\\\\/\\x00-\\x1F\\x7F]+$" }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] }, "contentType": { "type": "string", "minLength": 1, "maxLength": 256, "pattern": "^[\\x20-\\x7E]+$" } }, "required": ["filename", "data"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.uploadFile(prepare(args, { "type": "object", "properties": { "filename": { "type": "string", "minLength": 1, "maxLength": 255, "pattern": "^(?!\\.\\.)(?!.*\\.\\.$)(?!\\.$)[^\\\\/\\x00-\\x1F\\x7F]+$" }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] }, "contentType": { "type": "string", "minLength": 1, "maxLength": 256, "pattern": "^[\\x20-\\x7E]+$" } }, "required": ["filename", "data"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.uploadChunk", "profile": "web", "group": "pages", "method": "uploadChunk", "title": "web pages uploadChunk", "description": "Отправить один штатный POST upload_chunk с байтами данных как есть и явным Content-Range.\nВызывающий задаёт известный fileId из 32 шестнадцатеричных цифр и следит за порядком частей; последняя часть собирает файл.\nОтветы сами по себе не доказывают, что часть сохранена и что байты итогового файла верны.\nПеред последней частью загруженное нужно проверить чтением, подходящим для хранилища.\nПосле ошибки на последней части URL результата может остаться неизвестным: не повторять и не угадывать, что удалять.\nНужна установленная ветка WebSoft/libMain и её действующие правила для пользователя и загрузки.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "fileId": { "type": "string", "minLength": 32, "maxLength": 32, "pattern": "^[0-9a-fA-F]{32}$" }, "filename": { "type": "string", "minLength": 1, "maxLength": 255, "pattern": "^(?!\\.\\.)(?!.*\\.\\.$)(?!\\.$)[^\\\\/\\x00-\\x1F\\x7F]+$" }, "index": { "type": "integer", "minimum": 0, "maximum": 99999 }, "chunksTotal": { "type": "integer", "minimum": 1, "maximum": 1e5 }, "totalBytes": { "type": "integer", "minimum": 1, "maximum": 9007199254740991 }, "offset": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] }, "contentType": { "type": "string", "minLength": 1, "maxLength": 256, "pattern": "^[\\x20-\\x7E]+$" } }, "required": ["fileId", "filename", "index", "chunksTotal", "totalBytes", "offset", "data"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.uploadChunk(prepare(args, { "type": "object", "properties": { "fileId": { "type": "string", "minLength": 32, "maxLength": 32, "pattern": "^[0-9a-fA-F]{32}$" }, "filename": { "type": "string", "minLength": 1, "maxLength": 255, "pattern": "^(?!\\.\\.)(?!.*\\.\\.$)(?!\\.$)[^\\\\/\\x00-\\x1F\\x7F]+$" }, "index": { "type": "integer", "minimum": 0, "maximum": 99999 }, "chunksTotal": { "type": "integer", "minimum": 1, "maximum": 1e5 }, "totalBytes": { "type": "integer", "minimum": 1, "maximum": 9007199254740991 }, "offset": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] }, "contentType": { "type": "string", "minLength": 1, "maxLength": 256, "pattern": "^[\\x20-\\x7E]+$" } }, "required": ["fileId", "filename", "index", "chunksTotal", "totalBytes", "offset", "data"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.clearUploadChunks", "profile": "web", "group": "pages", "method": "clearUploadChunks", "title": "web pages clearUploadChunks", "description": "Запросить удаление частей [0, chunksTotal) для известного fileId из 32 шестнадцатеричных цифр, выбранного вызывающим.\nПространство ID общее: сервер не проверяет, кто создал этот ID.\nПустой ответ не доказывает, что части, папка, итоговый файл и временные данные удалены.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "fileId": { "type": "string", "minLength": 32, "maxLength": 32, "pattern": "^[0-9a-fA-F]{32}$" }, "chunksTotal": { "type": "integer", "minimum": 1, "maximum": 1e5 } }, "required": ["fileId", "chunksTotal"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.clearUploadChunks(prepare(args, { "type": "object", "properties": { "fileId": { "type": "string", "minLength": 32, "maxLength": 32, "pattern": "^[0-9a-fA-F]{32}$" }, "chunksTotal": { "type": "integer", "minimum": 1, "maximum": 1e5 } }, "required": ["fileId", "chunksTotal"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.resources.getImage", "profile": "native", "group": "resources", "method": "getImage", "title": "native resources getImage", "description": "Прочитать потоком картинку ресурса по десятичному ID; тип картинки необязателен.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "resourceId": { "type": "string", "pattern": "^\\d+$" }, "imageType": { "type": "string" } }, "required": ["resourceId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).resources.getImage(prepare(args, { "type": "object", "properties": { "resourceId": { "type": "string", "pattern": "^\\d+$" }, "imageType": { "type": "string" } }, "required": ["resourceId"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.resources.getCompoundResource", "profile": "native", "group": "resources", "method": "getCompoundResource", "title": "native resources getCompoundResource", "description": "Прочитать потоком именованное вложение compound-attc через GET /xhttp_res.\nИсточник — url для HTML с адресом x-local или x-app либо docUrl вместе с elemPath\nдля строкового поля документа (подходит и зарегистрированный документ x-db-obj).\nelemPath начинается с имени корневого элемента документа, например presence_state.name;\nего берут из самого документа, а не угадывают корень и структуру.\nСервер декодирует данные найденного вложения и выбирает тип содержимого\nпо resId. Штатный сервер 2025.1.1171 требует ещё, чтобы источник url лежал в настроенном courses_path:\nодной разрешённой локальной схемы для этого мало.\nЭтим маршрутом пользуется штатный клиент администратора; варианты native и web —\nодин маршрут сервера, различается только сессия HTTP. Тело ответа нужно дочитать или отменить.", "status": "implemented", "inputSchema": { "anyOf": [{ "type": "object", "properties": { "url": { "type": "string" }, "resId": { "type": "string" } }, "required": ["url", "resId"], "additionalProperties": false }, { "type": "object", "properties": { "docUrl": { "type": "string" }, "elemPath": { "type": "string" }, "resId": { "type": "string" } }, "required": ["docUrl", "elemPath", "resId"], "additionalProperties": false }] } }), invoke: async (gateway, args) => (await gateway.native()).resources.getCompoundResource(prepare(args, { "anyOf": [{ "type": "object", "properties": { "url": { "type": "string" }, "resId": { "type": "string" } }, "required": ["url", "resId"], "additionalProperties": false }, { "type": "object", "properties": { "docUrl": { "type": "string" }, "elemPath": { "type": "string" }, "resId": { "type": "string" } }, "required": ["docUrl", "elemPath", "resId"], "additionalProperties": false }] })) },
  { operation: decorateOperation({ "id": "web.resources.getImage", "profile": "web", "group": "resources", "method": "getImage", "title": "web resources getImage", "description": "Прочитать потоком картинку ресурса по десятичному ID; тип картинки необязателен.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "resourceId": { "type": "string", "pattern": "^\\d+$" }, "imageType": { "type": "string" } }, "required": ["resourceId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).resources.getImage(prepare(args, { "type": "object", "properties": { "resourceId": { "type": "string", "pattern": "^\\d+$" }, "imageType": { "type": "string" } }, "required": ["resourceId"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.resources.getCompoundResource", "profile": "web", "group": "resources", "method": "getCompoundResource", "title": "web resources getCompoundResource", "description": "Прочитать потоком именованное вложение compound-attc через GET /xhttp_res.\nИсточник — url для HTML с адресом x-local или x-app либо docUrl вместе с elemPath\nдля строкового поля документа (подходит и зарегистрированный документ x-db-obj).\nelemPath начинается с имени корневого элемента документа, например presence_state.name;\nего берут из самого документа, а не угадывают корень и структуру.\nСервер декодирует данные найденного вложения и выбирает тип содержимого\nпо resId. Штатный сервер 2025.1.1171 требует ещё, чтобы источник url лежал в настроенном courses_path:\nодной разрешённой локальной схемы для этого мало.\nЭтим маршрутом пользуется штатный клиент администратора; варианты native и web —\nодин маршрут сервера, различается только сессия HTTP. Тело ответа нужно дочитать или отменить.", "status": "implemented", "inputSchema": { "anyOf": [{ "type": "object", "properties": { "url": { "type": "string" }, "resId": { "type": "string" } }, "required": ["url", "resId"], "additionalProperties": false }, { "type": "object", "properties": { "docUrl": { "type": "string" }, "elemPath": { "type": "string" }, "resId": { "type": "string" } }, "required": ["docUrl", "elemPath", "resId"], "additionalProperties": false }] } }), invoke: async (gateway, args) => (await gateway.web()).resources.getCompoundResource(prepare(args, { "anyOf": [{ "type": "object", "properties": { "url": { "type": "string" }, "resId": { "type": "string" } }, "required": ["url", "resId"], "additionalProperties": false }, { "type": "object", "properties": { "docUrl": { "type": "string" }, "elemPath": { "type": "string" }, "resId": { "type": "string" } }, "required": ["docUrl", "elemPath", "resId"], "additionalProperties": false }] })) },
  { operation: decorateOperation({ "id": "anonymous.diagnostics.xhttpInfo", "profile": "anonymous", "group": "diagnostics", "method": "xhttpInfo", "title": "anonymous diagnostics xhttpInfo", "description": "Прочитать `/xhttp_info`; авторизация Basic применяется, только если клиенту заданы учётные данные.", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => gateway.client.diagnostics.xhttpInfo() },
  { operation: decorateOperation({ "id": "anonymous.experimental.rawRequest", "profile": "anonymous", "group": "experimental", "method": "rawRequest", "title": "anonymous experimental rawRequest", "description": "Отправить свой запрос на тот же origin и вернуть тело ответа потоком.\n`unsafe: true` обязателен. Сериализация обычных операций, разбор ошибок сервера и гарантии об исходе записи не действуют;\nнастроенные авторизация и cookie применяются, а метод, заголовки, тело и закрытие потока — на вызывающем.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false } }), invoke: async (gateway, args) => gateway.client.experimental.rawRequest(prepare(args, { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.experimental.rawRequest", "profile": "native", "group": "experimental", "method": "rawRequest", "title": "native experimental rawRequest", "description": "Отправить свой запрос на тот же origin и вернуть тело ответа потоком.\n`unsafe: true` обязателен. Сериализация обычных операций, разбор ошибок сервера и гарантии об исходе записи не действуют;\nнастроенные авторизация и cookie применяются, а метод, заголовки, тело и закрытие потока — на вызывающем.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.rawRequest(prepare(args, { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.experimental.rawRequest", "profile": "web", "group": "experimental", "method": "rawRequest", "title": "web experimental rawRequest", "description": "Отправить свой запрос на тот же origin и вернуть тело ответа потоком.\n`unsafe: true` обязателен. Сериализация обычных операций, разбор ошибок сервера и гарантии об исходе записи не действуют;\nнастроенные авторизация и cookie применяются, а метод, заголовки, тело и закрытие потока — на вызывающем.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).experimental.rawRequest(prepare(args, { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.experimental.authenticate", "profile": "web", "group": "experimental", "method": "authenticate", "title": "web experimental authenticate", "description": "Вызвать частично поддержанный маршрут веб-аутентификации; cookie и тело успешного ответа до конца не установлены.", "status": "implemented", "inputSchema": { "type": "object", "properties": { "login": { "type": "string" }, "password": { "type": "string" }, "token": { "type": "string" } }, "required": ["login", "password", "token"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).experimental.authenticate(prepare(args, { "type": "object", "properties": { "login": { "type": "string" }, "password": { "type": "string" }, "token": { "type": "string" } }, "required": ["login", "password", "token"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.lifecycle.admin", "profile": "web", "group": "lifecycle", "method": "admin", "title": "web lifecycle admin", "description": "Прочитать ответ `/admin` с перенаправлением, не переходя по нему.", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lifecycle.admin() },
  { operation: decorateOperation({ "id": "web.lifecycle.main", "profile": "web", "group": "lifecycle", "method": "main", "title": "web lifecycle main", "description": "Прочитать главную страницу веб-администратора после входа.", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lifecycle.main() },
  { operation: decorateOperation({ "id": "web.lifecycle.logout", "profile": "web", "group": "lifecycle", "method": "logout", "title": "web lifecycle logout", "description": "Выполнить оба шага выхода; при потере связи дальнейшие запросы не отправляются.", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lifecycle.logout() }
];

// src/immutable.ts
function freezeRegistry(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeRegistry(child);
    Object.freeze(value);
  }
  return value;
}

// src/native/gateway.ts
var empty = { type: "object", properties: {}, required: [], additionalProperties: false };
var managed = [];
managed.push({
  operation: {
    id: "anonymous.diagnostics.portal",
    profile: "anonymous",
    group: "diagnostics",
    method: "portal",
    title: "Portal status",
    description: "Прочитать статус стартовой страницы портала без перенаправлений и тела.",
    effect: "read",
    status: "implemented",
    inputSchema: empty
  },
  invoke: async (gateway) => gateway.client.diagnostics.portal()
});
managed.push({
  operation: {
    id: "web.websocket.heartbeat",
    profile: "web",
    group: "websocket",
    method: "heartbeat",
    title: "Stock WebSocket heartbeat",
    description: "Отправить один $hbt на /services/main_ws_service с ограничением по времени и дождаться $ok. Ответ различает закрытие со стороны сервера и отсутствие подтверждения; прикладные сообщения и браузерный /api/spxml2/ws не охвачены.",
    effect: "read",
    status: "implemented",
    inputSchema: {
      type: "object",
      properties: { timeoutMs: { type: "integer", minimum: 250, maximum: 1e4 } },
      required: [],
      additionalProperties: false
    }
  },
  invoke: async (gateway, args) => {
    gateway.client.assertWebSocketAvailable();
    return (await gateway.web()).heartbeat(args);
  }
});
for (const profile of ["native", "web"]) {
  for (const method of ["open", "close"]) {
    managed.push({
      operation: {
        id: `${profile}.session.${method}`,
        profile,
        group: "session",
        method,
        title: `${profile} session ${method}`,
        description: "Открыть или закрыть сессию, которой владеет клиент. Cookie и ID сессии LDS остаются внутри этого процесса.",
        effect: "read",
        status: "implemented",
        inputSchema: empty
      },
      invoke: method === "open" ? async (gateway) => {
        if (profile === "native") await gateway.native();
        else await gateway.web();
        return { opened: true, profile };
      } : async (gateway) => {
        await gateway.closeProfile(profile);
        return { closed: true, profile };
      }
    });
  }
}
managed.push({
  operation: {
    id: "native.lds.closeSession",
    profile: "native",
    group: "lds",
    method: "closeSession",
    title: "Close native LDS context",
    description: "Закрыть сессию LDS и HTTP и убрать её из кэша сессий клиента.",
    effect: "read",
    status: "implemented",
    inputSchema: empty
  },
  invoke: async (gateway) => {
    await gateway.closeProfile("native");
    return { closed: true };
  }
});
managed.push({
  operation: {
    id: "web.lds.closeSession",
    profile: "web",
    group: "lds",
    method: "closeSession",
    title: "Close web LDS context",
    description: "Закрыть сессию web LDS и HTTP и убрать её из кэша сессий клиента.",
    effect: "read",
    status: "implemented",
    inputSchema: empty
  },
  invoke: async (gateway) => {
    await gateway.closeProfile("web");
    return { closed: true };
  }
});
managed.push({
  operation: {
    id: "native.lds.openSession",
    profile: "native",
    group: "lds",
    method: "openSession",
    title: "Open native LDS context",
    description: "Открыть сессию native, которой владеет клиент. Внутренние ID сессии остаются в клиенте.",
    effect: "read",
    status: "implemented",
    inputSchema: empty
  },
  invoke: async (gateway) => {
    await gateway.native();
    return { opened: true };
  }
});
managed.push({
  operation: {
    id: "web.lds.openSession",
    profile: "web",
    group: "lds",
    method: "openSession",
    title: "Open web LDS context",
    description: "Открыть сессию web, которой владеет клиент. Внутренние ID сессии остаются в клиенте.",
    effect: "read",
    status: "implemented",
    inputSchema: empty
  },
  invoke: async (gateway) => {
    await gateway.web();
    return { opened: true };
  }
});
managed.push({
  operation: {
    id: "native.physicalDocuments.createFromXml",
    profile: "native",
    group: "physicalDocuments",
    method: "createFromXml",
    title: "Create a physical XML document",
    description: "Выделить ID, подставить его вместо {{objectId}} в documentXmlTemplate, сохранить через PutDoc и сверить ID корня через LoadDoc. Обработка XMD, как в клиенте администратора, не воспроизводится.",
    effect: "write",
    status: "implemented",
    inputSchema: {
      type: "object",
      properties: {
        documentXmlTemplate: { type: "string" },
        dbName: { type: "string" },
        writeDocInfo: { type: "boolean" },
        skipActions: { type: "boolean" },
        neverSaved: { type: "boolean" }
      },
      required: ["documentXmlTemplate"],
      additionalProperties: false
    }
  },
  invoke: async (gateway, args) => {
    const session = await gateway.native();
    return session.physicalDocuments.createFromXml({
      ...args.dbName === void 0 ? {} : { dbName: args.dbName },
      ...args.writeDocInfo === void 0 ? {} : { writeDocInfo: args.writeDocInfo },
      ...args.skipActions === void 0 ? {} : { skipActions: args.skipActions },
      ...args.neverSaved === void 0 ? {} : { neverSaved: args.neverSaved },
      document: ({ objectId }) => rawXml(args.documentXmlTemplate.replaceAll("{{objectId}}", objectId))
    });
  }
});
var entries = freezeRegistry([...NATIVE_ENTRIES, ...managed]);
var byId = new Map(entries.map((entry) => [entry.operation.id, entry]));
if (byId.size !== entries.length) throw new Error("ID низкоуровневой операции повторяется");
function getNativeOperations() {
  return entries.map((entry) => entry.operation).filter((item) => !isInternalNative(item.id));
}
function nativeEffect(id, args) {
  const entry = byId.get(id);
  return entry && getEffectiveNativeEffect(entry.operation, args);
}
function sessionGone(error) {
  if (!(error instanceof WsHcmApiError) || error.kind !== "cleanup") return false;
  const causes = error.cause instanceof AggregateError ? error.cause.errors : [error.cause];
  return causes.every((cause) => cause instanceof WsHcmApiError && cause.status === 401);
}
var failedLogins = /* @__PURE__ */ new WeakSet();
function loginFailed(error) {
  return typeof error === "object" && error !== null && failedLogins.has(error);
}
var NativeGateway = class {
  client;
  nativeSession;
  webSession;
  closed = false;
  accepting = true;
  queue = Promise.resolve();
  closePromise;
  constructor(config) {
    if (config.username === void 0 !== (config.password === void 0))
      throw new TypeError("Имя пользователя и пароль задают вместе.");
    this.client = new WsHcmClient({
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      ...config.fetch ? { fetch: config.fetch } : {},
      ...config.webSocketFactory === void 0 ? {} : { webSocketFactory: config.webSocketFactory },
      ...config.username === void 0 ? {} : { auth: { username: config.username, password: config.password } }
    });
  }
  assertOpen() {
    if (this.closed) throw new WsHcmApiError("protocol", "Шлюз закрыт");
  }
  native() {
    this.assertOpen();
    return this.nativeSession ??= this.client.openNativeSession().catch((error) => {
      this.nativeSession = void 0;
      if (error instanceof Error) failedLogins.add(error);
      throw error;
    });
  }
  web() {
    this.assertOpen();
    return this.webSession ??= this.client.openWebSession().catch((error) => {
      this.webSession = void 0;
      if (error instanceof Error) failedLogins.add(error);
      throw error;
    });
  }
  takeProfile(profile) {
    const session = profile === "native" ? this.nativeSession : this.webSession;
    if (profile === "native") this.nativeSession = void 0;
    else this.webSession = void 0;
    return session;
  }
  async closeProfile(profile) {
    const session = this.takeProfile(profile);
    if (session) await (await session).close();
  }
  call(id, args) {
    if (!this.accepting) return Promise.reject(new WsHcmApiError("protocol", "Шлюз закрыт"));
    const entry = byId.get(id);
    if (!entry)
      return Promise.reject(new WsHcmApiError("protocol", "Неизвестная низкоуровневая операция"));
    let snapshot;
    try {
      snapshot = structuredClone(args);
      prepare(snapshot, entry.operation.inputSchema);
    } catch (error) {
      return Promise.reject(error);
    }
    const run = this.queue.then(async () => {
      let failed = false;
      let operationError;
      try {
        return await this.output(await this.invoke(entry, snapshot));
      } catch (error) {
        failed = true;
        operationError = error;
        throw error;
      } finally {
        if (id === "web.lifecycle.logout") {
          const session = this.webSession;
          this.webSession = void 0;
          if (session) {
            try {
              (await session).disposeLocal();
            } catch (cleanupError) {
              if (failed) attachCleanupError(operationError, cleanupError);
              else throw cleanupError;
            }
          }
        }
      }
    });
    this.queue = run.catch(() => void 0);
    return run;
  }
  /**
   * Сервер сбрасывает сессию, простоявшую без дела (на стендах — в пределах двадцати минут),
   * или закрытую с его стороны; каждый следующий запрос получает HTTP 401. Долгоживущий владелец
   * остался бы без доступа, поэтому сброшенная сессия заменяется новым входом, и запрос
   * отправляется ещё раз. Сервер отклоняет такой запрос до обработки, поэтому повтор не может
   * выполнить что-либо дважды.
   */
  async invoke(entry, args) {
    const profile = entry.operation.profile;
    const session = profile === "native" ? this.nativeSession : profile === "web" ? this.webSession : void 0;
    try {
      return await entry.invoke(this, args);
    } catch (error) {
      if (session === void 0 || profile === "anonymous" || !(error instanceof WsHcmApiError) || error.kind !== "auth" || error.status !== 401 || /(?:^|[.])(?:session|lifecycle)[.]|[.](?:open|close)Session$/.test(entry.operation.id))
        throw error;
      const current = profile === "native" ? this.nativeSession : this.webSession;
      if (current === session) {
        this.takeProfile(profile);
        (await session).disposeLocal();
      }
      return entry.invoke(this, args);
    }
  }
  async output(result) {
    if (result === void 0) return { completed: true };
    if (result instanceof WsHcmBinaryResponse) {
      const bytes = new Uint8Array(await new Response(result.body).arrayBuffer());
      return {
        kind: "binary",
        bytes,
        contentType: result.headers.get("content-type") ?? "application/octet-stream"
      };
    }
    if (result && typeof result === "object" && "data" in result && "rawBody" in result)
      return result.data;
    if (result && typeof result === "object" && "putResponse" in result) {
      const created = result;
      return { objectId: created.objectId, url: created.url, document: created.loadResponse.data };
    }
    return result;
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.accepting = false;
    return this.closePromise = this.finishClose();
  }
  async finishClose() {
    await this.queue;
    this.closed = true;
    const errors = [];
    let transportLost = false;
    for (const profile of ["native", "web"]) {
      try {
        if (transportLost) {
          const session = this.takeProfile(profile);
          if (session) (await session).disposeLocal();
        } else await this.closeProfile(profile);
      } catch (error) {
        if (sessionGone(error)) continue;
        errors.push(error);
        transportLost ||= isTransportFailure(error);
      }
    }
    this.client.close();
    if (errors.length)
      throw new WsHcmApiError("cleanup", "Не удалось закрыть сессии шлюза", {
        details: { errorCount: errors.length, remoteCleanupStopped: transportLost },
        cause: errors.length === 1 ? errors[0] : new AggregateError(errors, "Ошибки при закрытии сессий шлюза")
      });
  }
};

export {
  freezeRegistry,
  validate,
  prepare,
  getEffectiveNativeEffect,
  getNativeOperations,
  nativeEffect,
  loginFailed,
  NativeGateway
};
