import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHcmMcpServer } from "../src/mcp/server.js";
import { HcmRuntime } from "../src/runtime.js";
import { HcmClient, type QueryData } from "../src/sdk.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import { mcpJson } from "./mcp-json.js";

type Row = { id: string; name: string; EOF: string; TotalCount: string };
type Context = { cookie: string; id: string; steps: string[]; starts: number[] };
const prefix = "/query-fixture";
const fields = ["id", "name", "EOF", "TotalCount"];
const where = { code: "fixture's Привет" };
const expectedQuery =
  "for $elem in resources where ($elem/code = 'fixture''s Привет') return $elem";
const rows: Row[] = Array.from({ length: 5 }, (_, index) => ({
  id: (9223372036854775700n + BigInt(index)).toString(),
  name: `Ресурс ${index} — 🙂 & <ok>`,
  EOF: "1",
  TotalCount: "1",
}));
const basic = "Basic " + Buffer.from("fixture-user:fixture-password").toString("base64");
const xmlText = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const wireText = (value: string) =>
  value.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (_all, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]!,
  );
const soap = (method: string, payload = "") =>
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response xmlns="http://www.datex-soft.com/">${payload}</${method}Response></soap:Body></soap:Envelope>`;

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "hcm-query-Рус😀 ' "));
  const contexts: Context[] = [],
    requests: string[] = [],
    failures: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        assert.ok(size <= 16384);
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");
      let context = contexts.find((item) => request.headers.cookie === "SessionID=" + item.cookie);
      if (url.pathname === prefix + "/loggedoff.html") {
        assert.equal(request.method, "GET");
        assert.ok(context);
        assert.equal(request.headers.authorization, undefined);
        assert.deepEqual(context.steps.slice(-1), ["CloseSession"]);
        context.steps.push("loggedoff");
        requests.push("loggedoff");
        response.end();
        return;
      }
      assert.equal(url.pathname, prefix + "/services/LdsService");
      assert.equal(request.method, "POST");
      assert.deepEqual([...url.searchParams.keys()], ["rnd"]);
      assert.match(request.headers["content-type"] ?? "", /^application\/soap\+xml/);
      const operation = /<soap:Body><([A-Za-z]+)\b[^>]*>([\s\S]*?)<\/\1><\/soap:Body>/.exec(body);
      assert.ok(operation);
      const method = operation[1]!,
        inner = operation[2]!;
      const elements = [...inner.matchAll(/<([A-Za-z]+)>([\s\S]*?)<\/\1>/g)];
      assert.equal(elements.map((item) => item[0]).join(""), inner);
      const args = Object.fromEntries(elements.map((item) => [item[1]!, wireText(item[2]!)]));
      requests.push(method);
      assert.ok(requests.length <= 24, "No extra query, retry or helper request is expected");
      response.setHeader("content-type", "application/soap+xml; charset=utf-8");
      if (method === "OpenSession") {
        assert.equal(request.headers.cookie, undefined);
        assert.equal(request.headers.authorization, basic);
        assert.deepEqual(args, { InstallationID: "" });
        context = {
          cookie: "query-owned-" + contexts.length,
          id: String(400 + contexts.length),
          steps: [method],
          starts: [],
        };
        contexts.push(context);
        response.setHeader("set-cookie", `SessionID=${context.cookie}; Path=/`);
        response.end(soap(method, `<SessionID>${context.id}</SessionID>`));
        return;
      }
      assert.ok(context, "A request must use its own previously issued HTTP cookie");
      assert.equal(request.headers.authorization, undefined);
      assert.equal(args.SessionID, context.id);
      if (method === "CloseSession") {
        assert.deepEqual(Object.keys(args), ["SessionID"]);
        assert.equal(context.steps.at(-1), "XQuery");
        context.steps.push(method);
        response.end(soap(method));
        return;
      }
      assert.equal(method, "XQuery");
      assert.deepEqual(Object.keys(args), [
        "Query",
        "StartPos",
        "MaxCount",
        "ExpectToReadAll",
        "KeepCursor",
        "SessionID",
      ]);
      assert.equal(
        args.Query,
        expectedQuery,
        "The catalog/filter expression must remain invariant across pages/frontends",
      );
      assert.equal(args.MaxCount, "2");
      assert.equal(args.ExpectToReadAll, "false");
      assert.equal(args.KeepCursor, "false");
      const start = Number(args.StartPos);
      assert.ok([1, 2, 4].includes(start));
      context.starts.push(start);
      context.steps.push(method);
      // Это заранее заданные страницы сервера, а не реализация постраничного чтения в runtime.
      const page = start === 1 ? rows.slice(1, 2) : start === 2 ? rows.slice(2, 4) : rows.slice(4);
      const data = page
        .map(
          (row) =>
            `<resource>${Object.entries(row)
              .map(([key, value]) => `<${key}>${xmlText(value)}</${key}>`)
              .join("")}</resource>`,
        )
        .join("");
      const eof = start === 1 ? "" : `<EOF>${start === 4 ? "1" : "0"}</EOF>`;
      response.end(soap(method, `<Data>${data}</Data><TotalCount>5</TotalCount>${eof}`));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "fixture assertion");
      response.writeHead(500).end("Independent query fixture rejected request");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config: ConnectionConfig = {
    name: "query-fixture",
    baseUrl: `http://127.0.0.1:${address.port}${prefix}`,
    username: "fixture-user",
    password: "fixture-password",
    timeoutMs: 2000,
    maxResponseBytes: 1048576,
    outputLimitBytes: 16384,
    runtimeDir: join(directory, "runtime"),
    permissions: { write: false, execute: false },
  };
  const configPath = join(directory, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({ defaultConnection: config.name, connections: { [config.name]: config } }),
  );
  async function cli(command: string[]) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^WTCTL_|^PATH$|^NODE_OPTIONS$/i.test(name)),
    ) as Record<string, string>;
    env.PATH = "";
    env.NODE_OPTIONS = "";
    const child = spawn(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL("../src/cli/bin.ts", import.meta.url)),
        "--config",
        configPath,
        ...command,
      ],
      { cwd: directory, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8").on("data", (text: string) => {
      stdout += text;
      if (stdout.length > 65536) child.kill();
    });
    child.stderr.setEncoding("utf8").on("data", (text: string) => {
      stderr += text;
      if (stderr.length > 65536) child.kill();
    });
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdin.end();
    try {
      const code = await new Promise<number | null>((done, reject) => {
        child.once("error", reject);
        child.once("close", done);
      });
      return { code, stdout, stderr };
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
    }
  }
  return {
    config,
    contexts,
    requests,
    failures,
    cli,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      const path = relative(resolve(tmpdir()), resolve(directory));
      assert.ok(path !== "" && !isAbsolute(path) && !path.startsWith(".."));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function mcpResult(response: Awaited<ReturnType<Client["callTool"]>>): OperationResult {
  const content = response.content as { type: string; text: string }[];
  assert.equal(content.length, 1);
  assert.equal(content[0]!.type, "text");
  const result = mcpJson(response);
  assert.equal(response.isError === true, !result.ok);
  return result;
}

async function follow(call: (start: number) => Promise<OperationResult>): Promise<Row[]> {
  const delivered: Row[] = [],
    offsets: number[] = [];
  let start = 1;
  for (let safety = 0; ; safety++) {
    assert.ok(safety < 4, "Only returned advancing offsets may be followed");
    offsets.push(start);
    const result = await call(start);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.meta.truncated, undefined);
    const page = result.data as QueryData<Row>;
    assert.equal(page.total, 5, "Nested row TotalCount must not replace response metadata");
    delivered.push(...page.items);
    if (page.nextStartPosition === undefined) {
      assert.deepEqual(Object.keys(page), ["items", "total"]);
      break;
    }
    assert.ok(page.nextStartPosition > start);
    start = page.nextStartPosition;
  }
  assert.deepEqual(offsets, [1, 2, 4]);
  assert.deepEqual(delivered, rows.slice(1));
  return delivered;
}

test(
  "настоящие SDK, CLI и MCP идут по возвращённым смещениям запроса, не теряя строк в записанном виде",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    const input = { catalog: "resources", where, fields, limit: 2 };
    const sdk = new HcmClient(f.config);
    const mcpRuntime = new HcmRuntime(f.config);
    const server = createHcmMcpServer(mcpRuntime, { connectionName: f.config.name });
    const client = new Client({ name: "query-frontends", version: "1" });
    let primaryFailure: { error: unknown } | undefined;
    try {
      assert.equal((await sdk.query({ ...input, limit: 0 })).ok, false);
      assert.equal(f.requests.length, 0);
      const sdkRows = await follow((startPosition) => sdk.query<Row>({ ...input, startPosition }));
      await sdk.close();
      const invalidCli = await f.cli(["query", "--catalog", "resources", "--limit", "0"]);
      assert.equal(invalidCli.code, 2);
      assert.equal(JSON.parse(invalidCli.stderr).error.code, "cli.invalid_input");
      assert.equal(f.requests.length, 6);
      const cliRows = await follow(async (start) => {
        const result = await f.cli([
          "query",
          "--catalog",
          "resources",
          "--where",
          JSON.stringify(where),
          "--fields",
          fields.join(","),
          "--limit",
          "2",
          "--start-position",
          String(start),
        ]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.equal(result.stderr, "");
        return JSON.parse(result.stdout) as OperationResult;
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const beforeInvalidMcp = f.requests.length;
      assert.equal(
        mcpResult(await client.callTool({ name: "hcm_query", arguments: { ...input, limit: 0 } }))
          .ok,
        false,
      );
      assert.equal(f.requests.length, beforeInvalidMcp);
      const mcpRows = await follow(async (startPosition) =>
        mcpResult(
          await client.callTool({ name: "hcm_query", arguments: { ...input, startPosition } }),
        ),
      );
      await mcpRuntime.close();
      assert.deepEqual(cliRows, sdkRows);
      assert.deepEqual(mcpRows, sdkRows);
      assert.deepEqual(f.failures, []);
      assert.equal(f.requests.length, 24);
      assert.equal(f.contexts.length, 5);
      assert.equal(new Set(f.contexts.map((context) => context.id)).size, 5);
      assert.equal(new Set(f.contexts.map((context) => context.cookie)).size, 5);
      assert.deepEqual(
        f.contexts.map((context) => context.starts),
        [[1, 2, 4], [1], [2], [4], [1, 2, 4]],
      );
      for (const context of f.contexts)
        assert.deepEqual(context.steps, [
          "OpenSession",
          ...context.starts.map(() => "XQuery"),
          "CloseSession",
          "loggedoff",
        ]);
    } catch (error) {
      primaryFailure = { error };
    } finally {
      const failures = primaryFailure ? [primaryFailure.error] : [];
      try {
        const closed = await Promise.allSettled(
          [
            () => client.close(),
            () => server.close(),
            () => sdk.close(),
            () => mcpRuntime.close(),
          ].map((close) => Promise.resolve().then(close)),
        );
        for (const result of closed) if (result.status === "rejected") failures.push(result.reason);
      } finally {
        try {
          await f.close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(failures, "Query conformance or owned cleanup failed");
    }
  },
);
