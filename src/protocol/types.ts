import type { EventEmitter } from "node:events";

/** Public socket surface used by a trusted in-process connector; no ws implementation types leak. */
export interface WebSocketConnection extends EventEmitter {
  readonly readyState: number;
  send(data: string, callback: (error?: Error) => void): void;
  pong(data: Uint8Array, mask: boolean, callback: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}
/** Fixed adapter policy. Headers contain the caller-owned cookie and must remain private. */
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
/** Programmatic construction option, never an operation argument or JSON connection setting. */
export type WebSocketFactory = (
  url: string,
  options: WebSocketConnectOptions,
) => WebSocketConnection;

export interface WebSocketHeartbeatInput {
  /** WS phase deadline only, integer 250..10000 milliseconds. Default: 5000. */
  readonly timeoutMs?: number;
}
/** Bounded observations; neither close delivery nor business-message delivery is inferred. */
export interface WebSocketHeartbeatReceipt {
  readonly route: "/services/main_ws_service";
  readonly phase: "preflight" | "connecting" | "heartbeat" | "closing" | "disposed";
  readonly handshakeValidated: boolean;
  /** Observed upgrade/rejection HTTP status; absence means no HTTP response was observed. */
  readonly httpStatus?: number;
  readonly heartbeatWritten: boolean;
  readonly heartbeatObserved: boolean;
  readonly closeRequested: boolean;
  readonly peerCloseObserved: boolean;
  readonly peerEofObserved: boolean;
  readonly libraryCloseCode?: number;
  readonly closeWriteVerified: false;
  readonly localSocketDisposed: boolean;
  readonly forcedLocalTermination: boolean;
  readonly warning?: "PEER_CLOSE_ACK_NOT_OBSERVED";
  readonly durationMs: number;
  readonly limits: {
    readonly timeoutMs: number;
    readonly maxMessageBytes: number;
    readonly maxMessages: number;
    readonly maxTotalBytes: number;
  };
  readonly counts: { readonly messages: number; readonly receivedBytes: number };
}
export interface WebSocketHeartbeatData extends WebSocketHeartbeatReceipt {
  readonly handshakeValidated: true;
  readonly heartbeatObserved: true;
}

/** Lossless decimal identifier. Never convert it through JavaScript `number`. */
export type DecimalId = string;
/** Lossless async task identifier. Server 1171 may serialize it as decimal or `0x` hexadecimal. */
export type TrackingId = string;

/** Basic-auth credentials. Values are never included in normalized error messages. */
export interface Credentials {
  username: string;
  password: string;
}

/** Construction options shared by all client/session transports. */
export interface WsHcmClientOptions {
  /** HTTP(S) server root. Defaults to `http://localhost:8088/`; embedded credentials are rejected. */
  baseUrl?: string;
  /** Optional Basic-auth credentials used by protected bootstrap/routes. */
  auth?: Credentials;
  /** Per-request timeout in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Hard response-body byte limit, including binary streams. Defaults to 16 MiB. */
  maxResponseBytes?: number;
  /** Custom Fetch implementation, primarily for tests or controlled instrumentation. */
  fetch?: typeof globalThis.fetch;
  /** Explicit trusted WS connector; required for heartbeat when a custom fetch is supplied. */
  webSocketFactory?: WebSocketFactory;
}

/** Per-call cancellation and timeout overrides. */
export interface RequestOptions {
  /** External cancellation signal composed with the request timeout. */
  signal?: AbortSignal;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
}

/** Buffered successful response with both parsed data and exact body bytes. */
export interface WsHcmResponse<T> {
  readonly status: number;
  readonly headers: Headers;
  readonly data: T;
  readonly rawBody: Uint8Array;
}

/**
 * Successful streaming response.
 * The caller owns `body` and must consume or cancel it; the library never buffers it implicitly.
 */
export class WsHcmBinaryResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;

  constructor(response: Response) {
    this.status = response.status;
    this.headers = response.headers;
    this.body = response.body;
  }
}
