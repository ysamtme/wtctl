import { WsHcmApiError } from "./error.js";
import { escapeXml, findXmlNode, isRawXml, parseXml, type RawXml, type XmlObject } from "./xml.js";

export type SoapProfile = "native" | "web";
export type SoapScalar = string | number | boolean | RawXml | null | undefined;
export type SoapField = readonly [name: string, value: SoapScalar];

function fieldXml([name, value]: SoapField): string {
  if (value === undefined) return "";
  if (value === null) return `<${name}></${name}>`;
  const content = isRawXml(value) ? value.xml : escapeXml(value);
  return `<${name}>${content}</${name}>`;
}

export function soapEnvelope(
  method: string,
  fields: readonly SoapField[],
  profile: SoapProfile,
): string {
  const envelopeNs =
    profile === "native"
      ? "http://www.w3.org/2003/05/soap-envelope/"
      : "http://schemas.xmlsoap.org/soap/envelope/";
  const operationNs =
    profile === "native" ? "http://www.datex-soft.com/" : "http://www.datex-soft.com/soap/";
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<soap:Envelope xmlns:soap="${envelopeNs}"><soap:Body>` +
    `<${method} xmlns="${operationNs}">${fields.map(fieldXml).join("")}</${method}>` +
    "</soap:Body></soap:Envelope>"
  );
}

export function soapContentType(profile: SoapProfile): string {
  return profile === "native" ? "application/soap+xml" : "application/soap+xml; charset=utf-8";
}

function textOf(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textOf(item);
      if (text !== undefined) return text;
    }
    return undefined;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value !== null && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: unknown })["#text"];
    return text === undefined ? undefined : String(text);
  }
  return undefined;
}

function directChild(value: unknown, name: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    const colon = key.indexOf(":");
    if ((colon < 0 ? key : key.slice(colon + 1)) === name) return child;
  }
  return undefined;
}

function soapFault(document: XmlObject): unknown {
  const bare = directChild(document, "Fault");
  if (bare !== undefined) return bare;
  const envelope = directChild(document, "Envelope");
  return directChild(directChild(envelope, "Body"), "Fault");
}

function boundedFaultText(value: unknown, fallback: string, maxLength = 512): string {
  const source = textOf(value)?.replace(/\s+/g, " ").trim();
  if (!source) return fallback;
  const redacted = source
    .replace(
      /\b(password|passwd|pwd|token|sessionid|cookie|authorization)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1$2[redacted]",
    )
    .replace(/\b(Basic|Bearer)\s+[^\s,;]+/gi, "$1 [redacted]");
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 3)}...`;
}

export function parseSoapBody(method: string, source: string, status: number): XmlObject {
  let document: XmlObject;
  try {
    document = parseXml(source);
  } catch (cause) {
    throw new WsHcmApiError("protocol", "Неверный XML в ответе", {
      operation: method,
      status,
      cause,
    });
  }

  const fault = soapFault(document);
  if (fault !== undefined) {
    const faultString = boundedFaultText(
      findXmlNode(fault, "faultstring") ?? findXmlNode(fault, "Text"),
      "SOAP Fault",
    );
    const rawFaultCode = findXmlNode(fault, "faultcode") ?? findXmlNode(fault, "Value");
    const faultCode =
      rawFaultCode === undefined ? undefined : boundedFaultText(rawFaultCode, "SOAP Fault", 128);
    throw new WsHcmApiError("soap-fault", faultString, {
      operation: method,
      status,
      details: faultCode === undefined ? {} : { faultCode },
    });
  }

  const response = directChild(
    directChild(directChild(document, "Envelope"), "Body"),
    `${method}Response`,
  );
  // fast-xml-parser представляет существующий пустой элемент пустой строкой.
  if (response === "") return {};
  if (response === undefined || response === null || typeof response !== "object") {
    throw new WsHcmApiError("protocol", `В ответе нет ${method}Response`, {
      operation: method,
      status,
    });
  }
  return response as XmlObject;
}

export function xmlText(value: unknown, name: string): string | undefined {
  return textOf(findXmlNode(value, name));
}
