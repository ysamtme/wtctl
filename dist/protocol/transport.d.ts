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
export declare class SessionCookie {
    #private;
    /** Значение cookie SessionID; undefined, если сессия ещё не выдала SessionID. */
    get value(): string | undefined;
    /** Все активные cookies сессии в виде заголовка Cookie. */
    header(): string | undefined;
    capture(headers: Headers): void;
    clear(): void;
}
export declare class HttpTransport {
    #private;
    readonly baseUrl: URL;
    readonly cookie: SessionCookie;
    get hasCredentials(): boolean;
    constructor(options: TransportOptions);
    assertOpen(): void;
    dispose(): void;
    private resolve;
    send(path: string, init?: RequestInit, options?: SendOptions): Promise<Response>;
}
/** Почему на запрос не пришёл ответ HTTP, одним словом; текст системной ошибки не хранится. */
export type NetworkFailure = "refused" | "unknown_host" | "unreachable" | "certificate" | "tls" | "not_http" | "redirect" | "timeout" | "reset" | "aborted" | "failed";
/**
 * Ограничивает число байтов до того, как потребитель сможет буферизовать недоверенный ответ.
 * Сбой чтения тела — WsHcmApiError с причиной, и при пределе Infinity тоже.
 */
export declare function limitResponse(response: Response, maxBytes: number, idleTimeoutMs?: number, onIdleTimeout?: (error: DOMException) => void, externalSignal?: AbortSignal): Response;
export declare function responseBytes<T>(response: Response, data: T): Promise<WsHcmResponse<T>>;
export declare function query(path: string, values: Readonly<Record<string, unknown>>): string;
