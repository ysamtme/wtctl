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
 * Authenticated native Administrator context with its own cookie store and decimal LDS session ID.
 * Prefer `WsHcmClient.withNativeSession()` so cleanup always runs.
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

  /** Drops local access without claiming that server-side LDS cleanup was acknowledged. */
  disposeLocal(): void {
    this.#closed = true;
    this.transport.dispose();
  }

  /**
   * Idempotently closes LDS, visits `/loggedoff.html`, and clears only this session's cookie.
   * The landing-page leg is partial lifecycle metadata, not a standalone supported operation.
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
      throw new WsHcmApiError("cleanup", "Native session cleanup failed", {
        details: { errorCount: errors.length },
        cause:
          errors.length === 1 ? errors[0] : new AggregateError(errors, "Native cleanup failures"),
      });
    }
  }
}

/** Decode the shipped CodeLiteral assignment without evaluating returned JavaScript. */
function extractWebUploadToken(html: string): string | undefined {
  const assignments: RegExpExecArray[] = [];
  // This is a deliberately narrow reader of the shipped inline assignment, not
  // a JavaScript interpreter. Markup, comments and string literals are not code.
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
      // The delivery writes a direct assignment on its own line. Requiring this
      // context also excludes mentions in regex literals and other expressions.
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

/** Bootstrap HTML is read only for a private token; returned script is never executed. */
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
        throw new WsHcmApiError("protocol", "Web bootstrap exceeds its bounded HTML limit");
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

/** Web Administrator page/bootstrap/logout lifecycle bound to one web cookie store. */
export class WebLifecycleApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly onMain?: (html: string | undefined) => void,
  ) {}

  /** Reads the `/admin` redirect response without following it. */
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

  /** Reads the authenticated web Administrator main page. */
  async main(options?: RequestOptions): Promise<WsHcmResponse<string>> {
    // The shipped page rotates its token before writing HTML, including requests
    // whose response cannot subsequently be read. An earlier token is stale.
    this.onMain?.(undefined);
    const response = await this.transport.send("/spxml_web/main.htm", {}, options);
    const rawBody = new Uint8Array(await response.arrayBuffer());
    if (!response.ok)
      throw new WsHcmApiError("http", `HTTP ${response.status}`, { status: response.status });
    const data = new TextDecoder().decode(rawBody);
    this.onMain?.(data);
    return { status: response.status, headers: response.headers, data, rawBody };
  }

  /** Runs both logout legs; observed transport loss stops further requests. */
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

  /** Executes the second web logout leg directly. Normally called by `logout()`. */
  async logout2(options?: RequestOptions): Promise<void> {
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
 * Authenticated web Administrator context with an isolated cookie store and web LDS session ID.
 * Web LDS/SPXML defaults intentionally differ from native ones; do not move IDs between sessions.
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
        throw new WsHcmApiError("protocol", "Web bootstrap did not return SessionID cookie");
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

  /** One stock transport heartbeat, with bounded socket disposal before the receipt is returned. */
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

  /** Invalidates the local context after a directly requested terminal web logout. */
  disposeLocal(): void {
    this.#closed = true;
    this.#uploadToken = undefined;
    this.transport.dispose();
  }

  /** Idempotently closes web LDS, runs both logout pages, and clears only this session's cookie. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#uploadToken = undefined;
    // A WS error does not imply HTTP loss. Settle its bounded local disposal
    // before closing this exact still-known HTTP/LDS context.
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
      throw new WsHcmApiError("cleanup", "Web session cleanup failed", {
        details: { errorCount: errors.length },
        cause: errors.length === 1 ? errors[0] : new AggregateError(errors, "Web cleanup failures"),
      });
    }
  }
}

/**
 * Entry point for WebSoft HCM administrative APIs.
 *
 * Defaults: `http://localhost:8088/`, 30-second per-request timeout, built-in `fetch`. Each opened session receives
 * an independent transport/cookie store. Prefer `with*Session()` for guaranteed cleanup.
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

  /** Disposes the standalone diagnostics/raw context. Session owners close their sessions separately. */
  close(): void {
    this.#anonymous.dispose();
  }

  /** Local guard used before web bootstrap when a custom HTTP connector is supplied. */
  assertWebSocketAvailable(): void {
    assertWebSocketAvailable(this.#defaults.webSocketFactory);
  }

  /** Opens a native session. The caller owns it and must call `close()`. */
  openNativeSession(): Promise<NativeSession> {
    return NativeSession.open(this.#defaults);
  }
  /** Opens a web Administrator session. The caller owns it and must call `close()`. */
  openWebSession(): Promise<WebSession> {
    return WebSession.open(this.#defaults);
  }
  /** Runs an action in a native session and closes it in `finally`, preserving operation error precedence. */
  async withNativeSession<T>(action: (session: NativeSession) => Promise<T>): Promise<T> {
    return withCleanup(await this.openNativeSession(), action);
  }
  /** Runs an action in a web session and closes it in `finally`, preserving operation error precedence. */
  async withWebSession<T>(action: (session: WebSession) => Promise<T>): Promise<T> {
    return withCleanup(await this.openWebSession(), action);
  }
}
