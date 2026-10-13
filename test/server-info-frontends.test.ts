import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { HcmClient, unwrap, withHcmClient, type ServerInfoData } from "../src/sdk.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import { mcpJson } from "./mcp-json.js";

const bin = fileURLToPath(new URL("../src/cli/bin.ts", import.meta.url));
const loader = import.meta.resolve("tsx");
const prefix = "/mounted-hcm";
const basic = "Basic " + Buffer.from("fixture-user:fixture-password").toString("base64");
type Profile = "native" | "web";
type Context = {
  profile: Profile;
  cookie: string;
  id: string;
  steps: string[];
};

function soap(profile: Profile, method: string, payload = "") {
  const envelope =
    profile === "native"
      ? "http://www.w3.org/2003/05/soap-envelope/"
      : "http://schemas.xmlsoap.org/soap/envelope/";
  const operation =
    profile === "native" ? "http://www.datex-soft.com/" : "http://www.datex-soft.com/soap/";
  return (
    `<soap:Envelope xmlns:soap="${envelope}"><soap:Body>` +
    `<${method}Response xmlns="${operation}">${payload}</${method}Response>` +
    "</soap:Body></soap:Envelope>"
  );
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "hcm-server-info-Рус😀 ' "));
  const contexts: Context[] = [];
  const requests: string[] = [];
  const errors: string[] = [];
  function newContext(profile: Profile): Context {
    const context: Context = {
      profile,
      cookie: "server-info-owned-" + (contexts.length + 1),
      id: String(700 + contexts.length),
      steps: [],
    };
    contexts.push(context);
    return context;
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        const part = Buffer.from(chunk);
        bytes += part.length;
        assert.ok(bytes <= 16384, "The fixed metadata request has a small bounded body");
        chunks.push(part);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const operation = /<soap:Body><([A-Za-z]+)\b[^>]*>([\s\S]*?)<\/\1><\/soap:Body>/.exec(body);
      const method = operation?.[1];
      const inner = operation?.[2] ?? "";
      const fieldEntries = Array.from(inner.matchAll(/<([A-Za-z]+)>([\s\S]*?)<\/\1>/g));
      const fields = Object.fromEntries(fieldEntries.map((match) => [match[1]!, match[2]!]));
      requests.push(method ?? url.pathname);
      assert.ok(requests.length <= 16, "Unexpected retries or supplementary metadata probes");
      if (url.pathname === prefix + "/spxml_web/main.htm") {
        assert.equal(request.method, "GET");
        assert.equal(body, "");
        assert.equal(request.headers.cookie, undefined);
        assert.equal(request.headers.authorization, basic);
        assert.equal(request.headers["x-spxml-client"], "SP-XML Web client 1.0");
        const context = newContext("web");
        context.steps.push("main");
        response.setHeader("set-cookie", `SessionID=${context.cookie}; Path=/`);
        response.end("<html>ordinary synthetic Administrator bootstrap</html>");
        return;
      }
      let context = contexts.find((item) => request.headers.cookie === "SessionID=" + item.cookie);
      if (url.pathname === prefix + "/services/LdsService") {
        assert.equal(request.method, "POST");
        assert.deepEqual(Array.from(url.searchParams.keys()), ["rnd"]);
        assert.ok(url.searchParams.get("rnd"));
        assert.ok(method === "OpenSession" || method === "CloseSession");
        assert.equal(fieldEntries.map((match) => match[0]).join(""), inner);
        if (method === "OpenSession") {
          assert.deepEqual(Object.keys(fields), ["InstallationID"]);
          assert.equal(fields.InstallationID, "");
          if (context === undefined) {
            assert.equal(request.headers.cookie, undefined);
            assert.equal(request.headers.authorization, basic);
            assert.equal(request.headers["x-spxml-client"], undefined);
            context = newContext("native");
            response.setHeader("set-cookie", `SessionID=${context.cookie}; Path=/`);
          } else {
            assert.equal(context.profile, "web");
            assert.equal(request.headers.authorization, undefined);
            assert.deepEqual(context.steps, ["main"]);
          }
          assert.ok(!context.steps.includes("OpenSession"));
          context.steps.push("OpenSession");
          response.setHeader("content-type", "application/soap+xml");
          response.end(soap(context.profile, method, `<SessionID>${context.id}</SessionID>`));
          return;
        }
        assert.ok(context, "CloseSession must use the cookie of its own opened context");
        assert.equal(request.headers.authorization, undefined);
        assert.deepEqual(Object.keys(fields), ["SessionID"]);
        assert.equal(fields.SessionID, context.id);
        assert.equal(
          context.steps.at(-1),
          context.profile === "native" ? "get_app_info" : "CallMethod",
        );
        context.steps.push("CloseSession");
        response.setHeader("content-type", "application/soap+xml");
        response.end(soap(context.profile, method));
        return;
      }
      assert.ok(context, "Every post-bootstrap request must retain its own isolated cookie");
      assert.equal(request.headers.authorization, undefined);
      assert.equal(
        request.headers["x-spxml-client"],
        context.profile === "web" ? "SP-XML Web client 1.0" : undefined,
      );
      // Профиль native запрашивает ещё и списки папок; этот сервер их не отдаёт.
      if (url.pathname === prefix + "/api/spxml2/get_app_info") {
        assert.equal(context.profile, "native");
        assert.equal(context.steps.at(-1), "CallMethod");
        context.steps.push("get_app_info");
        response.writeHead(500).end();
        return;
      }
      if (url.pathname === prefix + "/api/spxml/CallMethod") {
        assert.equal(request.method, "POST");
        assert.equal(url.search, "");
        assert.equal(method, "CallMethod");
        assert.equal(fieldEntries.map((match) => match[0]).join(""), inner);
        assert.deepEqual(Object.keys(fields), ["LibName", "MethodName", "ArgData"]);
        assert.deepEqual(fields, {
          LibName: "ms_tools",
          MethodName: "get_admin_init_server_data",
          ArgData: "",
        });
        assert.equal(context.steps.at(-1), "OpenSession");
        context.steps.push("CallMethod");
        const capability = context.profile === "native" ? "0x20000000000001" : "9007199254740993";
        response.setHeader("content-type", "application/soap+xml");
        response.end(
          soap(
            context.profile,
            "CallMethod",
            '<ResultData><Result VALUE-TYPE="Object">' +
              `<sys_db_capability VALUE-TYPE="integer">${capability}</sys_db_capability>` +
              '<catalog_limits VALUE-TYPE="string">&lt;catalogs/&gt;</catalog_limits>' +
              '<version_server VALUE-TYPE="string">2025.1.1171</version_server>' +
              '<os_type VALUE-TYPE="string">windows</os_type>' +
              "</Result></ResultData>",
          ),
        );
        return;
      }
      assert.equal(request.method, "GET");
      assert.equal(body, "");
      if (url.pathname === prefix + "/loggedoff.html") {
        assert.equal(context.profile, "native");
        assert.equal(context.steps.at(-1), "CloseSession");
        context.steps.push("loggedoff");
        response.setHeader("set-cookie", "SessionID=; Max-Age=0; Path=/");
        response.writeHead(302, { location: prefix + "/must-not-follow-cleanup" }).end();
        return;
      }
      assert.equal(context.profile, "web");
      if (url.pathname === prefix + "/spxml_web/logout.htm") {
        assert.equal(context.steps.at(-1), "CloseSession");
        context.steps.push("logout");
        response.writeHead(302, { location: prefix + "/must-not-follow-cleanup" }).end();
        return;
      }
      assert.equal(url.pathname, prefix + "/spxml_web/logout2.htm");
      assert.equal(context.steps.at(-1), "logout");
      context.steps.push("logout2");
      response.setHeader("set-cookie", "SessionID=; Max-Age=0; Path=/");
      response.writeHead(401).end();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config: ConnectionConfig = {
    name: "read-metadata",
    baseUrl: `http://127.0.0.1:${address.port}${prefix}/`,
    username: "fixture-user",
    password: "fixture-password",
    timeoutMs: 3000,
    maxResponseBytes: 65536,
    outputLimitBytes: 16384,
    runtimeDir: join(directory, "runtime"),
    permissions: { write: false, execute: false },
  };
  const configPath = join(directory, "connections.json");
  await writeFile(
    configPath,
    JSON.stringify({ defaultConnection: config.name, connections: { [config.name]: config } }),
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
    child.stdout.setEncoding("utf8").on("data", (text: string) => {
      stdout += text;
      if (stdout.length > 65536) child.kill();
    });
    child.stderr.setEncoding("utf8").on("data", (text: string) => {
      stderr += text;
      if (stderr.length > 65536) child.kill();
    });
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdin.end();
    try {
      const code = await new Promise<number | null>((done, reject) => {
        child.once("error", reject);
        child.once("close", done);
      });
      return { code, stderr, stdout };
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
    }
  }
  async function mcp<T>(action: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ name: "server-info-frontends", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [...args, "mcp"],
      cwd: directory,
      env,
      stderr: "pipe",
    });
    let stderr = "";
    const stderrDecoder = new StringDecoder("utf8");
    transport.stderr?.on("data", (bytes: Buffer) => {
      stderr += stderrDecoder.write(bytes);
    });
    try {
      await client.connect(transport);
      return await action(client);
    } finally {
      await client.close();
      stderr += stderrDecoder.end();
      assert.equal(stderr, "");
    }
  }
  function assertClosed() {
    assert.deepEqual(errors, []);
    assert.equal(contexts.length, 3);
    assert.equal(new Set(contexts.map((item) => item.cookie)).size, 3);
    assert.equal(new Set(contexts.map((item) => item.id)).size, 3);
    const native = ["OpenSession", "CallMethod", "get_app_info", "CloseSession", "loggedoff"];
    assert.deepEqual(
      contexts.map((item) => ({ profile: item.profile, steps: item.steps })),
      [
        { profile: "native", steps: native },
        {
          profile: "web",
          steps: ["main", "OpenSession", "CallMethod", "CloseSession", "logout", "logout2"],
        },
        { profile: "native", steps: native },
      ],
    );
    assert.equal(requests.length, 5 + 6 + 5);
  }
  async function close() {
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    const withinTemp = relative(resolve(tmpdir()), resolve(directory));
    assert.ok(withinTemp !== "" && !isAbsolute(withinTemp) && !withinTemp.startsWith(".."));
    await rm(directory, { recursive: true, force: true });
  }
  return { config, cli, mcp, requests, contexts, assertClosed, close };
}

function metadata(result: OperationResult, profile: Profile) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.meta.operationId, "server.info");
  assert.equal(result.meta.truncated, undefined);
  const data = result.data as ServerInfoData;
  assert.equal(data.profile, profile);
  assert.equal(data.versionServer, "2025.1.1171");
  assert.equal(data.osType, "windows");
  assert.equal(data.capabilityMask, profile === "native" ? "0x20000000000001" : "9007199254740993");
  assert.equal(BigInt(data.capabilityMask), 9007199254740993n);
  assert.deepEqual(data.catalogLimits, []);
  assert.deepEqual(Object.keys(data), [
    "profile",
    "versionServer",
    "osType",
    "capabilityMask",
    "database",
    "catalogLimits",
  ]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /server-info-owned-|fixture-password|SessionID|Authorization/,
  );
}

function structured(response: Awaited<ReturnType<Client["callTool"]>>): OperationResult {
  assert.ok(Array.isArray(response.content));
  assert.equal(response.content.length, 1);
  const content = response.content[0] as { type: unknown; text: unknown };
  assert.equal(content.type, "text");
  assert.ok(typeof content.text === "string");
  const result = mcpJson(response);
  assert.equal(response.isError === true, !result.ok);
  return result;
}

test(
  "SDK с правами только на чтение, CLI из чужого cwd и MCP по stdio используют только фиксированный штатный RPC метаданных и закрывают отдельные собственные области",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    try {
      await withHcmClient(f.config, async (client) => {
        const result = await client.serverInfo();
        unwrap(result);
        metadata(result, "native");
      });
      const cli = await f.cli(["server", "info", "--profile", "web"]);
      assert.equal(cli.code, 0);
      assert.equal(cli.stderr, "");
      metadata(JSON.parse(cli.stdout) as OperationResult, "web");
      await f.mcp(async (client) => {
        const response = await client.callTool({
          name: "hcm_api_read",
          arguments: { operationId: "server.info", args: { profile: "native" } },
        });
        metadata(structured(response), "native");
      });
      f.assertClosed();
    } finally {
      await f.close();
    }
  },
);

test(
  "неверный ввод метаданных и права общего RPC отклоняются в реальных SDK, CLI и MCP до любого серверного контекста",
  { timeout: 45000 },
  async () => {
    const f = await fixture();
    const sdk = new HcmClient(f.config);
    try {
      for (const args of [{ profile: "anonymous" }, { helperScript: "unexpected" }]) {
        const result = await sdk.call("server.info", args);
        assert.equal(result.ok, false);
        assert.equal(result.error?.retryable, false);
      }
      for (const id of ["rpc.call", "native.rpc.call"]) {
        const args =
          id === "rpc.call"
            ? { library: "ms_tools", method: "get_admin_init_server_data" }
            : { target: "ms_tools.get_admin_init_server_data", args: [] };
        const result = await sdk.call(id, args);
        assert.equal(result.ok, false);
        assert.equal(result.error?.code, "EXECUTE_DISABLED");
        assert.equal(result.error?.mutationOutcome, "not_sent");
      }
      await sdk.close();
      for (const command of [
        ["server", "info", "--profile", "anonymous"],
        ["server", "info", "--helper-script", "unexpected"],
        ["server", "info", "unexpected"],
      ]) {
        const cli = await f.cli(command);
        assert.equal(cli.code, 2);
      }
      await f.mcp(async (client) => {
        for (const args of [{ profile: "anonymous" }, { helperScript: "unexpected" }]) {
          const response = await client.callTool({
            name: "hcm_api_read",
            arguments: { operationId: "server.info", args },
          });
          assert.equal(structured(response).ok, false);
        }
        for (const operationId of ["rpc.call", "native.rpc.call"]) {
          const response = await client.callTool({
            name: "hcm_api_read",
            arguments: {
              operationId,
              args: { target: "ms_tools.get_admin_init_server_data", args: [] },
            },
          });
          const result = structured(response);
          assert.equal(result.ok, false);
          assert.equal(result.error?.code, "mcp.effect_mismatch");
        }
      });
      assert.deepEqual(f.requests, []);
      assert.deepEqual(f.contexts, []);
    } finally {
      await sdk.close();
      await f.close();
    }
  },
);
