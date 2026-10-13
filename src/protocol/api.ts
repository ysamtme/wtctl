import { randomBytes, randomInt } from "node:crypto";
import { WsHcmApiError } from "./error.js";
import {
  parseSoapBody,
  soapContentType,
  soapEnvelope,
  xmlText,
  type SoapField,
  type SoapProfile,
} from "./protocol.js";
import { HttpTransport, query } from "./transport.js";
import {
  WsHcmBinaryResponse,
  type DecimalId,
  type RequestOptions,
  type TrackingId,
  type WsHcmResponse,
} from "./types.js";
import {
  escapeXml,
  findXmlNode,
  isRawXml,
  parseXml,
  rawXml,
  rawXmlElement,
  type RawXml,
  type XmlObject,
} from "./xml.js";

/** Buffered parsed SOAP result with exact response bytes. */
export type SoapResult = WsHcmResponse<XmlObject>;
/** Query parameter map whose defined values are serialized lexically. */
export type QueryValues = Readonly<Record<string, string | number | boolean | null | undefined>>;
/** Exact external MIME-part data; strings and RawXml are encoded as UTF-8. */
export type SoapAttachment = RawXml | string | Uint8Array | ArrayBuffer;

/** Stock LDS library invocation. ArgData is inline typed child XML, never an XOP attachment. */
export interface RunMethodRequest {
  libName: string;
  methodName: string;
  /** Separate internal thread; no public task handle or completion acknowledgement is returned. */
  runAsync?: boolean;
  errorLogName?: string;
  argData: RawXml;
}

function decimal(value: DecimalId, name: string): DecimalId;
function decimal(value: DecimalId | undefined, name: string): DecimalId | undefined;
function decimal(value: DecimalId | undefined, name: string): DecimalId | undefined {
  if (value !== undefined && !/^\d+$/.test(value))
    throw new TypeError(`${name}: нужна строка из десятичных цифр.`);
  return value;
}

function tracking(value: TrackingId, name: string): TrackingId {
  if (!/^(?:\d+|0x[0-9a-f]+)$/i.test(value))
    throw new TypeError(
      `${name}: нужно целое число строкой — десятичное или шестнадцатеричное с 0x.`,
    );
  return value;
}

function validateRpcTarget(target: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(target))
    throw new TypeError("target: нужно имя библиотеки и имя функции через точку.");
}

async function soapCall(
  transport: HttpTransport,
  profile: SoapProfile,
  path: string,
  method: string,
  fields: readonly SoapField[],
  options: RequestOptions & { basic?: boolean } = {},
): Promise<SoapResult> {
  const source = soapEnvelope(method, fields, profile);
  const response = await transport.send(
    path,
    {
      method: "POST",
      headers: { "Content-Type": soapContentType(profile) },
      body: source,
    },
    {
      ...(options.basic === undefined ? {} : { basic: options.basic }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
  );
  return readSoapResponse(response, method);
}

async function readSoapResponse(response: Response, method: string): Promise<SoapResult> {
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

async function soapMultipartCall(
  transport: HttpTransport,
  profile: SoapProfile,
  path: string,
  method: string,
  fields: readonly SoapField[],
  external: { readonly name: string; readonly data: SoapAttachment },
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
  const data = isRawXml(external.data)
    ? new TextEncoder().encode(external.data.xml)
    : typeof external.data === "string"
      ? new TextEncoder().encode(external.data)
      : external.data instanceof ArrayBuffer
        ? new Uint8Array(external.data)
        : external.data;
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = appendBytes(appendBytes(prefix, data), suffix);
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

async function soapBinaryCall(
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
    // The HTTP status is already the primary error; a broken error body adds no safe detail.
  }
  await reader.cancel().catch(() => undefined);
  return buffer.slice(0, length);
}

function responseCharset(response: Response, fallback: string): string {
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
    throw new WsHcmApiError("protocol", "Unsupported response charset", {
      status: response.status,
      cause,
    });
  }
  try {
    return { status: response.status, headers: response.headers, data: parse(source), rawBody };
  } catch (cause) {
    throw new WsHcmApiError("protocol", "Invalid response body", {
      status: response.status,
      cause,
    });
  }
}

function jsonResponse(response: Response): Promise<WsHcmResponse<unknown>> {
  return readResponse(response, (source) => JSON.parse(source) as unknown);
}

function textResponse(response: Response): Promise<WsHcmResponse<string>> {
  return readResponse(response, (source) => source);
}

function xmlResponse(
  response: Response,
  fallbackCharset?: string,
): Promise<WsHcmResponse<XmlObject>> {
  return readResponse(response, parseXml, fallbackCharset);
}

async function binaryResponse(
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

function withRnd(path: string): string {
  return query(path, { rnd: randomInt(1_000_000_000) });
}

export interface OpenSessionResult {
  sessionId: DecimalId;
  response: SoapResult;
}

export async function openLdsSession(
  transport: HttpTransport,
  profile: SoapProfile,
  basic = false,
): Promise<OpenSessionResult> {
  const response = await soapCall(
    transport,
    profile,
    withRnd("/services/LdsService"),
    "OpenSession",
    [["InstallationID", ""]],
    { basic },
  );
  const sessionId = xmlText(response.data, "SessionID");
  if (sessionId === undefined || !/^\d+$/.test(sessionId)) {
    throw new WsHcmApiError("protocol", "OpenSession did not return a decimal SessionID", {
      operation: "OpenSession",
    });
  }
  return { sessionId, response };
}

/** @internal */
export function closeLdsSession(
  transport: HttpTransport,
  profile: SoapProfile,
  sessionId: DecimalId,
  options?: RequestOptions,
): Promise<SoapResult> {
  return soapCall(
    transport,
    profile,
    withRnd("/services/LdsService"),
    "CloseSession",
    [["SessionID", sessionId]],
    options,
  );
}

class LdsCaller {
  constructor(
    private readonly transport: HttpTransport,
    private readonly profile: SoapProfile,
    private readonly sessionId: () => DecimalId,
  ) {}

  call(
    method: string,
    fields: readonly SoapField[],
    options?: RequestOptions,
  ): Promise<SoapResult> {
    return soapCall(
      this.transport,
      this.profile,
      withRnd("/services/LdsService"),
      method,
      fields,
      options,
    );
  }

  binaryCall(
    method: string,
    fields: readonly SoapField[],
    options?: RequestOptions,
  ): Promise<WsHcmBinaryResponse> {
    return soapBinaryCall(
      this.transport,
      this.profile,
      withRnd("/services/LdsService"),
      method,
      fields,
      options,
    );
  }

  id(): DecimalId {
    return this.sessionId();
  }

  getTransport(): HttpTransport {
    return this.transport;
  }
}

/** Request shape for LDS XQuery. Cursor identifiers remain lossless decimal strings. */
export interface XQueryRequest {
  query: string;
  startPos?: number;
  maxCount?: number;
  expectToReadAll?: boolean;
  keepCursor?: boolean;
  cursorId?: DecimalId;
}

function safeInteger(value: number | undefined, name: string): number | undefined {
  if (value !== undefined && !Number.isSafeInteger(value))
    throw new TypeError(`${name}: нужно целое число.`);
  return value;
}

/** Shared request fields for native `LoadUrl`/`LoadDoc`. */
export interface LoadRequest {
  url: string;
  useBinaryResponse?: boolean;
  useMultipartResponse?: boolean;
  tryLock?: boolean;
  compress?: boolean;
}

/** Load request that selects an unbuffered binary/multipart response. */
export type StreamingLoadRequest = LoadRequest &
  ({ useBinaryResponse: true } | { useMultipartResponse: true });

/** Load request that keeps the normal parsed SOAP response. */
export type SoapLoadRequest = LoadRequest & {
  useBinaryResponse?: false;
  useMultipartResponse?: false;
};

/**
 * Native Administrator LDS SOAP 1.2 operations bound to one decimal LDS session ID.
 * Optional fields remain omitted unless explicitly supplied; large request bodies use multipart/XOP.
 */
export class NativeLdsApi {
  constructor(private readonly caller: LdsCaller) {}

  /** Closes the decimal LDS context. Prefer `NativeSession.close()` for the complete client lifecycle. */
  closeSession(options?: RequestOptions): Promise<SoapResult> {
    return this.caller.call("CloseSession", [["SessionID", this.caller.id()]], options);
  }
  /**
   * Returns ready entries from the current context's classic catalog-stat cache.
   * An empty Catalogs response is valid; readiness and skip gates may hide entries.
   * RecordsNum is cached metadata, not a fresh SQL COUNT or an object-type registry.
   */
  getCatalogsStat(options?: RequestOptions): Promise<SoapResult> {
    return this.caller.call("GetCatalogsStat", [["SessionID", this.caller.id()]], options);
  }
  /** Returns modified objects since optional `minModDate`. */
  getModObjects(
    request: { minModDate?: string; compress?: boolean } = {},
    options?: RequestOptions,
  ): Promise<SoapResult> {
    return this.caller.call(
      "GetModObjects",
      [
        ["MinModDate", request.minModDate],
        ["SessionID", this.caller.id()],
        ["Compress", request.compress],
      ],
      options,
    );
  }
  /**
   * Loads URL data; response flags select a stream, while `tryLock` mutates lock state.
   * @mutating When `tryLock` is enabled.
   */
  loadUrl(request: StreamingLoadRequest, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
  loadUrl(request: SoapLoadRequest, options?: RequestOptions): Promise<SoapResult>;
  loadUrl(
    request: LoadRequest,
    options?: RequestOptions,
  ): Promise<SoapResult | WsHcmBinaryResponse>;
  loadUrl(
    request: LoadRequest,
    options?: RequestOptions,
  ): Promise<SoapResult | WsHcmBinaryResponse> {
    const fields: readonly SoapField[] = [
      ["Url", request.url],
      ["UseBinaryResponse", request.useBinaryResponse],
      ["UseMultipartResponse", request.useMultipartResponse],
      ["TryLock", request.tryLock],
      ["SessionID", this.caller.id()],
      ["Compress", request.compress],
    ];
    return request.useBinaryResponse || request.useMultipartResponse
      ? this.caller.binaryCall("LoadUrl", fields, options)
      : this.caller.call("LoadUrl", fields, options);
  }
  /**
   * Writes exact text/binary URL data as an XOP attachment.
   * @mutating
   */
  putUrl(
    request: { url: string; data: SoapAttachment },
    options?: RequestOptions,
  ): Promise<SoapResult> {
    return soapMultipartCall(
      this.caller.getTransport(),
      "native",
      withRnd("/services/LdsService"),
      "PutUrl",
      [
        ["Url", request.url],
        ["SessionID", this.caller.id()],
      ],
      { name: "Data", data: request.data },
      options,
    );
  }
  /**
   * Deletes a URL, optionally requiring strict existence.
   * @mutating
   */
  deleteUrl(
    request: { url: string; strictDelete?: boolean },
    options?: RequestOptions,
  ): Promise<SoapResult> {
    return this.caller.call(
      "DeleteUrl",
      [
        ["Url", request.url],
        ["StrictDelete", request.strictDelete],
        ["SessionID", this.caller.id()],
      ],
      options,
    );
  }
  /**
   * Loads a document; `tryLock` mutates lock state.
   * In 1171, the LoadDoc handler ignores binary/multipart response flags and emits SOAP.
   * Those flags select the client's raw stream, whose bytes may still contain a SOAP envelope;
   * they do not guarantee the returned representation.
   * @mutating When `tryLock` is enabled.
   */
  loadDoc(request: StreamingLoadRequest, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
  loadDoc(request: SoapLoadRequest, options?: RequestOptions): Promise<SoapResult>;
  loadDoc(
    request: LoadRequest,
    options?: RequestOptions,
  ): Promise<SoapResult | WsHcmBinaryResponse>;
  loadDoc(
    request: LoadRequest,
    options?: RequestOptions,
  ): Promise<SoapResult | WsHcmBinaryResponse> {
    const fields: readonly SoapField[] = [
      ["Url", request.url],
      ["UseBinaryResponse", request.useBinaryResponse],
      ["UseMultipartResponse", request.useMultipartResponse],
      ["TryLock", request.tryLock],
      ["SessionID", this.caller.id()],
      ["Compress", request.compress],
    ];
    return request.useBinaryResponse || request.useMultipartResponse
      ? this.caller.binaryCall("LoadDoc", fields, options)
      : this.caller.call("LoadDoc", fields, options);
  }
  /**
   * Persists caller-built XML as an XOP attachment.
   * Omitted/false `skipActions` keeps server pre-save processing enabled; `true` suppresses its action-enable state.
   * `data` must be created by `rawXml()`.
   * @mutating
   */
  putDoc(
    request: {
      url: string;
      writeDocInfo?: boolean;
      skipActions?: boolean;
      neverSaved?: boolean;
      data: RawXml;
    },
    options?: RequestOptions,
  ): Promise<SoapResult> {
    if (!isRawXml(request.data)) throw new TypeError("data: нужен проверенный XML (RawXml).");
    return soapMultipartCall(
      this.caller.getTransport(),
      "native",
      withRnd("/services/LdsService"),
      "PutDoc",
      [
        ["Url", request.url],
        ["WriteDocInfo", request.writeDocInfo],
        ["SkipActions", request.skipActions],
        ["NeverSaved", request.neverSaved],
        ["SessionID", this.caller.id()],
      ],
      { name: "Data", data: request.data },
      options,
    );
  }
  /**
   * Deletes a physical document URL, optionally requiring strict existence.
   * @mutating
   */
  deleteDoc(
    request: { url: string; strictDelete?: boolean },
    options?: RequestOptions,
  ): Promise<SoapResult> {
    return this.caller.call(
      "DeleteDoc",
      [
        ["Url", request.url],
        ["StrictDelete", request.strictDelete],
        ["SessionID", this.caller.id()],
      ],
      options,
    );
  }
  /**
   * Allocates a new lossless object ID in the selected database.
   * @mutating
   */
  getNewObjectId(
    request: { dbName: string; objectType?: string },
    options?: RequestOptions,
  ): Promise<SoapResult> {
    return this.caller.call(
      "GetNewObjectID",
      [
        ["DbName", request.dbName],
        ["ObjectType", request.objectType],
        ["SessionID", this.caller.id()],
      ],
      options,
    );
  }
  /** Executes XQuery with optional pagination/cursor lifecycle. */
  xQuery(request: XQueryRequest, options?: RequestOptions): Promise<SoapResult> {
    return this.caller.call(
      "XQuery",
      [
        ["Query", request.query],
        ["StartPos", safeInteger(request.startPos, "startPos")],
        ["MaxCount", safeInteger(request.maxCount, "maxCount")],
        ["ExpectToReadAll", request.expectToReadAll],
        ["KeepCursor", request.keepCursor],
        ["CursorID", decimal(request.cursorId, "cursorId")],
        ["SessionID", this.caller.id()],
      ],
      options,
    );
  }
  /**
   * Releases a cursor previously returned to this LDS context.
   * @mutating Changes transient cursor state.
   */
  releaseCursor(cursorId: DecimalId, options?: RequestOptions): Promise<SoapResult> {
    return this.caller.call(
      "ReleaseCursor",
      [
        ["CursorID", decimal(cursorId, "cursorId")],
        ["SessionID", this.caller.id()],
      ],
      options,
    );
  }
  /**
   * Executes a server library method with inline XML `ArgData` children.
   * Server 2025.1.1171 takes the arguments only as XML inside the SOAP body;
   * it rejects external XOP attachments as Parameter is not XML.
   * RunAsync uses a separate internal thread and returns no public task handle;
   * its initial ResultData may be typed undefined and does not prove completion.
   * GetAsyncMethodStatus and KillAsyncMethod cannot track this execution.
   * @mutating
   */
  runMethod(request: RunMethodRequest, options?: RequestOptions): Promise<SoapResult> {
    return runLdsMethod(this.caller, request, options);
  }
  /** Keeps the current native LDS session active. */
  idle(options?: RequestOptions): Promise<SoapResult> {
    return this.caller.call("Idle", [["SessionID", this.caller.id()]], options);
  }
}

function runLdsMethod(
  caller: LdsCaller,
  request: RunMethodRequest,
  options?: RequestOptions,
): Promise<SoapResult> {
  if (!isRawXml(request.argData)) throw new TypeError("argData: нужен проверенный XML (RawXml).");
  return caller.call(
    "RunMethod",
    [
      ["LibName", request.libName],
      ["MethodName", request.methodName],
      ["RunAsync", request.runAsync],
      ["ErrorLogName", request.errorLogName],
      ["SessionID", caller.id()],
      ["ArgData", request.argData],
    ],
    options,
  );
}

/** Web Administrator LDS SOAP 1.1 context and shared stock service methods, bound to one LDS ID. */
export class WebLdsApi {
  constructor(private readonly caller: LdsCaller) {}

  /**
   * Executes web LDS XQuery. `keepCursor` defaults to `true`; pass `false` for one-shot reads.
   * @mutating When cursor retention is enabled (the default).
   */
  xQuery(request: XQueryRequest, options?: RequestOptions): Promise<SoapResult> {
    return this.caller.call(
      "XQuery",
      [
        ["Query", request.query],
        ["KeepCursor", request.keepCursor ?? true],
        ["CursorID", decimal(request.cursorId, "cursorId")],
        ["StartPos", safeInteger(request.startPos, "startPos")],
        ["MaxCount", safeInteger(request.maxCount, "maxCount")],
        ["SessionID", this.caller.id()],
      ],
      options,
    );
  }
  /**
   * Releases a caller-owned web LDS cursor.
   * @mutating Changes transient cursor state.
   */
  releaseCursor(cursorId: DecimalId, options?: RequestOptions): Promise<SoapResult> {
    return this.caller.call(
      "ReleaseCursor",
      [
        ["CursorID", decimal(cursorId, "cursorId")],
        ["SessionID", this.caller.id()],
      ],
      options,
    );
  }
  /**
   * Executes the stock LDS RunMethod in this web SOAP 1.1 context.
   * ArgData contains inline typed XML children; SessionID precedes that stream.
   * RunAsync uses a separate internal thread and returns no public task handle;
   * its initial ResultData may be typed undefined and does not prove completion.
   * GetAsyncMethodStatus and KillAsyncMethod cannot track this execution.
   * Server target permissions still apply, independently of the web profile.
   * @mutating
   */
  runMethod(request: RunMethodRequest, options?: RequestOptions): Promise<SoapResult> {
    return runLdsMethod(this.caller, request, options);
  }
  /**
   * Deletes a document; web wire sends `StrictDelete=1` only when enabled.
   * @mutating
   */
  deleteDoc(
    request: { url: string; strictDelete?: boolean },
    options?: RequestOptions,
  ): Promise<SoapResult> {
    return this.caller.call(
      "DeleteDoc",
      [
        ["Url", request.url],
        ["StrictDelete", request.strictDelete ? "1" : undefined],
      ],
      options,
    );
  }
}

/** One RPC argument. Structured XmElem child XML uses no VALUE-TYPE attribute. */
export interface RpcArgument {
  readonly valueType?: string;
  readonly lexicalValue: string | RawXml;
}

/** Parsed RPC result plus the complete XML response tree. */
export interface RpcResult {
  readonly valueType?: string;
  readonly lexicalValue?: string;
  readonly xml: XmlObject;
}

/**
 * RPC argument helpers. Only the string case is automatically typed; use `typed()` for every other lexical type.
 * `RawXml` lexical values are inserted as exact child XML rather than escaped text.
 */
export const rpc = Object.freeze({
  string(value: string): RpcArgument {
    return { valueType: "string", lexicalValue: value };
  },
  typed(valueType: string, lexicalValue: string | RawXml): RpcArgument {
    if (valueType.trim() === "") throw new TypeError("valueType: нужна непустая строка.");
    return { valueType, lexicalValue };
  },
  /** Match the shipped XmElem serializer: validated child XML without an invented VALUE-TYPE. */
  xml(value: RawXml): RpcArgument {
    if (!isRawXml(value)) throw new TypeError("Аргумент XML: нужен проверенный XML (RawXml).");
    return { lexicalValue: rawXmlElement(value.xml) };
  },
});

function rpcArgs(args: readonly RpcArgument[]): RawXml {
  return rawXml(
    args
      .map((arg, index) => {
        if (arg.valueType === undefined && !isRawXml(arg.lexicalValue))
          throw new TypeError(
            "Аргументу функции нужен valueType; без него передаётся только XML: {lexicalValue: {xml: …}}.",
          );
        const value =
          arg.valueType === undefined
            ? rawXmlElement((arg.lexicalValue as RawXml).xml).xml
            : isRawXml(arg.lexicalValue)
              ? arg.lexicalValue.xml
              : escapeXml(arg.lexicalValue);
        const type = arg.valueType === undefined ? "" : ` VALUE-TYPE="${escapeXml(arg.valueType)}"`;
        return `<arg-${index}${type}>${value}</arg-${index}>`;
      })
      .join(""),
  );
}

/**
 * SPXML `CallMethod` client for existing native or web server libraries.
 * Target discovery is historical evidence; the server decides authorization and reachability for dynamic targets.
 */
export class RpcApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly profile: SoapProfile,
  ) {}

  /**
   * Calls an existing server target; discovery evidence does not impose a hardcoded allowlist.
   * @mutating
   */
  async call(
    request: { target: string; args?: readonly RpcArgument[] },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<RpcResult>> {
    validateRpcTarget(request.target);
    const dot = request.target.indexOf(".");
    const response = await soapCall(
      this.transport,
      this.profile,
      "/api/spxml/CallMethod",
      "CallMethod",
      [
        ["LibName", request.target.slice(0, dot)],
        ["MethodName", request.target.slice(dot + 1)],
        ["ArgData", rpcArgs(request.args ?? [])],
      ],
      options,
    );
    const result = findXmlNode(response.data, "Result");
    if (result === undefined)
      throw new WsHcmApiError("protocol", "RPC response is missing Result", {
        operation: "CallMethod",
      });
    const valueType =
      result !== null && typeof result === "object"
        ? (result as Record<string, unknown>)["@_VALUE-TYPE"]
        : undefined;
    const lexicalValue =
      result !== null && typeof result === "object"
        ? ((result as Record<string, unknown>)["#text"] ??
          (valueType === "string" ? "" : undefined))
        : result;
    return {
      ...response,
      data: {
        ...(valueType === undefined ? {} : { valueType: String(valueType) }),
        ...(lexicalValue === undefined ? {} : { lexicalValue: String(lexicalValue) }),
        xml: response.data,
      },
    };
  }
}

/** Shipped web `/api/spxml` RPC, document and async-task surface. */
export class WebSpXmlApi {
  readonly rpc: RpcApi;
  constructor(private readonly transport: HttpTransport) {
    this.rpc = new RpcApi(transport, "web");
  }
  /**
   * Synchronous allowlisted RPC call. The selected target may change state.
   * @mutating
   */
  callMethod(
    request: { target: string; args?: readonly RpcArgument[] },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<RpcResult>> {
    return this.rpc.call(request, options);
  }
  /**
   * Starts an allowlisted asynchronous RPC task and returns a lossless TrackingID.
   * @mutating
   */
  callMethodAsync(
    request: { target: string; args?: readonly RpcArgument[] },
    options?: RequestOptions,
  ): Promise<SoapResult> {
    validateRpcTarget(request.target);
    const dot = request.target.indexOf(".");
    return soapCall(
      this.transport,
      "web",
      "/api/spxml/CallMethodAsync",
      "CallMethodAsync",
      [
        ["LibName", request.target.slice(0, dot)],
        ["MethodName", request.target.slice(dot + 1)],
        ["ArgData", rpcArgs(request.args ?? [])],
      ],
      options,
    );
  }
  /**
   * Lists background tasks filtered by library and method names.
   * On server 2025.1.1171 the task pool is application-wide and can include other callers;
   * matching a name does not establish task ownership. Expired nonrunning entries
   * are removed before filtering. Recent terminal tasks are not
   * consumed by this list, but their status/results are included in each Task.
   * Use an independently journalled TrackingID for subsequent status or kill calls.
   */
  getBackgroundTasksByName(
    request: { libName: string; methodName: string },
    options?: RequestOptions,
  ): Promise<SoapResult> {
    return soapCall(
      this.transport,
      "web",
      "/api/spxml/GetBackgroundTasksByName",
      "GetBackgroundTasksByName",
      [
        ["LibName", request.libName],
        ["MethodName", request.methodName],
      ],
      options,
    );
  }
  /**
   * Reads async task state using the original decimal or `0x` TrackingID lexical form.
   * On server 2025.1.1171 the first terminal response consumes the finished tracking entry.
   * Retain that payload immediately and never poll the finished ID again: a lost HTTP
   * terminal response can consume its result. Other builds require separate verification.
   * Poll running tasks no more often than once every 250 ms.
   */
  getAsyncMethodStatus(trackingId: TrackingId, options?: RequestOptions): Promise<SoapResult> {
    return soapCall(
      this.transport,
      "web",
      "/api/spxml/GetAsyncMethodStatus",
      "GetAsyncMethodStatus",
      [["TrackingID", tracking(trackingId, "trackingId")]],
      options,
    );
  }
  /**
   * Requests task cancellation; successful cancellation of already-completed tasks is not guaranteed.
   * @mutating
   */
  killAsyncMethod(trackingId: TrackingId, options?: RequestOptions): Promise<SoapResult> {
    return soapCall(
      this.transport,
      "web",
      "/api/spxml/KillAsyncMethod",
      "KillAsyncMethod",
      [["TrackingID", tracking(trackingId, "trackingId")]],
      options,
    );
  }
  /**
   * Reads document XML using UTF-8 unless `charset` is supplied; response charset headers take precedence.
   * Server 2025.1.1171 does not accept a TryLock query parameter on this route:
   * a value passed in the query is refused.
   * Use native LDS LoadDoc for a verified document-lock route.
   * @mutating When `tryLock` is enabled.
   */
  async getDoc(
    request: { docUrl: string; charset?: string; tryLock?: boolean },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<XmlObject>> {
    const charset = request.charset ?? "utf-8";
    return xmlResponse(
      await this.transport.send(
        query("/api/spxml/GetDoc", {
          DocUrl: request.docUrl,
          Charset: charset,
          TryLock: request.tryLock ? 1 : undefined,
        }),
        {},
        options,
      ),
      charset,
    );
  }
  /**
   * Persists caller XML through web SPXML server pre-save processing.
   * `neverSaved=true` sends `NeverSaved=1`; false/omitted sends no flag. This route has no `SkipActions` control.
   * @mutating
   */
  async putDoc(
    request: {
      docUrl: string;
      document: string | RawXml;
      writeDocInfo?: boolean;
      neverSaved?: boolean;
    },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<unknown>> {
    if (!isRawXml(request.document)) parseXml(request.document);
    const body = isRawXml(request.document) ? request.document.xml : request.document;
    return jsonResponse(
      await this.transport.send(
        query("/api/spxml/PutDoc", {
          DocUrl: request.docUrl,
          WriteDocInfo: request.writeDocInfo,
          NeverSaved: request.neverSaved ? 1 : undefined,
        }),
        { method: "POST", headers: { "Content-Type": "text/xml" }, body },
        options,
      ),
    );
  }
}

class SpXml2Base {
  constructor(protected readonly transport: HttpTransport) {}
  /** Reads server application/bootstrap metadata; `application_module` is optional and may be absent. */
  async getAppInfo(
    request: { fastStart?: boolean; anonymous?: boolean; openSession?: boolean; rnd?: number } = {},
    options?: RequestOptions,
  ): Promise<WsHcmResponse<unknown>> {
    return jsonResponse(
      await this.transport.send(
        query("/api/spxml2/get_app_info", {
          fast_start: request.fastStart ? 1 : undefined,
          anonymous: request.anonymous ? 1 : undefined,
          open_session: request.openSession ? 1 : undefined,
          rnd: request.rnd,
        }),
        {},
        options,
      ),
    );
  }
  /** Loads a form payload by server-local URL as text using the response charset. */
  async getForm(
    request: { url: string },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<string>> {
    return textResponse(
      await this.transport.send(query("/api/spxml2/get_form", request), {}, options),
    );
  }
}

/** Native SPXML2 app-info and form retrieval surface. */
export class NativeSpXml2Api extends SpXml2Base {}

/** Web SPXML2 surface; app-info defaults to `fast_start=1` and a random cache-busting `rnd`. */
export class WebSpXml2Api extends SpXml2Base {
  override getAppInfo(
    request: { fastStart?: boolean; anonymous?: boolean; openSession?: boolean; rnd?: number } = {},
    options?: RequestOptions,
  ): Promise<WsHcmResponse<unknown>> {
    return super.getAppInfo(
      {
        ...request,
        fastStart: request.fastStart ?? true,
        rnd: request.rnd ?? randomInt(1_000_000_000),
      },
      options,
    );
  }

  /** Streams a web SPXML2 image with optional effect query values. */
  async getImage(
    request: { url: string; effects?: QueryValues },
    options?: RequestOptions,
  ): Promise<WsHcmBinaryResponse> {
    const response = await this.transport.send(
      query("/api/spxml2/get_image", { ...request.effects, url: request.url }),
      {},
      options,
    );
    return binaryResponse(response, "get_image");
  }
  /** Reads the default preloaded-design-file set. */
  async getPreloadedDesignFiles(options?: RequestOptions): Promise<WsHcmResponse<string>> {
    return textResponse(
      await this.transport.send("/api/spxml2/get_preloaded_design_files?set=default", {}, options),
    );
  }
  /** Calls the shipped server `std_encrypt` service; this is not a general client-side encryption primitive. */
  async stdEncrypt(text: string, options?: RequestOptions): Promise<WsHcmResponse<unknown>> {
    return jsonResponse(
      await this.transport.send(query("/api/spxml2/std_encrypt", { text }), {}, options),
    );
  }
}

function appendBytes(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

/** One caller-selected part of the stock chunk uploader. offset and totalBytes count decoded bytes. */
export interface UploadChunkRequest {
  fileId: string;
  filename: string;
  index: number;
  chunksTotal: number;
  totalBytes: number;
  offset: number;
  data: SoapAttachment;
  contentType?: string;
}

/** The endpoint allocates a new Url on every request; this is not completion or file-existence proof. */
export interface UploadChunkResult {
  error: 0;
  Url: string;
}

/** Exact indices [0, chunksTotal) in the caller-selected global filechunk namespace. */
export interface ClearUploadChunksRequest {
  fileId: string;
  chunksTotal: number;
}

/** Server deletion errors are swallowed; an empty response proves acknowledgement only. */
export interface ClearUploadChunksResult {
  acknowledged: true;
  fileId: string;
  chunksTotal: number;
  absenceVerified: false;
}

/** Shipped web Administrator page-service operations. */
export class WebPageApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly uploadToken?: () => string | undefined,
    private readonly maximumUploadBytes = 8 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(maximumUploadBytes) || maximumUploadBytes < 1)
      throw new TypeError("maximumUploadBytes: нужно целое число больше нуля.");
  }
  /** Reads the shipped PDF preview helper page as text. */
  async filePreviewPdf(options?: RequestOptions): Promise<WsHcmResponse<string>> {
    return textResponse(
      await this.transport.send(
        "/spxml_web/service/file_preview/file_preview_pdf.htm",
        {},
        options,
      ),
    );
  }
  /** Reads a form by server-local URL as text. */
  async getForm(
    request: { url: string },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<string>> {
    return textResponse(
      await this.transport.send(query("/spxml_web/service/get_form.htm", request), {}, options),
    );
  }
  /** Reads a screen form by server-local URL as text. */
  async getScreenForm(
    request: { url: string },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<string>> {
    return textResponse(
      await this.transport.send(
        query("/spxml_web/service/get_screen_form.htm", request),
        {},
        options,
      ),
    );
  }
  /**
   * Streams SVG through the stock web page image handler. The server accepts
   * x-app/x-local SVG URLs and checks source read access. Optional state values
   * hover/pressed/disabled select the shipped color substitution; other values
   * preserve the original content. Omission sends state="" because the shipped
   * page requires that query field. Consume or cancel the returned body.
   */
  async getImage(
    request: { url: string; state?: string },
    options?: RequestOptions,
  ): Promise<WsHcmBinaryResponse> {
    return binaryResponse(
      await this.transport.send(
        query("/spxml_web/service/get_image.htm", { url: request.url, state: request.state ?? "" }),
        {},
        options,
      ),
      "get_image.htm",
    );
  }
  /** Reads and parses web UI text XML using its declared application charset. */
  async getUiText(options?: RequestOptions): Promise<WsHcmResponse<XmlObject>> {
    return xmlResponse(
      await this.transport.send("/spxml_web/service/get_ui_text.htm", {}, options),
    );
  }
  /** Streams page-service URL output; consume or cancel the returned body. */
  async getUrl(
    request: { url: string; navigate?: boolean; download?: boolean; base64?: boolean },
    options?: RequestOptions,
  ): Promise<WsHcmBinaryResponse> {
    const response = await this.transport.send(
      query("/spxml_web/service/get_url.htm", {
        url: request.url,
        navigate: request.navigate ? 1 : undefined,
        download: request.download ? 1 : undefined,
        base64: request.base64 ? 1 : undefined,
      }),
      {},
      options,
    );
    return binaryResponse(response, "get_url");
  }

  /**
   * Uploads one file through the shipped multipart f/session_token workflow.
   * The owning WebSession supplies its current private page token. Input is
   * bounded by maxResponseBytes and an 8 MiB client input budget; no chunks or
   * legacy base64 branch is implied. A successful response contains Url.
   * @mutating Persists a server upload and runs the platform's upload rules.
   */
  async uploadFile(
    request: { filename: string; data: SoapAttachment; contentType?: string },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<unknown>> {
    const invalidInput = (message: string): WsHcmApiError =>
      new WsHcmApiError("protocol", message, { operation: "uploadFile", requestSent: false });
    const filename = request.filename;
    if (
      typeof filename !== "string" ||
      !filename ||
      Array.from(filename).length > 255 ||
      /[\\/\x00-\x1F\x7F]/.test(filename) ||
      filename.startsWith("..") ||
      filename.endsWith("..") ||
      filename === "."
    )
      throw invalidInput("filename: нужно имя файла без пути, до 255 знаков.");
    if (
      request.contentType !== undefined &&
      (typeof request.contentType !== "string" || !/^[\x20-\x7E]{1,256}$/.test(request.contentType))
    )
      throw invalidInput("contentType: нужен тип MIME из печатных знаков ASCII, до 256 знаков.");
    const token = this.uploadToken?.();
    if (!token || !/^[\x21-\x7E]{1,256}$/.test(token))
      throw invalidInput("В веб-сессии нет действующего токена страницы для загрузки файла.");
    const value = isRawXml(request.data) ? request.data.xml : request.data;
    let bytes: Uint8Array;
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > this.maximumUploadBytes)
        throw invalidInput("Файл больше допустимого размера загрузки.");
      bytes = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (value instanceof Uint8Array) bytes = value;
    else throw invalidInput("data: нужен текст или двоичные данные.");
    if (bytes.byteLength > this.maximumUploadBytes)
      throw invalidInput("Файл больше допустимого размера загрузки.");
    const form = new FormData();
    form.append(
      "f",
      new Blob([bytes.slice().buffer], { type: request.contentType ?? "application/octet-stream" }),
      filename,
    );
    form.append("session_token", token);
    const result = await jsonResponse(
      await this.transport.send(
        "/spxml_web/service/upload_file.htm?json_response=1",
        { method: "POST", body: form },
        options,
      ),
    );
    const body = result.data;
    const uploadedPath =
      body && typeof body === "object" && "Url" in body && typeof body.Url === "string"
        ? body.Url.split("/")
        : undefined;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !uploadedPath ||
      uploadedPath.length !== 2 ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(uploadedPath[0]!) ||
      uploadedPath[1] !== filename ||
      ("error" in body && body.error !== 0 && body.error !== false)
    )
      throw new WsHcmApiError("protocol", "The upload response did not confirm a resource URL", {
        operation: "uploadFile",
        status: result.status,
      });
    return result;
  }

  /**
   * Sends one stock upload_chunk POST with exact data bytes and an explicit Content-Range.
   * The caller supplies a known 32-hex fileId and coordinates chunk order; the last part joins the file.
   * Receipts do not independently prove chunk persistence or final file bytes.
   * Verify staging with a storage-appropriate read before submitting the final part.
   * Final errors can leave an unknown output URL; do not retry or guess cleanup targets.
   * Requires the installed WebSoft/libMain branch and its existing principal/upload policies.
   * @mutating Writes global chunk storage and may create an assembled upload.
   */
  async uploadChunk(
    request: UploadChunkRequest,
    options?: RequestOptions,
  ): Promise<WsHcmResponse<UploadChunkResult>> {
    const invalidInput = (message: string): WsHcmApiError =>
      new WsHcmApiError("protocol", message, { operation: "uploadChunk", requestSent: false });
    if (typeof request.fileId !== "string" || !/^[0-9a-f]{32}$/i.test(request.fileId))
      throw invalidInput("fileId: нужно 32 шестнадцатеричные цифры.");
    const filename = request.filename;
    if (
      typeof filename !== "string" ||
      !filename ||
      Array.from(filename).length > 255 ||
      /[\\/\x00-\x1F\x7F]/.test(filename) ||
      filename.startsWith("..") ||
      filename.endsWith("..") ||
      filename === "."
    )
      throw invalidInput("filename: нужно имя файла без пути, до 255 знаков.");
    if (
      request.contentType !== undefined &&
      (typeof request.contentType !== "string" || !/^[\x20-\x7E]{1,256}$/.test(request.contentType))
    )
      throw invalidInput("contentType: нужен тип MIME из печатных знаков ASCII, до 256 знаков.");
    if (
      !Number.isSafeInteger(request.chunksTotal) ||
      request.chunksTotal < 1 ||
      request.chunksTotal > 100000
    )
      throw invalidInput("chunksTotal: нужно целое число от 1 до 100000.");
    if (
      !Number.isSafeInteger(request.index) ||
      request.index < 0 ||
      request.index >= request.chunksTotal
    )
      throw invalidInput("index: нужен номер части от 0 до chunksTotal - 1.");
    if (!Number.isSafeInteger(request.totalBytes) || request.totalBytes < 1)
      throw invalidInput("totalBytes: нужно целое число больше нуля.");
    if (!Number.isSafeInteger(request.offset) || request.offset < 0)
      throw invalidInput("offset: нужно целое неотрицательное число.");
    if (
      request.totalBytes < request.chunksTotal ||
      request.offset < request.index ||
      (request.index === 0 && request.offset !== 0)
    )
      throw invalidInput(
        "offset и totalBytes не сходятся с номером части: каждой предыдущей части нужен хотя бы один байт, а первая начинается с нуля.",
      );
    const value = isRawXml(request.data) ? request.data.xml : request.data;
    let bytes: Uint8Array;
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > this.maximumUploadBytes)
        throw invalidInput("Часть больше допустимого размера загрузки.");
      bytes = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (value instanceof Uint8Array) bytes = value;
    else throw invalidInput("data: нужен текст или двоичные данные.");
    if (bytes.byteLength < 1 || bytes.byteLength > this.maximumUploadBytes)
      throw invalidInput(
        "data: часть должна быть непустой и не больше допустимого размера загрузки.",
      );
    if (
      request.offset > request.totalBytes ||
      bytes.byteLength > request.totalBytes - request.offset
    )
      throw invalidInput("Часть выходит за totalBytes.");
    const endExclusive = request.offset + bytes.byteLength;
    const remainingChunks = request.chunksTotal - request.index - 1;
    if (
      request.totalBytes - endExclusive < remainingChunks ||
      (remainingChunks === 0 && endExclusive !== request.totalBytes)
    )
      throw invalidInput(
        "После части должно остаться место для следующих, а последняя должна кончаться на totalBytes.",
      );
    const form = new FormData();
    form.append("action", "upload_chunk");
    form.append("file_id", request.fileId);
    form.append("file_name", filename);
    form.append("chunk", String(request.index));
    form.append("chunks_total", String(request.chunksTotal));
    form.append("file_size", String(request.totalBytes));
    form.append("file_type", request.contentType ?? "application/octet-stream");
    form.append(
      "file_data",
      `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`,
    );
    const result = await jsonResponse(
      await this.transport.send(
        query("/spxml_web/service/upload_file.htm", {
          json_response: 1,
          action: "upload_chunk",
          file_id: request.fileId,
          file_name: filename,
        }),
        {
          method: "POST",
          headers: {
            "Content-Range": `bytes ${request.offset}-${endExclusive - 1}/${request.totalBytes}`,
          },
          body: form,
        },
        options,
      ),
    );
    const body = result.data;
    const parts =
      body && typeof body === "object" && "Url" in body && typeof body.Url === "string"
        ? body.Url.split("/")
        : undefined;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("error" in body) ||
      body.error !== 0 ||
      !parts ||
      parts.length !== 2 ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(parts[0]!) ||
      parts[1] !== filename
    )
      throw new WsHcmApiError(
        "protocol",
        "The chunk response did not acknowledge the requested filename",
        {
          operation: "uploadChunk",
          status: result.status,
        },
      );
    return result as WsHcmResponse<UploadChunkResult>;
  }

  /**
   * Requests deletion of [0, chunksTotal) for a known caller-selected 32-hex fileId.
   * The namespace is global; the server does not check who created this ID.
   * An empty ACK does not prove chunk absence, directory removal, final-file or scratch cleanup.
   * @mutating Requests chunk deletion; individual server errors are swallowed.
   */
  async clearUploadChunks(
    request: ClearUploadChunksRequest,
    options?: RequestOptions,
  ): Promise<WsHcmResponse<ClearUploadChunksResult>> {
    const invalidInput = (message: string): WsHcmApiError =>
      new WsHcmApiError("protocol", message, {
        operation: "clearUploadChunks",
        requestSent: false,
      });
    if (typeof request.fileId !== "string" || !/^[0-9a-f]{32}$/i.test(request.fileId))
      throw invalidInput("fileId: нужно 32 шестнадцатеричные цифры.");
    if (
      !Number.isSafeInteger(request.chunksTotal) ||
      request.chunksTotal < 1 ||
      request.chunksTotal > 100000
    )
      throw invalidInput("chunksTotal: нужно целое число от 1 до 100000.");
    const form = new FormData();
    form.append("action", "clear_chunks");
    form.append("file_id", request.fileId);
    form.append("chunks_total", String(request.chunksTotal));
    const result = await textResponse(
      await this.transport.send(
        query("/spxml_web/service/upload_file.htm", {
          json_response: 1,
          action: "clear_chunks",
          file_id: request.fileId,
        }),
        { method: "POST", body: form },
        options,
      ),
    );
    if (!result.rawBody.every((byte) => byte === 9 || byte === 10 || byte === 13 || byte === 32))
      throw new WsHcmApiError(
        "protocol",
        "The clear_chunks response was not an empty acknowledgement",
        {
          operation: "clearUploadChunks",
          status: result.status,
        },
      );
    return {
      ...result,
      data: {
        acknowledged: true,
        fileId: request.fileId,
        chunksTotal: request.chunksTotal,
        absenceVerified: false,
      },
    };
  }
}

/** Exactly one source for a named compound-attc attachment. */
export type CompoundResourceRequest =
  { url: string; resId: string } | { docUrl: string; elemPath: string; resId: string };

/** Resource streaming API shared by native and web sessions. */
export class ResourceApi {
  constructor(private readonly transport: HttpTransport) {}
  /** Streams a resource image by lossless decimal ID and optional image type. */
  async getImage(
    request: { resourceId: DecimalId; imageType?: string },
    options?: RequestOptions,
  ): Promise<WsHcmBinaryResponse> {
    const response = await this.transport.send(
      query("/lds/get_resource_image.html", {
        resource_id: decimal(request.resourceId, "resourceId"),
        image_type: request.imageType,
      }),
      {},
      options,
    );
    return binaryResponse(response, "get_resource_image");
  }
  /**
   * Streams a named compound-attc attachment through GET /xhttp_res.
   * Use url for an x-local/x-app HTML source, or docUrl plus elemPath for a
   * document string field (also accepts a registered x-db-obj document).
   * elemPath starts with the document element name, such as presence_state.name;
   * obtain it from the actual document rather than guessing its root or layout.
   * The server decodes the matching attachment data and selects media type
   * from resId. Stock 1171 also requires URL sources under configured courses_path;
   * a permitted local scheme alone does not establish that prefix.
   * Native Administrator builds this route; the web alias uses
   * the same server handler with its own HTTP context, not a distinct caller
   * claim. Consume or cancel the returned body.
   */
  async getCompoundResource(
    request: CompoundResourceRequest,
    options?: RequestOptions,
  ): Promise<WsHcmBinaryResponse> {
    const value = request as unknown as Record<string, unknown>;
    const text = (field: string): string => {
      const candidate = value[field];
      if (
        typeof candidate !== "string" ||
        candidate.length === 0 ||
        /[\u0000-\u001f\u007f]/u.test(candidate)
      )
        throw new TypeError(`${field}: нужна непустая строка без управляющих символов.`);
      return candidate;
    };
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new TypeError("Не задан источник ресурса: нужен объект с url или с docUrl и elemPath.");
    const urlBranch = Object.hasOwn(value, "url");
    const fields = urlBranch ? ["url", "resId"] : ["docUrl", "elemPath", "resId"];
    if (Object.keys(value).some((field) => !fields.includes(field)))
      throw new TypeError(
        "Источник ресурса — это url и resId либо docUrl, elemPath и resId; других полей быть не должно.",
      );
    const source = text(urlBranch ? "url" : "docUrl");
    const allowedScheme = urlBranch
      ? /^(?:x-local|x-app):\/\//u
      : /^(?:x-local|x-app|x-db-obj):\/\//u;
    if (!allowedScheme.test(source))
      throw new TypeError(
        "Источник ресурса: url начинается с x-local:// или x-app://, docUrl — ещё и с x-db-obj://.",
      );
    const resId = text("resId");
    const params = urlBranch
      ? { url: source, res_id: resId }
      : { doc_url: source, elem_path: text("elemPath"), res_id: resId };
    return binaryResponse(
      await this.transport.send(query("/xhttp_res", params), {}, options),
      "xhttp_res",
    );
  }
}

/** Read-only transport/server diagnostics that do not create an LDS session. */
export class DiagnosticsApi {
  constructor(private readonly transport: HttpTransport) {}
  /** Observes the portal status without following redirects or retaining its body. */
  async portal(options?: RequestOptions): Promise<{ status: number }> {
    const response = await this.transport.send(
      "/loggedoff.html",
      {},
      {
        ...options,
        allowStatuses: "any",
        redirect: "manual",
      },
    );
    await response.body?.cancel();
    return { status: response.status };
  }
  /** Reads `/xhttp_info`, using Basic auth only when client credentials were configured. */
  async xhttpInfo(options?: RequestOptions): Promise<WsHcmResponse<string>> {
    return textResponse(
      await this.transport.send(
        "/xhttp_info",
        {},
        { ...options, basic: this.transport.hasCredentials },
      ),
    );
  }
}

/** Explicit escape hatch for unknown/experimental wire requests. Prefer typed API groups. */
export class ExperimentalApi {
  constructor(protected readonly transport: HttpTransport) {}
  /**
   * Sends a same-origin caller-defined request and returns its body as a stream.
   * `unsafe: true` is mandatory. Normal operation serializers, fault parsing and mutability guarantees are bypassed;
   * configured auth/cookies still apply and the caller owns method, headers, body and stream cleanup.
   */
  async rawRequest(
    request: {
      unsafe: true;
      path: string;
      method?: string;
      headers?: HeadersInit;
      body?: BodyInit;
    },
    options?: RequestOptions,
  ): Promise<WsHcmBinaryResponse> {
    if (request.unsafe !== true)
      throw new WsHcmApiError("protocol", "Experimental raw requests require unsafe: true");
    const response = await this.transport.send(
      request.path,
      {
        method: request.method ?? "GET",
        ...(request.headers === undefined ? {} : { headers: request.headers }),
        ...(request.body === undefined ? {} : { body: request.body }),
      },
      {
        ...options,
        basic: this.transport.hasCredentials && this.transport.cookie.value === undefined,
      },
    );
    return binaryResponse(response);
  }
}

/** Schema-backed partial web operations plus the raw escape hatch. */
export class WebExperimentalApi extends ExperimentalApi {
  /**
   * Calls the partial web authentication route; success cookie/body semantics are not fully established.
   * @mutating Changes authentication/session state.
   */
  async authenticate(
    request: { login: string; password: string; token: string },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<unknown>> {
    return jsonResponse(
      await this.transport.send(
        "/api/spxml2/authenticate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        options,
      ),
    );
  }
}

/** Schema-backed partial native operations plus the raw escape hatch. */
export class NativeExperimentalApi extends ExperimentalApi {}

export function createNativeLdsApi(
  transport: HttpTransport,
  sessionId: () => DecimalId,
): NativeLdsApi {
  return new NativeLdsApi(new LdsCaller(transport, "native", sessionId));
}

export function createWebLdsApi(transport: HttpTransport, sessionId: () => DecimalId): WebLdsApi {
  return new WebLdsApi(new LdsCaller(transport, "web", sessionId));
}
