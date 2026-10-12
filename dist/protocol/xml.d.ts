declare const RAW_XML: unique symbol;
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
/** Rejects literal characters excluded by XML 1.0, including unpaired UTF-16 surrogates. */
export declare function assertXmlCharacters(source: string): void;
/** Validates document syntax and XML-only character/entity rules without parsing its values. */
export declare function validatePlatformXmlSource(source: string): void;
/**
 * Parses one well-formed XML document without coercing lexical values.
 * Namespace prefixes and attributes are preserved; DTD/entity declarations are rejected.
 */
export declare function parseXml(source: string): XmlObject;
/**
 * Serializes an `XmlObject`, escaping values and validating the result.
 * This is not XMD/schema-aware and is not a byte-for-byte round-trip formatter.
 */
export declare function buildXml(value: XmlObject): string;
/**
 * Validates an exact XML fragment and brands it for raw child/attachment fields.
 * The fragment is inserted without escaping; DTD/entity declarations remain forbidden.
 */
export declare function rawXml(source: string): RawXml;
/** Exactly one child element, as required by an untyped structured XmElem RPC argument. */
export declare function rawXmlElement(source: string): RawXml;
/** Returns whether a value was created by `rawXml()`. */
export declare function isRawXml(value: unknown): value is RawXml;
/** Escapes a scalar for XML text/attribute content; it does not build a complete document. */
export declare function escapeXml(value: unknown): string;
/** Returns the local part of a possibly namespace-prefixed XML name. */
export declare function localName(name: string): string;
/**
 * Finds the first element by local name using depth-first traversal.
 * Do not use this convenience search to enforce direct-child/cardinality schema rules.
 */
export declare function findXmlNode(value: unknown, name: string): unknown;
export {};
