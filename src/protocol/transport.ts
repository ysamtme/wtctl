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
  /** "any": a response with any HTTP status completes the request (the logout landing page). */
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
      throw new TypeError("baseUrl must be an HTTP(S) URL without embedded credentials");
    }
    this.#auth = options.auth;
    this.#timeoutMs = options.timeoutMs;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1)
      throw new TypeError("timeoutMs must be a positive integer");
    this.#fetch = options.fetch;
    this.#webHeaders = options.webHeaders ?? false;
    this.#maxResponseBytes = options.maxResponseBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(this.#maxResponseBytes) || this.#maxResponseBytes < 1)
      throw new TypeError("maxResponseBytes must be a positive integer");
    if (this.baseUrl.search || this.baseUrl.hash)
      throw new TypeError("baseUrl must not contain a query or fragment");
  }

  assertOpen(): void {
    if (this.#disposed) throw new WsHcmApiError("protocol", "Session is closed");
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
      throw new WsHcmApiError(
        "protocol",
        "Request outside the configured server base is not allowed",
      );
    }
    return url;
  }

  async send(path: string, init: RequestInit = {}, options: SendOptions = {}): Promise<Response> {
    this.assertOpen();
    const headers = new Headers(init.headers);
    if (options.basic) {
      if (this.#auth === undefined) throw new WsHcmApiError("auth", "Credentials are required");
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
          if (hop >= 5) throw new WsHcmApiError("http", "Too many redirects", redirected);
          if (!["GET", "HEAD"].includes((requestInit.method ?? "GET").toUpperCase()))
            throw new WsHcmApiError(
              "http",
              "Write redirect is not followed automatically",
              redirected,
            );
          const location = response.headers.get("location");
          if (location === null)
            throw new WsHcmApiError("protocol", "Redirect is missing Location");
          try {
            requestUrl = this.resolve(location, requestUrl);
          } catch {
            throw new WsHcmApiError("http", "Redirect leaves the configured server", redirected);
          }
          if (this.cookie.value !== undefined) {
            headers.set("Cookie", `SessionID=${this.cookie.value}`);
            ownsCookieHeader = true;
          } else if (ownsCookieHeader) {
            // A redirect can expire our SessionID. Remove the header we applied,
            // while preserving an expert caller's Cookie when we never owned it.
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
          ? "HTTP request timed out"
          : aborted
            ? "HTTP request aborted"
            : "HTTP request failed",
        { details: { network } },
      );
    }
    this.cookie.capture(response.headers);

    if (options.allowStatuses !== undefined) {
      if (options.allowStatuses === "any" || options.allowStatuses.includes(response.status))
        return limitResponse(response, this.#maxResponseBytes);
      await response.body?.cancel();
      if (response.status === 401)
        throw new WsHcmApiError("auth", "Authentication or session boundary", { status: 401 });
      if (response.status === 403)
        throw new WsHcmApiError("permission", "Permission denied", { status: 403 });
      throw new WsHcmApiError("http", `HTTP ${response.status}`, { status: response.status });
    }
    if (response.status === 401) {
      await response.body?.cancel();
      throw new WsHcmApiError("auth", "Authentication or session boundary", { status: 401 });
    }
    if (response.status === 403) {
      await response.body?.cancel();
      throw new WsHcmApiError("permission", "Permission denied", { status: 403 });
    }
    return limitResponse(response, this.#maxResponseBytes);
  }
}

/** Why a request got no HTTP response, as a fixed word; the system error text itself is not kept. */
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

/** Enforces a byte budget before any consumer can buffer an untrusted response. */
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
          const error = new WsHcmApiError("protocol", "Response exceeds configured byte limit", {
            details: { maxResponseBytes: maxBytes },
          });
          try {
            await reader.cancel();
          } catch (cleanupError) {
            attachCleanupError(
              error,
              cleanupError instanceof WsHcmApiError
                ? cleanupError
                : new WsHcmApiError("http", "HTTP response cancellation failed", {
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
            : new WsHcmApiError("http", "HTTP response body failed", { cause: error }),
        );
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch (error) {
        throw error instanceof WsHcmApiError
          ? error
          : new WsHcmApiError("http", "HTTP response body failed", { cause: error });
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
  // Datex percent-decodes query parameters without form-style '+' handling.
  // URLSearchParams encodes actual spaces as '+', while literal plus is %2B.
  // Preserve the latter and emit %20 for every serialized space.
  return `${url.pathname}${url.search.replaceAll("+", "%20")}`;
}
