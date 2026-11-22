import { ArgumentError, WsHcmApiError } from "./error.js";
import {
  soapFragments,
  xmlText,
  type SoapField,
  type SoapFragments,
  type SoapProfile,
} from "./protocol.js";
import { HttpTransport, query } from "./transport.js";
import {
  WsHcmBinaryResponse,
  type DecimalId,
  type ObjectId,
  type RequestOptions,
  type SoapAttachment,
  type SoapResult,
  type TrackingId,
  type WsHcmResponse,
} from "./types.js";
import {
  binaryResponse,
  jsonResponse,
  soapBinaryCall,
  soapCall,
  soapMultipartCall,
  textResponse,
  withRnd,
} from "./wire.js";
import {
  escapeXml,
  findXmlNode,
  inlineXml,
  isRawXml,
  rawXmlElement,
  type RawXml,
  type XmlObject,
} from "./xml.js";

export type { SoapAttachment, SoapResult };
export {
  WebPageApi,
  type ClearUploadChunksRequest,
  type ClearUploadChunksResult,
  type UploadChunkRequest,
  type UploadChunkResult,
} from "./web-pages.js";

/** ID объекта в десятичной записи: так его ждут страницы сервера, а каталоги отдают `0x…`. */
function decimalObjectId(value: ObjectId, name: string): DecimalId {
  if (!/^(?:\d{1,20}|0x[0-9a-fA-F]{1,16})$/.test(value) || BigInt(value) > 0xffffffffffffffffn)
    throw new ArgumentError(`${name}: нужен ID строкой, 0x… или десятичный.`);
  return BigInt(value).toString(10);
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

export interface OpenSessionResult {
  sessionId: DecimalId;
  response: SoapResult;
}

export async function openLdsSession(
  transport: HttpTransport,
  profile: SoapProfile,
  basic = false,
  options?: RequestOptions,
): Promise<OpenSessionResult> {
  const response = await soapCall(
    transport,
    profile,
    withRnd("/services/LdsService"),
    "OpenSession",
    [["InstallationID", ""]],
    { ...options, basic },
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
    private readonly sessionId: () => DecimalId,
  ) {}

  call(
    method: string,
    fields: readonly SoapField[],
    options?: RequestOptions,
  ): Promise<SoapResult> {
    return soapCall(
      this.transport,
      "native",
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
      "native",
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

/** Вид запроса LDS XQuery. */
export interface XQueryRequest {
  query: string;
  startPos?: number;
  maxCount?: number;
  expectToReadAll?: boolean;
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
  /** Выполнить XQuery; постраничное чтение необязательно. */
  xQuery(request: XQueryRequest, options?: RequestOptions): Promise<SoapResult> {
    return this.caller.call(
      "XQuery",
      [
        ["Query", request.query],
        ["StartPos", safeInteger(request.startPos, "startPos")],
        ["MaxCount", safeInteger(request.maxCount, "maxCount")],
        ["ExpectToReadAll", request.expectToReadAll],
        ["KeepCursor", false],
        ["SessionID", this.caller.id()],
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

/** Значения экранированы, а фрагменты проверены: закрытая обёртка частей без промежуточной склейки. */
function rpcArgs(args: readonly RpcArgument[]): SoapFragments {
  const parts: string[] = [];
  args.forEach((arg, index) => {
    if (arg.valueType === undefined && !isRawXml(arg.lexicalValue))
      throw new ArgumentError(
        "Аргументу функции нужен valueType; без него передаётся только XML: {lexicalValue: {xml: …}}.",
      );
    const value =
      arg.valueType === undefined
        ? inlineXml(rawXmlElement((arg.lexicalValue as RawXml).xml))
        : isRawXml(arg.lexicalValue)
          ? inlineXml(arg.lexicalValue)
          : escapeXml(arg.lexicalValue);
    const type = arg.valueType === undefined ? "" : ` VALUE-TYPE="${escapeXml(arg.valueType)}"`;
    parts.push(`<arg-${index}${type}>`, value, `</arg-${index}>`);
  });
  return soapFragments(parts);
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

/** Штатный web `/api/spxml`: фоновые задачи. */
export class WebSpXmlApi {
  constructor(private readonly transport: HttpTransport) {}
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
}

/** Native SPXML2: сведения о приложении и получение форм. */
export class NativeSpXml2Api {
  constructor(private readonly transport: HttpTransport) {}
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

/** Ровно один источник именованного вложения compound-attc. */
export type CompoundResourceRequest =
  { url: string; resId: string } | { docUrl: string; elemPath: string; resId: string };

/** API потокового чтения ресурсов для сессии native. */
export class ResourceApi {
  constructor(private readonly transport: HttpTransport) {}
  /** Прочитать потоком картинку ресурса по ID (0x… или десятичный); тип картинки необязателен. */
  async getImage(
    request: { resourceId: ObjectId; imageType?: string },
    options?: RequestOptions,
  ): Promise<WsHcmBinaryResponse> {
    const response = await this.transport.send(
      query("/lds/get_resource_image.html", {
        resource_id: decimalObjectId(request.resourceId, "resourceId"),
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
   * Этим маршрутом пользуется штатный клиент администратора. Тело ответа нужно дочитать или отменить.
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

export function createNativeLdsApi(
  transport: HttpTransport,
  sessionId: () => DecimalId,
): NativeLdsApi {
  return new NativeLdsApi(new LdsCaller(transport, sessionId));
}
