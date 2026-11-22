import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { once, EventEmitter } from "node:events";
import type { Socket } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { WsHcmClient, WebSocketHeartbeatError } from "../src/protocol/index.js";
import { HttpTransport } from "../src/protocol/transport.js";
import { webSocketHeartbeat } from "../src/protocol/websocket.js";
import { NativeGateway } from "../src/native/gateway.js";
import type { WebSocketConnection } from "../src/protocol/types.js";

type Mode =
  | "ack"
  | "fragmented"
  | "binary"
  | "eof-close"
  | "no-ack"
  | "reset-close"
  | "eof-before"
  | "bad-utf8"
  | "oversized"
  | "fragments"
  | "total-bytes"
  | "flood"
  | "ping-flood"
  | "silent"
  | "reject"
  | "reject-auth"
  | "reject-permission"
  | "bad-accept"
  | "rotate-cookie"
  | "expire-cookie";

/** Независимый эталонный сервер на малых кадрах. Декодируются только ожидаемые heartbeat и Close клиента. */
function rawFrames(socket: Socket, onFrame: (opcode: number, data: Buffer) => void) {
  let pending = Buffer.alloc(0);
  socket.on("data", (part) => {
    pending = Buffer.concat([pending, part]);
    while (pending.length >= 2) {
      const length = pending[1]! & 127;
      assert.ok(length < 126, "Only tiny stock client frames are expected");
      assert.equal(pending[1]! & 128, 128, "Client frames must be masked");
      if (pending.length < length + 6) return;
      const opcode = pending[0]! & 15;
      const data = Buffer.from(pending.subarray(6, length + 6));
      for (let index = 0; index < data.length; index++)
        data[index] = data[index]! ^ pending[2 + (index % 4)]!;
      pending = pending.subarray(length + 6);
      onFrame(opcode, data);
    }
  });
}
function frame(payload: Buffer | string, opcode = 1, final = true): Buffer {
  const body = Buffer.from(payload);
  const header =
    body.length < 126
      ? Buffer.from([(final ? 128 : 0) | opcode, body.length])
      : Buffer.from([(final ? 128 : 0) | opcode, 126, body.length >>> 8, body.length & 255]);
  return Buffer.concat([header, body]);
}

async function fixture(mode: Mode) {
  const sockets = new Set<Socket>();
  const observed = {
    heartbeats: 0,
    clientCloses: 0,
    paths: [] as string[],
    failures: [] as string[],
    upgrades: 0,
  };
  const wsServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  let base = "";
  const server = createServer((request, response) => {
    const path = new URL(request.url!, "http://fixture.invalid").pathname;
    observed.paths.push(path);
    if (path === "/mount/spxml_web/main.htm") {
      response.setHeader("set-cookie", "SessionID=owned-synthetic-cookie; Path=/");
      response.end("<html></html>");
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (part) => chunks.push(Buffer.from(part)));
    request.on("end", () => {
      if (path === "/mount/services/LdsService") {
        const body = Buffer.concat(chunks).toString();
        const open = body.includes("<OpenSession");
        response.setHeader("content-type", "application/soap+xml");
        const method = open ? "OpenSession" : "CloseSession";
        response.end(
          '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><' +
            method +
            'Response xmlns="http://www.datex-soft.com/">' +
            (open ? "<SessionID>9876543210123456</SessionID>" : "") +
            "</" +
            method +
            "Response></soap:Body></soap:Envelope>",
        );
      } else response.end();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, duplex, head) => {
    const socket = duplex as Socket;
    observed.upgrades++;
    try {
      assert.equal(request.url, "/mount/services/main_ws_service");
      assert.equal(request.headers.cookie, "SessionID=owned-synthetic-cookie");
      assert.equal(request.headers.origin, new URL(base).origin);
      assert.equal(request.headers.authorization, undefined);
      if (["reject", "reject-auth", "reject-permission"].includes(mode)) {
        const status =
          mode === "reject-auth"
            ? "401 Unauthorized"
            : mode === "reject-permission"
              ? "403 Forbidden"
              : "404 Not Found";
        const body = "private response body must not be consumed or published";
        socket.end(
          "HTTP/1.1 " +
            status +
            "\r\nContent-Length: " +
            Buffer.byteLength(body) +
            "\r\n\r\n" +
            body,
        );
        return;
      }
      if (mode === "bad-accept") {
        socket.end(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: invalid\r\n\r\n",
        );
        return;
      }
      if (["ack", "fragmented", "binary", "silent"].includes(mode)) {
        wsServer.handleUpgrade(request, socket, head, (ws) => {
          ws.on("error", () => {});
          ws.on("message", (data, binary) => {
            assert.equal(binary, false);
            assert.equal(data.toString(), "$hbt");
            observed.heartbeats++;
            if (mode === "ack") ws.send("$ok");
            else if (mode === "fragmented") {
              ws.send("$", { fin: false });
              ws.send("ok", { fin: true });
            } else if (mode === "binary") ws.send(Buffer.from("$ok"));
          });
        });
        return;
      }
      const accept = createHash("sha1")
        .update(request.headers["sec-websocket-key"]! + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      const cookie =
        mode === "rotate-cookie"
          ? "Set-Cookie: SessionID=foreign-secret-cookie\r\n"
          : mode === "expire-cookie"
            ? "Set-Cookie: SessionID=; Max-Age=0\r\n"
            : "";
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
          accept +
          "\r\n" +
          cookie +
          "\r\n",
      );
      rawFrames(socket, (opcode, data) => {
        if (opcode === 8) {
          observed.clientCloses++;
          if (mode === "eof-close") socket.end();
          else if (mode === "reset-close") socket.resetAndDestroy();
          return;
        }
        if (opcode === 10) return;
        assert.equal(opcode, 1);
        assert.equal(data.toString(), "$hbt");
        observed.heartbeats++;
        if (["eof-close", "no-ack", "reset-close"].includes(mode)) socket.write(frame("$ok"));
        else if (mode === "eof-before") socket.end();
        else if (mode === "bad-utf8") socket.write(frame(Buffer.from([255])));
        else if (mode === "oversized") socket.write(frame(Buffer.alloc(4097, 97)));
        else if (mode === "fragments")
          socket.write(
            Buffer.concat([
              frame("x", 1, false),
              ...Array.from({ length: 16 }, () => frame("x", 0, false)),
              frame("$ok", 0, true),
            ]),
          );
        else if (mode === "total-bytes")
          socket.write(
            Buffer.concat([
              ...Array.from({ length: 5 }, () => frame(Buffer.alloc(4096, 97))),
              frame("$ok"),
            ]),
          );
        else if (mode === "flood")
          socket.write(
            Buffer.concat([...Array.from({ length: 17 }, () => frame("x")), frame("$ok")]),
          );
        else if (mode === "ping-flood")
          socket.write(
            Buffer.concat([...Array.from({ length: 33 }, () => frame("", 9)), frame("$ok")]),
          );
      });
    } catch (error) {
      observed.failures.push(error instanceof Error ? error.message : "fixture error");
      socket.destroy();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/mount/`;
  const client = new WsHcmClient({
    baseUrl: base,
    auth: { username: "synthetic", password: "synthetic" },
    timeoutMs: 1000,
  });
  return {
    base,
    observed,
    client,
    async close() {
      client.close();
      for (const socket of sockets) socket.destroy();
      wsServer.close();
      await new Promise<void>((done) => server.close(() => done()));
      assert.deepEqual(observed.failures, []);
    },
  };
}

for (const mode of ["ack", "fragmented", "eof-close"] as const) {
  test(`настоящий heartbeat по фиксированному маршруту: ${mode} и честная сводка закрытия`, async () => {
    const f = await fixture(mode);
    try {
      const result = await f.client.withWebSession((session) =>
        session.heartbeat({ timeoutMs: 500 }),
      );
      assert.equal(result.route, "/services/main_ws_service");
      assert.equal(result.handshakeValidated, true);
      assert.equal(result.heartbeatObserved, true);
      assert.equal(typeof result.durationMs, "number");
      assert.ok(result.durationMs >= 0);
      assert.equal(result.closeCode, mode === "eof-close" ? undefined : 1000);
      assert.equal(
        result.warning,
        mode === "eof-close" ? "PEER_CLOSE_ACK_NOT_OBSERVED" : undefined,
      );
      assert.equal(f.observed.heartbeats, 1);
      assert.equal(f.observed.upgrades, 1);
      assert.deepEqual(f.observed.paths, [
        "/mount/spxml_web/main.htm",
        "/mount/services/LdsService",
        "/mount/services/LdsService",
        "/mount/spxml_web/logout.htm",
        "/mount/spxml_web/logout2.htm",
      ]);
    } finally {
      await f.close();
    }
  });
}

for (const [mode, code] of [
  ["binary", "WS_HEARTBEAT_FAILED"],
  ["silent", "WS_HEARTBEAT_FAILED"],
  ["eof-before", "WS_TRANSPORT_ERROR"],
  ["bad-utf8", "WS_TRANSPORT_ERROR"],
  ["oversized", "WS_RESPONSE_LIMIT"],
  ["fragments", "WS_RESPONSE_LIMIT"],
  ["total-bytes", "WS_RESPONSE_LIMIT"],
  ["flood", "WS_RESPONSE_LIMIT"],
  ["ping-flood", "WS_RESPONSE_LIMIT"],
  ["reject", "WS_HANDSHAKE_FAILED"],
  ["reject-auth", "WS_AUTHENTICATION_REQUIRED"],
  ["reject-permission", "WS_PERMISSION_DENIED"],
  ["bad-accept", "WS_TRANSPORT_ERROR"],
  ["rotate-cookie", "WS_SESSION_CHANGED"],
  ["expire-cookie", "WS_SESSION_CHANGED"],
] as const) {
  test(`сбой ${mode} сохраняет ограниченную сводку и допускает собственную очистку HTTP`, async () => {
    const f = await fixture(mode);
    try {
      await assert.rejects(
        f.client.withWebSession((session) => session.heartbeat({ timeoutMs: 250 })),
        (error: unknown) => {
          assert.ok(error instanceof WebSocketHeartbeatError);
          assert.equal(error.errorCode, code);
          assert.equal(error.details?.heartbeatObserved, false);
          assert.notEqual(error.details?.closeCode, 1006);
          if (["reject", "reject-auth", "reject-permission"].includes(mode)) {
            const expectedStatus =
              mode === "reject-auth" ? 401 : mode === "reject-permission" ? 403 : 404;
            assert.equal(error.status, expectedStatus);
            assert.equal(error.details?.status, expectedStatus);
            assert.equal(error.details?.handshakeValidated, false);
            assert.equal(f.observed.heartbeats, 0);
          } else {
            assert.equal(error.status, undefined);
            assert.equal(error.details?.status, undefined);
          }
          assert.equal(error.cleanupError, undefined);
          assert.ok(JSON.stringify(error).length < 1000);
          assert.doesNotMatch(
            JSON.stringify(error),
            /foreign-secret|owned-synthetic|127\.0\.0\.1|private response body/,
          );
          return true;
        },
      );
      assert.ok(f.observed.heartbeats <= 1);
      assert.equal(f.observed.upgrades, 1);
      assert.deepEqual(f.observed.paths.slice(-3), [
        "/mount/services/LdsService",
        "/mount/spxml_web/logout.htm",
        "/mount/spxml_web/logout2.htm",
      ]);
    } finally {
      await f.close();
    }
  });
}

test("принятый heartbeat без Close ACK завершается локально по истечении срока с явным предупреждением", async () => {
  const f = await fixture("no-ack");
  try {
    const result = await f.client.withWebSession((session) =>
      session.heartbeat({ timeoutMs: 250 }),
    );
    assert.equal(result.route, "/services/main_ws_service");
    assert.equal(result.handshakeValidated, true);
    assert.equal(result.heartbeatObserved, true);
    assert.equal(result.closeCode, undefined);
    assert.equal(result.warning, "PEER_CLOSE_ACK_NOT_OBSERVED");
    assert.equal(f.observed.clientCloses, 1);
    assert.equal(f.observed.heartbeats, 1);
    assert.deepEqual(f.observed.paths.slice(-3), [
      "/mount/services/LdsService",
      "/mount/spxml_web/logout.htm",
      "/mount/spxml_web/logout2.htm",
    ]);
  } finally {
    await f.close();
  }
});

test("сброс после принятого heartbeat остаётся сбоем и сохраняет факт приёма до собственной очистки HTTP", async () => {
  const f = await fixture("reset-close");
  try {
    await assert.rejects(
      f.client.withWebSession((session) => session.heartbeat({ timeoutMs: 500 })),
      (error: unknown) => {
        assert.ok(error instanceof WebSocketHeartbeatError);
        assert.equal(error.errorCode, "WS_TRANSPORT_ERROR");
        assert.equal(error.details?.handshakeValidated, true);
        assert.equal(error.details?.heartbeatObserved, true);
        assert.equal(error.cleanupError, undefined);
        return true;
      },
    );
    assert.deepEqual(f.observed.paths.slice(-3), [
      "/mount/services/LdsService",
      "/mount/spxml_web/logout.htm",
      "/mount/spxml_web/logout2.htm",
    ]);
  } finally {
    await f.close();
  }
});

test("защита от своего fetch без фабрики WS и проверка ввода срабатывают локально до bootstrap по HTTP", async () => {
  let requests = 0;
  const gateway = new NativeGateway({
    baseUrl: "http://invalid.example/",
    timeoutMs: 1000,
    maxResponseBytes: 4096,
    fetch: async () => {
      requests++;
      throw Error("must not run");
    },
  });
  try {
    await assert.rejects(gateway.call("web.websocket.heartbeat", {}), (error: unknown) => {
      assert.ok(error instanceof WebSocketHeartbeatError);
      assert.equal(error.errorCode, "WS_UNAVAILABLE");
      assert.equal(error.requestSent, false);
      return true;
    });
    for (const args of [
      { timeoutMs: 249 },
      { timeoutMs: 10001 },
      { timeoutMs: 500.5 },
      { route: "/other" },
      { message: "anything" },
    ])
      await assert.rejects(gateway.call("web.websocket.heartbeat", args));
    assert.equal(requests, 0);
  } finally {
    await gateway.close();
  }
});

test("доверенная фабрика видит только собственные опции; сбои транспорта при отправке и при освобождении сохраняют свою сводку", async () => {
  const http = new HttpTransport({
    baseUrl: "http://invalid.example/prefix/",
    timeoutMs: 1000,
    fetch: async () => {
      throw Error("must not run");
    },
  });
  http.cookie.capture(new Headers({ "set-cookie": "SessionID=owned-private-value" }));
  class FakeSocket extends EventEmitter implements WebSocketConnection {
    constructor(private readonly mode: "send-failure" | "disposal-reset") {
      super();
    }
    readyState = WebSocket.CONNECTING as number;
    send(data: string, callback: (error?: Error) => void) {
      assert.equal(data, "$hbt");
      if (this.mode === "send-failure") callback(Error("raw secret must be discarded"));
      else {
        callback();
        queueMicrotask(() => this.emit("message", Buffer.from("$ok"), false));
      }
    }
    pong() {
      throw Error("unexpected pong");
    }
    close() {
      assert.equal(this.mode, "disposal-reset");
      this.readyState = WebSocket.CLOSING;
    }
    terminate() {
      if (this.mode === "disposal-reset")
        this.emit("error", Object.assign(Error("reset secret"), { code: "ECONNRESET" }));
      this.readyState = WebSocket.CLOSED;
      this.emit("close", 1006);
      queueMicrotask(() => this.emit("error", Error("late secret")));
    }
  }
  for (const mode of ["send-failure", "disposal-reset"] as const)
    await assert.rejects(
      webSocketHeartbeat(
        http,
        (url, options) => {
          assert.equal(url, "ws://invalid.example/prefix/services/main_ws_service");
          assert.deepEqual(options.headers, { Cookie: "SessionID=owned-private-value" });
          assert.equal(options.origin, "http://invalid.example");
          assert.equal(options.maxPayload, 4096);
          assert.equal(options.autoPong, false);
          assert.equal(options.followRedirects, false);
          const socket = new FakeSocket(mode);
          queueMicrotask(() => {
            socket.readyState = WebSocket.OPEN;
            socket.emit("open");
          });
          return socket;
        },
        { timeoutMs: 250 },
      ),
      (error: unknown) => {
        assert.ok(error instanceof WebSocketHeartbeatError);
        assert.equal(error.errorCode, "WS_TRANSPORT_ERROR");
        assert.equal(error.details?.handshakeValidated, true);
        assert.equal(error.details?.heartbeatObserved, mode === "disposal-reset");
        assert.doesNotMatch(JSON.stringify(error), /secret|private-value/);
        return true;
      },
    );
  http.dispose();
});

test("конструктор ошибки heartbeat пропускает только поля из белого списка и не публикует произвольные значения", () => {
  const injected = {
    phase: "secret-phase",
    handshakeValidated: "secret",
    heartbeatObserved: "secret",
    status: "secret",
    closeCode: 9999,
    extra: "secret",
  } as unknown as ConstructorParameters<typeof WebSocketHeartbeatError>[1];
  const error = new WebSocketHeartbeatError("secret-code" as "WS_TRANSPORT_ERROR", injected);
  assert.equal(error.errorCode, "WS_TRANSPORT_ERROR");
  assert.equal(error.details?.phase, "preflight");
  assert.equal(error.details?.handshakeValidated, false);
  assert.equal(error.details?.heartbeatObserved, false);
  assert.equal(error.details?.status, undefined);
  assert.equal(error.details?.closeCode, undefined);
  assert.doesNotMatch(JSON.stringify(error), /secret/);
  assert.ok(Object.isFrozen(error.details));
});

test("webSocketHeartbeat передаёт все cookies сессии в рукопожатие и отклоняет слишком длинный заголовок Cookie", async () => {
  const http = new HttpTransport({
    baseUrl: "http://invalid.example/prefix",
    timeoutMs: 500,
    fetch: async () => new Response(""),
  });
  const headers = new Headers();
  headers.append("set-cookie", "SessionID=ws-1; Path=/");
  headers.append("set-cookie", "AWSALB=node-a; Path=/");
  http.cookie.capture(headers);
  let sentCookie: string | undefined;
  class CookieSocket extends EventEmitter implements WebSocketConnection {
    readyState: number = WebSocket.CONNECTING;
    send(data: string, callback: (error?: Error) => void): void {
      assert.equal(data, "$hbt");
      callback();
      queueMicrotask(() => this.emit("message", Buffer.from("$ok"), false));
    }
    close(): void {
      this.readyState = WebSocket.CLOSED;
      queueMicrotask(() => this.emit("close", 1000, Buffer.alloc(0)));
    }
    pong(): void {}
    terminate(): void {}
  }
  const socket = new CookieSocket();
  await webSocketHeartbeat(
    http,
    (_url, options) => {
      sentCookie = options.headers.Cookie;
      queueMicrotask(() => {
        socket.readyState = WebSocket.OPEN;
        socket.emit("open");
      });
      return socket;
    },
    { timeoutMs: 250 },
  );
  assert.equal(sentCookie, "SessionID=ws-1; AWSALB=node-a");

  const huge = new Headers();
  huge.append("set-cookie", `EXTRA=${"x".repeat(4100)}; Path=/`);
  http.cookie.capture(huge);
  await assert.rejects(
    webSocketHeartbeat(
      http,
      () => {
        throw new Error("фабрика не должна вызываться");
      },
      { timeoutMs: 250 },
    ),
    (error: unknown) =>
      error instanceof WebSocketHeartbeatError && error.errorCode === "WS_UNAVAILABLE",
  );
  http.dispose();
});

test("прямой webSocketHeartbeat проверяет ввод, фиксирует код закрытия сервера и отказ освобождения сокета", async () => {
  const http = new HttpTransport({
    baseUrl: "http://invalid.example/",
    timeoutMs: 500,
    fetch: async () => new Response(""),
  });
  http.cookie.capture(new Headers({ "set-cookie": "SessionID=ws-direct; Path=/" }));
  try {
    await assert.rejects(
      webSocketHeartbeat(
        http,
        () => {
          throw new Error("фабрика не должна вызываться");
        },
        { timeoutMs: 100 },
      ),
      (error: unknown) =>
        error instanceof WebSocketHeartbeatError &&
        error.errorCode === "WS_INVALID_INPUT" &&
        error.requestSent === false,
    );

    class StubSocket extends EventEmitter implements WebSocketConnection {
      readyState: number = WebSocket.CONNECTING;
      constructor(private readonly mode: "server-1011" | "stuck-close") {
        super();
      }
      send(_data: string, callback: (error?: Error) => void): void {
        callback();
        if (this.mode === "server-1011") {
          queueMicrotask(() => {
            this.readyState = WebSocket.CLOSED;
            this.emit("close", 1011, Buffer.alloc(0));
          });
        } else {
          queueMicrotask(() => this.emit("message", Buffer.from("$ok"), false));
        }
      }
      close(): void {
        this.readyState = WebSocket.CLOSING;
      }
      pong(): void {}
      terminate(): void {
        // В режиме stuck-close сокет намеренно не переходит в CLOSED.
      }
    }

    await assert.rejects(
      webSocketHeartbeat(
        http,
        () => {
          const socket = new StubSocket("server-1011");
          queueMicrotask(() => {
            socket.readyState = WebSocket.OPEN;
            socket.emit("open");
          });
          return socket;
        },
        { timeoutMs: 250 },
      ),
      (error: unknown) =>
        error instanceof WebSocketHeartbeatError &&
        error.errorCode === "WS_HEARTBEAT_FAILED" &&
        error.details?.closeCode === 1011 &&
        error.details?.status === undefined,
    );

    await assert.rejects(
      webSocketHeartbeat(
        http,
        () => {
          const socket = new StubSocket("stuck-close");
          queueMicrotask(() => {
            socket.readyState = WebSocket.OPEN;
            socket.emit("open");
          });
          return socket;
        },
        { timeoutMs: 250 },
      ),
      (error: unknown) =>
        error instanceof WebSocketHeartbeatError &&
        error.errorCode === "WS_DISPOSAL_FAILED" &&
        error.details?.heartbeatObserved === true,
    );
  } finally {
    http.dispose();
  }
});
