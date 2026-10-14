import { DiagnosticsApi, ExperimentalApi, NativeExperimentalApi, NativeSpXml2Api, ResourceApi, RpcApi, WebPageApi, WebExperimentalApi, WebSpXml2Api, WebSpXmlApi, type NativeLdsApi, type WebLdsApi } from "./api.js";
import { NativePhysicalDocumentsApi } from "./physical-documents.js";
import { HttpTransport } from "./transport.js";
import type { DecimalId, RequestOptions, WsHcmClientOptions, WsHcmResponse, WebSocketFactory, WebSocketHeartbeatInput, WebSocketHeartbeatData } from "./types.js";
interface ClientDefaults {
    readonly baseUrl: string;
    readonly auth?: WsHcmClientOptions["auth"];
    readonly timeoutMs: number;
    readonly maxResponseBytes: number;
    readonly fetch: typeof globalThis.fetch;
    readonly webSocketFactory?: WebSocketFactory;
}
/**
 * Контекст native Administrator после входа: своё хранилище cookie, десятичный ID сессии LDS.
 * Лучше `WsHcmClient.withNativeSession()`: так очистка выполняется всегда.
 */
export declare class NativeSession {
    #private;
    private readonly transport;
    readonly lds: NativeLdsApi;
    readonly physicalDocuments: NativePhysicalDocumentsApi;
    readonly rpc: RpcApi;
    readonly spxml2: NativeSpXml2Api;
    readonly resources: ResourceApi;
    readonly experimental: NativeExperimentalApi;
    readonly sessionId: DecimalId;
    private constructor();
    static open(defaults: ClientDefaults): Promise<NativeSession>;
    /** Снять локальный доступ, не утверждая, что очистку LDS на сервере подтвердили. */
    disposeLocal(): void;
    /**
     * Идемпотентно закрыть LDS, зайти на `/loggedoff.html` и очистить только cookie этой сессии.
     * Шаг со страницей выхода — часть жизненного цикла, а не отдельная поддерживаемая операция.
     */
    close(): Promise<void>;
}
/** Страница, начальная загрузка и выход web Administrator; привязаны к одному хранилищу cookie. */
export declare class WebLifecycleApi {
    private readonly transport;
    private readonly onMain?;
    constructor(transport: HttpTransport, onMain?: ((html: string | undefined) => void) | undefined);
    /** Прочитать ответ `/admin` с перенаправлением, не переходя по нему. */
    admin(options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Прочитать главную страницу веб-администратора после входа. */
    main(options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Выполнить оба шага выхода; при потере связи дальнейшие запросы не отправляются. */
    logout(options?: RequestOptions): Promise<void>;
    /** Выполнить второй шаг веб-выхода; его вызывает `logout()`. */
    private logout2;
}
/**
 * Контекст web Administrator после входа: своё хранилище cookie, ID сессии web LDS.
 * Умолчания web LDS/SPXML намеренно отличаются от native; ID между сессиями не переносить.
 */
export declare class WebSession {
    #private;
    private readonly transport;
    private readonly webSocketFactory;
    readonly lds: WebLdsApi;
    readonly rpc: RpcApi;
    readonly spxml: WebSpXmlApi;
    readonly spxml2: WebSpXml2Api;
    readonly pages: WebPageApi;
    readonly resources: ResourceApi;
    readonly lifecycle: WebLifecycleApi;
    readonly experimental: WebExperimentalApi;
    readonly sessionId: DecimalId;
    private constructor();
    static open(defaults: ClientDefaults): Promise<WebSession>;
    /** Один штатный heartbeat; ограниченное по времени закрытие сокета — до возврата сводки. */
    heartbeat(input?: WebSocketHeartbeatInput): Promise<WebSocketHeartbeatData>;
    /** Сделать локальный контекст недействительным после прямо запрошенного итогового веб-выхода. */
    disposeLocal(): void;
    /** Идемпотентно закрыть web LDS, пройти обе страницы выхода, очистить cookie лишь этой сессии. */
    close(): Promise<void>;
}
/**
 * Точка входа в административные API WebSoft HCM.
 *
 * Умолчания: `http://localhost:8088/`, таймаут запроса 30 секунд, встроенный `fetch`. Каждая сессия
 * получает собственные транспорт и хранилище cookie. Очистка гарантирована в `with*Session()`.
 */
export declare class WsHcmClient {
    #private;
    readonly diagnostics: DiagnosticsApi;
    readonly experimental: ExperimentalApi;
    constructor(options?: WsHcmClientOptions);
    /** Освободить автономный контекст диагностики и сырых запросов; сессии закрывают их владельцы. */
    close(): void;
    /** Локальная проверка перед начальной загрузкой web, когда задан собственный коннектор HTTP. */
    assertWebSocketAvailable(): void;
    /** Открыть сессию native. Ею владеет вызывающий, он обязан вызвать `close()`. */
    openNativeSession(): Promise<NativeSession>;
    /** Открыть сессию web Administrator. Ею владеет вызывающий, он обязан вызвать `close()`. */
    openWebSession(): Promise<WebSession>;
    /** Выполнить действие в сессии native и закрыть её в `finally`; главная — ошибка операции. */
    withNativeSession<T>(action: (session: NativeSession) => Promise<T>): Promise<T>;
    /** Выполнить действие в сессии web и закрыть её в `finally`; главная — ошибка операции. */
    withWebSession<T>(action: (session: WebSession) => Promise<T>): Promise<T>;
}
export {};
