import { createRequire as __wtctlRequire } from "node:module";
const require = __wtctlRequire(import.meta.url);
import {
  WsHcmApiError,
  WsHcmBinaryResponse,
  WsHcmClient,
  XHttpBinaryResponse,
  attachCleanupError,
  isTransportFailure,
  rawXml,
  rawXmlElement
} from "./chunk-L5K4UXEU.js";

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
  "web.websocket.heartbeat": "One bounded raw $hbt/$ok exchange on the fixed stock /services/main_ws_service route. Uses the gateway-owned web cookie, closes the socket locally and reports peer EOF separately from a close acknowledgement. No business payload, event subscription, browser LDS WebSocket binding or automatic reconnect is implied. On server 2025.1.1171 the main service returned $ok and then EOF without a peer close frame.",
  "web.experimental.authenticate": "Partial shipped browser JSON login shape requiring its own login-page token. Server 2025.1.1171 has no authenticate route in its built-in SPXML2 API; optional application hooks may differ. On the tested installation the stock login page returned HTTP 200 with a rendered error and no token, so no authenticate POST or managed-ticket revocation was exercised. Successful body and cookie semantics remain unverified.",
  "web.experimental.getUiTemplate": "Partial shipped browser UI-template route. Server 2025.1.1171 has no get_ui_template route in its built-in SPXML2 API; optional application hooks and other deployments may differ. A usable configured handler and its response semantics require independent verification.",
  "native.experimental.readDirectory": "Low-level directory wire adapter; flag types are lexical/raw. WebSoft HCM 2025.1.1171 does not know ReadDirectory: all three known-directory variants returned SOAP faults. Use logs.list and logs.read for remote server logs. Support on other builds requires verification.",
  "native.lds.eval": "Low-level native LDS Eval wire adapter; arbitrary code has execute effect. On WebSoft HCM 2025.1.1171 native and web LDS return Unknown method: Eval, including with ALLOW-SERVER-EVAL enabled. Use execute.script through the verified built-in RPC route. Support on other builds requires verification.",
  "web.lds.eval": "Low-level web LDS Eval wire adapter; arbitrary code has execute effect. On WebSoft HCM 2025.1.1171 native and web LDS return Unknown method: Eval, including with ALLOW-SERVER-EVAL enabled. Use execute.script through the verified built-in RPC route. Support on other builds requires verification."
};
function decorateOperation(operation) {
  const description = compatibilityDescriptions[operation.id];
  return description === void 0 ? operation : { ...operation, description };
}
function getEffectiveNativeEffect(operation, args) {
  const isReference = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.$ref === "string";
  const deferredArgs = isReference(args);
  if ((operation.method === "loadDoc" || operation.method === "loadUrl" || operation.method === "getDoc") && (deferredArgs || args.tryLock === true || isReference(args.tryLock)))
    return "write";
  if (operation.profile === "legacy" && operation.method === "getUrl" && (deferredArgs || args.lock === true || isReference(args.lock)))
    return "write";
  return operation.effect;
}

// src/native/generated.ts
var NATIVE_ENTRIES = [
  { operation: decorateOperation({ "id": "native.lds.getCatalogsStat", "profile": "native", "group": "lds", "method": "getCatalogsStat", "title": "native lds getCatalogsStat", "description": "Returns ready entries from the current context's classic catalog-stat cache.\nAn empty Catalogs response is valid; readiness and skip gates may hide entries.\nRecordsNum is cached metadata, not a fresh SQL COUNT or an object-type registry.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.getCatalogsStat() },
  { operation: decorateOperation({ "id": "native.lds.getModObjects", "profile": "native", "group": "lds", "method": "getModObjects", "title": "native lds getModObjects", "description": "Returns modified objects since optional `minModDate`.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "minModDate": { "type": "string" }, "compress": { "type": "boolean" } }, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.getModObjects(prepare(args, { "type": "object", "properties": { "minModDate": { "type": "string" }, "compress": { "type": "boolean" } }, "required": [], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.getModDeletedObjects", "profile": "native", "group": "lds", "method": "getModDeletedObjects", "title": "native lds getModDeletedObjects", "description": "Returns deleted-object changes. Availability and server-side storage dependencies must be checked on the connected server.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "minModDate": { "type": "string" }, "compress": { "type": "boolean" } }, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.getModDeletedObjects(prepare(args, { "type": "object", "properties": { "minModDate": { "type": "string" }, "compress": { "type": "boolean" } }, "required": [], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.loadUrl", "profile": "native", "group": "lds", "method": "loadUrl", "title": "native lds loadUrl", "description": "Calls the implemented NativeLdsApi.loadUrl wire operation. Server authorization and availability are checked at execution time.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "useBinaryResponse": { "type": "boolean" }, "useMultipartResponse": { "type": "boolean" }, "tryLock": { "type": "boolean" }, "compress": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.loadUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "useBinaryResponse": { "type": "boolean" }, "useMultipartResponse": { "type": "boolean" }, "tryLock": { "type": "boolean" }, "compress": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.putUrl", "profile": "native", "group": "lds", "method": "putUrl", "title": "native lds putUrl", "description": "Writes exact text/binary URL data as an XOP attachment.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] } }, "required": ["url", "data"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.putUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] } }, "required": ["url", "data"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.deleteUrl", "profile": "native", "group": "lds", "method": "deleteUrl", "title": "native lds deleteUrl", "description": "Deletes a URL, optionally requiring strict existence.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.deleteUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.unlockUrl", "profile": "native", "group": "lds", "method": "unlockUrl", "title": "native lds unlockUrl", "description": "Releases a URL lock owned by the current LDS context.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.unlockUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false })["url"]) },
  { operation: decorateOperation({ "id": "native.lds.createDoc", "profile": "native", "group": "lds", "method": "createDoc", "title": "native lds createDoc", "description": "Initializes an unsaved document through the runtime object model.\nThe wire contract is supported, but success requires a registered object type; classic XMD catalogs may not qualify.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "objectTypeId": { "type": "string" }, "assignId": { "type": "boolean" } }, "required": ["objectTypeId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.createDoc(prepare(args, { "type": "object", "properties": { "objectTypeId": { "type": "string" }, "assignId": { "type": "boolean" } }, "required": ["objectTypeId"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.loadDoc", "profile": "native", "group": "lds", "method": "loadDoc", "title": "native lds loadDoc", "description": "Calls the implemented NativeLdsApi.loadDoc wire operation. Server authorization and availability are checked at execution time.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "useBinaryResponse": { "type": "boolean" }, "useMultipartResponse": { "type": "boolean" }, "tryLock": { "type": "boolean" }, "compress": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.loadDoc(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "useBinaryResponse": { "type": "boolean" }, "useMultipartResponse": { "type": "boolean" }, "tryLock": { "type": "boolean" }, "compress": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.putDoc", "profile": "native", "group": "lds", "method": "putDoc", "title": "native lds putDoc", "description": "Persists caller-built XML as an XOP attachment.\nOmitted/false `skipActions` keeps server pre-save processing enabled; `true` suppresses its action-enable state.\n`data` must be created by `rawXml()`.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "writeDocInfo": { "type": "boolean" }, "skipActions": { "type": "boolean" }, "neverSaved": { "type": "boolean" }, "data": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["url", "data"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.putDoc(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "writeDocInfo": { "type": "boolean" }, "skipActions": { "type": "boolean" }, "neverSaved": { "type": "boolean" }, "data": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["url", "data"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.deleteDoc", "profile": "native", "group": "lds", "method": "deleteDoc", "title": "native lds deleteDoc", "description": "Deletes a physical document URL, optionally requiring strict existence.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.deleteDoc(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.loadLargeField", "profile": "native", "group": "lds", "method": "loadLargeField", "title": "native lds loadLargeField", "description": "Streams a native LDS large field for a registered x-db-obj object type; consume or cancel the body.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "contentType": { "type": "string" }, "compress": { "type": "boolean" }, "size": { "type": "string", "pattern": "^\\d+$" }, "useMultipartResponse": { "type": "boolean" } }, "required": ["docUrl", "fieldId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.loadLargeField(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "contentType": { "type": "string" }, "compress": { "type": "boolean" }, "size": { "type": "string", "pattern": "^\\d+$" }, "useMultipartResponse": { "type": "boolean" } }, "required": ["docUrl", "fieldId"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.putLargeField", "profile": "native", "group": "lds", "method": "putLargeField", "title": "native lds putLargeField", "description": "Writes a large-field XOP attachment without text re-encoding binary values.\nRequires an x-db-obj document URL backed by a registered object-type provider.\nNever derive this URL from a classic x-local document by guessing its type.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "fieldPathname": { "type": "string" }, "contentType": { "type": "string" }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] } }, "required": ["docUrl", "fieldId", "data"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.putLargeField(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "fieldPathname": { "type": "string" }, "contentType": { "type": "string" }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] } }, "required": ["docUrl", "fieldId", "data"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.deleteLargeField", "profile": "native", "group": "lds", "method": "deleteLargeField", "title": "native lds deleteLargeField", "description": "Deletes a large field by lossless document/field identity.\nRequires a registered x-db-obj object-type provider.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["docUrl", "fieldId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.deleteLargeField(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["docUrl", "fieldId"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.getNewObjectId", "profile": "native", "group": "lds", "method": "getNewObjectId", "title": "native lds getNewObjectId", "description": "Allocates a new lossless object ID in the selected database.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "dbName": { "type": "string" }, "objectType": { "type": "string" } }, "required": ["dbName"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.getNewObjectId(prepare(args, { "type": "object", "properties": { "dbName": { "type": "string" }, "objectType": { "type": "string" } }, "required": ["dbName"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.xQuery", "profile": "native", "group": "lds", "method": "xQuery", "title": "native lds xQuery", "description": "Executes XQuery with optional pagination/cursor lifecycle.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" }, "startPos": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "maxCount": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "expectToReadAll": { "type": "boolean" }, "keepCursor": { "type": "boolean" }, "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["query"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.xQuery(prepare(args, { "type": "object", "properties": { "query": { "type": "string" }, "startPos": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "maxCount": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "expectToReadAll": { "type": "boolean" }, "keepCursor": { "type": "boolean" }, "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["query"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.releaseCursor", "profile": "native", "group": "lds", "method": "releaseCursor", "title": "native lds releaseCursor", "description": "Releases a cursor previously returned to this LDS context.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["cursorId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.releaseCursor(prepare(args, { "type": "object", "properties": { "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["cursorId"], "additionalProperties": false })["cursorId"]) },
  { operation: decorateOperation({ "id": "native.lds.runMethod", "profile": "native", "group": "lds", "method": "runMethod", "title": "native lds runMethod", "description": "Executes a server library method with inline XML `ArgData` children.\nServer 2025.1.1171 takes the arguments only as XML inside the SOAP body;\nit rejects external XOP attachments as Parameter is not XML.\nRunAsync uses a separate internal thread and returns no public task handle;\nits initial ResultData may be typed undefined and does not prove completion.\nGetAsyncMethodStatus and KillAsyncMethod cannot track this execution.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" }, "runAsync": { "type": "boolean" }, "errorLogName": { "type": "string" }, "argData": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["libName", "methodName", "argData"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.runMethod(prepare(args, { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" }, "runAsync": { "type": "boolean" }, "errorLogName": { "type": "string" }, "argData": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["libName", "methodName", "argData"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.eval", "profile": "native", "group": "lds", "method": "eval", "title": "native lds eval", "description": "Executes server-side code. Treat every invocation as mutating.\nOn server 2025.1.1171 this SOAP method responds Unknown method:\nEval even with ALLOW-SERVER-EVAL enabled. Availability must be checked per server.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "code": { "type": "string" } }, "required": ["code"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.eval(prepare(args, { "type": "object", "properties": { "code": { "type": "string" } }, "required": ["code"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.lds.idle", "profile": "native", "group": "lds", "method": "idle", "title": "native lds idle", "description": "Keeps the current native LDS session active.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).lds.idle() },
  { operation: decorateOperation({ "id": "web.lds.xQuery", "profile": "web", "group": "lds", "method": "xQuery", "title": "web lds xQuery", "description": "Executes web LDS XQuery. `keepCursor` defaults to `true`; pass `false` for one-shot reads.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" }, "startPos": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "maxCount": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "keepCursor": { "type": "boolean" }, "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["query"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lds.xQuery(prepare(args, { "type": "object", "properties": { "query": { "type": "string" }, "startPos": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "maxCount": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }, "keepCursor": { "type": "boolean" }, "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["query"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.lds.releaseCursor", "profile": "web", "group": "lds", "method": "releaseCursor", "title": "web lds releaseCursor", "description": "Releases a caller-owned web LDS cursor.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["cursorId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lds.releaseCursor(prepare(args, { "type": "object", "properties": { "cursorId": { "type": "string", "pattern": "^\\d+$" } }, "required": ["cursorId"], "additionalProperties": false })["cursorId"]) },
  { operation: decorateOperation({ "id": "web.lds.runMethod", "profile": "web", "group": "lds", "method": "runMethod", "title": "web lds runMethod", "description": "Executes the stock LDS RunMethod in this web SOAP 1.1 context.\nArgData contains inline typed XML children; SessionID precedes that stream.\nRunAsync uses a separate internal thread and returns no public task handle;\nits initial ResultData may be typed undefined and does not prove completion.\nGetAsyncMethodStatus and KillAsyncMethod cannot track this execution.\nServer target permissions still apply, independently of the web profile.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" }, "runAsync": { "type": "boolean" }, "errorLogName": { "type": "string" }, "argData": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["libName", "methodName", "argData"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lds.runMethod(prepare(args, { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" }, "runAsync": { "type": "boolean" }, "errorLogName": { "type": "string" }, "argData": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] } }, "required": ["libName", "methodName", "argData"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.lds.deleteUrl", "profile": "web", "group": "lds", "method": "deleteUrl", "title": "web lds deleteUrl", "description": "Deletes a URL through the shipped web LDS subset.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lds.deleteUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false })["url"]) },
  { operation: decorateOperation({ "id": "web.lds.deleteDoc", "profile": "web", "group": "lds", "method": "deleteDoc", "title": "web lds deleteDoc", "description": "Deletes a document; web wire sends `StrictDelete=1` only when enabled.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lds.deleteDoc(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.lds.eval", "profile": "web", "group": "lds", "method": "eval", "title": "web lds eval", "description": "Executes server-side code in the web LDS context.\nOn server 2025.1.1171 this SOAP method responds Unknown method:\nEval even with ALLOW-SERVER-EVAL enabled. Availability must be checked per server.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "code": { "type": "string" } }, "required": ["code"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lds.eval(prepare(args, { "type": "object", "properties": { "code": { "type": "string" } }, "required": ["code"], "additionalProperties": false })["code"]) },
  { operation: decorateOperation({ "id": "native.rpc.call", "profile": "native", "group": "rpc", "method": "call", "title": "native rpc call", "description": "Calls an existing server target; discovery evidence does not impose a hardcoded allowlist.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).rpc.call(prepare(args, { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.rpc.call", "profile": "web", "group": "rpc", "method": "call", "title": "web rpc call", "description": "Calls an existing server target; discovery evidence does not impose a hardcoded allowlist.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).rpc.call(prepare(args, { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.spxml.call", "profile": "native", "group": "spxml", "method": "call", "title": "native spxml call", "description": "Calls an existing server target; discovery evidence does not impose a hardcoded allowlist.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).spxml.call(prepare(args, { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.callMethod", "profile": "web", "group": "spxml", "method": "callMethod", "title": "web spxml callMethod", "description": "Synchronous existing RPC call. The selected target may change state.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.callMethod(prepare(args, { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.callMethodAsync", "profile": "web", "group": "spxml", "method": "callMethodAsync", "title": "web spxml callMethodAsync", "description": "Starts an existing asynchronous RPC task and returns a lossless TrackingID.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.callMethodAsync(prepare(args, { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.getBackgroundTasksByName", "profile": "web", "group": "spxml", "method": "getBackgroundTasksByName", "title": "web spxml getBackgroundTasksByName", "description": "Lists background tasks filtered by library and method names.\nOn server 2025.1.1171 the task pool is application-wide and can include other callers;\nmatching a name does not establish task ownership. Expired nonrunning entries\nare removed before filtering. Recent terminal tasks are not\nconsumed by this list, but their status/results are included in each Task.\nUse an independently journalled TrackingID for subsequent status or kill calls.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" } }, "required": ["libName", "methodName"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.getBackgroundTasksByName(prepare(args, { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" } }, "required": ["libName", "methodName"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.getAsyncMethodStatus", "profile": "web", "group": "spxml", "method": "getAsyncMethodStatus", "title": "web spxml getAsyncMethodStatus", "description": "Reads async task state using the original decimal or `0x` TrackingID lexical form.\nOn server 2025.1.1171 the first terminal response consumes the finished tracking entry.\nRetain that payload immediately and never poll the finished ID again: a lost HTTP\nterminal response can consume its result. Other builds require separate verification.\nPoll running tasks no more often than once every 250 ms.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.getAsyncMethodStatus(prepare(args, { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false })["trackingId"]) },
  { operation: decorateOperation({ "id": "web.spxml.killAsyncMethod", "profile": "web", "group": "spxml", "method": "killAsyncMethod", "title": "web spxml killAsyncMethod", "description": "Requests task cancellation; successful cancellation of already-completed tasks is not guaranteed.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.killAsyncMethod(prepare(args, { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false })["trackingId"]) },
  { operation: decorateOperation({ "id": "web.spxml.getDoc", "profile": "web", "group": "spxml", "method": "getDoc", "title": "web spxml getDoc", "description": "Reads document XML using UTF-8 unless `charset` is supplied; response charset headers take precedence.\nServer 2025.1.1171 does not accept a TryLock query parameter on this route:\na value passed in the query is refused.\nUse native LDS LoadDoc for a verified document-lock route.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string" }, "charset": { "type": "string" }, "tryLock": { "type": "boolean" } }, "required": ["docUrl"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.getDoc(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string" }, "charset": { "type": "string" }, "tryLock": { "type": "boolean" } }, "required": ["docUrl"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.putDoc", "profile": "web", "group": "spxml", "method": "putDoc", "title": "web spxml putDoc", "description": "Persists caller XML through web SPXML server pre-save processing.\n`neverSaved=true` sends `NeverSaved=1`; false/omitted sends no flag. This route has no `SkipActions` control.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string" }, "document": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, "writeDocInfo": { "type": "boolean" }, "neverSaved": { "type": "boolean" } }, "required": ["docUrl", "document"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.putDoc(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string" }, "document": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, "writeDocInfo": { "type": "boolean" }, "neverSaved": { "type": "boolean" } }, "required": ["docUrl", "document"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.getLargeField", "profile": "web", "group": "spxml", "method": "getLargeField", "title": "web spxml getLargeField", "description": "Streams a web SPXML large field for a registered x-db-obj object type; consume or cancel the body.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "size": { "type": "string", "pattern": "^\\d+$" }, "contentType": { "type": "string" }, "prepareHtmlImages": { "type": "boolean" }, "fileName": { "type": "string" } }, "required": ["docUrl", "fieldId", "size", "contentType"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.getLargeField(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "size": { "type": "string", "pattern": "^\\d+$" }, "contentType": { "type": "string" }, "prepareHtmlImages": { "type": "boolean" }, "fileName": { "type": "string" } }, "required": ["docUrl", "fieldId", "size", "contentType"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.putLargeField", "profile": "web", "group": "spxml", "method": "putLargeField", "title": "web spxml putLargeField", "description": "Uploads a web SPXML large-field body without implicit buffering.\nRequires an x-db-obj document URL backed by a registered object-type provider.\nNever derive this URL from a classic x-local document by guessing its type.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "fieldPathname": { "type": "string" }, "contentType": { "type": "string" }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["docUrl", "fieldId", "fieldPathname", "contentType", "body"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.putLargeField(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "fieldPathname": { "type": "string" }, "contentType": { "type": "string" }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["docUrl", "fieldId", "fieldPathname", "contentType", "body"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml.putLargeFieldFromUrl", "profile": "web", "group": "spxml", "method": "putLargeFieldFromUrl", "title": "web spxml putLargeFieldFromUrl", "description": "Imports a web large field from a server-visible source URL.\nRequires an x-db-obj document URL backed by a registered object-type provider.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "fieldPathname": { "type": "string" }, "contentType": { "type": "string" }, "srcUrl": { "type": "string" } }, "required": ["docUrl", "fieldId", "fieldPathname", "srcUrl"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml.putLargeFieldFromUrl(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "fieldPathname": { "type": "string" }, "contentType": { "type": "string" }, "srcUrl": { "type": "string" } }, "required": ["docUrl", "fieldId", "fieldPathname", "srcUrl"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.experimental.spxml.callMethodAsync", "profile": "native", "group": "experimental.spxml", "method": "callMethodAsync", "title": "native experimental.spxml callMethodAsync", "description": "Starts an existing async target through the partial native SPXML profile.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.spxml.callMethodAsync(prepare(args, { "type": "object", "properties": { "target": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$" }, "args": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "valueType": { "type": "string", "minLength": 1 }, "lexicalValue": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["valueType", "lexicalValue"], "additionalProperties": false }, { "type": "object", "properties": { "lexicalValue": { "anyOf": [{ "type": "string", "x-normalization": "xml-element" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-element-box" }] } }, "required": ["lexicalValue"], "additionalProperties": false }] } } }, "required": ["target"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.experimental.spxml.getBackgroundTasksByName", "profile": "native", "group": "experimental.spxml", "method": "getBackgroundTasksByName", "title": "native experimental.spxml getBackgroundTasksByName", "description": "Lists name-filtered application-wide tasks through the native SOAP profile.\nOn server 2025.1.1171 expired nonrunning entries are removed before\nfiltering and the list can hold tasks belonging to other callers. Recent terminal\nentries are retained by this list; Task includes TrackingID, StartDate and\nstatus/result fields. Name matching never proves ownership: only operate on\nan independently journalled TrackingID.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" } }, "required": ["libName", "methodName"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.spxml.getBackgroundTasksByName(prepare(args, { "type": "object", "properties": { "libName": { "type": "string" }, "methodName": { "type": "string" } }, "required": ["libName", "methodName"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.experimental.spxml.getAsyncMethodStatus", "profile": "native", "group": "experimental.spxml", "method": "getAsyncMethodStatus", "title": "native experimental.spxml getAsyncMethodStatus", "description": "Reads native async task state while preserving the original TrackingID lexical form.\nOn server 2025.1.1171 the first terminal response consumes the finished tracking entry.\nRetain that payload immediately and never poll the finished ID again: a lost HTTP\nterminal response can consume its result. Other builds require separate verification.\nPoll running tasks no more often than once every 250 ms.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.spxml.getAsyncMethodStatus(prepare(args, { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false })["trackingId"]) },
  { operation: decorateOperation({ "id": "native.experimental.spxml.killAsyncMethod", "profile": "native", "group": "experimental.spxml", "method": "killAsyncMethod", "title": "native experimental.spxml killAsyncMethod", "description": "Requests cancellation through the partial native SPXML profile.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.spxml.killAsyncMethod(prepare(args, { "type": "object", "properties": { "trackingId": { "type": "string", "pattern": "^(?:\\d+|0x[0-9a-fA-F]+)$" } }, "required": ["trackingId"], "additionalProperties": false })["trackingId"]) },
  { operation: decorateOperation({ "id": "native.experimental.spxml.getDoc", "profile": "native", "group": "experimental.spxml", "method": "getDoc", "title": "native experimental.spxml getDoc", "description": "Reads document XML through the partial native SPXML route.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string" }, "charset": { "type": "string" }, "tryLock": { "type": "boolean" } }, "required": ["docUrl"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.spxml.getDoc(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string" }, "charset": { "type": "string" }, "tryLock": { "type": "boolean" } }, "required": ["docUrl"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.experimental.spxml.getLargeField", "profile": "native", "group": "experimental.spxml", "method": "getLargeField", "title": "native experimental.spxml getLargeField", "description": "Streams a large field through the partial native SPXML route.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "size": { "type": "string", "pattern": "^\\d+$" }, "contentType": { "type": "string" }, "prepareHtmlImages": { "type": "boolean" }, "fileName": { "type": "string" } }, "required": ["docUrl", "fieldId", "size", "contentType"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.spxml.getLargeField(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "size": { "type": "string", "pattern": "^\\d+$" }, "contentType": { "type": "string" }, "prepareHtmlImages": { "type": "boolean" }, "fileName": { "type": "string" } }, "required": ["docUrl", "fieldId", "size", "contentType"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.experimental.spxml.putDoc", "profile": "native", "group": "experimental.spxml", "method": "putDoc", "title": "native experimental.spxml putDoc", "description": "Persists document XML through the partial native SPXML route.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string" }, "document": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, "writeDocInfo": { "type": "boolean" }, "neverSaved": { "type": "boolean" } }, "required": ["docUrl", "document"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.spxml.putDoc(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string" }, "document": { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, "writeDocInfo": { "type": "boolean" }, "neverSaved": { "type": "boolean" } }, "required": ["docUrl", "document"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.experimental.spxml.putLargeField", "profile": "native", "group": "experimental.spxml", "method": "putLargeField", "title": "native experimental.spxml putLargeField", "description": "Uploads a large field through the partial native SPXML route.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "fieldPathname": { "type": "string" }, "contentType": { "type": "string" }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["docUrl", "fieldId", "fieldPathname", "contentType", "body"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.spxml.putLargeField(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "fieldPathname": { "type": "string" }, "contentType": { "type": "string" }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["docUrl", "fieldId", "fieldPathname", "contentType", "body"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.experimental.spxml.putLargeFieldFromUrl", "profile": "native", "group": "experimental.spxml", "method": "putLargeFieldFromUrl", "title": "native experimental.spxml putLargeFieldFromUrl", "description": "Imports a large field from a server-visible URL through the partial native route.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "fieldPathname": { "type": "string" }, "contentType": { "type": "string" }, "srcUrl": { "type": "string" } }, "required": ["docUrl", "fieldId", "fieldPathname", "srcUrl"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.spxml.putLargeFieldFromUrl(prepare(args, { "type": "object", "properties": { "docUrl": { "type": "string", "pattern": "^x-db-obj://", "description": "Requires a registered object-type storage provider. Classic x-local document URLs cannot be converted by guessing the object type." }, "fieldId": { "type": "string", "pattern": "^\\d+$" }, "fieldPathname": { "type": "string" }, "contentType": { "type": "string" }, "srcUrl": { "type": "string" } }, "required": ["docUrl", "fieldId", "fieldPathname", "srcUrl"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.spxml2.getAppInfo", "profile": "native", "group": "spxml2", "method": "getAppInfo", "title": "native spxml2 getAppInfo", "description": "Reads server application/bootstrap metadata; `application_module` is optional and may be absent.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "fastStart": { "type": "boolean" }, "anonymous": { "type": "boolean" }, "openSession": { "type": "boolean" }, "rnd": { "type": "number" } }, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).spxml2.getAppInfo(prepare(args, { "type": "object", "properties": { "fastStart": { "type": "boolean" }, "anonymous": { "type": "boolean" }, "openSession": { "type": "boolean" }, "rnd": { "type": "number" } }, "required": [], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.spxml2.getForm", "profile": "native", "group": "spxml2", "method": "getForm", "title": "native spxml2 getForm", "description": "Loads a form payload by server-local URL as text using the response charset.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).spxml2.getForm(prepare(args, { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml2.getAppInfo", "profile": "web", "group": "spxml2", "method": "getAppInfo", "title": "web spxml2 getAppInfo", "description": "Calls the implemented WebSpXml2Api.getAppInfo wire operation. Server authorization and availability are checked at execution time.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "fastStart": { "type": "boolean" }, "anonymous": { "type": "boolean" }, "openSession": { "type": "boolean" }, "rnd": { "type": "number" } }, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml2.getAppInfo(prepare(args, { "type": "object", "properties": { "fastStart": { "type": "boolean" }, "anonymous": { "type": "boolean" }, "openSession": { "type": "boolean" }, "rnd": { "type": "number" } }, "required": [], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml2.getForm", "profile": "web", "group": "spxml2", "method": "getForm", "title": "web spxml2 getForm", "description": "Loads a form payload by server-local URL as text using the response charset.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml2.getForm(prepare(args, { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml2.getImage", "profile": "web", "group": "spxml2", "method": "getImage", "title": "web spxml2 getImage", "description": "Streams a web SPXML2 image with optional effect query values.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "effects": { "type": "object", "additionalProperties": { "anyOf": [{ "type": "string" }, { "type": "number" }, { "type": "boolean" }, { "type": "null" }] } } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml2.getImage(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "effects": { "type": "object", "additionalProperties": { "anyOf": [{ "type": "string" }, { "type": "number" }, { "type": "boolean" }, { "type": "null" }] } } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.spxml2.getPreloadedDesignFiles", "profile": "web", "group": "spxml2", "method": "getPreloadedDesignFiles", "title": "web spxml2 getPreloadedDesignFiles", "description": "Reads the default preloaded-design-file set.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml2.getPreloadedDesignFiles() },
  { operation: decorateOperation({ "id": "web.spxml2.stdEncrypt", "profile": "web", "group": "spxml2", "method": "stdEncrypt", "title": "web spxml2 stdEncrypt", "description": "Calls the shipped server `std_encrypt` service; this is not a general client-side encryption primitive.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).spxml2.stdEncrypt(prepare(args, { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"], "additionalProperties": false })["text"]) },
  { operation: decorateOperation({ "id": "legacy.xhttp.idle", "profile": "legacy", "group": "xhttp", "method": "idle", "title": "legacy xhttp idle", "description": "Bootstraps or keeps alive the legacy session.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "installationId": { "type": "string" } }, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.legacy()).xhttp.idle(prepare(args, { "type": "object", "properties": { "installationId": { "type": "string" } }, "required": [], "additionalProperties": false })["installationId"]) },
  { operation: decorateOperation({ "id": "legacy.xhttp.getUrl", "profile": "legacy", "group": "xhttp", "method": "getUrl", "title": "legacy xhttp getUrl", "description": "Streams URL bytes after CRLF result records; `lock=true` changes lock state.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "lock": { "type": "boolean" }, "compress": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.legacy()).xhttp.getUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "lock": { "type": "boolean" }, "compress": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "legacy.xhttp.putUrl", "profile": "legacy", "group": "xhttp", "method": "putUrl", "title": "legacy xhttp putUrl", "description": "Writes URL bytes using exact legacy framing.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "body": { "anyOf": [{ "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "type": "string" }] }, "writeDocInfo": { "type": "boolean" } }, "required": ["url", "body"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.legacy()).xhttp.putUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "body": { "anyOf": [{ "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "type": "string" }] }, "writeDocInfo": { "type": "boolean" } }, "required": ["url", "body"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "legacy.xhttp.deleteUrl", "profile": "legacy", "group": "xhttp", "method": "deleteUrl", "title": "legacy xhttp deleteUrl", "description": "Deletes a URL; false strictness is serialized explicitly as required by legacy framing.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.legacy()).xhttp.deleteUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "strictDelete": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "legacy.xhttp.unlockUrl", "profile": "legacy", "group": "xhttp", "method": "unlockUrl", "title": "legacy xhttp unlockUrl", "description": "Releases a legacy URL lock.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.legacy()).xhttp.unlockUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false })["url"]) },
  { operation: decorateOperation({ "id": "legacy.xhttp.obtainNewDocId", "profile": "legacy", "group": "xhttp", "method": "obtainNewDocId", "title": "legacy xhttp obtainNewDocId", "description": "Allocates a new document ID in the named legacy database.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "db": { "type": "string" } }, "required": ["db"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.legacy()).xhttp.obtainNewDocId(prepare(args, { "type": "object", "properties": { "db": { "type": "string" } }, "required": ["db"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "legacy.xhttp.queryCatalogByKeys", "profile": "legacy", "group": "xhttp", "method": "queryCatalogByKeys", "title": "legacy xhttp queryCatalogByKeys", "description": "Selects catalog rows by typed keys using one XQuery scalar literal per CRLF body line.\nCatalog and KeyName are explicit legacy header records. Strings escape apostrophes\nby doubling; integer/real lexical strings avoid implicit JavaScript conversion.\nThe initial proven grammar supports unsigned integers, finite unsigned decimals,\nand single-line strings. Signed expressions, boolean/null keys and raw code are not accepted.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "catalog": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*$" }, "keyName": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*(?:/[A-Za-z_][A-Za-z0-9_]*)*$" }, "keys": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "type": { "const": "string" }, "value": { "type": "string" } }, "required": ["type", "value"], "additionalProperties": false }, { "type": "object", "properties": { "type": { "const": "integer" }, "value": { "type": "string" } }, "required": ["type", "value"], "additionalProperties": false }, { "type": "object", "properties": { "type": { "const": "real" }, "value": { "type": "string" } }, "required": ["type", "value"], "additionalProperties": false }] } } }, "required": ["catalog", "keyName", "keys"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.legacy()).xhttp.queryCatalogByKeys(prepare(args, { "type": "object", "properties": { "catalog": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*$" }, "keyName": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*(?:/[A-Za-z_][A-Za-z0-9_]*)*$" }, "keys": { "type": "array", "items": { "anyOf": [{ "type": "object", "properties": { "type": { "const": "string" }, "value": { "type": "string" } }, "required": ["type", "value"], "additionalProperties": false }, { "type": "object", "properties": { "type": { "const": "integer" }, "value": { "type": "string" } }, "required": ["type", "value"], "additionalProperties": false }, { "type": "object", "properties": { "type": { "const": "real" }, "value": { "type": "string" } }, "required": ["type", "value"], "additionalProperties": false }] } } }, "required": ["catalog", "keyName", "keys"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "legacy.xhttp.eval", "profile": "legacy", "group": "xhttp", "method": "eval", "title": "legacy xhttp eval", "description": "Executes server-side code supplied as the legacy request body.\nServer 2025.1.1171 rejects this action\nwith Obsolete method: ServerEval when ALLOW-SERVER-EVAL is disabled.\nFresh baseline fixtures confirmed disabled rejection with a masked HTTP 500\nand an enabled harmless Unicode string expression with a typed UTF-8 result.\nThese checks do not establish other scripts or the separate SOAP LDS Eval path.\nThe separate legacy XQuery action returns No longer supported.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "code": { "type": "string" } }, "required": ["code"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.legacy()).xhttp.eval(prepare(args, { "type": "object", "properties": { "code": { "type": "string" } }, "required": ["code"], "additionalProperties": false })["code"]) },
  { operation: decorateOperation({ "id": "legacy.xhttp.isAdmin", "profile": "legacy", "group": "xhttp", "method": "isAdmin", "title": "legacy xhttp isAdmin", "description": "Reads whether the current legacy context has administrator privileges.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.legacy()).xhttp.isAdmin() },
  { operation: decorateOperation({ "id": "web.pages.copyUrl", "profile": "web", "group": "pages", "method": "copyUrl", "title": "web pages copyUrl", "description": "Copies one server URL to another.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "srcUrl": { "type": "string" }, "destUrl": { "type": "string" } }, "required": ["srcUrl", "destUrl"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.copyUrl(prepare(args, { "type": "object", "properties": { "srcUrl": { "type": "string" }, "destUrl": { "type": "string" } }, "required": ["srcUrl", "destUrl"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.createDoc", "profile": "web", "group": "pages", "method": "createDoc", "title": "web pages createDoc", "description": "Asks the web create handler for unsaved document XML.\nSuccess depends on classic/object-model branch and registered object type; this method does not persist the result.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "objectTypeId": { "type": "string" }, "assignId": { "type": "boolean" } }, "required": ["objectTypeId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.createDoc(prepare(args, { "type": "object", "properties": { "objectTypeId": { "type": "string" }, "assignId": { "type": "boolean" } }, "required": ["objectTypeId"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.filePreviewPdf", "profile": "web", "group": "pages", "method": "filePreviewPdf", "title": "web pages filePreviewPdf", "description": "Reads the shipped PDF preview helper page as text.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.filePreviewPdf() },
  { operation: decorateOperation({ "id": "web.pages.getForm", "profile": "web", "group": "pages", "method": "getForm", "title": "web pages getForm", "description": "Reads a form by server-local URL as text.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.getForm(prepare(args, { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.getScreenForm", "profile": "web", "group": "pages", "method": "getScreenForm", "title": "web pages getScreenForm", "description": "Reads a screen form by server-local URL as text.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.getScreenForm(prepare(args, { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.getImage", "profile": "web", "group": "pages", "method": "getImage", "title": "web pages getImage", "description": 'Streams SVG through the stock web page image handler. The server accepts\nx-app/x-local SVG URLs and checks source read access. Optional state values\nhover/pressed/disabled select the shipped color substitution; other values\npreserve the original content. Omission sends state="" because the shipped\npage requires that query field. Consume or cancel the returned body.', "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "state": { "type": "string" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.getImage(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "state": { "type": "string" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.getIcon", "profile": "web", "group": "pages", "method": "getIcon", "title": "web pages getIcon", "description": "Streams a PNG generated by the stock icon page from an x-app/x-local .ico URL.\nThis page supports one fixed 16-pixel extraction, not arbitrary resizing or\na PNG input. A sufficiently fresh server icon-cache entry is returned as-is;\na cache miss creates directories/temp files and runs misc/image_convert.exe.\nAvailability therefore requires that cache entry or the installed converter.\nTreat this operation as write because it may change server cache/temp files.\nConsume or cancel the returned body.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string", "pattern": "^(?:x-local|x-app)://[^?#\\x00-\\x1f\\x7f]+\\.ico$" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.getIcon(prepare(args, { "type": "object", "properties": { "url": { "type": "string", "pattern": "^(?:x-local|x-app)://[^?#\\x00-\\x1f\\x7f]+\\.ico$" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.getUiText", "profile": "web", "group": "pages", "method": "getUiText", "title": "web pages getUiText", "description": "Reads and parses web UI text XML using its declared application charset.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.getUiText() },
  { operation: decorateOperation({ "id": "web.pages.getUrl", "profile": "web", "group": "pages", "method": "getUrl", "title": "web pages getUrl", "description": "Streams page-service URL output; consume or cancel the returned body.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "navigate": { "type": "boolean" }, "download": { "type": "boolean" }, "base64": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.getUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "navigate": { "type": "boolean" }, "download": { "type": "boolean" }, "base64": { "type": "boolean" } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.putUrl", "profile": "web", "group": "pages", "method": "putUrl", "title": "web pages putUrl", "description": "Writes a page-service URL body with optional base64/text hints.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "isBase64": { "type": "boolean" }, "isText": { "type": "boolean" }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["url", "body"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.putUrl(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "isBase64": { "type": "boolean" }, "isText": { "type": "boolean" }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["url", "body"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.uploadFile", "profile": "web", "group": "pages", "method": "uploadFile", "title": "web pages uploadFile", "description": "Uploads one file through the shipped multipart f/session_token workflow.\nThe owning WebSession supplies its current private page token. Input is\nbounded by maxResponseBytes and an 8 MiB client input budget; no chunks or\nlegacy base64 branch is implied. A successful response contains Url.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "filename": { "type": "string", "minLength": 1, "maxLength": 255, "pattern": "^(?!\\.\\.)(?!.*\\.\\.$)(?!\\.$)[^\\\\/\\x00-\\x1F\\x7F]+$" }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] }, "contentType": { "type": "string", "minLength": 1, "maxLength": 256, "pattern": "^[\\x20-\\x7E]+$" } }, "required": ["filename", "data"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.uploadFile(prepare(args, { "type": "object", "properties": { "filename": { "type": "string", "minLength": 1, "maxLength": 255, "pattern": "^(?!\\.\\.)(?!.*\\.\\.$)(?!\\.$)[^\\\\/\\x00-\\x1F\\x7F]+$" }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] }, "contentType": { "type": "string", "minLength": 1, "maxLength": 256, "pattern": "^[\\x20-\\x7E]+$" } }, "required": ["filename", "data"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.uploadChunk", "profile": "web", "group": "pages", "method": "uploadChunk", "title": "web pages uploadChunk", "description": "Sends one stock upload_chunk POST with exact data bytes and an explicit Content-Range.\nThe caller supplies a known 32-hex fileId and coordinates chunk order; the last part joins the file.\nReceipts do not independently prove chunk persistence or final file bytes.\nVerify staging with a storage-appropriate read before submitting the final part.\nFinal errors can leave an unknown output URL; do not retry or guess cleanup targets.\nRequires the installed WebSoft/libMain branch and its existing principal/upload policies.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "fileId": { "type": "string", "minLength": 32, "maxLength": 32, "pattern": "^[0-9a-fA-F]{32}$" }, "filename": { "type": "string", "minLength": 1, "maxLength": 255, "pattern": "^(?!\\.\\.)(?!.*\\.\\.$)(?!\\.$)[^\\\\/\\x00-\\x1F\\x7F]+$" }, "index": { "type": "integer", "minimum": 0, "maximum": 99999 }, "chunksTotal": { "type": "integer", "minimum": 1, "maximum": 1e5 }, "totalBytes": { "type": "integer", "minimum": 1, "maximum": 9007199254740991 }, "offset": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] }, "contentType": { "type": "string", "minLength": 1, "maxLength": 256, "pattern": "^[\\x20-\\x7E]+$" } }, "required": ["fileId", "filename", "index", "chunksTotal", "totalBytes", "offset", "data"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.uploadChunk(prepare(args, { "type": "object", "properties": { "fileId": { "type": "string", "minLength": 32, "maxLength": 32, "pattern": "^[0-9a-fA-F]{32}$" }, "filename": { "type": "string", "minLength": 1, "maxLength": 255, "pattern": "^(?!\\.\\.)(?!.*\\.\\.$)(?!\\.$)[^\\\\/\\x00-\\x1F\\x7F]+$" }, "index": { "type": "integer", "minimum": 0, "maximum": 99999 }, "chunksTotal": { "type": "integer", "minimum": 1, "maximum": 1e5 }, "totalBytes": { "type": "integer", "minimum": 1, "maximum": 9007199254740991 }, "offset": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }, "data": { "anyOf": [{ "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }, { "type": "string" }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }, { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] }] }, "contentType": { "type": "string", "minLength": 1, "maxLength": 256, "pattern": "^[\\x20-\\x7E]+$" } }, "required": ["fileId", "filename", "index", "chunksTotal", "totalBytes", "offset", "data"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.pages.clearUploadChunks", "profile": "web", "group": "pages", "method": "clearUploadChunks", "title": "web pages clearUploadChunks", "description": "Requests deletion of [0, chunksTotal) for a known caller-selected 32-hex fileId.\nThe namespace is global; the server does not check who created this ID.\nAn empty ACK does not prove chunk absence, directory removal, final-file or scratch cleanup.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "fileId": { "type": "string", "minLength": 32, "maxLength": 32, "pattern": "^[0-9a-fA-F]{32}$" }, "chunksTotal": { "type": "integer", "minimum": 1, "maximum": 1e5 } }, "required": ["fileId", "chunksTotal"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).pages.clearUploadChunks(prepare(args, { "type": "object", "properties": { "fileId": { "type": "string", "minLength": 32, "maxLength": 32, "pattern": "^[0-9a-fA-F]{32}$" }, "chunksTotal": { "type": "integer", "minimum": 1, "maximum": 1e5 } }, "required": ["fileId", "chunksTotal"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.resources.getImage", "profile": "native", "group": "resources", "method": "getImage", "title": "native resources getImage", "description": "Streams a resource image by lossless decimal ID and optional image type.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "resourceId": { "type": "string", "pattern": "^\\d+$" }, "imageType": { "type": "string" } }, "required": ["resourceId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).resources.getImage(prepare(args, { "type": "object", "properties": { "resourceId": { "type": "string", "pattern": "^\\d+$" }, "imageType": { "type": "string" } }, "required": ["resourceId"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.resources.getCompoundResource", "profile": "native", "group": "resources", "method": "getCompoundResource", "title": "native resources getCompoundResource", "description": "Streams a named compound-attc attachment through GET /xhttp_res.\nUse url for an x-local/x-app HTML source, or docUrl plus elemPath for a\ndocument string field (also accepts a registered x-db-obj document).\nelemPath starts with the document element name, such as presence_state.name;\nobtain it from the actual document rather than guessing its root or layout.\nThe server decodes the matching attachment data and selects media type\nfrom resId. Stock 1171 also requires URL sources under configured courses_path;\na permitted local scheme alone does not establish that prefix.\nNative Administrator builds this route; the web alias uses\nthe same server handler with its own HTTP context, not a distinct caller\nclaim. Consume or cancel the returned body.", "effect": "read", "status": "implemented", "inputSchema": { "anyOf": [{ "type": "object", "properties": { "url": { "type": "string" }, "resId": { "type": "string" } }, "required": ["url", "resId"], "additionalProperties": false }, { "type": "object", "properties": { "docUrl": { "type": "string" }, "elemPath": { "type": "string" }, "resId": { "type": "string" } }, "required": ["docUrl", "elemPath", "resId"], "additionalProperties": false }] } }), invoke: async (gateway, args) => (await gateway.native()).resources.getCompoundResource(prepare(args, { "anyOf": [{ "type": "object", "properties": { "url": { "type": "string" }, "resId": { "type": "string" } }, "required": ["url", "resId"], "additionalProperties": false }, { "type": "object", "properties": { "docUrl": { "type": "string" }, "elemPath": { "type": "string" }, "resId": { "type": "string" } }, "required": ["docUrl", "elemPath", "resId"], "additionalProperties": false }] })) },
  { operation: decorateOperation({ "id": "web.resources.getImage", "profile": "web", "group": "resources", "method": "getImage", "title": "web resources getImage", "description": "Streams a resource image by lossless decimal ID and optional image type.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "resourceId": { "type": "string", "pattern": "^\\d+$" }, "imageType": { "type": "string" } }, "required": ["resourceId"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).resources.getImage(prepare(args, { "type": "object", "properties": { "resourceId": { "type": "string", "pattern": "^\\d+$" }, "imageType": { "type": "string" } }, "required": ["resourceId"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.resources.getCompoundResource", "profile": "web", "group": "resources", "method": "getCompoundResource", "title": "web resources getCompoundResource", "description": "Streams a named compound-attc attachment through GET /xhttp_res.\nUse url for an x-local/x-app HTML source, or docUrl plus elemPath for a\ndocument string field (also accepts a registered x-db-obj document).\nelemPath starts with the document element name, such as presence_state.name;\nobtain it from the actual document rather than guessing its root or layout.\nThe server decodes the matching attachment data and selects media type\nfrom resId. Stock 1171 also requires URL sources under configured courses_path;\na permitted local scheme alone does not establish that prefix.\nNative Administrator builds this route; the web alias uses\nthe same server handler with its own HTTP context, not a distinct caller\nclaim. Consume or cancel the returned body.", "effect": "read", "status": "implemented", "inputSchema": { "anyOf": [{ "type": "object", "properties": { "url": { "type": "string" }, "resId": { "type": "string" } }, "required": ["url", "resId"], "additionalProperties": false }, { "type": "object", "properties": { "docUrl": { "type": "string" }, "elemPath": { "type": "string" }, "resId": { "type": "string" } }, "required": ["docUrl", "elemPath", "resId"], "additionalProperties": false }] } }), invoke: async (gateway, args) => (await gateway.web()).resources.getCompoundResource(prepare(args, { "anyOf": [{ "type": "object", "properties": { "url": { "type": "string" }, "resId": { "type": "string" } }, "required": ["url", "resId"], "additionalProperties": false }, { "type": "object", "properties": { "docUrl": { "type": "string" }, "elemPath": { "type": "string" }, "resId": { "type": "string" } }, "required": ["docUrl", "elemPath", "resId"], "additionalProperties": false }] })) },
  { operation: decorateOperation({ "id": "anonymous.diagnostics.xhttpInfo", "profile": "anonymous", "group": "diagnostics", "method": "xhttpInfo", "title": "anonymous diagnostics xhttpInfo", "description": "Reads `/xhttp_info`, using Basic auth only when client credentials were configured.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => gateway.client.diagnostics.xhttpInfo() },
  { operation: decorateOperation({ "id": "anonymous.experimental.rawRequest", "profile": "anonymous", "group": "experimental", "method": "rawRequest", "title": "anonymous experimental rawRequest", "description": "Sends a same-origin caller-defined request and returns its body as a stream.\n`unsafe: true` is mandatory. Normal operation serializers, fault parsing and mutability guarantees are bypassed;\nconfigured auth/cookies still apply and the caller owns method, headers, body and stream cleanup.", "effect": "unknown", "status": "implemented", "inputSchema": { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false } }), invoke: async (gateway, args) => gateway.client.experimental.rawRequest(prepare(args, { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.experimental.rawRequest", "profile": "native", "group": "experimental", "method": "rawRequest", "title": "native experimental rawRequest", "description": "Sends a same-origin caller-defined request and returns its body as a stream.\n`unsafe: true` is mandatory. Normal operation serializers, fault parsing and mutability guarantees are bypassed;\nconfigured auth/cookies still apply and the caller owns method, headers, body and stream cleanup.", "effect": "unknown", "status": "implemented", "inputSchema": { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.rawRequest(prepare(args, { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "native.experimental.readDirectory", "profile": "native", "group": "experimental", "method": "readDirectory", "title": "native experimental readDirectory", "description": "Reads the schema-backed partial native directory operation; flag types remain intentionally lexical/raw.", "effect": "write", "status": "implemented", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" }, "readFilesOnly": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] }, "readDirectoriesOnly": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["url"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.native()).experimental.readDirectory(prepare(args, { "type": "object", "properties": { "url": { "type": "string" }, "readFilesOnly": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] }, "readDirectoriesOnly": { "anyOf": [{ "type": "string" }, { "anyOf": [{ "type": "string", "x-normalization": "xml" }, { "type": "object", "properties": { "xml": { "type": "string" } }, "required": ["xml"], "additionalProperties": false, "x-normalization": "xml-box" }] }] } }, "required": ["url"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.experimental.rawRequest", "profile": "web", "group": "experimental", "method": "rawRequest", "title": "web experimental rawRequest", "description": "Sends a same-origin caller-defined request and returns its body as a stream.\n`unsafe: true` is mandatory. Normal operation serializers, fault parsing and mutability guarantees are bypassed;\nconfigured auth/cookies still apply and the caller owns method, headers, body and stream cleanup.", "effect": "unknown", "status": "implemented", "inputSchema": { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).experimental.rawRequest(prepare(args, { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.experimental.getUiTemplate", "profile": "web", "group": "experimental", "method": "getUiTemplate", "title": "web experimental getUiTemplate", "description": "Reads the schema-backed but partial web UI-template route.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).experimental.getUiTemplate(prepare(args, { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.experimental.authenticate", "profile": "web", "group": "experimental", "method": "authenticate", "title": "web experimental authenticate", "description": "Calls the partial web authentication route; success cookie/body semantics are not fully established.", "effect": "execute", "status": "implemented", "inputSchema": { "type": "object", "properties": { "login": { "type": "string" }, "password": { "type": "string" }, "token": { "type": "string" } }, "required": ["login", "password", "token"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).experimental.authenticate(prepare(args, { "type": "object", "properties": { "login": { "type": "string" }, "password": { "type": "string" }, "token": { "type": "string" } }, "required": ["login", "password", "token"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "legacy.experimental.rawRequest", "profile": "legacy", "group": "experimental", "method": "rawRequest", "title": "legacy experimental rawRequest", "description": "Sends a same-origin caller-defined request and returns its body as a stream.\n`unsafe: true` is mandatory. Normal operation serializers, fault parsing and mutability guarantees are bypassed;\nconfigured auth/cookies still apply and the caller owns method, headers, body and stream cleanup.", "effect": "unknown", "status": "implemented", "inputSchema": { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.legacy()).experimental.rawRequest(prepare(args, { "type": "object", "properties": { "unsafe": { "const": true, "type": "boolean" }, "path": { "type": "string" }, "method": { "type": "string" }, "headers": { "type": "object", "additionalProperties": { "type": "string" } }, "body": { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "base64": { "type": "string" } }, "required": ["base64"], "additionalProperties": false, "x-normalization": "binary" }] } }, "required": ["unsafe", "path"], "additionalProperties": false })) },
  { operation: decorateOperation({ "id": "web.lifecycle.admin", "profile": "web", "group": "lifecycle", "method": "admin", "title": "web lifecycle admin", "description": "Reads the `/admin` redirect response without following it.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lifecycle.admin() },
  { operation: decorateOperation({ "id": "web.lifecycle.main", "profile": "web", "group": "lifecycle", "method": "main", "title": "web lifecycle main", "description": "Reads the authenticated web Administrator main page.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lifecycle.main() },
  { operation: decorateOperation({ "id": "web.lifecycle.logout", "profile": "web", "group": "lifecycle", "method": "logout", "title": "web lifecycle logout", "description": "Runs both logout legs; observed transport loss stops further requests.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lifecycle.logout() },
  { operation: decorateOperation({ "id": "web.lifecycle.logout2", "profile": "web", "group": "lifecycle", "method": "logout2", "title": "web lifecycle logout2", "description": "Executes the second web logout leg directly. Normally called by `logout()`.", "effect": "read", "status": "implemented", "inputSchema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false } }), invoke: async (gateway, args) => (await gateway.web()).lifecycle.logout2() }
];

// src/immutable.ts
function freezeRegistry(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeRegistry(child);
    Object.freeze(value);
  }
  return value;
}

// src/native/identity.ts
import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
var inFlight = /* @__PURE__ */ new Map();
var validIdentity = /^[0-9A-Fa-f]{16}(?:\r?\n)?$/;
function loadOrCreateLegacyInstallationId(filename) {
  const path = resolve(filename);
  const pending = inFlight.get(path);
  if (pending) return pending;
  const created = readOrCreate(path).catch((cause) => {
    if (cause instanceof WsHcmApiError) throw cause;
    throw new WsHcmApiError(
      "protocol",
      "Не удалось прочитать или создать файл с installationId старого клиента.",
      { requestSent: false, cause }
    );
  }).finally(() => {
    inFlight.delete(path);
  });
  inFlight.set(path, created);
  return created;
}
async function readIdentity(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 16 || info.size > 18) {
    throw new WsHcmApiError(
      "protocol",
      "Файл с installationId старого клиента должен быть обычным файлом из 16 шестнадцатеричных цифр.",
      { requestSent: false }
    );
  }
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await file.stat();
    if (!current.isFile() || current.size < 16 || current.size > 18) {
      throw new WsHcmApiError(
        "protocol",
        "В файле с installationId старого клиента не 16 шестнадцатеричных цифр.",
        {
          requestSent: false
        }
      );
    }
    const buffer = Buffer.alloc(19);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const value = buffer.subarray(0, bytesRead).toString("utf8");
    if (!validIdentity.test(value))
      throw new WsHcmApiError(
        "protocol",
        "В файле с installationId старого клиента не 16 шестнадцатеричных цифр.",
        {
          requestSent: false
        }
      );
    return value.slice(0, 16);
  } finally {
    await file.close();
  }
}
async function readOrCreate(path) {
  try {
    return await readIdentity(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true, mode: 448 });
  const candidate = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const file = await open(candidate, "wx", 384);
  try {
    try {
      await file.writeFile(`${randomBytes(8).toString("hex").toUpperCase()}
`, "ascii");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(candidate, path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    return await readIdentity(path);
  } finally {
    await unlink(candidate);
  }
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
    description: "Read the portal landing status without redirects or body.",
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
    description: "Sends one bounded $hbt on /services/main_ws_service and observes $ok. A receipt distinguishes peer Close from missing acknowledgement; app messages and browser /api/spxml2/ws are not covered.",
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
for (const profile of ["native", "web", "legacy"]) {
  for (const method of ["open", "close"]) {
    managed.push({
      operation: {
        id: `${profile}.session.${method}`,
        profile,
        group: "session",
        method,
        title: `${profile} session ${method}`,
        description: "Opens or closes the gateway-owned session. Cookies and LDS IDs remain private to this process.",
        effect: "read",
        status: "implemented",
        inputSchema: empty
      },
      invoke: method === "open" ? async (gateway) => {
        if (profile === "native") await gateway.native();
        else if (profile === "web") await gateway.web();
        else await gateway.legacy();
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
    description: "Closes the LDS and HTTP context and removes it from the gateway session cache.",
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
    description: "Closes the web LDS and HTTP context and removes it from the gateway session cache.",
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
    description: "Opens the gateway-owned native session. Internal session IDs remain in the gateway.",
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
    description: "Opens the gateway-owned web session. Internal session IDs remain in the gateway.",
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
    description: "Allocates an ID and replaces {{objectId}} in documentXmlTemplate, then PutDoc and LoadDoc verify its root ID. This does not reproduce client XMD lifecycle.",
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
if (byId.size !== entries.length) throw new Error("Duplicate native operation ID");
function getNativeOperations() {
  return entries.map((entry) => entry.operation);
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
  constructor(config) {
    this.config = config;
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
  client;
  nativeSession;
  webSession;
  legacySession;
  closed = false;
  accepting = true;
  queue = Promise.resolve();
  closePromise;
  assertOpen() {
    if (this.closed) throw new WsHcmApiError("protocol", "Gateway is closed");
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
  legacy() {
    this.assertOpen();
    if (this.config.installationId === void 0 && this.config.installationIdFile === void 0)
      throw new WsHcmApiError(
        "protocol",
        "Операциям старого клиента нужен installationId из 16 шестнадцатеричных цифр или файл installationIdFile, где он хранится.",
        { requestSent: false }
      );
    return this.legacySession ??= (async () => {
      const installationId = this.config.installationId ?? await loadOrCreateLegacyInstallationId(this.config.installationIdFile);
      return this.client.openLegacySession({ installationId });
    })().catch((error) => {
      this.legacySession = void 0;
      if (error instanceof Error) failedLogins.add(error);
      throw error;
    });
  }
  takeProfile(profile) {
    const session = profile === "native" ? this.nativeSession : profile === "web" ? this.webSession : this.legacySession;
    if (profile === "native") this.nativeSession = void 0;
    else if (profile === "web") this.webSession = void 0;
    else this.legacySession = void 0;
    return session;
  }
  async closeProfile(profile) {
    const session = this.takeProfile(profile);
    if (session) await (await session).close();
  }
  call(id, args) {
    if (!this.accepting) return Promise.reject(new WsHcmApiError("protocol", "Gateway is closed"));
    const entry = byId.get(id);
    if (!entry) return Promise.reject(new WsHcmApiError("protocol", "Unknown native operation"));
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
        if (id === "web.lifecycle.logout" || id === "web.lifecycle.logout2") {
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
   * The server drops a session that stayed idle (within twenty minutes on the stands) or was closed
   * from its side; every later request then gets HTTP 401. A long-lived owner would stay locked out,
   * so the dropped session is replaced by a new login and the request is sent once more. The server
   * rejects such a request before handling it, hence the repeat cannot run anything twice.
   */
  async invoke(entry, args) {
    const profile = entry.operation.profile;
    const session = profile === "native" ? this.nativeSession : profile === "web" ? this.webSession : profile === "legacy" ? this.legacySession : void 0;
    try {
      return await entry.invoke(this, args);
    } catch (error) {
      if (session === void 0 || profile === "anonymous" || !(error instanceof WsHcmApiError) || error.kind !== "auth" || error.status !== 401 || /(?:^|[.])(?:session|lifecycle)[.]|[.](?:open|close)Session$/.test(entry.operation.id))
        throw error;
      const current = profile === "native" ? this.nativeSession : profile === "web" ? this.webSession : this.legacySession;
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
        // Framed lock/owner records are independent of successful payload bytes.
        // Keep them first so stored JSON readers can inspect metadata before base64.
        ...result instanceof XHttpBinaryResponse ? { records: { ...result.records } } : {},
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
    for (const profile of ["native", "web", "legacy"]) {
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
      throw new WsHcmApiError("cleanup", "Gateway session cleanup failed", {
        details: { errorCount: errors.length, remoteCleanupStopped: transportLost },
        cause: errors.length === 1 ? errors[0] : new AggregateError(errors, "Gateway cleanup failures")
      });
  }
};

export {
  validate,
  prepare,
  getEffectiveNativeEffect,
  freezeRegistry,
  getNativeOperations,
  loginFailed,
  NativeGateway
};
