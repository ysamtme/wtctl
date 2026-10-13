import { Buffer } from "node:buffer";
import { attachCleanupError, WsHcmApiError } from "./error.js";
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

export class SessionCookie {
  #value: string | undefined;

  get value(): string | undefined {
    return this.#value;
  }

  capture(headers: Headers): void {
    const values =
      headers.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
    for (const value of values) {
      const first = value.split(";", 1)[0] ?? "";
      const equals = first.indexOf("=");
      if (equals < 0 || first.slice(0, equals).trim().toLowerCase() !== "sessionid") continue;
      const cookieValue = first.slice(equals + 1).trim();
      const deleted = /(?:^|;)\s*max-age=0(?:;|$)/i.test(value) || cookieValue === "";
      this.#value = deleted ? undefined : cookieValue;
    }
  }

  clear(): void {
    this.#value = undefined;
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
    this.baseUrl = new URL(options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
    if (
      !["http:", "https:"].includes(this.baseUrl.protocol) ||
      this.baseUrl.username !== "" ||
      this.baseUrl.password !== ""
    ) {
      throw new TypeError("baseUrl: нужен URL HTTP(S) без имени и пароля в адресе");
    }
    this.#auth = options.auth;
    this.#timeoutMs = options.timeoutMs;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1)
      throw new TypeError("timeoutMs: нужно положительное целое число");
    this.#fetch = options.fetch;
    this.#webHeaders = options.webHeaders ?? false;
    this.#maxResponseBytes = options.maxResponseBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(this.#maxResponseBytes) || this.#maxResponseBytes < 1)
      throw new TypeError("maxResponseBytes: нужно положительное целое число");
    if (this.baseUrl.search || this.baseUrl.hash)
      throw new TypeError("baseUrl: строка запроса и фрагмент не допускаются");
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
    const url = new URL(
      absolute ? path : relativeTo === this.baseUrl ? path.replace(/^\/+/, "") : path,
      relativeTo,
    );
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
    const headers = new Headers(init.headers);
    if (options.basic) {
      if (this.#auth === undefined)
        throw new WsHcmApiError("auth", "Нужны имя пользователя и пароль");
      headers.set(
        "Authorization",
        `Basic ${Buffer.from(`${this.#auth.username}:${this.#auth.password}`, "utf8").toString("base64")}`,
      );
    }
    let ownsCookieHeader = this.cookie.value !== undefined;
    if (ownsCookieHeader) headers.set("Cookie", `SessionID=${this.cookie.value}`);
    if (this.#webHeaders) headers.set("X-SpXml-Client", "SP-XML Web client 1.0");

    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
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
          if (this.cookie.value !== undefined) {
            headers.set("Cookie", `SessionID=${this.cookie.value}`);
            ownsCookieHeader = true;
          } else if (ownsCookieHeader) {
            // Перенаправление может сделать SessionID недействительным. Свой заголовок клиент
            // убирает, а Cookie опытного вызывающего, который клиент не ставил, сохраняет.
            headers.delete("Cookie");
          }
          response = await this.#fetch(requestUrl, { ...requestInit, redirect: "manual" });
          this.cookie.capture(response.headers);
        }
      }
    } catch (error) {
      if (error instanceof WsHcmApiError) throw error;
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      const aborted = error instanceof DOMException && error.name === "AbortError";
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
    }
    this.cookie.capture(response.headers);

    if (options.allowStatuses !== undefined) {
      if (options.allowStatuses === "any" || options.allowStatuses.includes(response.status))
        return limitResponse(response, this.#maxResponseBytes);
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
    return limitResponse(response, this.#maxResponseBytes);
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

/** Ограничивает число байтов до того, как потребитель сможет буферизовать недоверенный ответ. */
export function limitResponse(response: Response, maxBytes: number): Response {
  if (response.body === null) return response;
  const reader = response.body.getReader();
  let read = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
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
        controller.error(
          error instanceof WsHcmApiError
            ? error
            : new WsHcmApiError("http", "Не удалось прочитать тело HTTP-ответа", { cause: error }),
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
