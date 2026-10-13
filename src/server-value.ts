// Значение с типом, как его принимает и отдаёт функция библиотеки сервера: кодирование аргумента,
// строгий разбор ответа и разбор значения в обычный JSON. Остальной код формата не знает.
import { HcmError } from "./errors.js";
import type { RpcArgument } from "./protocol/api.js";
import { findXmlNode } from "./protocol/xml.js";

/** Аргумент функции сервера из обычного значения: строка, целое, true/false или null. */
export function rpcArgument(value: unknown): RpcArgument {
  if (value === null) return { valueType: "null", lexicalValue: "" };
  if (typeof value === "string") return { valueType: "string", lexicalValue: value };
  if (typeof value === "boolean") return { valueType: "bool", lexicalValue: value ? "1" : "0" };
  if (typeof value === "number" && Number.isSafeInteger(value))
    return { valueType: "integer", lexicalValue: String(value) };
  throw new HcmError(
    "INVALID_RPC_ARGUMENT",
    "Такой аргумент функции задаётся явно: {valueType, lexicalValue}. Так передают дробные и большие числа, даты, объекты и XML.",
  );
}

// Помощники строгого разбора бросают пустую Error: разборщик ловит её и формулирует свой код отказа.
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}
export function blank(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.trim() === "");
}
export function exactKeys(node: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(node).some((key) => !allowed.includes(key))) throw new Error();
}
/** Тип значения (VALUE-TYPE или valueType) равен `type` без учёта регистра. */
export function isType(value: unknown, type: string): boolean {
  return typeof value === "string" && value.toLowerCase() === type;
}
/** Обёртка ответа допускает только объявления пространств имён и пустой текст. */
function wrapper(value: unknown, child: string): unknown {
  const node = object(value);
  if (
    !blank(node["#text"]) ||
    Object.keys(node).some((key) => {
      if (key === child || key === "#text") return false;
      return (
        !/^@_xmlns(?::[A-Za-z_][\w.-]*)?$/.test(key) ||
        typeof node[key] !== "string" ||
        node[key].length > 1024
      );
    })
  )
    throw new Error();
  return node[child];
}
/** Элемент с типом `type` и только текстом внутри. */
export function typedText(value: unknown, type: "string" | "integer"): string {
  const node = object(value);
  exactKeys(node, ["@_VALUE-TYPE", "#text"]);
  if (!isType(node["@_VALUE-TYPE"], type)) throw new Error();
  const text = node["#text"] ?? "";
  if (typeof text !== "string") throw new Error();
  return text;
}

/**
 * Ответ функции строго: объект только с ключами xml, valueType, lexicalValue и узел Result
 * в обёртках ResultData и Result. Проверки самого значения остаются у вызывающего.
 */
export function strictResponse(response: unknown): {
  rpc: Record<string, unknown>;
  result: Record<string, unknown>;
} {
  const rpc = object(response);
  exactKeys(rpc, ["xml", "valueType", "lexicalValue"]);
  return { rpc, result: object(wrapper(wrapper(rpc.xml, "ResultData"), "Result")) };
}

/** Сохраняет скалярные значения как записаны, в том числе каждое 64-битное целое и дату. */
export function decodeRpcValue(value: unknown, depth = 0): unknown {
  if (depth > 64) throw new HcmError("SCRIPT_RESPONSE", "Результат вложен глубже 64 уровней.");
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new HcmError("SCRIPT_RESPONSE", "В результате нет элемента с VALUE-TYPE.");
  const node = value as Record<string, unknown>;
  const typeValue = node["@_VALUE-TYPE"];
  if (typeof typeValue !== "string" || typeValue === "")
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "В результате есть элемент XML без типа.",
      "Возвращать можно простые значения, массивы и обычные объекты. Элементы и документы XML (XmElem, XmDoc) нужно превращать в строку в самом коде. Ответ сервера как есть покажет web.rpc.call.",
    );
  const type = typeValue.toLowerCase();
  const children = Object.keys(node).filter((key) => !key.startsWith("@_") && key !== "#text");
  const text = node["#text"] ?? "";
  if (typeof text !== "string")
    throw new HcmError("SCRIPT_RESPONSE", "Значение в результате — не текст.");
  if (["array", "object", "null", "undefined"].includes(type) && text.trim() !== "")
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "В массиве, объекте или null результата есть посторонний текст.",
    );
  if (type === "array") {
    if (children.some((key) => key !== "e"))
      throw new HcmError("SCRIPT_RESPONSE", "В массиве результата есть посторонние элементы.");
    const items = node.e === undefined ? [] : Array.isArray(node.e) ? node.e : [node.e];
    return items.map((item) => decodeRpcValue(item, depth + 1));
  }
  if (type === "object") {
    return Object.fromEntries(children.map((key) => [key, decodeRpcValue(node[key], depth + 1)]));
  }
  if (type === "null" || type === "undefined") {
    if (children.length !== 0)
      throw new HcmError("SCRIPT_RESPONSE", "В значении null результата есть вложенные элементы.");
    return null;
  }
  if (!["string", "integer", "real", "bool", "date"].includes(type))
    throw new HcmError(
      "SCRIPT_RESPONSE",
      "В результате есть значение неподдерживаемого типа (VALUE-TYPE).",
      "Возвращать можно простые значения, массивы и обычные объекты. Элементы и документы XML (XmElem, XmDoc) нужно превращать в строку в самом коде. Ответ сервера как есть покажет web.rpc.call.",
    );
  if (children.length !== 0)
    throw new HcmError("SCRIPT_RESPONSE", "В простом значении результата есть вложенные элементы.");
  return text;
}

/**
 * Что вернула функция библиотеки, обычным JSON. Значение, которое типизированная форма не может
 * выразить (документ, элемент формы), остаётся разобранным ответом.
 */
export function rpcValue(response: unknown): unknown {
  try {
    return { value: decodeRpcValue(findXmlNode(response, "Result")) };
  } catch (error) {
    if (error instanceof HcmError && error.code === "SCRIPT_RESPONSE") return response;
    throw error;
  }
}
