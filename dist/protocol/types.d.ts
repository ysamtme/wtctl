import type { EventEmitter } from "node:events";
import type { RawXml, XmlObject } from "./xml.js";
/** Публичный интерфейс сокета для доверенного коннектора в процессе; типы ws наружу не попадают. */
export interface WebSocketConnection extends EventEmitter {
    readonly readyState: number;
    send(data: string, callback: (error?: Error) => void): void;
    pong(data: Uint8Array, mask: boolean, callback: (error?: Error) => void): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
}
/** Фиксированные правила адаптера. Заголовки содержат cookie вызывающего и должны быть закрыты. */
export interface WebSocketConnectOptions {
    readonly headers: Readonly<Record<string, string>>;
    readonly origin: string;
    readonly handshakeTimeout: number;
    readonly closeTimeout: number;
    readonly maxPayload: number;
    readonly maxFragments: number;
    readonly maxBufferedChunks: number;
    readonly maxHeaderSize: number;
    readonly protocolVersion: 13;
    readonly autoPong: false;
    readonly perMessageDeflate: false;
    readonly followRedirects: false;
    readonly skipUTF8Validation: false;
}
/** Параметр программного создания; не аргумент операции и не поле JSON подключения. */
export type WebSocketFactory = (url: string, options: WebSocketConnectOptions) => WebSocketConnection;
/** Аргументы heartbeat. */
export interface WebSocketHeartbeatInput {
    /** Срок проверки WebSocket, 250–10000 мс; по умолчанию 5000. */
    readonly timeoutMs?: number;
}
/** Ответ проверки WebSocket: подключение принято, получен ответ $ok. */
export interface WebSocketHeartbeatData {
    /** Адрес службы WebSocket на сервере. */
    readonly route: "/services/main_ws_service";
    /** Сервер принял подключение WebSocket. */
    readonly handshakeValidated: true;
    /** Получен ответ $ok. */
    readonly heartbeatObserved: true;
    /** Время проверки, мс. */
    readonly durationMs: number;
    /** Код закрытия WebSocket, если сервер прислал кадр закрытия. */
    readonly closeCode?: number;
    /** Ответа сервера на закрытие не было; $ok при этом получен. */
    readonly warning?: "PEER_CLOSE_ACK_NOT_OBSERVED";
}
/** Десятичный идентификатор без потерь. Никогда не пропускать через `number` JavaScript. */
export type DecimalId = string;
/** ID асинхронной задачи без потерь. Сервер 1171 может отдать его десятичным или как `0x`. */
export type TrackingId = string;
/** ID объекта строкой: `0x…` или десятичная запись. */
export type ObjectId = string;
/** Учётные данные Basic-auth. Значения не попадают в нормализованные сообщения ошибок. */
export interface Credentials {
    username: string;
    password: string;
}
/** Параметры создания, общие для всех транспортов клиента и сессий. */
export interface WsHcmClientOptions {
    /** Корень сервера HTTP(S), умолчание `http://localhost:8088/`; учётные данные в URL — отказ. */
    baseUrl?: string;
    /** Необязательные учётные данные Basic-auth для защищённой начальной загрузки и маршрутов. */
    auth?: Credentials;
    /** Предел времени запроса в миллисекундах. По умолчанию 30 секунд. */
    timeoutMs?: number;
    /** Жёсткий предел тела ответа в байтах, включая двоичные потоки. По умолчанию 16 МиБ. */
    maxResponseBytes?: number;
    /** Собственная реализация Fetch, главным образом для тестов или контролируемой инструментации. */
    fetch?: typeof globalThis.fetch;
    /** Явный доверенный коннектор WS; нужен для heartbeat, если задан собственный fetch. */
    webSocketFactory?: WebSocketFactory;
}
/** Отмена и предел времени для отдельного вызова. */
export interface RequestOptions {
    /** Внешний сигнал отмены вместе с пределом времени запроса. */
    signal?: AbortSignal;
    /** Предел времени вызова в миллисекундах. */
    timeoutMs?: number;
    /** Предел тела ответа этого вызова в байтах вместо предела клиента; Infinity — без предела. */
    maxResponseBytes?: number;
}
/** Буферизованный успешный ответ: разобранные данные и точные байты тела. */
export interface WsHcmResponse<T> {
    readonly status: number;
    readonly headers: Headers;
    readonly data: T;
    readonly rawBody: Uint8Array;
}
/**
 * Успешный потоковый ответ.
 * Вызывающий владеет `body` и обязан дочитать или отменить его; библиотека сама его не буферизует.
 */
export declare class WsHcmBinaryResponse {
    readonly status: number;
    readonly headers: Headers;
    readonly body: ReadableStream<Uint8Array> | null;
    constructor(response: Response);
}
/** Буферизованный разобранный результат SOAP с точными байтами ответа. */
export type SoapResult = WsHcmResponse<XmlObject>;
/** Точные данные внешней части MIME; строки и RawXml кодируются как UTF-8. */
export type SoapAttachment = RawXml | string | Uint8Array | ArrayBuffer;
