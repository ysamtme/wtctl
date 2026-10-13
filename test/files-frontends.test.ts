import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HcmClient, unwrap } from "../src/sdk.js";
import { HcmRuntime } from "../src/runtime.js";
import { runCli } from "../src/cli/run.js";
import { createHcmMcpServer } from "../src/mcp/server.js";
import type { CliIo } from "../src/cli/types.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import { mcpJson } from "./mcp-json.js";

const inputUrl = "x-local://Share/Рус😀 file +% &.txt";
const prefix = "/mounted-platform";
const basic = "Basic " + Buffer.from("fixture:fixture-password").toString("base64");
function soap(method: string, payload = "") {
  return `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response xmlns="http://www.datex-soft.com/">${payload}</${method}Response></soap:Body></soap:Envelope>`;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "hcm-files-Рус😀 ' "));
  const contexts: { cookie: string; id: string; steps: string[] }[] = [];
  const requests: string[] = [];
  const failures: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        const part = Buffer.from(chunk);
        bytes += part.length;
        assert.ok(bytes <= 8192);
        chunks.push(part);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const method = /<soap:Body><([A-Za-z]+)\b/.exec(body)?.[1] ?? "loggedoff";
      requests.push(method);
      assert.ok(requests.length <= 12, "Only three owned four-request contexts are permitted");
      assert.equal(request.headers["x-spxml-client"], undefined);
      if (method === "OpenSession") {
        assert.equal(url.pathname, prefix + "/services/LdsService");
        assert.deepEqual(Array.from(url.searchParams.keys()), ["rnd"]);
        assert.equal(request.method, "POST");
        assert.equal(request.headers.authorization, basic);
        assert.equal(request.headers.cookie, undefined);
        assert.match(body, /<InstallationID><\/InstallationID>/);
        const context = {
          cookie: "files-owned-" + contexts.length,
          id: String(701 + contexts.length),
          steps: [method],
        };
        contexts.push(context);
        response.setHeader("set-cookie", `SessionID=${context.cookie}; Path=/`);
        response.setHeader("content-type", "application/soap+xml");
        response.end(soap(method, `<SessionID>${context.id}</SessionID>`));
        return;
      }
      assert.equal(request.headers.authorization, undefined);
      const context = contexts.find(
        (item) => request.headers.cookie === "SessionID=" + item.cookie,
      );
      assert.ok(context, "Every request after bootstrap must use its own isolated cookie");
      if (method === "CallMethod") {
        assert.equal(url.pathname, prefix + "/api/spxml/CallMethod");
        assert.equal(url.search, "");
        assert.equal(request.method, "POST");
        assert.deepEqual(context.steps, ["OpenSession"]);
        assert.equal(
          body,
          '<?xml version="1.0" encoding="utf-8"?>' +
            '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><CallMethod xmlns="http://www.datex-soft.com/">' +
            '<LibName>tools</LibName><MethodName>file_url_exists_server</MethodName><ArgData><arg-0 VALUE-TYPE="string">' +
            "x-local://Share/Рус😀 file +% &amp;.txt</arg-0></ArgData></CallMethod></soap:Body></soap:Envelope>",
        );
        context.steps.push(method);
        response.setHeader("content-type", "application/soap+xml");
        response.end(soap(method, '<ResultData><Result VALUE-TYPE="bool">0</Result></ResultData>'));
        return;
      }
      if (method === "CloseSession") {
        assert.equal(url.pathname, prefix + "/services/LdsService");
        assert.equal(request.method, "POST");
        assert.deepEqual(context.steps, ["OpenSession", "CallMethod"]);
        assert.match(body, new RegExp(`<SessionID>${context.id}</SessionID>`));
        context.steps.push(method);
        response.setHeader("content-type", "application/soap+xml");
        response.end(soap(method));
        return;
      }
      assert.equal(url.pathname, prefix + "/loggedoff.html");
      assert.equal(request.method, "GET");
      assert.equal(body, "");
      assert.deepEqual(context.steps, ["OpenSession", "CallMethod", "CloseSession"]);
      context.steps.push("loggedoff");
      response.setHeader("set-cookie", "SessionID=; Max-Age=0; Path=/");
      response.writeHead(302, { location: prefix + "/must-not-follow" }).end();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const config = (name: string): ConnectionConfig => ({
    name,
    baseUrl: `http://127.0.0.1:${address.port}${prefix}/`,
    username: "fixture",
    password: "fixture-password",
    timeoutMs: 2000,
    maxResponseBytes: 65536,
    outputLimitBytes: 1024,
    runtimeDir: join(directory, name),
    permissions: { write: false, execute: false },
  });
  return {
    config,
    requests,
    assertClosed() {
      assert.deepEqual(failures, []);
      assert.equal(requests.length, 12);
      assert.equal(contexts.length, 3);
      assert.equal(new Set(contexts.map((item) => item.cookie)).size, 3);
      for (const context of contexts)
        assert.deepEqual(context.steps, ["OpenSession", "CallMethod", "CloseSession", "loggedoff"]);
    },
    async close() {
      server.closeAllConnections();
      try {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

test("SDK, CLI и MCP доносят ложный ответ предиката через настоящий HTTP при общих правах на чтение", async () => {
  const f = await fixture();
  const sdk = new HcmClient(f.config("sdk"));
  const runtime = new HcmRuntime(f.config("mcp"));
  const server = createHcmMcpServer(runtime);
  const client = new Client({ name: "files-conformance", version: "0.0.0" });
  let primary: unknown;
  try {
    const expected = unwrap(await sdk.fileExists({ url: inputUrl }));
    assert.equal(expected.exists, false);
    let stdout = "";
    let stderr = "";
    let loaded = 0;
    const io: CliIo = {
      writeOut(text) {
        stdout += text;
      },
      writeError(text) {
        stderr += text;
      },
      async readFile() {
        throw new Error("No input file is required");
      },
      async readStdin() {
        throw new Error("No stdin is required");
      },
      async writeFile() {
        throw new Error("No output file was requested");
      },
    };
    const dependencies = {
      loadConfiguration() {
        loaded++;
        return f.config("cli");
      },
      createRuntime(config: ConnectionConfig) {
        return new HcmRuntime(config);
      },
      async runMcp() {
        throw new Error("CLI invocation is a one-shot read");
      },
    };
    const before = f.requests.length;
    assert.equal(await runCli(["files", "exists", "http://fixture.invalid"], io, dependencies), 2);
    assert.equal(loaded, 0);
    assert.equal(f.requests.length, before);
    stdout = "";
    stderr = "";
    assert.equal(await runCli(["files", "exists", inputUrl], io, dependencies), 0);
    assert.equal(stderr, "");
    const cli = JSON.parse(stdout) as OperationResult;
    assert.equal(cli.ok, true);
    assert.deepEqual(cli.data, expected);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const read = (operationId: string, args: Record<string, unknown>) =>
      client.callTool({ name: "hcm_api_read", arguments: { operationId, args } });
    const response = await read("files.exists", { url: inputUrl });
    const structured = mcpJson(response);
    const content = response.content as { type: string; text?: string }[];
    assert.equal(response.isError === true, !structured.ok);
    assert.equal(content[0]?.type, "text");
    assert.deepEqual(JSON.parse(content[0]!.text!), structured);
    assert.deepEqual(structured.data, expected);
    const count = f.requests.length;
    for (const [operationId, args] of [
      ["files.exists", { url: inputUrl, target: "tools.get_version" }],
      ["files.exists", { url: "x-db-obj://db/id" }],
      ["native.rpc.call", { target: "tools.file_url_exists_server", args: [] }],
    ] as const) {
      const denied = await read(operationId, args);
      assert.equal(denied.isError, true);
      assert.equal(mcpJson(denied).ok, false);
    }
    assert.equal(f.requests.length, count);
    assert.doesNotMatch(JSON.stringify(structured.data), /fixture-password|SessionID|files-owned-/);
  } catch (error) {
    primary = error;
  }
  const cleanup = await Promise.allSettled([
    sdk.close(),
    client.close(),
    server.close(),
    runtime.close(),
  ]);
  const errors = cleanup.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  try {
    f.assertClosed();
  } catch (error) {
    errors.push(error);
  }
  try {
    await f.close();
  } catch (error) {
    errors.push(error);
  }
  if (primary !== undefined && errors.length === 0) throw primary;
  if (primary !== undefined) errors.unshift(primary);
  if (errors.length)
    throw new AggregateError(errors, "The predicate workflow or owned cleanup failed");
});
