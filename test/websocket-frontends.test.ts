import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { HcmClient, withHcmClient, unwrap } from "../src/sdk.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import type { WebSocketHeartbeatReceipt } from "../src/protocol/types.js";
import { mcpJson } from "./mcp-json.js";

const bin = fileURLToPath(new URL("../src/cli/bin.ts", import.meta.url));
const loader = import.meta.resolve("tsx");
const prefix = "/mount";
type Context = {
  cookie: string;
  id: string;
  opens: number;
  closes: number;
  logouts: string[];
  messages: string[];
  upgrades: number;
  socket?: WebSocket;
  socketClosed: boolean;
};

async function fixture(mode: "reply" | "silent" = "reply") {
  const directory = await mkdtemp(join(tmpdir(), "hcm-ws-Рус😀 ' "));
  const contexts: Context[] = [];
  const errors: string[] = [];
  const requests: string[] = [];
  const sockets = new Set<WebSocket>();
  const soap = (method: string, content = "") =>
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><' +
    method +
    'Response xmlns="http://www.datex-soft.com/">' +
    content +
    "</" +
    method +
    "Response></soap:Body></soap:Envelope>";
  let origin = "";
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
      const chunks: Buffer[] = [];
      for await (const part of request) chunks.push(Buffer.from(part));
      const body = Buffer.concat(chunks).toString("utf8");
      const method = /<soap:Body>\s*<([A-Za-z]+)/.exec(body)?.[1];
      requests.push(method ?? path);
      if (path === prefix + "/spxml_web/main.htm") {
        assert.equal(request.method, "GET");
        assert.equal(
          request.headers.authorization,
          "Basic " + Buffer.from("fixture-user:fixture-password").toString("base64"),
        );
        const context: Context = {
          cookie: "heartbeat-owned-" + (contexts.length + 1),
          id: String(100 + contexts.length),
          opens: 0,
          closes: 0,
          logouts: [],
          messages: [],
          upgrades: 0,
          socketClosed: false,
        };
        contexts.push(context);
        response.setHeader("set-cookie", "SessionID=" + context.cookie + "; Path=/");
        response.end("<html>ordinary synthetic main page</html>");
        return;
      }
      const context = contexts.find(
        (item) => request.headers.cookie === "SessionID=" + item.cookie,
      );
      assert.ok(context, "Every request after bootstrap must use its own HTTP context");
      assert.equal(request.headers.authorization, undefined);
      if (path === prefix + "/services/LdsService") {
        if (method === "OpenSession") {
          assert.equal(context.opens++, 0);
          response.setHeader("content-type", "application/soap+xml");
          response.end(soap("OpenSession", "<SessionID>" + context.id + "</SessionID>"));
          return;
        }
        assert.equal(method, "CloseSession");
        assert.match(body, new RegExp("<SessionID>" + context.id + "</SessionID>"));
        assert.notEqual(
          context.socket?.readyState,
          WebSocket.OPEN,
          "Socket closure starts before LDS cleanup",
        );
        assert.equal(context.closes++, 0);
        response.setHeader("content-type", "application/soap+xml");
        response.end(soap("CloseSession"));
        return;
      }
      assert.ok(
        [prefix + "/spxml_web/logout.htm", prefix + "/spxml_web/logout2.htm"].includes(path),
      );
      assert.equal(context.closes, 1);
      context.logouts.push(path);
      response.end();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      response.writeHead(500).end();
    }
  });
  const ws = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 4096 });
  server.on("upgrade", (request, socket, head) => {
    try {
      assert.equal(request.url, prefix + "/services/main_ws_service");
      assert.equal(request.headers.origin, origin);
      assert.equal(request.headers.authorization, undefined);
      const context = contexts.find(
        (item) => request.headers.cookie === "SessionID=" + item.cookie,
      );
      assert.ok(context);
      assert.equal(context.opens, 1);
      assert.equal(context.upgrades++, 0);
      ws.handleUpgrade(request, socket, head, (connection) => {
        context.socket = connection;
        sockets.add(connection);
        connection.on("error", () => {});
        connection.on("close", () => {
          context.socketClosed = true;
          sockets.delete(connection);
        });
        connection.on("message", (bytes, binary) => {
          if (binary || bytes.toString() !== "$hbt" || context.messages.length !== 0) {
            errors.push("Unexpected application payload or retry");
            connection.close(1002);
            return;
          }
          context.messages.push(bytes.toString());
          if (mode === "reply") connection.send("$ok");
        });
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = "http://127.0.0.1:" + address.port;
  const config: ConnectionConfig = {
    name: "readonly",
    baseUrl: origin + prefix + "/",
    username: "fixture-user",
    password: "fixture-password",
    timeoutMs: 2000,
    maxResponseBytes: 65536,
    outputLimitBytes: 16384,
    runtimeDir: join(directory, "runtime"),
    permissions: { write: false, execute: false },
  };
  const configPath = join(directory, "connections.json");
  await writeFile(
    configPath,
    JSON.stringify({
      defaultConnection: config.name,
      connections: {
        [config.name]: config,
        compact: { ...config, outputLimitBytes: 1024 },
      },
    }),
  );
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/^WTCTL_/i.test(name) && !/^PATH$|^NODE_OPTIONS$/i.test(name),
      ),
    ),
    PATH: "",
    NODE_OPTIONS: "",
  } as Record<string, string>;
  const args = ["--import", loader, bin, "--config", configPath];
  async function cli(command: string[]) {
    const child = spawn(process.execPath, [...args, ...command], {
      cwd: directory,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (bytes: Buffer) => {
      stdout += bytes.toString();
    });
    child.stderr.on("data", (bytes: Buffer) => {
      stderr += bytes.toString();
    });
    const timer = setTimeout(() => child.kill(), 12000);
    child.stdin.end();
    try {
      const code = await new Promise<number | null>((done, reject) => {
        child.once("error", reject);
        child.once("close", done);
      });
      return { code, stderr, result: stdout ? (JSON.parse(stdout) as OperationResult) : undefined };
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
    }
  }
  async function mcp(timeoutMs: number, compact = false) {
    const client = new Client({ name: "heartbeat-frontends", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [...args, ...(compact ? ["--connection", "compact"] : []), "mcp"],
      cwd: directory,
      env,
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (bytes: Buffer) => {
      stderr += bytes.toString();
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const read = tools.tools.find((item) => item.name === "hcm_api_read");
      assert.equal(read?.annotations?.idempotentHint, false);
      const response = await client.callTool({
        name: "hcm_api_read",
        arguments: { operationId: "web.websocket.heartbeat", args: { timeoutMs } },
      });
      assert.ok(Array.isArray(response.content));
      const content = response.content[0] as { type: unknown; text: unknown };
      assert.equal(content.type, "text");
      assert.ok(typeof content.text === "string");
      const result = mcpJson(response);
      assert.equal(response.isError === true, !result.ok);
      return result;
    } finally {
      await client.close();
      assert.equal(stderr, "");
    }
  }
  function assertClosed(count: number) {
    assert.deepEqual(errors, []);
    assert.equal(contexts.length, count);
    for (const context of contexts) {
      assert.equal(context.opens, 1);
      assert.equal(context.closes, 1);
      assert.deepEqual(context.logouts, [
        prefix + "/spxml_web/logout.htm",
        prefix + "/spxml_web/logout2.htm",
      ]);
      assert.equal(context.upgrades, 1);
      assert.deepEqual(context.messages, ["$hbt"]);
      assert.equal(context.socketClosed, true);
    }
    assert.equal(sockets.size, 0);
  }
  async function close() {
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((done) => ws.close(() => done()));
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    assert.ok(
      resolve(directory).startsWith(resolve(tmpdir()) + "/") ||
        resolve(directory).startsWith(resolve(tmpdir()) + "\\"),
    );
    await rm(directory, { recursive: true, force: true });
  }
  return { config, cli, mcp, contexts, requests, assertClosed, close };
}

function success(result: OperationResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.meta.operationId, "web.websocket.heartbeat");
  assert.equal(result.meta.truncated, undefined);
  const data = result.data as WebSocketHeartbeatReceipt;
  assert.equal(data.route, "/services/main_ws_service");
  assert.equal(data.phase, "disposed");
  assert.equal(data.handshakeValidated, true);
  assert.equal(data.heartbeatWritten, true);
  assert.equal(data.heartbeatObserved, true);
  assert.equal(data.closeRequested, true);
  assert.equal(data.closeWriteVerified, false);
  assert.equal(data.localSocketDisposed, true);
  assert.equal(data.forcedLocalTermination, false);
  assert.equal(data.limits.timeoutMs, 1000);
  assert.doesNotMatch(
    JSON.stringify(result),
    /heartbeat-owned-|fixture-password|SessionID|Authorization/,
  );
}

test(
  "SDK, foreign-cwd CLI and stdio MCP perform only the fixed heartbeat and close their own contexts",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      await withHcmClient(f.config, async (client) => {
        const result = await client.heartbeat({ timeoutMs: 1000 });
        unwrap(result);
        success(result);
      });
      const cli = await f.cli(["ws", "heartbeat", "--timeout-ms", "1000"]);
      assert.equal(cli.code, 0);
      assert.equal(cli.stderr, "");
      success(cli.result!);
      success(await f.mcp(1000));
      f.assertClosed(3);
    } finally {
      await f.close();
    }
  },
);

test(
  "silent WS returns bounded failure receipts without retry and still closes healthy owned HTTP/LDS contexts",
  { timeout: 30000 },
  async () => {
    const f = await fixture("silent");
    try {
      const results: OperationResult[] = [];
      await withHcmClient(f.config, async (client) => {
        results.push(await client.heartbeat({ timeoutMs: 250 }));
      });
      const cli = await f.cli(["ws", "heartbeat", "--timeout-ms", "250"]);
      assert.equal(cli.code, 1);
      assert.equal(cli.stderr, "");
      results.push(cli.result!);
      results.push(await f.mcp(250));
      for (const result of results) {
        assert.equal(result.ok, false);
        assert.equal(result.error?.retryable, false);
        assert.equal(result.meta.operationId, "web.websocket.heartbeat");
        const receipt = result.error?.details?.heartbeatReceipt as WebSocketHeartbeatReceipt;
        assert.ok(receipt);
        assert.equal(receipt.handshakeValidated, true);
        assert.equal(receipt.heartbeatWritten, true);
        assert.equal(receipt.heartbeatObserved, false);
        assert.equal(receipt.localSocketDisposed, true);
        assert.equal(receipt.closeWriteVerified, false);
        assert.equal(receipt.limits.timeoutMs, 250);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) < f.config.outputLimitBytes);
        assert.doesNotMatch(
          JSON.stringify(result),
          /heartbeat-owned-|fixture-password|SessionID|Authorization/,
        );
      }
      assert.equal(new Set(results.map((item) => item.error?.code)).size, 1);
      const compact: OperationResult[] = [];
      await withHcmClient(
        { ...f.config, name: "n".repeat(800), outputLimitBytes: 1024 },
        async (client) => {
          compact.push(await client.heartbeat({ timeoutMs: 250 }));
        },
      );
      compact.push(await f.mcp(250, true));
      for (const result of compact) {
        assert.equal(result.ok, false);
        assert.equal(result.error?.code, results[0]!.error?.code);
        assert.ok(
          Buffer.byteLength(JSON.stringify(result)) <= 1024,
          "Whole failure envelope respects output budget",
        );
        const receipt = result.error?.details?.heartbeatReceipt as WebSocketHeartbeatReceipt;
        assert.ok(receipt);
        assert.equal(receipt.heartbeatObserved, false);
        assert.equal(receipt.localSocketDisposed, true);
        assert.equal(receipt.closeWriteVerified, false);
        if (result.error?.details?.heartbeatReceiptFieldsOmitted === true) {
          assert.equal(receipt.limits, undefined);
        } else assert.equal(receipt.limits.timeoutMs, 250);
      }
      f.assertClosed(5);
    } finally {
      await f.close();
    }
  },
);

test(
  "heartbeat rejects a custom HTTP mock without a WS factory before any network, and CLI rejects overrides locally",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    let httpCalls = 0;
    const client = new HcmClient({
      ...f.config,
      fetch: async () => {
        httpCalls++;
        throw new Error("HTTP mock must not be called");
      },
    });
    try {
      const result = await client.heartbeat();
      assert.equal(result.ok, false);
      assert.equal(httpCalls, 0);
      assert.equal(result.error?.retryable, false);
      assert.equal(
        (result.error?.details?.heartbeatReceipt as WebSocketHeartbeatReceipt).phase,
        "preflight",
      );
      for (const command of [
        ["ws", "heartbeat", "--timeout-ms", "249"],
        ["ws", "heartbeat", "--timeout-ms", "10001"],
        ["ws", "heartbeat", "--url", "http://example.invalid/"],
        ["ws", "heartbeat", "unexpected-route"],
      ]) {
        const invalid = await f.cli(command);
        assert.equal(invalid.code, 2);
      }
      assert.deepEqual(f.requests, []);
      assert.deepEqual(f.contexts, []);
    } finally {
      await client.close();
      await f.close();
    }
  },
);
