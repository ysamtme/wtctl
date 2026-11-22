import { randomBytes, randomInt } from "node:crypto";
import { WsHcmApiError } from "./error.js";
import {
  parseSoapBody,
  soapBody,
  soapContentType,
  soapEnvelope,
  type SoapBodyField,
  type SoapField,
  type SoapProfile,
} from "./protocol.js";
import { HttpTransport, query } from "./transport.js";
import {
  WsHcmBinaryResponse,
  type RequestOptions,
  type SoapResult,
  type WsHcmResponse,
} from "./types.js";
import { parseXml, rawXml, type RawXml, type XmlObject } from "./xml.js";

/** @internal */
export async function soapCall(
  transport: HttpTransport,
  profile: SoapProfile,
  path: string,
  method: string,
  fields: readonly SoapBodyField[],
  options: RequestOptions & { basic?: boolean } = {},
): Promise<SoapResult> {
  const source = soapBody(method, fields, profile);
  const response = await transport.send(
    path,
    {
      method: "POST",
      headers: { "Content-Type": soapContentType(profile) },
      body: source,
    },
    options,
  );
  return readSoapResponse(response, method);
}

/** @internal */
export async function readSoapResponse(response: Response, method: string): Promise<SoapResult> {
  const rawBody = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(rawBody);
  try {
    const data = parseSoapBody(method, text, response.status);
    if (!response.ok)
      throw new WsHcmApiError("http", `HTTP ${response.status}`, {
        operation: method,
        status: response.status,
      });
    return { status: response.status, headers: response.headers, data, rawBody };
  } catch (error) {
    if (error instanceof WsHcmApiError && error.kind === "soap-fault") throw error;
    if (!response.ok) {
      throw new WsHcmApiError("http", `HTTP ${response.status}`, {
        operation: method,
        status: response.status,
        cause: error,
      });
    }
    throw error;
  }
}

/** @internal */
export async function soapMultipartCall(
  transport: HttpTransport,
  profile: SoapProfile,
  path: string,
  method: string,
  fields: readonly SoapField[],
  external: { readonly name: string; readonly data: RawXml },
  options?: RequestOptions,
): Promise<SoapResult> {
  const contentId = `0x${randomBytes(8).toString("hex")}`;
  const boundary = `0x${randomBytes(16).toString("hex")}`;
  const rootContentType = soapContentType(profile);
  const include = rawXml(
    `<xop:Include xmlns:xop="http://www.w3.org/2004/08/xop/include" href="cid:${contentId}"/>`,
  );
  const envelope = soapEnvelope(method, [...fields, [external.name, include]], profile);
  const prefix = new TextEncoder().encode(
    `\r\n--${boundary}\r\nContent-Type: ${rootContentType}\r\nContent-ID: <5837048452213900518@datex-soft.com>\r\n\r\n${envelope}` +
      `\r\n--${boundary}\r\nContent-ID: ${contentId}\r\n\r\n`,
  );
  const data = new TextEncoder().encode(external.data.xml);
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(prefix.byteLength + data.byteLength + suffix.byteLength);
  body.set(prefix, 0);
  body.set(data, prefix.byteLength);
  body.set(suffix, prefix.byteLength + data.byteLength);
  const response = await transport.send(
    path,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary="${boundary}"; type="application/xop+xml"; start-info="text/xml"`,
      },
      body,
    },
    options,
  );
  return readSoapResponse(response, method);
}

/** @internal */
export async function soapBinaryCall(
  transport: HttpTransport,
  profile: SoapProfile,
  path: string,
  method: string,
  fields: readonly SoapField[],
  options?: RequestOptions,
): Promise<WsHcmBinaryResponse> {
  const response = await transport.send(
    path,
    {
      method: "POST",
      headers: { "Content-Type": soapContentType(profile) },
      body: soapEnvelope(method, fields, profile),
    },
    options,
  );
  if (response.ok) return new WsHcmBinaryResponse(response);
  const rawBody = await boundedResponsePrefix(response);
  try {
    parseSoapBody(method, new TextDecoder().decode(rawBody), response.status);
  } catch (error) {
    if (error instanceof WsHcmApiError && error.kind === "soap-fault") throw error;
  }
  throw new WsHcmApiError("http", `HTTP ${response.status}`, {
    operation: method,
    status: response.status,
  });
}

async function boundedResponsePrefix(response: Response, maxBytes = 65_536): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const buffer = new Uint8Array(maxBytes);
  let length = 0;
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) return buffer.slice(0, length);
      const take = Math.min(value.length, maxBytes - length);
      buffer.set(value.subarray(0, take), length);
      length += take;
      if (take < value.length) break;
    }
  } catch {
    // Статус HTTP уже основная ошибка; испорченное тело безопасных подробностей не добавляет.
  }
  await reader.cancel().catch(() => undefined);
  return buffer.slice(0, length);
}

/** @internal */
export function responseCharset(response: Response, fallback: string): string {
  const contentType = response.headers.get("content-type") ?? "";
  const match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match?.[1] ?? match?.[2] ?? fallback;
}

async function readResponse<T>(
  response: Response,
  parse: (source: string) => T,
  fallbackCharset = "utf-8",
): Promise<WsHcmResponse<T>> {
  const rawBody = new Uint8Array(await response.arrayBuffer());
  if (!response.ok)
    throw new WsHcmApiError("http", `HTTP ${response.status}`, { status: response.status });
  let source: string;
  try {
    source = new TextDecoder(responseCharset(response, fallbackCharset)).decode(rawBody);
  } catch (cause) {
    throw new WsHcmApiError("protocol", "Кодировка ответа не поддерживается", {
      status: response.status,
      cause,
    });
  }
  try {
    return { status: response.status, headers: response.headers, data: parse(source), rawBody };
  } catch (cause) {
    throw new WsHcmApiError("protocol", "Неверное тело ответа", {
      status: response.status,
      cause,
    });
  }
}

/** @internal */
export function jsonResponse(response: Response): Promise<WsHcmResponse<unknown>> {
  return readResponse(response, (source) => JSON.parse(source) as unknown);
}

/** @internal */
export function textResponse(response: Response): Promise<WsHcmResponse<string>> {
  return readResponse(response, (source) => source);
}

/** @internal */
export function xmlResponse(
  response: Response,
  fallbackCharset?: string,
): Promise<WsHcmResponse<XmlObject>> {
  return readResponse(response, parseXml, fallbackCharset);
}

/** @internal */
export async function binaryResponse(
  response: Response,
  operation?: string,
): Promise<WsHcmBinaryResponse> {
  if (response.ok) return new WsHcmBinaryResponse(response);
  await response.body?.cancel();
  throw new WsHcmApiError("http", `HTTP ${response.status}`, {
    status: response.status,
    ...(operation === undefined ? {} : { operation }),
  });
}

/** @internal */
export function withRnd(path: string): string {
  return query(path, { rnd: randomInt(1_000_000_000) });
}
