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
 * Authenticated native Administrator context with its own cookie store and decimal LDS session ID.
 * Prefer `WsHcmClient.withNativeSession()` so cleanup always runs.
 */
export declare class NativeSession {
    #private;
    private readonly transport;
    readonly lds: NativeLdsApi;
    readonly physicalDocuments: NativePhysicalDocumentsApi;
    readonly rpc: RpcApi;
    readonly spxml: RpcApi;
    readonly spxml2: NativeSpXml2Api;
    readonly resources: ResourceApi;
    readonly experimental: NativeExperimentalApi;
    readonly sessionId: DecimalId;
    private constructor();
    static open(defaults: ClientDefaults): Promise<NativeSession>;
    /** Drops local access without claiming that server-side LDS cleanup was acknowledged. */
    disposeLocal(): void;
    /**
     * Idempotently closes LDS, visits `/loggedoff.html`, and clears only this session's cookie.
     * The landing-page leg is partial lifecycle metadata, not a standalone supported operation.
     */
    close(): Promise<void>;
}
/** Web Administrator page/bootstrap/logout lifecycle bound to one web cookie store. */
export declare class WebLifecycleApi {
    private readonly transport;
    private readonly onMain?;
    constructor(transport: HttpTransport, onMain?: ((html: string | undefined) => void) | undefined);
    /** Reads the `/admin` redirect response without following it. */
    admin(options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Reads the authenticated web Administrator main page. */
    main(options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Runs both logout legs; observed transport loss stops further requests. */
    logout(options?: RequestOptions): Promise<void>;
    /** Executes the second web logout leg; `logout()` calls it. */
    private logout2;
}
/**
 * Authenticated web Administrator context with an isolated cookie store and web LDS session ID.
 * Web LDS/SPXML defaults intentionally differ from native ones; do not move IDs between sessions.
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
    /** One stock transport heartbeat, with bounded socket disposal before the receipt is returned. */
    heartbeat(input?: WebSocketHeartbeatInput): Promise<WebSocketHeartbeatData>;
    /** Invalidates the local context after a directly requested terminal web logout. */
    disposeLocal(): void;
    /** Idempotently closes web LDS, runs both logout pages, and clears only this session's cookie. */
    close(): Promise<void>;
}
/**
 * Entry point for WebSoft HCM administrative APIs.
 *
 * Defaults: `http://localhost:8088/`, 30-second per-request timeout, built-in `fetch`. Each opened session receives
 * an independent transport/cookie store. Prefer `with*Session()` for guaranteed cleanup.
 */
export declare class WsHcmClient {
    #private;
    readonly diagnostics: DiagnosticsApi;
    readonly experimental: ExperimentalApi;
    constructor(options?: WsHcmClientOptions);
    /** Disposes the standalone diagnostics/raw context. Session owners close their sessions separately. */
    close(): void;
    /** Local guard used before web bootstrap when a custom HTTP connector is supplied. */
    assertWebSocketAvailable(): void;
    /** Opens a native session. The caller owns it and must call `close()`. */
    openNativeSession(): Promise<NativeSession>;
    /** Opens a web Administrator session. The caller owns it and must call `close()`. */
    openWebSession(): Promise<WebSession>;
    /** Runs an action in a native session and closes it in `finally`, preserving operation error precedence. */
    withNativeSession<T>(action: (session: NativeSession) => Promise<T>): Promise<T>;
    /** Runs an action in a web session and closes it in `finally`, preserving operation error precedence. */
    withWebSession<T>(action: (session: WebSession) => Promise<T>): Promise<T>;
}
export {};
