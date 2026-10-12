/**
 * Safe XML object parsing/building and explicit exact-fragment helpers.
 * These utilities are not XMD schema validation or generic SOAP serializers.
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
import { WsHcmApiError } from "./error.js";

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

// XML character validation excludes this marker from every source name.
const xmlNameMarker = "\u0001";
const protectXmlName = (name: string): string =>
  reservedXmlNames.has(name) ? xmlNameMarker + name : name;
function restoreXmlNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreXmlNames);
  if (value === null || typeof value !== "object") return value;
  const node = value as Record<PropertyKey, unknown>;
  // fromEntries creates own properties even for __proto__; no prototype setters run.
  return Object.fromEntries(
    Reflect.ownKeys(node).map((key) => [
      typeof key === "string" ? key.replace(xmlNameMarker, "") : key,
      restoreXmlNames(node[key]),
    ]),
  );
}

/** Primitive value accepted by the object-to-XML builder. */
export type XmlPrimitive = string | number | boolean | null;
/** XML node value: a primitive, nested element map, or repeated-element array. */
export type XmlValue = XmlPrimitive | XmlObject | XmlValue[];
/**
 * Object representation used by `parseXml()`/`buildXml()`.
 * `@_` keys are attributes, `#text` is text, and arrays create repeated sibling elements.
 */
export interface XmlObject {
  [key: string]: XmlValue;
}

/** Validated exact XML fragment accepted by raw child/attachment fields. */
export interface RawXml {
  readonly [RAW_XML]: true;
  readonly xml: string;
}

const parser = createPlatformXmlParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  removeNSPrefix: false,
});

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

/** Rejects literal characters excluded by XML 1.0, including unpaired UTF-16 surrogates. */
export function assertXmlCharacters(source: string): void {
  for (const character of source)
    if (!validXmlCodePoint(character.codePointAt(0)!))
      throw new TypeError("В XML есть недопустимый символ.");
}

function assertSafe(source: string): void {
  assertXmlCharacters(source);
  const referenced = source.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, "");
  if (unsafeDeclaration.test(referenced)) {
    throw new TypeError("Объявления DOCTYPE и ENTITY в XML не допускаются.");
  }
  // References in comments, CDATA and processing instructions are literal text.
  for (const match of referenced.matchAll(/&#(?:x([0-9a-f]+)|(\d+));/gi)) {
    const code = Number.parseInt(match[1] ?? match[2]!, match[1] === undefined ? 10 : 16);
    if (!validXmlCodePoint(code))
      throw new TypeError("В XML есть ссылка на недопустимый символ (&#…;).");
  }
  for (const match of referenced.matchAll(/&([^;\s<&]+);/g)) {
    if (!/^(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+)$/.test(match[1]!))
      throw new TypeError(
        "В XML есть сущность, которой нет среди допустимых: amp, lt, gt, apos, quot и числовые.",
      );
  }
  if (/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);)/.test(referenced))
    throw new TypeError("В XML есть одиночный знак &; сам знак записывается как &amp;.");
}

/**
 * Shared parser with complete XML numeric decoding and forbidden/undefined entity checks.
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
    // Pinned fast-xml-parser 5.11.2 uses a single-pass EntityDecoder, including
    // numeric references. Its HTML names are excluded by assertSafe above.
    try {
      return restoreXmlNames(parse(text, validation ?? false));
    } catch {
      throw new WsHcmApiError("protocol", "XML could not be parsed within supported limits.");
    }
  };
  return result;
}

/**
 * Escape XML values and preserve CR values as references across XML line-end normalization.
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
  if (validation !== true) throw new TypeError("Неверный XML: ошибка в разметке.");
}

/** Validates document syntax and XML-only character/entity rules without parsing its values. */
export function validatePlatformXmlSource(source: string): void {
  assertSafe(source);
  assertWellFormed(source);
}

/**
 * Parses one well-formed XML document without coercing lexical values.
 * Namespace prefixes and attributes are preserved; DTD/entity declarations are rejected.
 */
export function parseXml(source: string): XmlObject {
  assertSafe(source);
  assertWellFormed(source);
  return parser.parse(source) as XmlObject;
}

/**
 * Serializes an `XmlObject`, escaping values and validating the result.
 * This is not XMD/schema-aware and is not a byte-for-byte round-trip formatter.
 */
export function buildXml(value: XmlObject): string {
  const source = builder.build(value) as string;
  assertSafe(source);
  assertWellFormed(source);
  return source;
}

/**
 * Validates an exact XML fragment and brands it for raw child/attachment fields.
 * The fragment is inserted without escaping; DTD/entity declarations remain forbidden.
 */
export function rawXml(source: string): RawXml {
  assertSafe(source);
  assertWellFormed(`<ws-hcm-fragment>${source}</ws-hcm-fragment>`);
  return Object.freeze({ [RAW_XML]: true as const, xml: source });
}

/** Exactly one child element, as required by an untyped structured XmElem RPC argument. */
export function rawXmlElement(source: string): RawXml {
  const value = parseXml(source);
  const elements = Object.keys(value).filter(
    (key) => !key.startsWith("?") && !key.startsWith("@_") && key !== "#text",
  );
  if (
    elements.length !== 1 ||
    Array.isArray(value[elements[0]!]) ||
    (typeof value["#text"] === "string" && value["#text"].trim() !== "")
  )
    throw new TypeError("Аргумент XML должен быть ровно одним элементом.");
  return rawXml(source);
}

/** Returns whether a value was created by `rawXml()`. */
export function isRawXml(value: unknown): value is RawXml {
  return typeof value === "object" && value !== null && RAW_XML in value;
}

/** Escapes a scalar for XML text/attribute content; it does not build a complete document. */
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

/** Returns the local part of a possibly namespace-prefixed XML name. */
export function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

/**
 * Finds the first element by local name using depth-first traversal.
 * Do not use this convenience search to enforce direct-child/cardinality schema rules.
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
