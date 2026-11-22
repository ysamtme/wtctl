import { Buffer } from "node:buffer";
import { ArgumentError, attachCleanupError, WsHcmApiError } from "./error.js";
import type { Credentials, RequestOptions, WsHcmResponse } from "./types.js";

export interface TransportOptions {
  baseUrl: string;
  auth?: Credentials;
  timeoutMs: number;
  fetch: typeof globalThis.fetch;
  webHeaders?: boolean;
  maxResponseBytes?: number;
}

export interface SendOptions extends RequestOptions {
  basic?: boolean;
  /** "any": ответ с любым статусом HTTP завершает запрос (страница выхода). */
  allowStatuses?: readonly number[] | "any";
  redirect?: RequestRedirect;
}

const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_TIMEOUT_MS = 2_147_483_647;

export class SessionCookie {
  readonly #cookies = new Map<string, { name: string; value: string }>();

  /** Значение cookie SessionID; undefined, если сессия ещё не выдала SessionID. */
  get value(): string | undefined {
    return this.#cookies.get("sessionid")?.value;
  }

  /** Все активные cookies сессии в виде заголовка Cookie. */
  header(): string | undefined {
    if (this.#cookies.size === 0) return undefined;
    return [...this.#cookies.values()].map(({ name, value }) => `${name}=${value}`).join("; ");
  }

  capture(headers: Headers): void {
    const values =
      headers.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
    for (const raw of values) {
      const first = raw.split(";", 1)[0] ?? "";
      const equals = first.indexOf("=");
      if (equals <= 0) continue;
      const name = first.slice(0, equals).trim();
      const cookieValue = first.slice(equals + 1).trim();
      if (!COOKIE_NAME_PATTERN.test(name) || /[\x00-\x1f\x7f-\uffff]/.test(cookieValue)) continue;
      const key = name.toLowerCase();
      const attrs = raw.slice(first.length);
      let deleted = cookieValue === "";
      if (!deleted) {
        // По RFC 6265 §5.3 атрибут Max-Age имеет приоритет над Expires.
        const maxAge = /;\s*max-age\s*=\s*(-?\d+)\s*(?:;|$)/i.exec(attrs);
        if (maxAge !== null) {
          deleted = Number(maxAge[1]) <= 0;
        } else {
          const expires = /;\s*expires\s*=\s*([^;]+)/i.exec(attrs);
          if (expires?.[1]) {
            const time = Date.parse(expires[1].trim());
            if (Number.isFinite(time) && time <= Date.now()) deleted = true;
          }
        }
      }
      if (deleted) this.#cookies.delete(key);
      else this.#cookies.set(key, { name, value: cookieValue });
    }
  }

  clear(): void {
    this.#cookies.clear();
  }
}

export class HttpTransport {
  readonly baseUrl: URL;
  readonly cookie = new SessionCookie();
  readonly #auth: Credentials | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #webHeaders: boolean;
  readonly #maxResponseBytes: number;
  #disposed = false;

  get hasCredentials(): boolean {
    return this.#auth !== undefined;
  }

  constructor(options: TransportOptions) {
    const baseUrl = URL.parse(
      options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`,
    );
    if (
      !baseUrl ||
      !["http:", "https:"].includes(baseUrl.protocol) ||
      baseUrl.username !== "" ||
      baseUrl.password !== ""
    ) {
      throw new ArgumentError("baseUrl: нужен URL HTTP(S) без имени и пароля в адресе");
    }
    this.baseUrl = baseUrl;
    this.#auth = options.auth;
    this.#timeoutMs = options.timeoutMs;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 1 ||
      this.#timeoutMs > MAX_TIMEOUT_MS
    )
      throw new ArgumentError("timeoutMs: нужно положительное целое число");
    this.#fetch = options.fetch;
    this.#webHeaders = options.webHeaders ?? false;
    this.#maxResponseBytes = options.maxResponseBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(this.#maxResponseBytes) || this.#maxResponseBytes < 1)
      throw new ArgumentError("maxResponseBytes: нужно положительное целое число");
    if (this.baseUrl.search || this.baseUrl.hash)
      throw new ArgumentError("baseUrl: строка запроса и фрагмент не допускаются");
  }

  assertOpen(): void {
    if (this.#disposed) throw new WsHcmApiError("protocol", "Сессия закрыта");
  }

  dispose(): void {
    this.cookie.clear();
    this.#disposed = true;
  }

  private resolve(path: string, relativeTo = this.baseUrl): URL {
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//");
    const url = URL.parse(
      absolute ? path : relativeTo === this.baseUrl ? path.replace(/^\/+/, "") : path,
      relativeTo,
    );
    if (!url) throw new ArgumentError("path: адрес записан неверно.");
    if (
      url.origin !== this.baseUrl.origin ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(this.baseUrl.pathname)
    ) {
      throw new WsHcmApiError("protocol", "Запрос за пределы адреса подключения запрещён");
    }
    return url;
  }

  async send(path: string, init: RequestInit = {}, options: SendOptions = {}): Promise<Response> {
    this.assertOpen();
    let headers: Headers;
    try {
      headers = new Headers(init.headers);
    } catch {
      throw new ArgumentError("headers: имя или значение заголовка записано неверно.");
    }
    if (options.basic) {
      if (this.#auth === undefined)
        throw new WsHcmApiError("auth", "Нужны имя пользователя и пароль");
      headers.set(
        "Authorization",
        `Basic ${Buffer.from(`${this.#auth.username}:${this.#auth.password}`, "utf8").toString("base64")}`,
      );
    }
    const callerCookie = headers.has("cookie");
    const initialCookie =
      !callerCookie || this.cookie.value !== undefined ? this.cookie.header() : undefined;
    let ownsCookieHeader = initialCookie !== undefined;
    if (initialCookie !== undefined) headers.set("Cookie", initialCookie);
    if (this.#webHeaders) headers.set("X-SpXml-Client", "SP-XML Web client 1.0");

    const maxResponseBytes = options.maxResponseBytes ?? this.#maxResponseBytes;
    if (
      !(maxResponseBytes === Infinity || Number.isSafeInteger(maxResponseBytes)) ||
      maxResponseBytes < 1
    )
      throw new ArgumentError("maxResponseBytes: нужно положительное целое число или Infinity");
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)
      throw new ArgumentError("timeoutMs: нужно положительное целое число");
    const streaming = maxResponseBytes === Infinity;
    const streamController = streaming ? new AbortController() : undefined;
    const timeoutSignal = streamController
      ? streamController.signal
      : AbortSignal.timeout(timeoutMs);
    const signal =
      options.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([options.signal, timeoutSignal]);
    const requestInit: RequestInit & { duplex?: "half" } = {
      ...init,
      headers,
      signal,
      ...(init.body instanceof ReadableStream ? { duplex: "half" as const } : {}),
      ...(options.redirect === undefined && init.redirect === undefined
        ? {}
        : { redirect: options.redirect ?? init.redirect }),
    };
    let requestUrl = this.resolve(path);
    let response: Response;
    // Для потокового чтения ограничивается ожидание заголовков, затем — простой между чанками.
    let headerTimer: ReturnType<typeof setTimeout> | undefined;
    if (streamController) {
      headerTimer = setTimeout(() => {
        streamController.abort(
          new DOMException("The operation was aborted due to timeout", "TimeoutError"),
        );
      }, timeoutMs);
    }
    try {
      response = await this.#fetch(requestUrl, { ...requestInit, redirect: "manual" });
      this.cookie.capture(response.headers);
      if ((options.redirect ?? init.redirect ?? "follow") === "follow") {
        for (let hop = 0; [301, 302, 303, 307, 308].includes(response.status); hop++) {
          await response.body?.cancel();
          const redirected = { details: { network: "redirect" } };
          if (hop >= 5)
            throw new WsHcmApiError("http", "Слишком много перенаправлений", redirected);
          if (!["GET", "HEAD"].includes((requestInit.method ?? "GET").toUpperCase()))
            throw new WsHcmApiError(
              "http",
              "Перенаправление запроса на запись само не выполняется",
              redirected,
            );
          const location = response.headers.get("location");
          if (location === null)
            throw new WsHcmApiError("protocol", "В перенаправлении нет Location");
          try {
            requestUrl = this.resolve(location, requestUrl);
          } catch {
            throw new WsHcmApiError("http", "Перенаправление ведёт на другой сервер", redirected);
          }
          const nextCookie =
            ownsCookieHeader || !callerCookie || this.cookie.value !== undefined
              ? this.cookie.header()
              : undefined;
          if (nextCookie !== undefined) {
            headers.set("Cookie", nextCookie);
            ownsCookieHeader = true;
          } else if (ownsCookieHeader) {
            // Перенаправление может очистить cookies сессии. Свой заголовок клиент
            // убирает, а Cookie опытного вызывающего, который клиент не ставил, сохраняет.
            headers.delete("Cookie");
          }
          response = await this.#fetch(requestUrl, { ...requestInit, redirect: "manual" });
          this.cookie.capture(response.headers);
        }
      }
    } catch (error) {
      if (error instanceof WsHcmApiError) throw error;
      const reason = timeoutSignal.aborted ? timeoutSignal.reason : undefined;
      const timedOut =
        (error instanceof DOMException && error.name === "TimeoutError") ||
        (reason instanceof DOMException && reason.name === "TimeoutError");
      const aborted =
        !timedOut &&
        ((error instanceof DOMException && error.name === "AbortError") ||
          Boolean(options.signal?.aborted));
      const network = timedOut ? "timeout" : aborted ? "aborted" : networkFailure(error);
      throw new WsHcmApiError(
        "http",
        timedOut
          ? "Истекло время HTTP-запроса"
          : aborted
            ? "HTTP-запрос прерван"
            : "HTTP-запрос не выполнен",
        { details: { network } },
      );
    } finally {
      clearTimeout(headerTimer);
    }
    const wrap = (res: Response): Response =>
      limitResponse(
        res,
        maxResponseBytes,
        streaming ? timeoutMs : undefined,
        streamController ? (error) => streamController.abort(error) : undefined,
        options.signal,
      );

    if (options.allowStatuses !== undefined) {
      if (options.allowStatuses === "any" || options.allowStatuses.includes(response.status))
        return wrap(response);
      await response.body?.cancel();
      if (response.status === 401)
        throw new WsHcmApiError("auth", "Отказ во входе или сессия недействительна", {
          status: 401,
        });
      if (response.status === 403)
        throw new WsHcmApiError("permission", "Доступ запрещён", { status: 403 });
      throw new WsHcmApiError("http", `HTTP ${response.status}`, { status: response.status });
    }
    if (response.status === 401) {
      await response.body?.cancel();
      throw new WsHcmApiError("auth", "Отказ во входе или сессия недействительна", { status: 401 });
    }
    if (response.status === 403) {
      await response.body?.cancel();
      throw new WsHcmApiError("permission", "Доступ запрещён", { status: 403 });
    }
    return wrap(response);
  }
}

/** Почему на запрос не пришёл ответ HTTP, одним словом; текст системной ошибки не хранится. */
export type NetworkFailure =
  | "refused"
  | "unknown_host"
  | "unreachable"
  | "certificate"
  | "tls"
  | "not_http"
  | "redirect"
  | "timeout"
  | "reset"
  | "aborted"
  | "failed";
function networkFailure(error: unknown): NetworkFailure {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === "string") {
      if (code === "ECONNREFUSED") return "refused";
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "unknown_host";
      if (code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "EADDRNOTAVAIL")
        return "unreachable";
      if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code)) return "certificate";
      if (code === "EPROTO" || code.startsWith("ERR_SSL") || code.startsWith("ERR_TLS"))
        return "tls";
      if (code.startsWith("HPE_")) return "not_http";
      if (code === "ETIMEDOUT" || /^UND_ERR_.*TIMEOUT$/.test(code)) return "timeout";
      if (code === "ECONNRESET" || code === "EPIPE" || code === "UND_ERR_SOCKET") return "reset";
    }
    if (current instanceof AggregateError && current.errors.length > 0) current = current.errors[0];
    else current = current.cause;
  }
  return "failed";
}

/**
 * Ограничивает число байтов до того, как потребитель сможет буферизовать недоверенный ответ.
 * Сбой чтения тела — WsHcmApiError с причиной, и при пределе Infinity тоже.
 */
export function limitResponse(
  response: Response,
  maxBytes: number,
  idleTimeoutMs?: number,
  onIdleTimeout?: (error: DOMException) => void,
  externalSignal?: AbortSignal,
): Response {
  if (response.body === null) return response;
  const reader = response.body.getReader();
  let read = 0;
  const readChunk = (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (idleTimeoutMs === undefined) return reader.read();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const timeoutError = new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        );
        onIdleTimeout?.(timeoutError);
        reject(timeoutError);
      }, idleTimeoutMs);
      reader.read().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await readChunk();
        if (result.done) {
          controller.close();
          reader.releaseLock();
          return;
        }
        read += result.value.byteLength;
        if (read > maxBytes) {
          const error = new WsHcmApiError("protocol", "Ответ превышает заданный предел в байтах", {
            details: { maxResponseBytes: maxBytes },
          });
          try {
            await reader.cancel();
          } catch (cleanupError) {
            attachCleanupError(
              error,
              cleanupError instanceof WsHcmApiError
                ? cleanupError
                : new WsHcmApiError("http", "Не удалось отменить чтение HTTP-ответа", {
                    cause: cleanupError,
                  }),
            );
          } finally {
            reader.releaseLock();
          }
          controller.error(error);
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        const network =
          error instanceof DOMException && error.name === "TimeoutError"
            ? "timeout"
            : (error instanceof DOMException && error.name === "AbortError") ||
                Boolean(externalSignal?.aborted)
              ? "aborted"
              : undefined;
        controller.error(
          error instanceof WsHcmApiError
            ? error
            : new WsHcmApiError("http", "Не удалось прочитать тело HTTP-ответа", {
                cause: error,
                ...(network === undefined ? {} : { details: { network } }),
              }),
        );
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch (error) {
        throw error instanceof WsHcmApiError
          ? error
          : new WsHcmApiError("http", "Не удалось прочитать тело HTTP-ответа", { cause: error });
      } finally {
        reader.releaseLock();
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function responseBytes<T>(response: Response, data: T): Promise<WsHcmResponse<T>> {
  const rawBody = new Uint8Array(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, data, rawBody };
}

export function query(path: string, values: Readonly<Record<string, unknown>>): string {
  const url = new URL(path, "http://ws-hcm.invalid");
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  // Datex раскодирует параметры запроса без обработки '+' как в формах.
  // URLSearchParams кодирует настоящие пробелы как '+', а буквальный плюс — как %2B.
  // Последнее сохранить, а каждый сериализованный пробел выдать как %20.
  return `${url.pathname}${url.search.replaceAll("+", "%20")}`;
}
