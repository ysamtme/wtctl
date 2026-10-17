/**
 * Безопасный разбор и построение объектов XML, а также явные функции для точных фрагментов.
 * Это не проверка схемы XMD и не универсальные сериализаторы SOAP.
 *
 * @packageDocumentation
 */
import {
  XMLBuilder,
  XMLParser,
  XMLValidator,
  type X2jOptions,
  type XmlBuilderOptions,
} from "fast-xml-parser";
import { ArgumentError, WsHcmApiError } from "./error.js";

const RAW_XML = Symbol("RawXml");
const unsafeDeclaration = /<!\s*(?:DOCTYPE|ENTITY)\b/i;
const reservedXmlNames = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "hasOwnProperty",
  "toString",
  "valueOf",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

// Проверка символов XML исключает этот маркер из любого исходного имени.
const xmlNameMarker = "\u0001";
const protectXmlName = (name: string): string =>
  reservedXmlNames.has(name) ? xmlNameMarker + name : name;
function restoreXmlNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreXmlNames);
  if (value === null || typeof value !== "object") return value;
  const node = value as Record<PropertyKey, unknown>;
  // fromEntries создаёт собственные свойства даже для __proto__; сеттеры прототипа не вызываются.
  return Object.fromEntries(
    Reflect.ownKeys(node).map((key) => [
      typeof key === "string" ? key.replace(xmlNameMarker, "") : key,
      restoreXmlNames(node[key]),
    ]),
  );
}

/** Примитивное значение, которое принимает построитель XML из объекта. */
export type XmlPrimitive = string | number | boolean | null;
/** Значение узла XML: примитив, карта вложенных элементов или массив повторяющихся элементов. */
export type XmlValue = XmlPrimitive | XmlObject | XmlValue[];
/**
 * Представление объекта для `parseXml()`/`buildXml()`.
 * Ключи `@_` — атрибуты, `#text` — текст, массивы создают повторяющиеся соседние элементы.
 */
export interface XmlObject {
  [key: string]: XmlValue;
}

/** Проверенный точный фрагмент XML, который принимают поля сырых дочерних элементов и вложений. */
export interface RawXml {
  readonly [RAW_XML]: true;
  readonly xml: string;
}

const parserOptions: X2jOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  removeNSPrefix: false,
};
const parser = createPlatformXmlParser(parserOptions);
// Корень не разбирается: верхнего уровня хватает, чтобы найти единственный элемент.
const topLevelParser = createPlatformXmlParser({ ...parserOptions, stopNodes: ["*"] });

const builder = createPlatformXmlBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  format: true,
  suppressEmptyNode: false,
});

function validXmlCodePoint(code: number): boolean {
  return (
    code === 9 ||
    code === 10 ||
    code === 13 ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}
// С флагом u непарный суррогат — отдельный знак вне этих диапазонов.
const invalidXmlCharacter = /[^\t\n\r\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u;

/** Отклоняет литеральные символы, запрещённые XML 1.0, включая непарные суррогаты UTF-16. */
export function assertXmlCharacters(source: string): void {
  if (invalidXmlCharacter.test(source)) throw new ArgumentError("В XML есть недопустимый символ.");
}

function assertSafe(source: string): void {
  assertXmlCharacters(source);
  const referenced = source.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, "");
  if (unsafeDeclaration.test(referenced)) {
    throw new ArgumentError("Объявления DOCTYPE и ENTITY в XML не допускаются.");
  }
  // Ссылки в комментариях, CDATA и инструкциях обработки — буквальный текст.
  for (const match of referenced.matchAll(/&#(?:x([0-9a-f]+)|(\d+));/gi)) {
    const code = Number.parseInt(match[1] ?? match[2]!, match[1] === undefined ? 10 : 16);
    if (!validXmlCodePoint(code))
      throw new ArgumentError("В XML есть ссылка на недопустимый символ (&#…;).");
  }
  for (const match of referenced.matchAll(/&([^;\s<&]+);/g)) {
    if (!/^(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+)$/.test(match[1]!))
      throw new ArgumentError(
        "В XML есть сущность, которой нет среди допустимых: amp, lt, gt, apos, quot и числовые.",
      );
  }
  if (/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);)/.test(referenced))
    throw new ArgumentError("В XML есть одиночный знак &; сам знак записывается как &amp;.");
}

/**
 * Общий парсер: полное декодирование числовых ссылок XML, проверка запрещённых и неопределённых
 * сущностей.
 * @internal
 */
export function createPlatformXmlParser(options: X2jOptions = {}): XMLParser {
  const attributePrefix = options.attributeNamePrefix ?? "@_";
  const result = new XMLParser({
    ...options,
    htmlEntities: true,
    transformTagName: (name) =>
      protectXmlName(options.transformTagName ? options.transformTagName(name) : name),
    transformAttributeName: (name) => {
      const transformed = options.transformAttributeName
        ? options.transformAttributeName(name)
        : name;
      return transformed.startsWith(attributePrefix)
        ? attributePrefix + protectXmlName(transformed.slice(attributePrefix.length))
        : protectXmlName(transformed);
    },
  });
  const parse = result.parse.bind(result);
  result.parse = (
    source: string | Uint8Array,
    validation?: Parameters<XMLParser["parse"]>[1],
  ): unknown => {
    const text =
      typeof source === "string"
        ? source
        : new TextDecoder("utf-8", { fatal: true }).decode(source);
    assertSafe(text);
    // Закреплённый fast-xml-parser 5.11.2 использует однопроходный EntityDecoder, в том числе для
    // числовых ссылок. Его имена HTML исключены проверкой assertSafe выше.
    try {
      return restoreXmlNames(parse(text, validation ?? false));
    } catch {
      throw new WsHcmApiError("protocol", "XML не удалось разобрать в поддерживаемых пределах.");
    }
  };
  return result;
}

/**
 * Экранирует значения XML и сохраняет CR ссылками при нормализации концов строк XML.
 * @internal
 */
export function createPlatformXmlBuilder(options: XmlBuilderOptions = {}): XMLBuilder {
  const normalizedOptions = {
    ...options,
    processEntities: true,
    entities: [
      { regex: /&/g, val: "&amp;" },
      { regex: />/g, val: "&gt;" },
      { regex: /</g, val: "&lt;" },
      { regex: /'/g, val: "&apos;" },
      { regex: /"/g, val: "&quot;" },
      { regex: /\r/g, val: "&#13;" },
      { regex: /\n/g, val: "&#10;" },
      { regex: /\t/g, val: "&#9;" },
    ],
  };
  return new XMLBuilder(normalizedOptions);
}

function assertWellFormed(source: string): void {
  const validation = XMLValidator.validate(source);
  if (validation !== true) throw new ArgumentError("Неверный XML: ошибка в разметке.");
}

/** Проверяет синтаксис документа и правила XML для символов и сущностей, не разбирая значения. */
export function validatePlatformXmlSource(source: string): void {
  assertSafe(source);
  assertWellFormed(source);
}

/**
 * Разбирает один корректный документ XML, не приводя значения к типам.
 * Префиксы пространств имён и атрибуты сохраняются; объявления DTD и сущностей отклоняются.
 */
export function parseXml(source: string): XmlObject {
  assertSafe(source);
  assertWellFormed(source);
  return parser.parse(source) as XmlObject;
}

/**
 * Сериализует `XmlObject`, экранируя значения и проверяя результат.
 * Не учитывает XMD и схему и не гарантирует побайтного совпадения при обратном разборе.
 */
export function buildXml(value: XmlObject): string {
  const source = builder.build(value) as string;
  assertSafe(source);
  assertWellFormed(source);
  return source;
}

/** Декларация `<?xml …?>` в самом начале, можно после BOM. */
const leadingDeclaration = /^\uFEFF?<\?xml(?=[\s?])[\s\S]*?\?>/i;

/**
 * Отклоняет декларацию `<?xml …?>` не в самом начале: такой XML неверен где угодно. В комментарии,
 * CDATA и данных другой инструкции обработки это текст.
 */
function assertDeclarationFirst(source: string): void {
  const rest = source.replace(leadingDeclaration, "");
  if (!/<\?xml(?=[\s?])/i.test(rest)) return;
  for (const [, target] of rest.matchAll(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?([^\s?]+)[\s\S]*?\?>/g,
  ))
    if (target?.toLowerCase() === "xml")
      throw new ArgumentError("Декларация XML <?xml …?> допустима только в самом начале.");
}

/**
 * Текст XML для вставки внутрь SOAP, где декларация недопустима: декларация в начале убирается.
 * @internal
 */
export function inlineXml(value: RawXml): string {
  return value.xml.replace(leadingDeclaration, "");
}

/**
 * Проверяет точный фрагмент XML и помечает его для полей сырых дочерних элементов и вложений.
 * Фрагмент вставляется без экранирования; объявления DTD и сущностей по-прежнему запрещены.
 * Декларация `<?xml …?>` допустима только в самом начале; внутри SOAP клиент её убирает.
 */
export function rawXml(source: string): RawXml {
  assertDeclarationFirst(source);
  assertSafe(source);
  assertWellFormed(`<ws-hcm-fragment>${source}</ws-hcm-fragment>`);
  return assembledXml(source);
}

/**
 * Помечает без проверки XML, который клиент собрал сам из экранированных значений и проверенных
 * фрагментов: проверка такой строки ничего не находит, а на десятках мегабайт занимает секунды.
 * @internal
 */
export function assembledXml(source: string): RawXml {
  return Object.freeze({ [RAW_XML]: true as const, xml: source });
}

/** Ровно один дочерний элемент, как требует нетипизированный структурный аргумент XmElem RPC. */
export function rawXmlElement(source: string): RawXml {
  assertDeclarationFirst(source);
  assertSafe(source);
  assertWellFormed(source);
  const value = topLevelParser.parse(source) as XmlObject;
  const elements = Object.keys(value).filter(
    (key) => !key.startsWith("?") && !key.startsWith("@_") && key !== "#text",
  );
  if (
    elements.length !== 1 ||
    Array.isArray(value[elements[0]!]) ||
    (typeof value["#text"] === "string" && value["#text"].trim() !== "")
  )
    throw new ArgumentError("Аргумент XML должен быть ровно одним элементом.");
  // Текст уже проверен как документ, а это строже проверки фрагмента.
  return assembledXml(source);
}

/** Показывает, создано ли значение через `rawXml()`. */
export function isRawXml(value: unknown): value is RawXml {
  return typeof value === "object" && value !== null && RAW_XML in value;
}

/** Экранирует скаляр для текста и атрибутов XML; полный документ не строит. */
export function escapeXml(value: unknown): string {
  const source = String(value);
  assertXmlCharacters(source);
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\t", "&#9;");
}

/** Возвращает локальную часть имени XML, возможно с префиксом пространства имён. */
export function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

/**
 * Находит первый элемент по локальному имени обходом в глубину.
 * Не использовать этот поиск для проверки правил схемы о прямых потомках и кратности.
 */
export function findXmlNode(value: unknown, name: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (localName(key) === name) return child;
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findXmlNode(item, name);
        if (found !== undefined) return found;
      }
    } else {
      const found = findXmlNode(child, name);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
