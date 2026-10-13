import {
  DiagnosticsApi,
  ExperimentalApi,
  NativeExperimentalApi,
  NativeSpXml2Api,
  ResourceApi,
  RpcApi,
  WebPageApi,
  WebExperimentalApi,
  WebSpXml2Api,
  WebSpXmlApi,
  closeLdsSession,
  createNativeLdsApi,
  createWebLdsApi,
  openLdsSession,
  type NativeLdsApi,
  type WebLdsApi,
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
  WsHcmResponse,
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
  readonly spxml: RpcApi;
  readonly spxml2: NativeSpXml2Api;
  readonly resources: ResourceApi;
  readonly experimental: NativeExperimentalApi;
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
    this.spxml = this.rpc;
    this.spxml2 = new NativeSpXml2Api(transport);
    this.resources = new ResourceApi(transport);
    this.experimental = new NativeExperimentalApi(transport);
  }

  static async open(defaults: ClientDefaults): Promise<NativeSession> {
    const http = transport(defaults);
    try {
      const opened = await openLdsSession(http, "native", true);
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
  // JavaScript. Разметка, комментарии и строковые литералы кодом не считаются.
  const markup = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  for (const script of markup.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = script[1]!;
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

/** HTML начальной загрузки читается ради закрытого токена; возвращённый скрипт не выполняется. */
async function boundedWebBootstrap(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximumBytes)
        throw new WsHcmApiError("protocol", "Стартовая страница web превышает предел размера HTML");
      chunks.push(part.value.slice());
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Страница, начальная загрузка и выход web Administrator; привязаны к одному хранилищу cookie. */
export class WebLifecycleApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly onMain?: (html: string | undefined) => void,
  ) {}

  /** Прочитать ответ `/admin` с перенаправлением, не переходя по нему. */
  async admin(options?: RequestOptions): Promise<WsHcmResponse<string>> {
    const response = await this.transport.send(
      "/admin",
      {},
      {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        redirect: "manual",
        allowStatuses: [301],
      },
    );
    const rawBody = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      headers: response.headers,
      data: new TextDecoder().decode(rawBody),
      rawBody,
    };
  }

  /** Прочитать главную страницу веб-администратора после входа. */
  async main(options?: RequestOptions): Promise<WsHcmResponse<string>> {
    // Штатная страница меняет токен до записи HTML, в том числе для запросов, ответ на которые
    // потом не удаётся прочитать. Прежний токен устарел.
    this.onMain?.(undefined);
    const response = await this.transport.send("/spxml_web/main.htm", {}, options);
    const rawBody = new Uint8Array(await response.arrayBuffer());
    if (!response.ok)
      throw new WsHcmApiError("http", `HTTP ${response.status}`, { status: response.status });
    const data = new TextDecoder().decode(rawBody);
    this.onMain?.(data);
    return { status: response.status, headers: response.headers, data, rawBody };
  }

  /** Выполнить оба шага выхода; при потере связи дальнейшие запросы не отправляются. */
  async logout(options?: RequestOptions): Promise<void> {
    this.onMain?.(undefined);
    let logoutError: unknown;
    try {
      const first = await this.transport.send(
        "/spxml_web/logout.htm",
        {},
        {
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
          ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          redirect: "manual",
          allowStatuses: [200, 302, 401],
        },
      );
      await first.body?.cancel();
    } catch (error) {
      logoutError = error;
    }
    try {
      if (!isTransportFailure(logoutError)) await this.logout2(options);
    } catch (cleanupError) {
      if (logoutError === undefined) throw cleanupError;
      attachCleanupError(logoutError, cleanupError);
    }
    if (logoutError !== undefined) throw logoutError;
  }

  /** Выполнить второй шаг веб-выхода; его вызывает `logout()`. */
  private async logout2(options?: RequestOptions): Promise<void> {
    this.onMain?.(undefined);
    const second = await this.transport.send(
      "/spxml_web/logout2.htm",
      {},
      {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        redirect: "manual",
        allowStatuses: [200, 302, 401],
      },
    );
    await second.body?.cancel();
  }
}

/**
 * Контекст web Administrator после входа: своё хранилище cookie, ID сессии web LDS.
 * Умолчания web LDS/SPXML намеренно отличаются от native; ID между сессиями не переносить.
 */
export class WebSession {
  readonly lds: WebLdsApi;
  readonly rpc: RpcApi;
  readonly spxml: WebSpXmlApi;
  readonly spxml2: WebSpXml2Api;
  readonly pages: WebPageApi;
  readonly resources: ResourceApi;
  readonly lifecycle: WebLifecycleApi;
  readonly experimental: WebExperimentalApi;
  readonly sessionId: DecimalId;
  #closed = false;
  #uploadToken: string | undefined;
  #heartbeat: Promise<WebSocketHeartbeatData> | undefined;

  private constructor(
    private readonly transport: HttpTransport,
    sessionId: DecimalId,
    uploadToken: string | undefined,
    maximumUploadBytes: number,
    private readonly webSocketFactory: WebSocketFactory | undefined,
  ) {
    this.#uploadToken = uploadToken;
    this.sessionId = sessionId;
    this.lds = createWebLdsApi(transport, () => this.sessionId);
    this.rpc = new RpcApi(transport, "web");
    this.spxml = new WebSpXmlApi(transport);
    this.spxml2 = new WebSpXml2Api(transport);
    this.pages = new WebPageApi(transport, () => this.#uploadToken, maximumUploadBytes);
    this.resources = new ResourceApi(transport);
    this.lifecycle = new WebLifecycleApi(transport, (html) => {
      this.#uploadToken = html === undefined ? undefined : extractWebUploadToken(html);
    });
    this.experimental = new WebExperimentalApi(transport);
  }

  static async open(defaults: ClientDefaults): Promise<WebSession> {
    const http = transport(defaults, true);
    try {
      const main = await http.send("/spxml_web/main.htm", {}, { basic: true });
      if (!main.ok) {
        await main.body?.cancel();
        throw new WsHcmApiError("http", `HTTP ${main.status}`, {
          operation: "main-page",
          status: main.status,
        });
      }
      const html = await boundedWebBootstrap(main, defaults.maxResponseBytes);
      if (http.cookie.value === undefined)
        throw new WsHcmApiError("protocol", "Стартовая страница web не вернула cookie SessionID");
      const opened = await openLdsSession(http, "web");
      return new WebSession(
        http,
        opened.sessionId,
        extractWebUploadToken(html),
        Math.min(defaults.maxResponseBytes, 8 * 1024 * 1024),
        defaults.webSocketFactory,
      );
    } catch (error) {
      try {
        if (!isTransportFailure(error)) await new WebLifecycleApi(http).logout();
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
        new WsHcmApiError("protocol", "Веб-сессия закрыта.", { requestSent: false }),
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

  /** Сделать локальный контекст недействительным после прямо запрошенного итогового веб-выхода. */
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
      if (!errors.some(isTransportFailure)) await this.lifecycle.logout();
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
  readonly experimental: ExperimentalApi;
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
    this.experimental = new ExperimentalApi(anonymous);
  }

  /** Освободить автономный контекст диагностики и сырых запросов; сессии закрывают их владельцы. */
  close(): void {
    this.#anonymous.dispose();
  }

  /** Локальная проверка перед начальной загрузкой web, когда задан собственный коннектор HTTP. */
  assertWebSocketAvailable(): void {
    assertWebSocketAvailable(this.#defaults.webSocketFactory);
  }

  /** Открыть сессию native. Ею владеет вызывающий, он обязан вызвать `close()`. */
  openNativeSession(): Promise<NativeSession> {
    return NativeSession.open(this.#defaults);
  }
  /** Открыть сессию web Administrator. Ею владеет вызывающий, он обязан вызвать `close()`. */
  openWebSession(): Promise<WebSession> {
    return WebSession.open(this.#defaults);
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
