import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { OperationResult } from "../src/contracts.js";
import { escapeXml, findXmlNode, parseXml } from "../src/protocol/xml.js";
import type { LogMatches, LogNews, LogText } from "../src/log-output.js";
import { withHcmClient, unwrap } from "../src/sdk.js";
import type { ConnectionConfig } from "../src/contracts.js";
import type { RpcCatalogPage, RpcTargetDescription } from "../src/rpc-catalog.js";
import type { ScriptData } from "../src/scripts.js";
import { mcpJson } from "./mcp-json.js";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const bin = fileURLToPath(new URL("../src/cli/bin.ts", import.meta.url));
const objectId = "9007199254740993";
const script = 'RESULT=[{value:42,text:"Привет & <ok>",enabled:true,id:"9007199254740993"}];';

function safeEnvironment(): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env)
        .filter(([key, value]) => value !== undefined && !/^WTCTL_/i.test(key))
        .map(([key, value]) => [key, value!]),
    ),
    WTCTL_USERNAME: "synthetic-account",
    WTCTL_PASSWORD: "synthetic-fixture-only",
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "wtctl-e2e-"));
  const methods: string[] = [];
  const docUrls: string[] = [];
  const scriptExecutions: string[] = [];
  let source: string | undefined =
    "<education_mode><id>" +
    objectId +
    '</id><name>Initial</name><future vendor="fixture">preserve</future></education_mode>';
  let binaryPut: Buffer | undefined;
  const logName = "xhttp_2026-09-30.log";
  let logText = "12:00:00 [r1] INFO started\n12:00:01 [r2] ERROR failed\n    at frame\n";
  const soap = (method: string, inner = "") =>
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><' +
    method +
    'Response xmlns="http://www.datex-soft.com/">' +
    inner +
    "</" +
    method +
    "Response></soap:Body></soap:Envelope>";
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    const body = raw.toString("utf8");
    const method = /<soap:Body><([A-Za-z0-9]+)/.exec(body)?.[1];
    if (!method) {
      methods.push("HTTP:" + new URL(request.url ?? "/", "http://synthetic.invalid").pathname);
      if (request.url?.startsWith("/loggedoff.html")) {
        response.statusCode = 500;
        response.end();
        return;
      }
      if (request.url?.startsWith("/spxml_web/main.htm")) {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.setHeader("set-cookie", "SessionID=synthetic-session; Path=/");
        response.end("<!doctype html><html><body>synthetic Administrator</body></html>");
        return;
      }
      if (
        request.url?.startsWith("/spxml_web/logout.htm") ||
        request.url?.startsWith("/spxml_web/logout2.htm")
      ) {
        response.end();
        return;
      }
      if (request.url?.startsWith("/api/spxml2/get_app_info")) {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            default_db_name: "wt_data",
            databases: [
              {
                id: "wt_data",
                catalogs: [{ id: "education_modes", object_type: "education_mode" }],
              },
            ],
          }),
        );
        return;
      }
      if (request.url?.startsWith("/api/spxml2/get_form")) {
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.end(
          '<SPXML-FORM><education_mode><id TYPE="integer"/><name TYPE="string"/><enabled TYPE="bool"/><count TYPE="integer"/></education_mode></SPXML-FORM>',
        );
        return;
      }
      response.writeHead(404);
      response.end();
      return;
    }
    methods.push(method);
    response.setHeader("content-type", "application/soap+xml");
    response.setHeader("set-cookie", "SessionID=synthetic-session; Path=/");
    switch (method) {
      case "OpenSession":
        response.end(soap(method, "<SessionID>42</SessionID>"));
        break;
      case "CloseSession":
        response.end(soap(method));
        break;
      case "GetNewObjectID":
        response.end(soap(method, "<ObjectID>" + objectId + "</ObjectID>"));
        break;
      case "LoadDoc":
        docUrls.push(findXmlNode(parseXml(body), "Url") as string);
        if (!source) {
          response.writeHead(404);
          response.end();
          break;
        }
        if (body.includes("<UseBinaryResponse>true</UseBinaryResponse>")) {
          response.setHeader("content-type", "application/octet-stream");
          response.end(source);
        } else response.end(soap(method, "<Data>" + source + "</Data>"));
        break;
      case "PutDoc": {
        const document = /<education_mode(?:\s[^>]*)?>[\s\S]*?<\/education_mode>/.exec(body)?.[0];
        if (!document) {
          response.writeHead(500);
          response.end();
          break;
        }
        source = document;
        response.end(soap(method));
        break;
      }
      case "DeleteDoc":
        source = undefined;
        response.end(soap(method));
        break;
      case "XQuery":
        response.end(
          soap(
            method,
            "<Data>" + (source ?? "") + "</Data><TotalCount>1</TotalCount><EOF>true</EOF>",
          ),
        );
        break;
      case "CallMethod": {
        if (body.includes("<MethodName>evaluate_remote_collection_obj</MethodName>")) {
          assert.ok(request.url?.startsWith("/api/spxml/CallMethod"));
          assert.equal(request.headers.cookie, "SessionID=synthetic-session");
          assert.ok(body.includes('xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"'));
          assert.ok(body.includes("<LibName>ms_tools</LibName>"));
          assert.ok(
            body.includes(
              '<arg-0><remote_collection SPXML-FORM="x-local://wtv/wtv_remote_collection.xmd" SPXML-FORM-ELEM="remote_collection">',
            ),
          );
          assert.ok(body.includes("<use_cache>0</use_cache>"));
          assert.ok(body.includes("<script>" + escapeXml(script) + "</script>"));
          assert.doesNotMatch(body, /<arg-0 VALUE-TYPE=|<arg-1/);
          const executionId = findXmlNode(parseXml(body), "code");
          assert.equal(typeof executionId, "string");
          assert.match(executionId as string, /^hcm_inline_[a-f0-9]{32}$/);
          scriptExecutions.push(executionId as string);
          const fields =
            '<value VALUE-TYPE="integer">42</value><text VALUE-TYPE="string">Привет &amp; &lt;ok&gt;</text><enabled VALUE-TYPE="bool">true</enabled><id VALUE-TYPE="string">9007199254740993</id>';
          response.end(
            soap(
              method,
              '<ResultData><Result VALUE-TYPE="object"><error VALUE-TYPE="integer">0</error><ticks VALUE-TYPE="integer">7</ticks><total VALUE-TYPE="integer">1</total><result VALUE-TYPE="array"><e VALUE-TYPE="object">' +
                fields +
                '</e></result><columns VALUE-TYPE="array"/><data VALUE-TYPE="object"/></Result></ResultData>',
            ),
          );
          break;
        }
        let value = "2025.1.1171.synthetic";
        if (body.includes("<MethodName>synthetic_large</MethodName>"))
          value = "fixture-".repeat(250);
        if (body.includes("<MethodName>server_log_report</MethodName>")) {
          assert.ok(body.includes("<LibName>tools_report</LibName>"));
          const expectedParams = encodeURIComponent(
            "<func_params><server_log_report><type_id>all</type_id><show_alert>false</show_alert></server_log_report></func_params>",
          );
          assert.ok(body.includes('<arg-0 VALUE-TYPE="string">' + expectedParams + "</arg-0>"));
          const size = String(Buffer.byteLength(logText));
          const cells = [
            "Основной журнал",
            "30.09.2026",
            logName,
            size,
            "xhttp",
            "false",
            "x-local://Logs/" + logName,
          ];
          value =
            "<data><rs><r><cs>" +
            cells
              .map(
                (cell, index) =>
                  "<c><t>" +
                  escapeXml(cell) +
                  "</t>" +
                  (index === 3 ? "<r>" + size + "</r>" : "") +
                  "</c>",
              )
              .join("") +
            "</cs></r></rs></data>";
        }
        if (body.includes("<MethodName>load_url_data_server</MethodName>")) {
          assert.ok(body.includes("<LibName>tools</LibName>"));
          assert.ok(
            body.includes('<arg-0 VALUE-TYPE="string">x-local://Logs/' + logName + "</arg-0>"),
          );
          const bytes = /<arg-1 VALUE-TYPE="integer">(\d+)<\/arg-1>/.exec(body)?.[1];
          const source = Buffer.from(logText, "utf8");
          value =
            bytes && source.length >= Number(bytes)
              ? "Показано последние " +
                bytes +
                " байт файла. Для просмотра всего файла его нужно сохранить.\n" +
                source.subarray(source.length - Number(bytes)).toString("utf8")
              : logText;
        }
        response.end(
          soap(
            method,
            '<ResultData><Result VALUE-TYPE="string">' +
              escapeXml(value) +
              "</Result></ResultData>",
          ),
        );
        break;
      }
      case "Eval":
        response.writeHead(500);
        response.end("Unknown method");
        break;
      case "PutUrl":
        binaryPut = raw;
        response.end(soap(method));
        break;
      case "LoadUrl":
        response.end(soap(method, "<Data>QQ==</Data>"));
        break;
      case "DeleteUrl":
        response.end(soap(method));
        break;
      default:
        response.end(soap(method));
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const configPath = join(directory, "config.json");
  const profile = {
    baseUrl: "http://127.0.0.1:" + address.port,
    usernameEnv: "WTCTL_USERNAME",
    passwordEnv: "WTCTL_PASSWORD",
    permissions: { write: true, execute: true },
    runtimeDir: join(directory, "runtime"),
    timeoutMs: 2000,
    outputLimitBytes: 24000,
  };
  await writeFile(
    configPath,
    JSON.stringify({
      defaultConnection: "synthetic",
      connections: {
        synthetic: profile,
        readonly: { ...profile, permissions: { write: false, execute: false } },
        compact: { ...profile, outputLimitBytes: 1024 },
      },
    }),
  );
  const env = safeEnvironment();
  const sdkConfig: ConnectionConfig = {
    name: "synthetic",
    baseUrl: profile.baseUrl,
    username: "synthetic-account",
    password: "synthetic-only",
    timeoutMs: 2000,
    maxResponseBytes: 32 * 1024 * 1024,
    outputLimitBytes: 24000,
    runtimeDir: profile.runtimeDir,
    permissions: { write: false, execute: false },
  };
  async function cli(args: string[], stdin = "", extraEnv: Record<string, string> = {}) {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", bin, "--config", configPath, ...args],
      { cwd, env: { ...env, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const closed = new Promise<number | null>((done, reject) => {
      child.on("error", reject);
      child.on("close", done);
    });
    child.stdin.end(stdin);
    return {
      code: await closed,
      stdout,
      stderr,
      result: stdout ? (JSON.parse(stdout) as OperationResult) : undefined,
    };
  }
  async function close() {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.match(basename(directory), /^wtctl-e2e-/);
    await rm(directory, { recursive: true, force: true });
  }
  return {
    directory,
    configPath,
    cli,
    methods,
    docUrls,
    scriptExecutions,
    env,
    sdkConfig,
    logName,
    appendLog: (text: string) => {
      logText += text;
    },
    source: () => source,
    binaryPut: () => binaryPut,
    close,
  };
}

test(
  "настоящий CLI создаёт, правит, читает и удаляет через подставной HTTP-сервер",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      const create = await f.cli(
        ["object", "create", "education_mode", "--stdin"],
        '{"name":"Created"}',
      );
      assert.equal(create.code, 0, create.stdout + create.stderr + JSON.stringify(f.methods));
      assert.equal(typeof (create.result?.data as { id: string }).id, "string");
      assert.equal(BigInt((create.result?.data as { id: string }).id), BigInt(objectId));
      const id = (create.result?.data as { id: string }).id;
      const writesBefore = f.methods.filter((method) => method === "PutDoc").length;
      const exportFailed = await f.cli(
        ["object", "patch", "education_mode", id, "--stdin", "--output", f.directory],
        '{"name":"AppliedBeforeExportFailure"}',
      );
      assert.equal(exportFailed.code, 1);
      assert.equal(exportFailed.result?.error?.code, "cli.output_failed");
      assert.equal(exportFailed.result?.error?.retryable, false);
      assert.equal(exportFailed.result?.meta.outputFailed, true);
      assert.equal(
        (exportFailed.result?.data as { mutationOutcome: string }).mutationOutcome,
        "confirmed",
      );
      assert.match(f.source()!, /<name>AppliedBeforeExportFailure<\/name>/);
      assert.equal(f.methods.filter((method) => method === "PutDoc").length, writesBefore + 1);
      // Включить будущее поле, как если бы расширение добавил сервер или другой клиент.
      const put = await f.cli(
        ["doc", "put", "x-local://wt_data/synthetic.xml", "--stdin"],
        "<education_mode><id>" +
          id +
          '</id><name>Created</name><future vendor="fixture">preserve</future></education_mode>',
      );
      assert.equal(put.code, 0, put.stdout + put.stderr);
      const patched = await f.cli(
        ["object", "patch", "education_mode", id, "--stdin"],
        '{"name":"Changed"}',
      );
      assert.equal(patched.code, 0, patched.stdout + patched.stderr);
      assert.match(f.source()!, /<future vendor="fixture">preserve<\/future>/);
      const read = await f.cli(["object", "get", "education_mode", id, "--fields", "id,name"]);
      assert.equal(read.code, 0, read.stdout + read.stderr);
      assert.deepEqual((read.result?.data as { data: unknown }).data, { id, name: "Changed" });
      const query = await f.cli([
        "query",
        "--catalog",
        "education_modes",
        "--fields",
        "id,name",
        "--limit",
        "1",
      ]);
      assert.equal(query.code, 0, query.stdout + query.stderr);
      assert.deepEqual((query.result?.data as { items: unknown[] }).items, [
        { id, name: "Changed" },
      ]);
      const rpc = await f.cli(["rpc", "tools", "get_version", "--args", '["wtv"]']);
      assert.equal(rpc.code, 0, rpc.stdout + rpc.stderr);
      const methodsBeforeExec = f.methods.length;
      const documentBeforeExec = f.source();
      const exec = await f.cli(["exec", "--stdin"], script);
      assert.equal(exec.code, 0, exec.stdout + exec.stderr);
      const execution = exec.result?.data as ScriptData<{
        value: string;
        text: string;
        enabled: string;
        id: string;
      }>;
      assert.equal(execution.executionId, f.scriptExecutions[0]);
      const { executionId: cliExecutionId, ...cliSemantic } = execution;
      assert.match(cliExecutionId, /^hcm_inline_[a-f0-9]{32}$/);
      assert.deepEqual(cliSemantic, {
        result: [{ value: "42", text: "Привет & <ok>", enabled: "true", id: objectId }],
      });
      assert.deepEqual(f.methods.slice(methodsBeforeExec), [
        "HTTP:/spxml_web/main.htm",
        "OpenSession",
        "CallMethod",
        "CloseSession",
        "HTTP:/spxml_web/logout.htm",
        "HTTP:/spxml_web/logout2.htm",
      ]);
      assert.equal(
        f.source(),
        documentBeforeExec,
        "the unsaved collection workflow must not persist a document",
      );
      await withHcmClient(
        { ...f.sdkConfig, permissions: { write: false, execute: true } },
        async (hcm) => {
          const sdkExecution = unwrap(
            await hcm.execute<{ value: string; text: string; enabled: string; id: string }>(script),
          );
          assert.equal(sdkExecution.executionId, f.scriptExecutions[1]);
          assert.notEqual(sdkExecution.executionId, cliExecutionId);
          const { executionId: sdkExecutionId, ...sdkSemantic } = sdkExecution;
          assert.match(sdkExecutionId, /^hcm_inline_[a-f0-9]{32}$/);
          assert.deepEqual(
            sdkSemantic,
            cliSemantic,
            "the typed SDK must preserve collection values while generating a distinct local execution receipt",
          );
        },
      );
      const deletion = await f.cli([
        "object",
        "delete",
        "education_mode",
        id,
        "--permanent",
        "--catalog",
        "education_modes",
      ]);
      assert.equal(deletion.code, 0, deletion.stdout + deletion.stderr);
      assert.equal(f.source(), undefined);
      assert.equal(
        f.methods.filter((method) => method === "OpenSession").length,
        f.methods.filter((method) => method === "CloseSession").length,
      );
      await withHcmClient(
        { ...f.sdkConfig, permissions: { write: true, execute: false } },
        async (hcm) => {
          const created = unwrap(
            await hcm.create({
              type: "education_mode",
              data: { name: "SDK", enabled: true, count: 2 },
            }),
          );
          assert.equal(BigInt(created.id), BigInt(objectId));
          assert.equal("data" in created, false, "a write returns a receipt, not the document");
          const stored = unwrap(await hcm.get({ id: created.id }));
          assert.equal(stored.data.enabled, "true");
          assert.equal(stored.data.count, "2");
          const patched = unwrap(
            await hcm.patch({ id: created.id, patch: { name: "SDK Changed" } }),
          );
          assert.deepEqual(patched.changes, [
            { op: "set", path: "name", before: "SDK", after: "SDK Changed" },
          ]);
          const read = unwrap(await hcm.get({ id: created.id }));
          assert.equal(read.data.name, "SDK Changed");
          const removed = unwrap(await hcm.delete({ id: created.id, permanent: true }));
          assert.equal(removed.catalog, "education_modes");
        },
      );
      assert.equal(f.source(), undefined);
    } finally {
      await f.close();
    }
  },
);

test(
  "настоящий CLI: двоичный ввод, неверный argv, пароль через stdin и общий пакет работают на точных границах",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      const bytes = Buffer.from([0, 255, 254, 65]);
      const path = join(f.directory, "binary.bin");
      await writeFile(path, bytes);
      const binary = await f.cli([
        "files",
        "write",
        "x-local://wtv/synthetic.bin",
        "--input-file",
        path,
      ]);
      assert.equal(binary.code, 0, binary.stdout + binary.stderr);
      assert.ok(f.binaryPut()?.includes(bytes));
      const before = f.methods.length;
      const invalid = await f.cli(["--password=synthetic-private-argv"]);
      assert.equal(invalid.code, 2);
      assert.equal(invalid.stdout, "");
      assert.doesNotMatch(invalid.stderr, /synthetic-private-argv/);
      assert.equal(f.methods.length, before);
      const status = await f.cli(["status", "--password-stdin"], "synthetic-private-stdin\n", {
        WTCTL_USERNAME: "synthetic-account",
      });
      assert.equal(status.code, 0, status.stdout + status.stderr);
      assert.doesNotMatch(status.stdout + status.stderr, /synthetic-private-stdin/);
      const batch = await f.cli(
        ["run", "--stdin"],
        JSON.stringify({
          steps: [
            { id: "objects.get", args: { type: "education_mode", id: objectId }, as: "current" },
            {
              id: "objects.patch",
              args: {
                type: "education_mode",
                id: { $ref: "current.data.id" },
                patch: { name: "Batch" },
              },
            },
          ],
        }),
      );
      assert.equal(batch.code, 0, batch.stdout + batch.stderr);
      assert.match(f.source()!, /<name>Batch<\/name>/);
    } finally {
      await f.close();
    }
  },
);

test(
  "настоящая точка входа MCP в CLI выполняет вызовы SDK по stdio и вызовы к подставному серверу",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", bin, "--config", f.configPath, "mcp"],
      cwd,
      env: f.env,
      stderr: "pipe",
    });
    let diagnostics = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      diagnostics += chunk.toString("utf8");
    });
    const client = new Client({ name: "synthetic-cli-tests", version: "1.0.0" });
    try {
      await client.connect(transport);
      assert.equal((await client.listTools()).tools.length, 23);
      const status = await client.callTool({ name: "hcm_status", arguments: {} });
      assert.equal(mcpJson(status).ok, true);
      const read = await client.callTool({
        name: "hcm_object_get",
        arguments: { type: "education_mode", id: objectId },
      });
      assert.equal(mcpJson(read).ok, true);
      const mutation = await client.callTool({
        name: "hcm_api_read",
        arguments: {
          operationId: "native.lds.loadDoc",
          args: { url: "x-local://wt_data/synthetic.xml", tryLock: true },
        },
      });
      assert.equal(mutation.isError, true);
      assert.equal(mcpJson(mutation).error?.code, "mcp.effect_mismatch");
      const logs = await client.callTool({
        name: "hcm_logs_list",
        arguments: { type: "xhttp", startDate: "2026-09-30", endDate: "2026-09-30" },
      });
      assert.equal(mcpJson(logs).ok, true);
      const logRead = await client.callTool({
        name: "hcm_log_read",
        arguments: { file: f.logName, tailBytes: 128 },
      });
      assert.equal((mcpJson(logRead).data as LogText).file, f.logName);
      const logSearch = await client.callTool({
        name: "hcm_logs_search",
        arguments: { file: f.logName, level: "error" },
      });
      assert.equal((mcpJson(logSearch).data as LogMatches).events.length, 1);
      const logFollow = await client.callTool({
        name: "hcm_log_follow",
        arguments: { file: f.logName },
      });
      assert.equal(typeof (mcpJson(logFollow).data as LogNews).cursor, "string");
      const before = f.methods.length;
      const invalidFile = await client.callTool({
        name: "hcm_log_read",
        arguments: { file: "../private.log" },
      });
      assert.equal(mcpJson(invalidFile).error?.code, "INVALID_LOG_FILE");
      assert.equal(f.methods.length, before);
    } finally {
      await client.close();
      await f.close();
    }
    assert.equal(diagnostics, "");
  },
);

test(
  "логи настоящего CLI используют проверенные RPC только на чтение, многострочный поиск и явные курсоры слежения",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      const list = await f.cli([
        "--connection",
        "readonly",
        "logs",
        "list",
        "--date",
        "2026-09-30",
        "--type",
        "xhttp",
        "--name-contains",
        "http",
      ]);
      assert.equal(list.code, 0, list.stdout + list.stderr);
      const files = (list.result?.data as { files: { name: string; url: string }[] }).files;
      assert.equal(files.length, 1);
      assert.equal(files[0]?.name, f.logName);
      const full = await f.cli([
        "--connection",
        "readonly",
        "logs",
        "read",
        files[0]!.name,
        "--full",
      ]);
      assert.equal(full.code, 0, full.stdout + full.stderr);
      assert.equal((full.result?.data as LogText).tailOnly, false);
      const tail = await f.cli([
        "--connection",
        "readonly",
        "logs",
        "tail",
        f.logName,
        "--tail-bytes",
        "24",
      ]);
      assert.equal(tail.code, 0, tail.stdout + tail.stderr);
      assert.equal((tail.result?.data as LogText).tailOnly, true);
      assert.deepEqual(Object.keys(tail.result?.data as LogText), [
        "file",
        "text",
        "sizeBytes",
        "tailOnly",
        "fingerprint",
      ]);
      const search = await f.cli([
        "--connection",
        "readonly",
        "logs",
        "search",
        f.logName,
        "--text",
        "frame",
        "--context",
        "R2",
        "--level",
        "error",
        "--limit",
        "1",
      ]);
      assert.equal(search.code, 0, search.stdout + search.stderr);
      const events = search.result?.data as LogMatches;
      assert.equal(events.events.length, 1);
      assert.equal(events.events[0]?.time, "12:00:01");
      assert.match(events.events[0]!.text, /\n    at frame/);
      assert.doesNotMatch(events.events[0]!.text, /^12:00:01/, "time is a separate field");
      assert.equal("message" in events.events[0]!, false, "each fact appears once");
      const first = await f.cli(["--connection", "readonly", "logs", "follow", f.logName]);
      assert.equal(first.code, 0, first.stdout + first.stderr);
      const initial = first.result?.data as LogNews;
      const same = await f.cli([
        "--connection",
        "readonly",
        "logs",
        "follow",
        f.logName,
        "--cursor",
        initial.cursor,
      ]);
      assert.equal(same.code, 0, same.stdout + same.stderr);
      assert.deepEqual((same.result?.data as LogNews).events, []);
      f.appendLog("12:00:02 [r3] INFO appended\n");
      const next = await f.cli([
        "--connection",
        "readonly",
        "logs",
        "follow",
        f.logName,
        "--cursor",
        initial.cursor,
      ]);
      assert.equal(next.code, 0, next.stdout + next.stderr);
      const followed = next.result?.data as LogNews;
      assert.equal(followed.events.length, 1);
      assert.equal(followed.events[0]?.context, "r3");
      assert.equal(followed.gapPossible, false);
      const changed = await f.cli([
        "--connection",
        "readonly",
        "logs",
        "search",
        f.logName,
        "--expected-fingerprint",
        events.fingerprint,
      ]);
      assert.equal(changed.code, 1);
      assert.equal(changed.result?.error?.code, "LOG_CHANGED");
      assert.equal(f.methods.includes("Eval"), false);
      assert.equal(f.methods.includes("PutDoc"), false);
      await withHcmClient(f.sdkConfig, async (hcm) => {
        const listed = unwrap(
          await hcm.listLogs({ type: "xhttp", startDate: "2026-09-30", endDate: "2026-09-30" }),
        );
        assert.equal(listed.files[0]?.name, f.logName);
        const read = unwrap(await hcm.readLog({ file: listed.files[0]!.name, full: true }));
        assert.match(read.text, /12:00:02/);
        const found = unwrap(
          await hcm.searchLogs({ file: f.logName, level: "error", text: "frame" }),
        );
        assert.equal(found.events.length, 1);
        const current = unwrap(await hcm.followLog({ file: f.logName }));
        const unchanged = unwrap(await hcm.followLog({ file: f.logName, cursor: current.cursor }));
        assert.equal(unchanged.changed, false);
        assert.equal(unchanged.events.length, 0);
      });
    } finally {
      await f.close();
    }
  },
);

test(
  "адресация объектов в настоящем CLI совпадает с SDK при правах только на чтение",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      const initialSource = f.source();
      const expected = await withHcmClient(f.sdkConfig, async (hcm) =>
        unwrap(await hcm.get({ id: objectId, fields: ["id", "name"] })),
      );
      assert.equal(expected.id, objectId);
      assert.ok(typeof expected.url === "string" && expected.url.length > 0);
      for (const target of [
        ["--id", objectId],
        ["--url", expected.url, "--type", "education_mode"],
        ["education_mode", objectId],
      ]) {
        const read = await f.cli([
          "--connection",
          "readonly",
          "object",
          "get",
          ...target,
          "--fields",
          "id,name",
        ]);
        assert.equal(read.code, 0, read.stdout + read.stderr);
        assert.equal(read.stderr, "");
        assert.deepEqual(read.result?.data, expected);
      }
      const preview = await f.cli(
        [
          "--connection",
          "readonly",
          "object",
          "patch",
          "--url",
          expected.url,
          "--stdin",
          "--preview",
          "--expected-fingerprint",
          expected.fingerprint,
        ],
        '{"name":"Preview via URL"}',
      );
      assert.equal(preview.code, 0, preview.stdout + preview.stderr);
      assert.equal(preview.stderr, "");
      assert.equal((preview.result?.data as { preview: boolean }).preview, true);
      assert.deepEqual((preview.result?.data as { changes: unknown }).changes, [
        { op: "set", path: "name", before: "Initial", after: "Preview via URL" },
      ]);
      assert.equal((preview.result?.data as { noop: boolean }).noop, false);
      assert.equal(f.source(), initialSource);
      const mismatch = await f.cli([
        "--connection",
        "readonly",
        "object",
        "get",
        "--id",
        objectId,
        "--type",
        "collaborator",
      ]);
      assert.equal(mismatch.code, 1);
      assert.equal(mismatch.result?.error?.code, "TYPE_MISMATCH");
      assert.deepEqual(
        f.docUrls,
        Array.from({ length: 6 }, () => expected.url),
      );
      assert.equal(f.methods.filter((method) => method === "CloseSession").length, 6);
      assert.equal(f.methods.filter((method) => method === "HTTP:/loggedoff.html").length, 6);
      const requestsBefore = f.methods.length;
      for (const command of [
        ["object", "patch", "--id", objectId, "--stdin"],
        ["object", "delete", "--url", expected.url, "--permanent"],
      ]) {
        const denied = await f.cli(["--connection", "readonly", ...command], '{"name":"Denied"}');
        assert.equal(denied.code, 1);
        assert.equal(denied.result?.error?.code, "WRITE_DISABLED");
        assert.equal(f.methods.length, requestsBefore);
      }
      for (const command of [
        ["object", "get", "--id", objectId, "--url", expected.url],
        ["object", "get", "education_mode", objectId, "--type", "education_mode"],
        ["object", "delete", "--url", expected.url],
      ]) {
        const invalid = await f.cli(["--connection", "readonly", ...command]);
        assert.equal(invalid.code, 2);
        assert.equal(JSON.parse(invalid.stderr).error.code, "cli.invalid_input");
        assert.equal(f.methods.length, requestsBefore);
      }
      assert.equal(f.source(), initialSource);
      assert.ok(
        f.methods.every(
          (method) => !["PutDoc", "DeleteDoc", "GetNewObjectID", "CallMethod"].includes(method),
        ),
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "обзор, права, предпросмотр и файлы вывода настоящего CLI совпадают с общим runtime",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      const list = await f.cli([
        "api",
        "list",
        "--group",
        "lds",
        "--effect",
        "read",
        "--limit",
        "2",
      ]);
      assert.equal(list.code, 0, list.stdout + list.stderr);
      const page = list.result?.data as {
        operations: { id: string; effect: string }[];
        nextCursor: number;
      };
      assert.equal(page.operations.length, 2);
      assert.equal(
        page.operations.every((op) => op.effect === "read"),
        true,
      );
      assert.equal(page.nextCursor, 2);
      assert.equal(f.methods.length, 0);
      const describe = await f.cli(["api", "describe", "native.lds.loadDoc"]);
      assert.equal(describe.code, 0, describe.stdout + describe.stderr);
      assert.equal((describe.result?.data as { id: string }).id, "native.lds.loadDoc");
      assert.equal(f.methods.length, 0);
      const rpcList = await f.cli([
        "--connection",
        "readonly",
        "rpc",
        "list",
        "--built-in",
        "--library",
        "tools",
        "--method",
        "get_version",
      ]);
      assert.equal(rpcList.code, 0, rpcList.stdout + rpcList.stderr);
      const rpcPage = rpcList.result?.data as RpcCatalogPage;
      assert.equal(rpcPage.total, 1);
      assert.equal(rpcPage.targets[0]?.id, "tools.get_version");
      assert.deepEqual(rpcPage.targets[0]?.parameters, ["sTypeParam", "bDateFlag"]);
      assert.equal(rpcPage.targets[0]?.allowed, true);
      assert.equal(rpcPage.source, "built-in 2025.1.1171");
      const rpcDescribe = await f.cli([
        "--connection",
        "readonly",
        "rpc",
        "describe",
        "tools.get_version",
        "--built-in",
        "--source",
      ]);
      assert.equal(rpcDescribe.code, 0, rpcDescribe.stdout + rpcDescribe.stderr);
      const rpcTarget = rpcDescribe.result?.data as RpcTargetDescription;
      assert.equal(rpcTarget.source, "built-in 2025.1.1171");
      assert.equal(rpcTarget.code, undefined);
      const rpcUnknown = await f.cli(["rpc", "describe", "tools.synthetic_missing", "--built-in"]);
      assert.equal(rpcUnknown.code, 1);
      assert.equal(rpcUnknown.result?.error?.code, "UNKNOWN_RPC_TARGET");
      await withHcmClient(f.sdkConfig, async (hcm) => {
        const first = unwrap(await hcm.listRpc({ limit: 2, builtIn: true }));
        assert.equal(first.total, 263);
        assert.equal(first.nextCursor, 2);
        const second = unwrap(
          await hcm.listRpc({ limit: 2, cursor: first.nextCursor!, builtIn: true }),
        );
        assert.equal(second.nextCursor, 4);
        assert.equal(first.targets[0]?.id, "i18n.obtain_const_translate_data");
        assert.equal(first.targets[0]?.allowed, null);
        assert.equal(new Set([...first.targets, ...second.targets].map((item) => item.id)).size, 4);
        assert.deepEqual(
          unwrap(await hcm.describeRpc("tools.get_version", { builtIn: true })).parameters,
          ["sTypeParam", "bDateFlag"],
        );
      });
      assert.equal(
        f.methods.length,
        0,
        "Built-in RPC discovery must not contact the configured server",
      );
      const denyWrite = await f.cli(
        ["--connection", "readonly", "object", "create", "education_mode", "--stdin"],
        '{"name":"Denied"}',
      );
      assert.equal(denyWrite.code, 1);
      assert.equal(denyWrite.result?.error?.code, "WRITE_DISABLED");
      assert.equal(denyWrite.result?.error?.mutationOutcome, "not_sent");
      const denyExec = await f.cli(["--connection", "readonly", "query", "(1)"]);
      assert.equal(denyExec.code, 1);
      assert.equal(denyExec.result?.error?.code, "EXECUTE_DISABLED");
      assert.equal(f.methods.length, 0);
      const preview = await f.cli(
        [
          "--connection",
          "readonly",
          "object",
          "patch",
          "education_mode",
          objectId,
          "--stdin",
          "--preview",
        ],
        '{"name":"Preview"}',
      );
      assert.equal(preview.code, 0, preview.stdout + preview.stderr);
      assert.equal((preview.result?.data as { preview: boolean }).preview, true);
      assert.match(f.source()!, /<name>Initial<\/name>/);
      assert.equal(f.methods.includes("PutDoc"), false);
      const schema = await f.cli(["schema", "education_mode"]);
      assert.equal(schema.code, 0, schema.stdout + schema.stderr);
      const schemaData = schema.result?.data as { type: string; fields: { path: string }[] };
      assert.equal(schemaData.type, "education_mode");
      assert.ok(schemaData.fields.some((field) => field.path === "name"));
      const path = join(f.directory, "output", "object.json");
      const saved = await f.cli(["object", "get", "education_mode", objectId, "--output", path]);
      assert.equal(saved.code, 0, saved.stdout + saved.stderr);
      assert.deepEqual(saved.result?.data, { saved: true, output: path });
      const full = JSON.parse(await readFile(path, "utf8")) as OperationResult;
      assert.equal((full.data as { data: { id: string } }).data.id, objectId);
    } finally {
      await f.close();
    }
  },
);

test(
  "настоящий CLI продолжает с сохранённым JSON, не повторяя операцию на сервере, и сохраняет сбои пакета",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      const large = await f.cli(["--connection", "compact", "rpc", "tools", "synthetic_large"]);
      assert.equal(large.code, 3, large.stdout + large.stderr);
      assert.equal(large.result?.meta.truncated, true);
      const resultId = large.result?.meta.resultId;
      assert.equal(typeof resultId, "string");
      const before = f.methods.length;
      let offset = 0;
      let text = "";
      for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
        const page = await f.cli([
          "--connection",
          "compact",
          "result",
          "read",
          resultId!,
          "--format",
          "json",
          "--offset",
          String(offset),
        ]);
        assert.equal(page.code, 0, page.stdout + page.stderr);
        const data = page.result?.data as { text: string; nextOffset?: number; format: string };
        assert.equal(data.format, "json");
        text += data.text;
        if (data.nextOffset === undefined) break;
        assert.ok(data.nextOffset > offset);
        offset = data.nextOffset;
      }
      assert.deepEqual(JSON.parse(text), { value: "fixture-".repeat(250) });
      assert.equal(f.methods.length, before);
      const crossProfile = await f.cli(["result", "read", resultId!, "--format", "json"]);
      assert.equal(crossProfile.code, 1);
      assert.equal(crossProfile.result?.error?.code, "RESULT_NOT_FOUND");
      const failed = await f.cli(
        ["run", "--stdin"],
        JSON.stringify({
          steps: [
            { id: "objects.get", args: { type: "education_mode", id: objectId } },
            {
              id: "objects.patch",
              args: {
                type: "education_mode",
                id: objectId,
                patch: { name: "DeniedByConflict" },
                expectedFingerprint: "stale",
              },
            },
            { id: "execute.script", args: { code: "RESULT=[{value:1}];" } },
          ],
        }),
      );
      assert.equal(failed.code, 1);
      assert.equal(failed.result?.error?.code, "BATCH_FAILED");
      const data = failed.result?.data as { completed: number; results: OperationResult[] };
      assert.equal(data.completed, 2);
      assert.equal(data.results[0]?.ok, true);
      assert.equal(data.results[1]?.error?.code, "CONFLICT");
      assert.equal(f.methods.includes("Eval"), false);
      assert.match(f.source()!, /<name>Initial<\/name>/);
    } finally {
      await f.close();
    }
  },
);
