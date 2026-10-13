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
  WebSocketHeartbeatReceipt,
} from "./types.js";

const ROUTE = "/services/main_ws_service";
const MAX_MESSAGE_BYTES = 4096;
const MAX_MESSAGES = 16;
const MAX_TOTAL_BYTES = 16384;
const DISPOSAL_MS = 250;

const ERROR_MESSAGES = {
  WS_UNAVAILABLE:
    "Соединение WebSocket недоступно: нет webSocketFactory или собственной веб-сессии.",
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

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}
function canonicalReceipt(value: WebSocketHeartbeatReceipt): WebSocketHeartbeatReceipt {
  const phase = ["preflight", "connecting", "heartbeat", "closing", "disposed"].includes(
    value.phase,
  )
    ? value.phase
    : "preflight";
  const libraryCloseCode = boundedInteger(value.libraryCloseCode, 1000, 4999, 0);
  const httpStatus = boundedInteger(value.httpStatus, 100, 599, 0);
  return Object.freeze({
    route: ROUTE,
    phase,
    handshakeValidated: value.handshakeValidated === true,
    ...(httpStatus === 0 ? {} : { httpStatus }),
    heartbeatWritten: value.heartbeatWritten === true,
    heartbeatObserved: value.heartbeatObserved === true,
    closeRequested: value.closeRequested === true,
    peerCloseObserved: value.peerCloseObserved === true,
    peerEofObserved: value.peerEofObserved === true,
    ...(libraryCloseCode === 0 ? {} : { libraryCloseCode }),
    closeWriteVerified: false,
    localSocketDisposed: value.localSocketDisposed === true,
    forcedLocalTermination: value.forcedLocalTermination === true,
    ...(value.warning === "PEER_CLOSE_ACK_NOT_OBSERVED" ? { warning: value.warning } : {}),
    durationMs: boundedInteger(value.durationMs, 0, 60000, 0),
    limits: Object.freeze({
      timeoutMs: boundedInteger(value.limits?.timeoutMs, 250, 10000, 5000),
      maxMessageBytes: MAX_MESSAGE_BYTES,
      maxMessages: MAX_MESSAGES,
      maxTotalBytes: MAX_TOTAL_BYTES,
    }),
    counts: Object.freeze({
      messages: boundedInteger(value.counts?.messages, 0, MAX_MESSAGES + 1, 0),
      receivedBytes: boundedInteger(
        value.counts?.receivedBytes,
        0,
        MAX_TOTAL_BYTES + MAX_MESSAGE_BYTES,
        0,
      ),
    }),
  });
}

/** Использует лишь публичный конструктор закреплённой библиотеки, её публичные события и методы. */
export const defaultWebSocketFactory: WebSocketFactory = (url, options) =>
  new WebSocket(url, { ...options, headers: { ...options.headers } });

/** Фиксированная диагностика и канонические наблюдения; произвольные подробности не копируются. */
export class WebSocketHeartbeatError extends WsHcmApiError {
  readonly errorCode: WebSocketHeartbeatErrorCode;
  readonly hint: string;
  readonly receipt: Readonly<WebSocketHeartbeatReceipt>;

  constructor(
    errorCode: WebSocketHeartbeatErrorCode,
    receipt: WebSocketHeartbeatReceipt,
    options: { requestSent?: false } = {},
  ) {
    // Потеря WebSocket не зависит от контекста HTTP, которым клиент всё ещё владеет. Не помечать
    // её как сбой транспорта HTTP и не мешать точной очистке LDS и выхода.
    const code = Object.hasOwn(ERROR_MESSAGES, errorCode) ? errorCode : "WS_TRANSPORT_ERROR";
    super("protocol", ERROR_MESSAGES[code], {
      operation: "WebSocketHeartbeat",
      ...(options.requestSent === undefined ? {} : { requestSent: false }),
    });
    this.name = "WebSocketHeartbeatError";
    this.errorCode = code;
    this.hint =
      code === "WS_UNAVAILABLE"
        ? "При custom fetch нужно явно передать trusted webSocketFactory и открыть собственный WebSession; сетевой fallback отключён."
        : code === "WS_AUTHENTICATION_REQUIRED"
          ? "Проверить аутентификацию и срок действия собственного web-контекста; автоматический повтор отключён."
          : code === "WS_PERMISSION_DENIED"
            ? "Проверить права текущего пользователя на штатный WebSocket сервис; автоматический повтор отключён."
            : code === "WS_INVALID_INPUT"
              ? "timeoutMs должен быть целым числом 250..10000; другие параметры не поддерживаются."
              : "Проверить ответ heartbeat; автоматический повтор не выполняется.";
    this.receipt = canonicalReceipt(receipt);
  }
}

function emptyReceipt(timeoutMs = 5000): WebSocketHeartbeatReceipt {
  return {
    route: ROUTE,
    phase: "preflight",
    handshakeValidated: false,
    heartbeatWritten: false,
    heartbeatObserved: false,
    closeRequested: false,
    peerCloseObserved: false,
    peerEofObserved: false,
    closeWriteVerified: false,
    localSocketDisposed: true,
    forcedLocalTermination: false,
    durationMs: 0,
    limits: {
      timeoutMs,
      maxMessageBytes: MAX_MESSAGE_BYTES,
      maxMessages: MAX_MESSAGES,
      maxTotalBytes: MAX_TOTAL_BYTES,
    },
    counts: { messages: 0, receivedBytes: 0 },
  };
}

/** Отказать до начальной загрузки HTTP, если у подставного коннектора HTTP нет парного сокета. */
export function assertWebSocketAvailable(
  factory: WebSocketFactory | undefined,
): asserts factory is WebSocketFactory {
  if (typeof factory !== "function")
    throw new WebSocketHeartbeatError("WS_UNAVAILABLE", emptyReceipt(), {
      requestSent: false,
    });
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
    throw new WebSocketHeartbeatError("WS_INVALID_INPUT", emptyReceipt(), {
      requestSent: false,
    });
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
  if (cookie === undefined || cookie.length > 1024 || /[\x00-\x20\x7f-\uffff;,"\\]/.test(cookie))
    throw new WebSocketHeartbeatError("WS_UNAVAILABLE", emptyReceipt(timeoutMs), {
      requestSent: false,
    });
  http.assertOpen();
  const url = new URL(ROUTE.replace(/^\/+/, ""), http.baseUrl);
  const origin = url.origin;
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const started = performance.now();
  const state = {
    ...emptyReceipt(timeoutMs),
    phase: "connecting" as WebSocketHeartbeatReceipt["phase"],
    localSocketDisposed: false,
  };
  let messages = 0;
  let receivedBytes = 0;
  let events = 0;
  const receipt = (): WebSocketHeartbeatReceipt => ({
    ...state,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    counts: { messages, receivedBytes },
  });

  return new Promise<WebSocketHeartbeatData>((resolve, reject) => {
    let ws: WebSocketConnection | undefined;
    let responseSocket: Socket | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let disposal: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    let terminating = false;
    let failure: { code: WebSocketHeartbeatErrorCode; message: string } | undefined;

    function settle(): void {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(disposal);
      responseSocket?.off("end", onEnd);
      responseSocket?.off("error", onSocketError);
      state.phase = "disposed";
      if (!state.localSocketDisposed && !failure)
        failure = {
          code: "WS_DISPOSAL_FAILED",
          message: "Закрытие локального сокета WebSocket не зафиксировано",
        };
      if (failure) reject(new WebSocketHeartbeatError(failure.code, receipt()));
      else if (state.handshakeValidated && state.heartbeatWritten && state.heartbeatObserved)
        resolve(
          Object.freeze({
            ...canonicalReceipt(receipt()),
            handshakeValidated: true,
            heartbeatObserved: true,
          }),
        );
      else reject(new WebSocketHeartbeatError("WS_HEARTBEAT_FAILED", receipt()));
    }
    function terminate(): void {
      if (finished || terminating) return;
      terminating = true;
      state.forcedLocalTermination = true;
      disposal = setTimeout(() => {
        state.localSocketDisposed = ws?.readyState === WebSocket.CLOSED;
        settle();
      }, DISPOSAL_MS);
      try {
        ws?.terminate();
      } catch {
        /* Всё равно дождаться ограниченного завершающего наблюдения. */
      }
      if (!ws) {
        state.localSocketDisposed = true;
        settle();
      }
    }
    function fail(code: WebSocketHeartbeatErrorCode, message: string): void {
      failure ??= { code, message };
      terminate();
    }
    function onEnd(): void {
      state.peerEofObserved = true;
    }
    function onSocketError(): void {
      if (!finished) fail("WS_TRANSPORT_ERROR", "Сбой транспорта WebSocket");
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
        fail("WS_RESPONSE_LIMIT", "Ответ WebSocket превысил заданные пределы");
        return false;
      }
      return true;
    }
    function requestClose(): void {
      if (
        state.closeRequested ||
        !state.heartbeatWritten ||
        !state.heartbeatObserved ||
        failure ||
        finished
      )
        return;
      state.phase = "closing";
      state.closeRequested = true;
      try {
        ws!.close(1000);
      } catch {
        fail("WS_TRANSPORT_ERROR", "Не удалось отправить запрос закрытия WebSocket");
      }
      // У close() нет публичного обратного вызова записи. Сброс по этому вызову не выводить.
    }

    deadline = setTimeout(() => {
      if (state.heartbeatWritten && state.heartbeatObserved && state.closeRequested) {
        state.warning = "PEER_CLOSE_ACK_NOT_OBSERVED";
        terminate();
      } else fail("WS_HEARTBEAT_FAILED", "Истёк срок ожидания штатного heartbeat");
    }, timeoutMs);
    try {
      ws = factory(
        url.href,
        Object.freeze({
          headers: Object.freeze({ Cookie: `SessionID=${cookie}` }),
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
      fail("WS_HANDSHAKE_FAILED", "Соединение WebSocket не создано");
      return;
    }

    // Оставить обработчик error даже после ограниченного освобождения: собственный коннектор
    // может выдать позднюю ошибку, и она не должна ни раскрыть секреты, ни уронить вызывающего.
    ws.on("error", (error: unknown) => {
      if (finished || (terminating && failure)) return;
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const limited =
        code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH" ||
        code === "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH" ||
        code === "WS_ERR_TOO_MANY_BUFFERED_PARTS";
      fail(limited ? "WS_RESPONSE_LIMIT" : "WS_TRANSPORT_ERROR", "Сбой соединения WebSocket");
    });
    ws.on("upgrade", (response: IncomingMessage) => {
      const status = boundedInteger(response.statusCode, 100, 599, 0);
      if (status !== 0) state.httpStatus = status;
      responseSocket = response.socket;
      responseSocket.on("end", onEnd);
      responseSocket.on("error", onSocketError);
      const cookies = response.headers["set-cookie"];
      if (cookies) {
        const candidate = new SessionCookie();
        for (const value of cookies) candidate.capture(new Headers({ "set-cookie": value }));
        if (cookies.some((value) => /^\s*SessionID\s*=/i.test(value)) && candidate.value !== cookie)
          fail("WS_SESSION_CHANGED", "Handshake WebSocket изменил cookie своей сессии");
      }
    });
    ws.on("unexpected-response", (request: ClientRequest, response: IncomingMessage) => {
      const status = boundedInteger(response.statusCode, 100, 599, 0);
      if (status !== 0) state.httpStatus = status;
      fail(
        status === 401
          ? "WS_AUTHENTICATION_REQUIRED"
          : status === 403
            ? "WS_PERMISSION_DENIED"
            : "WS_HANDSHAKE_FAILED",
        "Штатный handshake WebSocket отклонён",
      );
      // Регистрация этого публичного события отключает штатное прерывание запроса в ws.
      response.destroy();
      request.destroy();
    });
    ws.on("open", () => {
      if (failure || terminating || finished) return;
      state.handshakeValidated = true;
      state.phase = "heartbeat";
      try {
        ws!.send("$hbt", (error) => {
          if (error) {
            if (!terminating && !finished)
              fail("WS_TRANSPORT_ERROR", "Не удалось отправить heartbeat");
            return;
          }
          state.heartbeatWritten = true;
          requestClose();
        });
      } catch {
        fail("WS_TRANSPORT_ERROR", "Не удалось отправить heartbeat");
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
        state.heartbeatObserved = true;
        requestClose();
      }
    });
    ws.on("ping", (data: Uint8Array) => {
      if (!account(data.byteLength)) return;
      try {
        ws!.pong(data, true, (error) => {
          if (error && !terminating && !finished)
            fail("WS_TRANSPORT_ERROR", "Не удалось отправить pong WebSocket");
        });
      } catch {
        fail("WS_TRANSPORT_ERROR", "Не удалось отправить pong WebSocket");
      }
    });
    ws.on("pong", (data: Uint8Array) => {
      account(data.byteLength);
    });
    ws.on("close", (code: number) => {
      state.libraryCloseCode = code;
      state.localSocketDisposed = ws?.readyState === WebSocket.CLOSED;
      // 1006 — служебное значение библиотеки, а не кадр Close от другой стороны.
      state.peerCloseObserved = code !== 1006;
      if (!failure && !terminating && code === 1006) {
        if (
          state.peerEofObserved &&
          state.heartbeatWritten &&
          state.heartbeatObserved &&
          state.closeRequested
        )
          state.warning = "PEER_CLOSE_ACK_NOT_OBSERVED";
        else
          failure = {
            code: "WS_TRANSPORT_ERROR",
            message: "WebSocket завершился без ожидаемых heartbeat и закрытия",
          };
      }
      if (!failure && code !== 1006 && code !== 1000 && code !== 1005)
        failure = {
          code: "WS_HEARTBEAT_FAILED",
          message: "Другая сторона WebSocket сообщила о неуспешном закрытии",
        };
      settle();
    });
  });
}
