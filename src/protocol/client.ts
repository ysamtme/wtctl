import {
  DiagnosticsApi,
  NativeSpXml2Api,
  ResourceApi,
  RpcApi,
  WebPageApi,
  WebSpXmlApi,
  closeLdsSession,
  createNativeLdsApi,
  openLdsSession,
  type NativeLdsApi,
} from "./api.js";
import { attachCleanupError, isTransportFailure, WsHcmApiError } from "./error.js";
import { NativePhysicalDocumentsApi } from "./physical-documents.js";
import { HttpTransport } from "./transport.js";
import {
  assertWebSocketAvailable,
  defaultWebSocketFactory,
  webSocketHeartbeat,
} from "./websocket.js";
import type {
  DecimalId,
  RequestOptions,
  WsHcmClientOptions,
  WebSocketFactory,
  WebSocketHeartbeatInput,
  WebSocketHeartbeatData,
} from "./types.js";

interface ClientDefaults {
  readonly baseUrl: string;
  readonly auth?: WsHcmClientOptions["auth"];
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly fetch: typeof globalThis.fetch;
  readonly webSocketFactory?: WebSocketFactory;
}

function transport(defaults: ClientDefaults, webHeaders = false): HttpTransport {
  return new HttpTransport({
    baseUrl: defaults.baseUrl,
    timeoutMs: defaults.timeoutMs,
    maxResponseBytes: defaults.maxResponseBytes,
    fetch: defaults.fetch,
    webHeaders,
    ...(defaults.auth === undefined ? {} : { auth: defaults.auth }),
  });
}

async function withCleanup<T, S extends { close(): Promise<void> }>(
  session: S,
  action: (session: S) => Promise<T>,
): Promise<T> {
  let operationError: unknown;
  try {
    return await action(session);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await session.close();
    } catch (cleanupError) {
      if (operationError === undefined) throw cleanupError;
      attachCleanupError(operationError, cleanupError);
    }
  }
}

/**
 * Контекст native Administrator после входа: своё хранилище cookie, десятичный ID сессии LDS.
 * Лучше `WsHcmClient.withNativeSession()`: так очистка выполняется всегда.
 */
export class NativeSession {
  readonly lds: NativeLdsApi;
  readonly physicalDocuments: NativePhysicalDocumentsApi;
  readonly rpc: RpcApi;
  readonly spxml2: NativeSpXml2Api;
  readonly resources: ResourceApi;
  readonly sessionId: DecimalId;
  #closed = false;

  private constructor(
    private readonly transport: HttpTransport,
    sessionId: DecimalId,
  ) {
    this.sessionId = sessionId;
    this.lds = createNativeLdsApi(transport, () => this.sessionId);
    this.physicalDocuments = new NativePhysicalDocumentsApi(this.lds);
    this.rpc = new RpcApi(transport, "native");
    this.spxml2 = new NativeSpXml2Api(transport);
    this.resources = new ResourceApi(transport);
  }

  static async open(defaults: ClientDefaults, options?: RequestOptions): Promise<NativeSession> {
    const http = transport(defaults);
    try {
      const opened = await openLdsSession(http, "native", true, options);
      return new NativeSession(http, opened.sessionId);
    } catch (error) {
      try {
        if (!isTransportFailure(error)) {
          const response = await http.send(
            "/loggedoff.html",
            {},
            { allowStatuses: "any", redirect: "manual" },
          );
          await response.body?.cancel();
        }
      } catch (cleanup) {
        attachCleanupError(error, cleanup);
      } finally {
        http.dispose();
      }
      throw error;
    }
  }

  /** Снять локальный доступ, не утверждая, что очистку LDS на сервере подтвердили. */
  disposeLocal(): void {
    this.#closed = true;
    this.transport.dispose();
  }

  /**
   * Идемпотентно закрыть LDS, зайти на `/loggedoff.html` и очистить только cookie этой сессии.
   * Шаг со страницей выхода — часть жизненного цикла, а не отдельная поддерживаемая операция.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const errors: unknown[] = [];
    try {
      await this.lds.closeSession();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (!errors.some(isTransportFailure)) {
        const response = await this.transport.send(
          "/loggedoff.html",
          {},
          { allowStatuses: "any", redirect: "manual" },
        );
        await response.body?.cancel();
      }
    } catch (error) {
      errors.push(error);
    } finally {
      this.disposeLocal();
    }
    if (errors.length > 0) {
      throw new WsHcmApiError("cleanup", "Не удалось закрыть сессию native", {
        details: { errorCount: errors.length },
        cause:
          errors.length === 1
            ? errors[0]
            : new AggregateError(errors, "Ошибки при закрытии сессии native"),
      });
    }
  }
}

/** Декодировать штатное присваивание CodeLiteral, не выполняя возвращённый JavaScript. */
function extractWebUploadToken(html: string): string | undefined {
  const assignments: RegExpExecArray[] = [];
  // Намеренно узкое чтение штатного встроенного присваивания, а не интерпретатор
  // JavaScript. HTML-комментарии вне <script> пропускаются в том же проходе, чтобы
  // строковый литерал с "<!--" внутри <script> не обрывал разбор скрипта.
  for (const script of html.matchAll(
    /<!--[\s\S]*?(?:-->|$)|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (script[1] === undefined) continue;
    const attributes = script[1];
    const scriptType = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
    if (
      /\bsrc\s*=/i.test(attributes) ||
      (scriptType &&
        !/^(?:|text\/javascript|application\/javascript|module)$/i.test(
          scriptType[1] ?? scriptType[2] ?? scriptType[3]!,
        ))
    )
      continue;
    const source = script[2]!;
    for (let index = 0; index < source.length; index++) {
      const character = source[index]!;
      if (character === "/" && source[index + 1] === "/") {
        while (index < source.length && !/[\r\n]/.test(source[index]!)) index++;
        continue;
      }
      if (character === "/" && source[index + 1] === "*") {
        const end = source.indexOf("*/", index + 2);
        if (end < 0) break;
        index = end + 1;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        const quote = character;
        while (++index < source.length) {
          if (source[index] === "\\") index++;
          else if (source[index] === quote) break;
        }
        continue;
      }
      if (character !== "g" || !source.startsWith("gFaApp.webSessionToken", index)) continue;
      if (!/^gFaApp\.webSessionToken\s*=/.test(source.slice(index, index + 128))) continue;
      // В поставке это прямое присваивание на отдельной строке. Такое требование заодно
      // исключает упоминания в литералах регулярных выражений и других выражениях.
      const lineStart =
        Math.max(source.lastIndexOf("\n", index - 1), source.lastIndexOf("\r", index - 1)) + 1;
      if (!/^\s*$/.test(source.slice(lineStart, index))) return undefined;
      const assignment =
        /^gFaApp\.webSessionToken\s*=\s*("(?:\\.|[^"\\]){0,1024}"|'(?:\\.|[^'\\]){0,1024}')\s*;/.exec(
          source.slice(index, index + 4096),
        );
      if (!assignment) return undefined;
      assignments.push(assignment);
      index += assignment[0].length - 1;
    }
  }
  if (assignments.length !== 1) return undefined;
  const literal = assignments[0]![1]!;
  let token: string;
  try {
    if (literal.startsWith('"')) token = JSON.parse(literal) as string;
    else {
      const content = literal.slice(1, -1);
      token = "";
      for (let index = 0; index < content.length; index++) {
        const character = content[index]!;
        if (character !== "\\") {
          token += character;
          continue;
        }
        const escaped = content[++index];
        if (escaped === "\\" || escaped === "'" || escaped === '"' || escaped === "/")
          token += escaped;
        else if (escaped === "u" || escaped === "x") {
          const width = escaped === "u" ? 4 : 2;
          const hex = content.slice(index + 1, index + 1 + width);
          if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(hex)) return undefined;
          token += String.fromCharCode(Number.parseInt(hex, 16));
          index += width;
        } else return undefined;
      }
    }
  } catch {
    return undefined;
  }
  return typeof token === "string" && /^[\x21-\x7E]{1,256}$/.test(token) ? token : undefined;
}

/** Выполнить оба шага веб-выхода; при потере связи дальнейшие запросы не отправляются. */
async function webLogout(http: HttpTransport): Promise<void> {
  let logoutError: unknown;
  try {
    const first = await http.send(
      "/spxml_web/logout.htm",
      {},
      {
        redirect: "manual",
        allowStatuses: [200, 302, 401],
      },
    );
    await first.body?.cancel();
  } catch (error) {
    logoutError = error;
  }
  try {
    if (!isTransportFailure(logoutError)) {
      const second = await http.send(
        "/spxml_web/logout2.htm",
        {},
        {
          redirect: "manual",
          allowStatuses: [200, 302, 401],
        },
      );
      await second.body?.cancel();
    }
  } catch (cleanupError) {
    if (logoutError === undefined) throw cleanupError;
    attachCleanupError(logoutError, cleanupError);
  }
  if (logoutError !== undefined) throw logoutError;
}

/**
 * Контекст web Administrator после входа: своё хранилище cookie, ID сессии web LDS.
 * Умолчания web LDS/SPXML намеренно отличаются от native; ID между сессиями не переносить.
 */
export class WebSession {
  readonly rpc: RpcApi;
  readonly spxml: WebSpXmlApi;
  readonly pages: WebPageApi;
  readonly sessionId: DecimalId;
  #closed = false;
  #uploadToken: string | undefined;
  #heartbeat: Promise<WebSocketHeartbeatData> | undefined;

  private constructor(
    private readonly transport: HttpTransport,
    sessionId: DecimalId,
    uploadToken: string | undefined,
    private readonly webSocketFactory: WebSocketFactory | undefined,
  ) {
    this.#uploadToken = uploadToken;
    this.sessionId = sessionId;
    this.rpc = new RpcApi(transport, "web");
    this.spxml = new WebSpXmlApi(transport);
    this.pages = new WebPageApi(transport, () => this.#uploadToken);
  }

  static async open(defaults: ClientDefaults, options?: RequestOptions): Promise<WebSession> {
    const http = transport(defaults, true);
    try {
      const main = await http.send("/spxml_web/main.htm", {}, { ...options, basic: true });
      if (!main.ok) {
        await main.body?.cancel();
        throw new WsHcmApiError("http", `HTTP ${main.status}`, {
          operation: "main-page",
          status: main.status,
        });
      }
      // Предел размера ответа уже применил HttpTransport.send() через limitResponse.
      const html = await main.text();
      if (http.cookie.value === undefined)
        throw new WsHcmApiError("protocol", "Стартовая страница web не вернула cookie SessionID");
      const opened = await openLdsSession(http, "web", false, options);
      return new WebSession(
        http,
        opened.sessionId,
        extractWebUploadToken(html),
        defaults.webSocketFactory,
      );
    } catch (error) {
      try {
        if (!isTransportFailure(error)) await webLogout(http);
      } catch (cleanup) {
        attachCleanupError(error, cleanup);
      } finally {
        http.dispose();
      }
      throw error;
    }
  }

  /** Один штатный heartbeat; ограниченное по времени закрытие сокета — до возврата сводки. */
  heartbeat(input: WebSocketHeartbeatInput = {}): Promise<WebSocketHeartbeatData> {
    if (this.#closed)
      return Promise.reject(
        new WsHcmApiError("protocol", "Сессия web закрыта.", { requestSent: false }),
      );
    if (this.#heartbeat)
      return Promise.reject(
        new WsHcmApiError("protocol", "Проверка WebSocket уже выполняется.", {
          requestSent: false,
        }),
      );
    const pending = webSocketHeartbeat(this.transport, this.webSocketFactory, input);
    this.#heartbeat = pending;
    void pending
      .finally(() => {
        if (this.#heartbeat === pending) this.#heartbeat = undefined;
      })
      .catch(() => {});
    return pending;
  }

  /** Снять локальный доступ, не утверждая, что очистку на сервере подтвердили. */
  disposeLocal(): void {
    this.#closed = true;
    this.#uploadToken = undefined;
    this.transport.dispose();
  }

  /** Идемпотентно закрыть web LDS, пройти обе страницы выхода, очистить cookie лишь этой сессии. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#uploadToken = undefined;
    // Ошибка WS не означает потери HTTP. Сначала завершить её ограниченное локальное закрытие,
    // затем закрывать именно этот ещё известный контекст HTTP/LDS.
    await this.#heartbeat?.catch(() => {});
    const errors: unknown[] = [];
    try {
      await closeLdsSession(this.transport, "web", this.sessionId);
    } catch (error) {
      errors.push(error);
    }
    try {
      if (!errors.some(isTransportFailure)) await webLogout(this.transport);
    } catch (error) {
      errors.push(error);
    } finally {
      this.transport.dispose();
    }
    if (errors.length > 0) {
      throw new WsHcmApiError("cleanup", "Не удалось закрыть сессию web", {
        details: { errorCount: errors.length },
        cause:
          errors.length === 1
            ? errors[0]
            : new AggregateError(errors, "Ошибки при закрытии сессии web"),
      });
    }
  }
}

/**
 * Точка входа в административные API WebSoft HCM.
 *
 * Умолчания: `http://localhost:8088/`, таймаут запроса 30 секунд, встроенный `fetch`. Каждая сессия
 * получает собственные транспорт и хранилище cookie. Очистка гарантирована в `with*Session()`.
 */
export class WsHcmClient {
  readonly diagnostics: DiagnosticsApi;
  readonly #defaults: ClientDefaults;
  readonly #anonymous: HttpTransport;

  constructor(options: WsHcmClientOptions = {}) {
    this.#defaults = {
      baseUrl: options.baseUrl ?? "http://localhost:8088/",
      timeoutMs: options.timeoutMs ?? 30_000,
      maxResponseBytes: options.maxResponseBytes ?? 16 * 1024 * 1024,
      fetch: options.fetch ?? globalThis.fetch,
      ...(options.webSocketFactory !== undefined
        ? { webSocketFactory: options.webSocketFactory }
        : options.fetch === undefined
          ? { webSocketFactory: defaultWebSocketFactory }
          : {}),
      ...(options.auth === undefined ? {} : { auth: options.auth }),
    };
    const anonymous = transport(this.#defaults);
    this.#anonymous = anonymous;
    this.diagnostics = new DiagnosticsApi(anonymous);
  }

  /** Освободить автономный контекст диагностики; сессии закрывают их владельцы. */
  close(): void {
    this.#anonymous.dispose();
  }

  /** Локальная проверка перед начальной загрузкой web, когда задан собственный коннектор HTTP. */
  assertWebSocketAvailable(): void {
    assertWebSocketAvailable(this.#defaults.webSocketFactory);
  }

  /** Открыть сессию native. Ею владеет вызывающий, он обязан вызвать `close()`. */
  openNativeSession(options?: RequestOptions): Promise<NativeSession> {
    return NativeSession.open(this.#defaults, options);
  }
  /** Открыть сессию web Administrator. Ею владеет вызывающий, он обязан вызвать `close()`. */
  openWebSession(options?: RequestOptions): Promise<WebSession> {
    return WebSession.open(this.#defaults, options);
  }
  /** Выполнить действие в сессии native и закрыть её в `finally`; главная — ошибка операции. */
  async withNativeSession<T>(action: (session: NativeSession) => Promise<T>): Promise<T> {
    return withCleanup(await this.openNativeSession(), action);
  }
  /** Выполнить действие в сессии web и закрыть её в `finally`; главная — ошибка операции. */
  async withWebSession<T>(action: (session: WebSession) => Promise<T>): Promise<T> {
    return withCleanup(await this.openWebSession(), action);
  }
}
