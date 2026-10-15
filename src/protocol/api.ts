import { randomBytes, randomInt } from "node:crypto";
import { ArgumentError, WsHcmApiError } from "./error.js";
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

/** Буферизованный разобранный результат SOAP с точными байтами ответа. */
export type SoapResult = WsHcmResponse<XmlObject>;
/** Карта параметров запроса; заданные значения сериализуются в том виде, как записаны. */
export type QueryValues = Readonly<Record<string, string | number | boolean | null | undefined>>;
/** Точные данные внешней части MIME; строки и RawXml кодируются как UTF-8. */
export type SoapAttachment = RawXml | string | Uint8Array | ArrayBuffer;

/** Вызов штатной библиотеки LDS. ArgData — типизированный дочерний XML в теле, не вложение XOP. */
export interface RunMethodRequest {
  libName: string;
  methodName: string;
  /** Отдельный внутренний поток; наружу не отдаётся ни ID задачи, ни подтверждение завершения. */
  runAsync?: boolean;
  errorLogName?: string;
  argData: RawXml;
}

function decimal(value: DecimalId, name: string): DecimalId;
function decimal(value: DecimalId | undefined, name: string): DecimalId | undefined;
function decimal(value: DecimalId | undefined, name: string): DecimalId | undefined {
  if (value !== undefined && !/^\d+$/.test(value))
    throw new ArgumentError(`${name}: нужна строка из десятичных цифр.`);
  return value;
}

function tracking(value: TrackingId, name: string): TrackingId {
  if (!/^(?:\d+|0x[0-9a-f]+)$/i.test(value))
    throw new ArgumentError(
      `${name}: нужно целое число строкой — десятичное или шестнадцатеричное с 0x.`,
    );
  return value;
}

function validateRpcTarget(target: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(target))
    throw new ArgumentError("target: нужно имя библиотеки и имя функции через точку.");
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
    // Статус HTTP уже основная ошибка; испорченное тело безопасных подробностей не добавляет.
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
    throw new WsHcmApiError("protocol", "OpenSession не вернул десятичный SessionID", {
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

/** Вид запроса LDS XQuery. ID курсоров остаются десятичными строками без потерь. */
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
    throw new ArgumentError(`${name}: нужно целое число.`);
  return value;
}

/** Общие поля запроса native `LoadUrl`/`LoadDoc`. */
export interface LoadRequest {
  url: string;
  useBinaryResponse?: boolean;
  useMultipartResponse?: boolean;
  tryLock?: boolean;
  compress?: boolean;
}

/** Запрос загрузки, выбирающий небуферизованный двоичный или multipart-ответ. */
export type StreamingLoadRequest = LoadRequest &
  ({ useBinaryResponse: true } | { useMultipartResponse: true });

/** Запрос загрузки, сохраняющий обычный разобранный ответ SOAP. */
export type SoapLoadRequest = LoadRequest & {
  useBinaryResponse?: false;
  useMultipartResponse?: false;
};

/**
 * Операции native Administrator LDS SOAP 1.2, привязанные к одному десятичному ID сессии LDS.
 * Необязательные поля опускаются, пока не заданы; большие тела запросов идут как multipart/XOP.
 */
export class NativeLdsApi {
  constructor(private readonly caller: LdsCaller) {}

  /** Закрыть десятичный контекст LDS. Для закрытия всего клиента лучше `NativeSession.close()`. */
  closeSession(options?: RequestOptions): Promise<SoapResult> {
    return this.caller.call("CloseSession", [["SessionID", this.caller.id()]], options);
  }
  /**
   * Прочитать готовые записи из кэша статистики каталогов текущей сессии.
   * Пустой ответ Catalogs допустим: неготовые и пропускаемые каталоги в него не попадают.
   * RecordsNum — число из кэша, а не свежий SQL COUNT и не перечень типов объектов.
   */
  getCatalogsStat(options?: RequestOptions): Promise<SoapResult> {
    return this.caller.call("GetCatalogsStat", [["SessionID", this.caller.id()]], options);
  }
  /** Прочитать объекты, изменённые после `minModDate`; дата необязательна. */
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
   * Прочитать данные по URL; флаги ответа выбирают поток, а `tryLock` меняет состояние блокировки.
   * @mutating Если включён `tryLock`.
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
   * Записать по URL текст или двоичные данные как есть, вложением XOP.
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
   * Удалить данные по URL; можно потребовать, чтобы они существовали.
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
   * Прочитать документ; `tryLock` меняет состояние блокировки.
   * На сервере 2025.1.1171 LoadDoc отвечает SOAP и при флагах двоичного или multipart-ответа.
   * Флаги включают выдачу ответа потоком байтов, в котором может оказаться конверт SOAP;
   * вида ответа они не гарантируют.
   * @mutating Если включён `tryLock`.
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
   * Сохранить свой XML вложением XOP.
   * Без `skipActions` или с `false` сервер выполняет обработку перед сохранением; `true` её отключает.
   * `data` — только результат `rawXml()`.
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
    if (!isRawXml(request.data)) throw new ArgumentError("data: нужен проверенный XML (RawXml).");
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
   * Удалить документ по URL; можно потребовать, чтобы он существовал.
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
   * Выделить новый ID объекта в выбранной базе, без потери точности.
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
  /** Выполнить XQuery; постраничное чтение и курсор необязательны. */
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
   * Освободить курсор, выданный ранее этой сессии LDS.
   * @mutating Меняет временное состояние курсора.
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
   * Выполнить функцию библиотеки сервера; аргументы — дочерние элементы XML в `ArgData`.
   * На сервере 2025.1.1171 аргументы принимаются только как XML в теле SOAP:
   * внешнее вложение XOP отклоняется с Parameter is not XML.
   * RunAsync выполняет функцию в отдельном внутреннем потоке и не возвращает ID задачи;
   * первый ResultData может прийти с типом undefined и не означает завершения.
   * GetAsyncMethodStatus и KillAsyncMethod такое выполнение не отслеживают.
   * @mutating
   */
  runMethod(request: RunMethodRequest, options?: RequestOptions): Promise<SoapResult> {
    return runLdsMethod(this.caller, request, options);
  }
  /** Продлить текущую сессию native LDS. */
  idle(options?: RequestOptions): Promise<SoapResult> {
    return this.caller.call("Idle", [["SessionID", this.caller.id()]], options);
  }
}

function runLdsMethod(
  caller: LdsCaller,
  request: RunMethodRequest,
  options?: RequestOptions,
): Promise<SoapResult> {
  if (!isRawXml(request.argData))
    throw new ArgumentError("argData: нужен проверенный XML (RawXml).");
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

/** Контекст Web Administrator LDS SOAP 1.1 и общие штатные методы службы для одного ID LDS. */
export class WebLdsApi {
  constructor(private readonly caller: LdsCaller) {}

  /**
   * Выполнить XQuery через web LDS. `keepCursor` по умолчанию `true`; для разового чтения нужен `false`.
   * @mutating Если курсор сохраняется (по умолчанию).
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
   * Освободить свой курсор web LDS.
   * @mutating Меняет временное состояние курсора.
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
   * Выполнить штатный RunMethod LDS в этой веб-сессии по SOAP 1.1.
   * ArgData содержит дочерние элементы XML с типами; SessionID идёт перед ними.
   * RunAsync выполняет функцию в отдельном внутреннем потоке и не возвращает ID задачи;
   * первый ResultData может прийти с типом undefined и не означает завершения.
   * GetAsyncMethodStatus и KillAsyncMethod такое выполнение не отслеживают.
   * Права сервера на вызываемую функцию действуют и здесь, независимо от профиля web.
   * @mutating
   */
  runMethod(request: RunMethodRequest, options?: RequestOptions): Promise<SoapResult> {
    return runLdsMethod(this.caller, request, options);
  }
  /**
   * Удалить документ; `StrictDelete=1` отправляется, только когда он включён.
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

/** Один аргумент RPC. Структурированный дочерний XML XmElem не использует атрибут VALUE-TYPE. */
export interface RpcArgument {
  readonly valueType?: string;
  readonly lexicalValue: string | RawXml;
}

/** Разобранный результат RPC и полное дерево XML ответа. */
export interface RpcResult {
  readonly valueType?: string;
  readonly lexicalValue?: string;
  readonly xml: XmlObject;
}

/**
 * Функции аргументов RPC. Автоматически типизируется только строка; остальные — через `typed()`.
 * Значения `RawXml` вставляются как точный дочерний XML, а не как экранированный текст.
 */
export const rpc = Object.freeze({
  string(value: string): RpcArgument {
    return { valueType: "string", lexicalValue: value };
  },
  typed(valueType: string, lexicalValue: string | RawXml): RpcArgument {
    if (valueType.trim() === "") throw new ArgumentError("valueType: нужна непустая строка.");
    return { valueType, lexicalValue };
  },
  /** Повторяет штатный сериализатор XmElem: проверенный дочерний XML без выдуманного VALUE-TYPE. */
  xml(value: RawXml): RpcArgument {
    if (!isRawXml(value)) throw new ArgumentError("Аргумент XML: нужен проверенный XML (RawXml).");
    return { lexicalValue: rawXmlElement(value.xml) };
  },
});

function rpcArgs(args: readonly RpcArgument[]): RawXml {
  return rawXml(
    args
      .map((arg, index) => {
        if (arg.valueType === undefined && !isRawXml(arg.lexicalValue))
          throw new ArgumentError(
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
 * Клиент SPXML `CallMethod` для существующих библиотек сервера, native или web.
 * Обзор целей — исторические данные; авторизацию и достижимость динамических целей решает сервер.
 */
export class RpcApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly profile: SoapProfile,
  ) {}

  /**
   * Вызвать функцию библиотеки сервера; своим списком функций клиент вызов не ограничивает.
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
      throw new WsHcmApiError("protocol", "В ответе RPC нет Result", {
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

/** Штатный web `/api/spxml`: RPC, документы и фоновые задачи. */
export class WebSpXmlApi {
  readonly rpc: RpcApi;
  constructor(private readonly transport: HttpTransport) {
    this.rpc = new RpcApi(transport, "web");
  }
  /**
   * Вызвать функцию библиотеки синхронно. Вызванная функция может менять данные.
   * @mutating
   */
  callMethod(
    request: { target: string; args?: readonly RpcArgument[] },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<RpcResult>> {
    return this.rpc.call(request, options);
  }
  /**
   * Запустить функцию библиотеки фоновой задачей; ответ содержит TrackingID без потери точности.
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
   * Перечислить фоновые задачи по имени библиотеки и функции.
   * На сервере 2025.1.1171 пул задач общий для приложения, в нём бывают чужие задачи;
   * совпадение имени не значит, что задача своя. Устаревшие записи о завершённых задачах
   * удаляются до отбора. Недавно завершённые задачи этот список
   * не расходует: их состояние и результат входят в каждый Task.
   * Для опроса и остановки нужен TrackingID, записанный отдельно при запуске.
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
   * Прочитать состояние фоновой задачи по TrackingID в исходной записи: десятичной или `0x`.
   * На сервере 2025.1.1171 первый ответ о завершении расходует запись о задаче.
   * Этот ответ нужно сохранить сразу и завершённый ID больше не опрашивать:
   * если ответ HTTP потерян, результат уже израсходован. Другие сборки проверяются отдельно.
   * Идущую задачу опрашивать не чаще раза в 250 мс.
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
   * Запросить остановку задачи; остановка уже завершённой задачи не гарантирована.
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
   * Прочитать XML документа в UTF-8, если не задан `charset`; кодировка из заголовков ответа важнее.
   * Сервер 2025.1.1171 не принимает параметр TryLock на этом маршруте:
   * значение в строке запроса отклоняется.
   * Проверенный способ заблокировать документ — LoadDoc через native LDS.
   * @mutating Если включён `tryLock`.
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
   * Сохранить свой XML через web SPXML; сервер выполняет обработку перед сохранением.
   * `neverSaved=true` отправляет `NeverSaved=1`; при false или без значения флаг не отправляется. Управления `SkipActions` на этом маршруте нет.
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
  /** Прочитать сведения сервера о приложении; `application_module` необязателен и может отсутствовать. */
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
  /** Прочитать форму по локальному URL сервера как текст в кодировке ответа. */
  async getForm(
    request: { url: string },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<string>> {
    return textResponse(
      await this.transport.send(query("/api/spxml2/get_form", request), {}, options),
    );
  }
}

/** Native SPXML2: сведения о приложении и получение форм. */
export class NativeSpXml2Api extends SpXml2Base {}

/** Web SPXML2; сведения о приложении по умолчанию идут с `fast_start=1` и случайным `rnd`. */
export class WebSpXml2Api extends SpXml2Base {
  /** Прочитать сведения сервера о приложении; по умолчанию отправляет `fast_start=1` и случайный `rnd`. */
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

  /** Прочитать потоком картинку web SPXML2; параметры эффектов необязательны. */
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
  /** Прочитать набор предзагружаемых файлов оформления default. */
  async getPreloadedDesignFiles(options?: RequestOptions): Promise<WsHcmResponse<string>> {
    return textResponse(
      await this.transport.send("/api/spxml2/get_preloaded_design_files?set=default", {}, options),
    );
  }
  /** Вызвать штатную службу сервера `std_encrypt`; это не средство шифрования общего назначения на стороне клиента. */
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

/** Часть штатной загрузки по выбору вызывающего; offset и totalBytes — в декодированных байтах. */
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

/** Url новый на каждый запрос; это не доказательство завершения и не наличия файла. */
export interface UploadChunkResult {
  error: 0;
  Url: string;
}

/** Точные индексы [0, chunksTotal) в выбранном вызывающим общем пространстве filechunk. */
export interface ClearUploadChunksRequest {
  fileId: string;
  chunksTotal: number;
}

/** Ошибки удаления на сервере проглатываются; пустой ответ доказывает только приём запроса. */
export interface ClearUploadChunksResult {
  acknowledged: true;
  fileId: string;
  chunksTotal: number;
  absenceVerified: false;
}

/** Штатные операции страничных служб web Administrator. */
export class WebPageApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly uploadToken?: () => string | undefined,
    private readonly maximumUploadBytes = 8 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(maximumUploadBytes) || maximumUploadBytes < 1)
      throw new ArgumentError("maximumUploadBytes: нужно целое число больше нуля.");
  }
  /** Прочитать штатную страницу предпросмотра PDF как текст. */
  async filePreviewPdf(options?: RequestOptions): Promise<WsHcmResponse<string>> {
    return textResponse(
      await this.transport.send(
        "/spxml_web/service/file_preview/file_preview_pdf.htm",
        {},
        options,
      ),
    );
  }
  /** Прочитать форму по локальному URL сервера как текст. */
  async getForm(
    request: { url: string },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<string>> {
    return textResponse(
      await this.transport.send(query("/spxml_web/service/get_form.htm", request), {}, options),
    );
  }
  /** Прочитать экранную форму по локальному URL сервера как текст. */
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
   * Прочитать потоком SVG через штатную страницу картинок веб-интерфейса. Сервер принимает
   * URL SVG в x-app и x-local и проверяет право чтения источника. Необязательные значения state
   * hover, pressed и disabled включают штатную подмену цветов; при других значениях
   * содержимое остаётся исходным. Без значения отправляется state="": штатная
   * страница требует это поле запроса. Тело ответа нужно дочитать или отменить.
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
  /** Прочитать и разобрать XML текстов веб-интерфейса в кодировке, объявленной приложением. */
  async getUiText(options?: RequestOptions): Promise<WsHcmResponse<XmlObject>> {
    return xmlResponse(
      await this.transport.send("/spxml_web/service/get_ui_text.htm", {}, options),
    );
  }
  /** Прочитать потоком ответ службы страниц по URL; тело нужно дочитать или отменить. */
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
   * Загрузить один файл штатным способом: multipart с полями f и session_token.
   * Текущий токен страницы подставляет веб-сессия, которой принадлежит вызов. Размер
   * ограничен maxResponseBytes и пределом клиента 8 МиБ; части и старый вариант
   * с base64 не используются. Успешный ответ содержит Url.
   * @mutating Сохраняет файл на сервере; срабатывают правила загрузки платформы.
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
    const response = await this.transport.send(
      "/spxml_web/service/upload_file.htm?json_response=1",
      { method: "POST", body: form },
      options,
    );
    // HTTP 415 сервер ставит только отказу своей политики загрузки и имени вне своей таблицы
    // типов. Текст отказа он пишет лишь в свой лог: в строке статуса стандартная фраза, тела нет.
    if (response.status === 415) {
      await response.body?.cancel().catch(() => undefined);
      throw new WsHcmApiError("http", "HTTP 415", {
        operation: "uploadFile",
        status: 415,
        details: { uploadRefused: true },
      });
    }
    const result = await jsonResponse(response);
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
      throw new WsHcmApiError("protocol", "Ответ на загрузку не подтвердил URL ресурса", {
        operation: "uploadFile",
        status: result.status,
      });
    return result;
  }

  /**
   * Отправить один штатный POST upload_chunk с байтами данных как есть и явным Content-Range.
   * Вызывающий задаёт известный fileId из 32 шестнадцатеричных цифр и следит за порядком частей; последняя часть собирает файл.
   * Ответы сами по себе не доказывают, что часть сохранена и что байты итогового файла верны.
   * Перед последней частью загруженное нужно проверить чтением, подходящим для хранилища.
   * После ошибки на последней части URL результата может остаться неизвестным: не повторять и не угадывать, что удалять.
   * Нужна установленная ветка WebSoft/libMain и её действующие правила для пользователя и загрузки.
   * @mutating Пишет в общее хранилище частей и может создать собранный файл.
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
    const response = await this.transport.send(
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
    );
    // Отказ политики загрузки и имя вне таблицы типов сервер отдаёт HTTP 500 с текстом
    // в error_text; остальные сбои части — другим статусом или без этого текста.
    if (response.status === 500) {
      let reason: unknown;
      try {
        const source = new TextDecoder(responseCharset(response, "utf-8")).decode(
          await response.arrayBuffer(),
        );
        reason = (JSON.parse(source) as { error_text?: unknown } | null)?.error_text;
      } catch {
        // Тело не JSON, не дочитано или в неизвестной кодировке: остаётся отказ HTTP 500 без текста.
      }
      throw new WsHcmApiError("http", "HTTP 500", {
        operation: "uploadChunk",
        status: 500,
        ...(typeof reason === "string" && reason.trim()
          ? { details: { uploadRefused: true, reason: reason.trim().slice(0, 500) } }
          : {}),
      });
    }
    const result = await jsonResponse(response);
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
        "Ответ на загрузку части не подтвердил запрошенное имя файла",
        {
          operation: "uploadChunk",
          status: result.status,
        },
      );
    return result as WsHcmResponse<UploadChunkResult>;
  }

  /**
   * Запросить удаление частей [0, chunksTotal) для известного fileId из 32 шестнадцатеричных цифр, выбранного вызывающим.
   * Пространство ID общее: сервер не проверяет, кто создал этот ID.
   * Пустой ответ не доказывает, что части, папка, итоговый файл и временные данные удалены.
   * @mutating Запрашивает удаление частей; отдельные ошибки сервера не сообщаются.
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
      throw new WsHcmApiError("protocol", "Ответ clear_chunks — не пустое подтверждение", {
        operation: "clearUploadChunks",
        status: result.status,
      });
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

/** Ровно один источник именованного вложения compound-attc. */
export type CompoundResourceRequest =
  { url: string; resId: string } | { docUrl: string; elemPath: string; resId: string };

/** API потокового чтения ресурсов, общий для сессий native и web. */
export class ResourceApi {
  constructor(private readonly transport: HttpTransport) {}
  /** Прочитать потоком картинку ресурса по десятичному ID; тип картинки необязателен. */
  async getImage(
    request: { resourceId: DecimalId; imageType?: string },
    options?: RequestOptions,
  ): Promise<WsHcmBinaryResponse> {
    const response = await this.transport.send(
      query("/lds/get_resource_image.html", {
        resource_id: decimal(request.resourceId, "resourceId"),
        image_type: request.imageType,
      }),
      // Сервер закрывает соединение после этой страницы, не сообщая об этом; только что запущенный —
      // с задержкой, и следующий запрос в том же соединении обрывался.
      { headers: { connection: "close" } },
      options,
    );
    return binaryResponse(response, "get_resource_image");
  }
  /**
   * Прочитать потоком именованное вложение compound-attc через GET /xhttp_res.
   * Источник — url для HTML с адресом x-local или x-app либо docUrl вместе с elemPath
   * для строкового поля документа (подходит и зарегистрированный документ x-db-obj).
   * elemPath начинается с имени корневого элемента документа, например presence_state.name;
   * его берут из самого документа, а не угадывают корень и структуру.
   * Сервер декодирует данные найденного вложения и выбирает тип содержимого
   * по resId. Штатный сервер 2025.1.1171 требует ещё, чтобы источник url лежал в настроенном courses_path:
   * одной разрешённой локальной схемы для этого мало.
   * Этим маршрутом пользуется штатный клиент администратора; варианты native и web —
   * один маршрут сервера, различается только сессия HTTP. Тело ответа нужно дочитать или отменить.
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
        throw new ArgumentError(`${field}: нужна непустая строка без управляющих символов.`);
      return candidate;
    };
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ArgumentError(
        "Не задан источник ресурса: нужен объект с url или с docUrl и elemPath.",
      );
    const urlBranch = Object.hasOwn(value, "url");
    const fields = urlBranch ? ["url", "resId"] : ["docUrl", "elemPath", "resId"];
    if (Object.keys(value).some((field) => !fields.includes(field)))
      throw new ArgumentError(
        "Источник ресурса — это url и resId либо docUrl, elemPath и resId; других полей быть не должно.",
      );
    const source = text(urlBranch ? "url" : "docUrl");
    const allowedScheme = urlBranch
      ? /^(?:x-local|x-app):\/\//u
      : /^(?:x-local|x-app|x-db-obj):\/\//u;
    if (!allowedScheme.test(source))
      throw new ArgumentError(
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

/** Диагностика транспорта и сервера только на чтение, без создания сессии LDS. */
export class DiagnosticsApi {
  constructor(private readonly transport: HttpTransport) {}
  /** Прочитать статус портала, не переходя по перенаправлениям и не сохраняя тело ответа. */
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
  /** Прочитать `/xhttp_info`; авторизация Basic применяется, только если клиенту заданы учётные данные. */
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

/**
 * Запасной путь для неизвестных и экспериментальных запросов протокола. Лучше типизированные API.
 */
export class ExperimentalApi {
  constructor(protected readonly transport: HttpTransport) {}
  /**
   * Отправить свой запрос на тот же origin и вернуть тело ответа потоком.
   * `unsafe: true` обязателен. Сериализация обычных операций, разбор ошибок сервера и гарантии об исходе записи не действуют;
   * настроенные авторизация и cookie применяются, а метод, заголовки, тело и закрытие потока — на вызывающем.
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
      throw new WsHcmApiError("protocol", "Экспериментальный rawRequest требует unsafe: true");
    const method = request.method ?? "GET";
    try {
      // Пробный Request: метод и допустимость тела проверяет тот же код, что у fetch, до сети.
      new Request(this.transport.baseUrl, {
        method,
        ...(request.body === undefined ? {} : { body: "" }),
      });
    } catch {
      throw new ArgumentError("method: метод HTTP записан неверно или не допускает тела (body).");
    }
    const response = await this.transport.send(
      request.path,
      {
        method,
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

/** Частичные операции web, подкреплённые схемой, и запасной путь — сырой запрос. */
export class WebExperimentalApi extends ExperimentalApi {
  /**
   * Вызвать частично поддержанный маршрут веб-аутентификации; cookie и тело успешного ответа до конца не установлены.
   * @mutating Меняет состояние аутентификации и сессии.
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

/** Частичные операции native, подкреплённые схемой, и запасной путь — сырой запрос. */
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
