import { WsHcmApiError } from "./error.js";
import { HttpTransport } from "./transport.js";
import type { WebSocketFactory, WebSocketHeartbeatData, WebSocketHeartbeatInput, WebSocketHeartbeatReceipt } from "./types.js";
declare const ERROR_MESSAGES: {
    readonly WS_UNAVAILABLE: "Соединение WebSocket недоступно: нет webSocketFactory или собственной веб-сессии.";
    readonly WS_INVALID_INPUT: "Неверные аргументы проверки WebSocket.";
    readonly WS_HANDSHAKE_FAILED: "Сервер не установил соединение WebSocket.";
    readonly WS_AUTHENTICATION_REQUIRED: "Сервер требует входа для соединения WebSocket.";
    readonly WS_PERMISSION_DENIED: "Сервер запретил соединение WebSocket.";
    readonly WS_HEARTBEAT_FAILED: "Ответ на проверку WebSocket не получен, или сервер закрыл соединение с ошибкой.";
    readonly WS_RESPONSE_LIMIT: "Ответ по WebSocket превысил пределы размера или числа сообщений.";
    readonly WS_TRANSPORT_ERROR: "Соединение WebSocket оборвалось.";
    readonly WS_SESSION_CHANGED: "При соединении WebSocket сервер сменил cookie сессии.";
    readonly WS_DISPOSAL_FAILED: "Не удалось убедиться, что соединение WebSocket закрыто с этой стороны.";
};
export type WebSocketHeartbeatErrorCode = keyof typeof ERROR_MESSAGES;
/** Uses only the pinned library's public constructor and public events/methods. */
export declare const defaultWebSocketFactory: WebSocketFactory;
/** Fixed diagnostics and canonical observations; arbitrary upstream details are never copied. */
export declare class WebSocketHeartbeatError extends WsHcmApiError {
    readonly errorCode: WebSocketHeartbeatErrorCode;
    readonly hint: string;
    readonly receipt: Readonly<WebSocketHeartbeatReceipt>;
    constructor(errorCode: WebSocketHeartbeatErrorCode, receipt: WebSocketHeartbeatReceipt, options?: {
        requestSent?: false;
    });
}
/** Fail before HTTP bootstrap when a synthetic HTTP connector has no matching socket connector. */
export declare function assertWebSocketAvailable(factory: WebSocketFactory | undefined): asserts factory is WebSocketFactory;
/** A single bounded stock heartbeat; no app payloads, LDS tags, reconnects or delivery guarantees. */
export declare function webSocketHeartbeat(http: HttpTransport, factory: WebSocketFactory | undefined, input?: WebSocketHeartbeatInput): Promise<WebSocketHeartbeatData>;
export {};
