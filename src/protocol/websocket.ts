import type { ClientRequest, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import WebSocket from "ws";
import { WsHcmApiError } from "./error.js";
import { HttpTransport, SessionCookie } from "./transport.js";
import type {
  WebSocketConnection,
  WebSocketFactory,
  WebSocketHeartbeatData,
  WebSocketHeartbeatInput,
} from "./types.js";

const ROUTE = "/services/main_ws_service";
const MAX_MESSAGE_BYTES = 4096;
const MAX_MESSAGES = 16;
const MAX_TOTAL_BYTES = 16384;
const DISPOSAL_MS = 250;

const ERROR_MESSAGES = {
  WS_UNAVAILABLE:
    "Соединение WebSocket недоступно: нет webSocketFactory или собственной сессии web.",
  WS_INVALID_INPUT: "Неверные аргументы проверки WebSocket.",
  WS_HANDSHAKE_FAILED: "Сервер не установил соединение WebSocket.",
  WS_AUTHENTICATION_REQUIRED: "Сервер требует входа для соединения WebSocket.",
  WS_PERMISSION_DENIED: "Сервер запретил соединение WebSocket.",
  WS_HEARTBEAT_FAILED:
    "Ответ на проверку WebSocket не получен, или сервер закрыл соединение с ошибкой.",
  WS_RESPONSE_LIMIT: "Ответ по WebSocket превысил пределы размера или числа сообщений.",
  WS_TRANSPORT_ERROR: "Соединение WebSocket оборвалось.",
  WS_SESSION_CHANGED: "При соединении WebSocket сервер сменил cookie сессии.",
  WS_DISPOSAL_FAILED: "Не удалось убедиться, что соединение WebSocket закрыто с этой стороны.",
} as const;
export type WebSocketHeartbeatErrorCode = keyof typeof ERROR_MESSAGES;

const ERROR_HINTS: Partial<Record<WebSocketHeartbeatErrorCode, string>> = {
  WS_UNAVAILABLE:
    "При своём fetch нужно явно передать webSocketFactory и открыть собственную сессию web.",
  WS_AUTHENTICATION_REQUIRED: "Проверить аутентификацию и срок действия сессии web.",
  WS_PERMISSION_DENIED: "Проверить права пользователя на штатную службу WebSocket.",
  WS_INVALID_INPUT: "timeoutMs должен быть целым числом от 250 до 10000.",
};

type Phase = "preflight" | "connecting" | "heartbeat" | "closing";
const PHASES = new Set<Phase>(["preflight", "connecting", "heartbeat", "closing"]);

/** Использует лишь публичный конструктор закреплённой библиотеки, её публичные события и методы. */
export const defaultWebSocketFactory: WebSocketFactory = (url, options) =>
  new WebSocket(url, { ...options, headers: { ...options.headers } });

/** Ошибка проверки WebSocket с фиксированным кодом и компактной диагностикой. */
export class WebSocketHeartbeatError extends WsHcmApiError {
  readonly errorCode: WebSocketHeartbeatErrorCode;
  readonly hint: string;

  constructor(
    errorCode: WebSocketHeartbeatErrorCode,
    options: {
      phase?: Phase;
      handshakeValidated?: boolean;
      heartbeatObserved?: boolean;
      status?: number;
      closeCode?: number;
      requestSent?: false;
    } = {},
  ) {
    // Потеря WebSocket не зависит от контекста HTTP, которым клиент всё ещё владеет. Не помечать
    // её как сбой транспорта HTTP и не мешать точной очистке LDS и выхода.
    const code = Object.hasOwn(ERROR_MESSAGES, errorCode) ? errorCode : "WS_TRANSPORT_ERROR";
    const safe = options && typeof options === "object" ? options : {};
    const status =
      typeof safe.status === "number" &&
      Number.isInteger(safe.status) &&
      safe.status >= 100 &&
      safe.status <= 599
        ? safe.status
        : undefined;
    const closeCode =
      typeof safe.closeCode === "number" &&
      Number.isInteger(safe.closeCode) &&
      safe.closeCode >= 1000 &&
      safe.closeCode <= 4999
        ? safe.closeCode
        : undefined;
    const phase: Phase =
      typeof safe.phase === "string" && PHASES.has(safe.phase as Phase)
        ? (safe.phase as Phase)
        : "preflight";
    const details = Object.freeze({
      phase,
      handshakeValidated: safe.handshakeValidated === true,
      heartbeatObserved: safe.heartbeatObserved === true,
      ...(status === undefined ? {} : { status }),
      ...(closeCode === undefined ? {} : { closeCode }),
    });
    super("protocol", ERROR_MESSAGES[code], {
      operation: "WebSocketHeartbeat",
      ...(status === undefined ? {} : { status }),
      details,
      ...(safe.requestSent === false ? { requestSent: false } : {}),
    });
    this.name = "WebSocketHeartbeatError";
    this.errorCode = code;
    this.hint = ERROR_HINTS[code] ?? "Проверить доступность службы WebSocket и повторить проверку.";
  }
}

/** Отказать до начальной загрузки HTTP, если у подставного коннектора HTTP нет парного сокета. */
export function assertWebSocketAvailable(
  factory: WebSocketFactory | undefined,
): asserts factory is WebSocketFactory {
  if (typeof factory !== "function")
    throw new WebSocketHeartbeatError("WS_UNAVAILABLE", { requestSent: false });
}

/** Вызывающие протокол напрямую получают тот же ограниченный контракт ввода, что и шлюз. */
function timeout(input: WebSocketHeartbeatInput): number {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "timeoutMs") ||
    (input.timeoutMs !== undefined &&
      (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 250 || input.timeoutMs > 10000))
  )
    throw new WebSocketHeartbeatError("WS_INVALID_INPUT", { requestSent: false });
  return input.timeoutMs ?? 5000;
}

/**
 * Один ограниченный штатный heartbeat: без payload приложения, тегов LDS, переподключений
 * и гарантий доставки.
 */
export async function webSocketHeartbeat(
  http: HttpTransport,
  factory: WebSocketFactory | undefined,
  input: WebSocketHeartbeatInput = {},
): Promise<WebSocketHeartbeatData> {
  assertWebSocketAvailable(factory);
  const timeoutMs = timeout(input);
  const cookie = http.cookie.value;
  const cookieHeader = http.cookie.header();
  if (
    cookie === undefined ||
    cookieHeader === undefined ||
    cookie.length > 1024 ||
    /[\x00-\x20\x7f-\uffff;,"\\]/.test(cookie) ||
    cookieHeader.length > 4096 ||
    /[\x00-\x1f\x7f-\uffff]/.test(cookieHeader)
  )
    throw new WebSocketHeartbeatError("WS_UNAVAILABLE", { requestSent: false });
  http.assertOpen();
  const url = new URL(ROUTE.replace(/^\/+/, ""), http.baseUrl);
  const origin = url.origin;
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const started = performance.now();

  return new Promise<WebSocketHeartbeatData>((resolve, reject) => {
    let ws: WebSocketConnection | undefined;
    let responseSocket: Socket | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let disposal: ReturnType<typeof setTimeout> | undefined;
    let phase: Phase = "connecting";
    let handshakeValidated = false;
    let heartbeatWritten = false;
    let heartbeatObserved = false;
    let closeRequested = false;
    let peerEof = false;
    let disposed = false;
    let httpStatus: number | undefined;
    let closeCode: number | undefined;
    let warning: "PEER_CLOSE_ACK_NOT_OBSERVED" | undefined;
    let messages = 0;
    let receivedBytes = 0;
    let events = 0;
    let finished = false;
    let terminating = false;
    let failure: WebSocketHeartbeatErrorCode | undefined;

    function settle(): void {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(disposal);
      responseSocket?.off("end", onEnd);
      responseSocket?.off("error", onSocketError);
      if (!disposed && !failure) failure = "WS_DISPOSAL_FAILED";
      if (failure) {
        reject(
          new WebSocketHeartbeatError(failure, {
            phase,
            handshakeValidated,
            heartbeatObserved,
            ...(httpStatus === undefined ? {} : { status: httpStatus }),
            ...(closeCode === undefined ? {} : { closeCode }),
          }),
        );
      } else if (handshakeValidated && heartbeatWritten && heartbeatObserved) {
        resolve(
          Object.freeze({
            route: ROUTE,
            handshakeValidated: true,
            heartbeatObserved: true,
            durationMs: Math.max(0, Math.round(performance.now() - started)),
            ...(closeCode === undefined ? {} : { closeCode }),
            ...(warning === undefined ? {} : { warning }),
          }),
        );
      } else {
        reject(
          new WebSocketHeartbeatError("WS_HEARTBEAT_FAILED", {
            phase,
            handshakeValidated,
            heartbeatObserved,
            ...(httpStatus === undefined ? {} : { status: httpStatus }),
            ...(closeCode === undefined ? {} : { closeCode }),
          }),
        );
      }
    }
    function terminate(): void {
      if (finished || terminating) return;
      terminating = true;
      disposal = setTimeout(() => {
        disposed = ws?.readyState === WebSocket.CLOSED;
        settle();
      }, DISPOSAL_MS);
      try {
        ws?.terminate();
      } catch {
        /* Всё равно дождаться ограниченного завершающего наблюдения. */
      }
      if (!ws) {
        disposed = true;
        settle();
      }
    }
    function fail(code: WebSocketHeartbeatErrorCode): void {
      failure ??= code;
      terminate();
    }
    function onEnd(): void {
      peerEof = true;
    }
    function onSocketError(): void {
      if (!finished) fail("WS_TRANSPORT_ERROR");
    }
    function account(bytes: number, message = false): boolean {
      if (failure || terminating || finished) return false;
      receivedBytes += bytes;
      events++;
      if (message) messages++;
      if (
        bytes > MAX_MESSAGE_BYTES ||
        receivedBytes > MAX_TOTAL_BYTES ||
        messages > MAX_MESSAGES ||
        events > 32
      ) {
        fail("WS_RESPONSE_LIMIT");
        return false;
      }
      return true;
    }
    function requestClose(): void {
      if (closeRequested || !heartbeatWritten || !heartbeatObserved || failure || finished) return;
      phase = "closing";
      closeRequested = true;
      try {
        ws!.close(1000);
      } catch {
        fail("WS_TRANSPORT_ERROR");
      }
    }

    deadline = setTimeout(() => {
      if (heartbeatWritten && heartbeatObserved && closeRequested) {
        warning = "PEER_CLOSE_ACK_NOT_OBSERVED";
        terminate();
      } else fail("WS_HEARTBEAT_FAILED");
    }, timeoutMs);
    try {
      ws = factory(
        url.href,
        Object.freeze({
          headers: Object.freeze({ Cookie: cookieHeader }),
          origin,
          handshakeTimeout: timeoutMs,
          closeTimeout: timeoutMs,
          maxPayload: MAX_MESSAGE_BYTES,
          maxFragments: 16,
          maxBufferedChunks: 32,
          maxHeaderSize: 8192,
          protocolVersion: 13,
          autoPong: false,
          perMessageDeflate: false,
          followRedirects: false,
          skipUTF8Validation: false,
        }),
      );
    } catch {
      fail("WS_HANDSHAKE_FAILED");
      return;
    }

    // Оставить обработчик error даже после освобождения: поздняя ошибка сокета не уронит процесс.
    ws.on("error", (error: unknown) => {
      if (finished || (terminating && failure)) return;
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const limited =
        code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH" ||
        code === "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH" ||
        code === "WS_ERR_TOO_MANY_BUFFERED_PARTS";
      fail(limited ? "WS_RESPONSE_LIMIT" : "WS_TRANSPORT_ERROR");
    });
    ws.on("upgrade", (response: IncomingMessage) => {
      if (finished) return;
      responseSocket = response.socket;
      responseSocket.on("end", onEnd);
      responseSocket.on("error", onSocketError);
      const cookies = response.headers["set-cookie"];
      if (cookies) {
        const candidate = new SessionCookie();
        for (const value of cookies) candidate.capture(new Headers({ "set-cookie": value }));
        if (cookies.some((value) => /^\s*SessionID\s*=/i.test(value)) && candidate.value !== cookie)
          fail("WS_SESSION_CHANGED");
      }
    });
    ws.on("unexpected-response", (request: ClientRequest, response: IncomingMessage) => {
      httpStatus = response.statusCode;
      fail(
        httpStatus === 401
          ? "WS_AUTHENTICATION_REQUIRED"
          : httpStatus === 403
            ? "WS_PERMISSION_DENIED"
            : "WS_HANDSHAKE_FAILED",
      );
      // Регистрация этого события отключает штатное прерывание запроса в ws.
      response.destroy();
      request.destroy();
    });
    ws.on("open", () => {
      if (failure || terminating || finished) return;
      handshakeValidated = true;
      phase = "heartbeat";
      try {
        ws!.send("$hbt", (error) => {
          if (error) {
            if (!terminating && !finished) fail("WS_TRANSPORT_ERROR");
            return;
          }
          heartbeatWritten = true;
          requestClose();
        });
      } catch {
        fail("WS_TRANSPORT_ERROR");
      }
    });
    ws.on("message", (data: Uint8Array | ArrayBuffer | Uint8Array[], binary: boolean) => {
      const length = Array.isArray(data)
        ? data.reduce((total, part) => total + part.byteLength, 0)
        : data.byteLength;
      if (!account(length, true) || binary) return;
      const value = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      if (value.equals(Buffer.from("$ok"))) {
        heartbeatObserved = true;
        requestClose();
      }
    });
    ws.on("ping", (data: Uint8Array) => {
      if (!account(data.byteLength)) return;
      try {
        ws!.pong(data, true, (error) => {
          if (error && !terminating && !finished) fail("WS_TRANSPORT_ERROR");
        });
      } catch {
        fail("WS_TRANSPORT_ERROR");
      }
    });
    ws.on("pong", (data: Uint8Array) => {
      account(data.byteLength);
    });
    ws.on("close", (code: number) => {
      // 1006 — служебный код библиотеки ws без кадра Close от сервера.
      closeCode = code === 1006 ? undefined : code;
      disposed = ws?.readyState === WebSocket.CLOSED;
      if (!failure && !terminating && code === 1006) {
        if (peerEof && heartbeatWritten && heartbeatObserved && closeRequested)
          warning = "PEER_CLOSE_ACK_NOT_OBSERVED";
        else failure = "WS_TRANSPORT_ERROR";
      }
      if (!failure && code !== 1006 && code !== 1000 && code !== 1005)
        failure = "WS_HEARTBEAT_FAILED";
      settle();
    });
  });
}
