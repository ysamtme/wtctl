import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogReader, LogReadUnavailableError, type LogGateway } from "../src/logs.js";
import { WsHcmApiError, attachCleanupError } from "../src/protocol/error.js";
import { escapeXml, findXmlNode, parseXml } from "../src/protocol/xml.js";
import { HcmRuntime } from "../src/runtime.js";
import { HcmClient } from "../src/sdk.js";
import { runCli } from "../src/cli/run.js";
import type { CliIo } from "../src/cli/types.js";
import { HcmMcpTools } from "../src/mcp/server.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import { mcpJson } from "./mcp-json.js";

const name = "xhttp_2026-09-30.log";
const size = "76";
const notice = "Показано последние 76 байт файла. Для просмотра всего файла его нужно сохранить.\n";
function report(file = name): string {
  const cells = [
    "Основной журнал",
    "30.09.2026",
    file,
    size,
    "xhttp",
    "false",
    `x-local://Logs/${encodeURIComponent(file)}`,
  ];
  return `<data><rs><r><cs>${cells.map((value) => `<c><t>${escapeXml(value)}</t></c>`).join("")}</cs></r></rs></data>`;
}
function fault(operation = "CallMethod", options: { requestSent?: boolean; cause?: unknown } = {}) {
  return new WsHcmApiError("soap-fault", "File already opened: private-server-diagnostic", {
    operation,
    status: 500,
    ...options,
  });
}
/** refusals: сколько раз сервер отказывает в чтении содержимого, прежде чем отдаст текст. */
function readerFixture(
  error: unknown,
  phase: "before" | "content" | "after" = "content",
  refusals = Number.POSITIVE_INFINITY,
) {
  const calls: string[] = [];
  let reports = 0;
  let reads = 0;
  const gateway: LogGateway = {
    async call(id, args) {
      assert.equal(id, "native.rpc.call");
      const target = String(args.target);
      calls.push(target);
      if (target === "tools_report.server_log_report") {
        reports++;
        if ((phase === "before" && reports === 1) || (phase === "after" && reports === 2))
          throw error;
        return { valueType: "string", lexicalValue: report() };
      }
      assert.equal(target, "tools.load_url_data_server");
      if (phase === "content" && ++reads <= refusals) throw error;
      return { valueType: "string", lexicalValue: notice + "text" };
    },
  };
  return { reader: new LogReader(gateway, { maxResponseBytes: 65536, logBusyMs: 20 }), calls };
}

test("лог, в чтении которого сервер отказывает дважды, сообщается как недоступный, без собственного текста сервера", async () => {
  for (const full of [false, true]) {
    const original = fault();
    const inheritedCleanup = new WsHcmApiError("cleanup", "private inherited cleanup fault", {
      cause: new WsHcmApiError("http", "HTTP500 cleanup", { status: 500 }),
    });
    original.cleanupError = inheritedCleanup;
    const f = readerFixture(original);
    await assert.rejects(
      f.reader.read({ file: name, ...(full ? { full: true } : { tailBytes: 512 }) }),
      (error: unknown) => {
        assert.ok(error instanceof LogReadUnavailableError);
        assert.equal(error.code, "LOG_READ_UNAVAILABLE");
        assert.equal(error.toJSON().details, undefined);
        assert.ok(Object.isExtensible(error), "scoped owners can preserve cleanup failures");
        const cleanup = new WsHcmApiError("cleanup", "own scoped cleanup failed");
        attachCleanupError(error, cleanup);
        const attached = Reflect.get(error, "cleanupError");
        assert.ok(attached instanceof AggregateError);
        assert.equal(attached.errors.at(-1), cleanup);
        assert.ok(attached.errors.includes(inheritedCleanup));
        assert.doesNotMatch(JSON.stringify(error.toJSON()), /private-server|File already opened/);
        return true;
      },
    );
    assert.deepEqual(f.calls, [
      "tools_report.server_log_report",
      "tools.load_url_data_server",
      "tools_report.server_log_report",
      "tools.load_url_data_server",
    ]);
  }
});

test("лог, в чтении которого сервер отказал один раз, читается повторной попыткой после паузы на занятость", async () => {
  const f = readerFixture(fault(), "content", 1);
  const started = Date.now();
  const read = await f.reader.read({ file: name, tailBytes: 512 });
  assert.equal(read.text, "text");
  assert.ok(Date.now() - started >= 15, "the repeat waits for the server to release the file");
  assert.deepEqual(f.calls, [
    "tools_report.server_log_report",
    "tools.load_url_data_server",
    "tools_report.server_log_report",
    "tools.load_url_data_server",
    "tools_report.server_log_report",
  ]);
});

test("чтение сразу после отклонённого запроса ждёт перед первой попыткой", async () => {
  const f = readerFixture(fault(), "after", 0);
  const waited = new LogReader(
    {
      call: async (_id, args) => ({
        valueType: "string",
        lexicalValue:
          String(args.target) === "tools_report.server_log_report" ? report() : notice + "text",
      }),
    },
    { maxResponseBytes: 65536, logBusyMs: 40 },
  );
  waited.serverWroteLog();
  const started = Date.now();
  await waited.read({ file: name, tailBytes: 512 });
  assert.ok(Date.now() - started >= 30);
  assert.equal(f.calls.length, 0);
});

test("заменяется только SOAP500 при чтении содержимого; ошибки bootstrap, отчёта, авторизации, транспорта, протокола и программирования остаются прежними", async () => {
  const errors: unknown[] = [
    new WsHcmApiError("auth", "auth", { status: 401 }),
    new WsHcmApiError("permission", "permission", { status: 403 }),
    new WsHcmApiError("http", "lost response"),
    new WsHcmApiError("http", "HTTP500", { status: 500 }),
    new WsHcmApiError("protocol", "invalid XML", { status: 200 }),
    new WsHcmApiError("cleanup", "cleanup"),
    new WsHcmApiError("soap-fault", "HTTP401", { operation: "CallMethod", status: 401 }),
    new WsHcmApiError("soap-fault", "HTTP403", { operation: "CallMethod", status: 403 }),
    new WsHcmApiError("soap-fault", "HTTP200", { operation: "CallMethod", status: 200 }),
    fault("OpenSession"),
    fault("CallMethod", { requestSent: false }),
    fault("CallMethod", {
      cause: new AggregateError([new WsHcmApiError("http", "body disconnected")], "loss"),
    }),
    new TypeError("local programming failure"),
  ];
  const nestedCleanup = fault();
  nestedCleanup.cleanupError = new WsHcmApiError("http", "lost cleanup response");
  errors.push(nestedCleanup);
  for (const error of errors) {
    const f = readerFixture(error);
    await assert.rejects(f.reader.read({ file: name }), (actual: unknown) => actual === error);
    assert.equal(f.calls.length, 2);
  }
  for (const phase of ["before", "after"] as const) {
    const original = fault();
    const f = readerFixture(original, phase);
    await assert.rejects(f.reader.read({ file: name }), (actual: unknown) => actual === original);
    assert.equal(f.calls.length, phase === "before" ? 1 : 3);
  }
});

type WireVariant = "fault" | "auth" | "permission" | "protocol" | "lost-body" | "bootstrap";
function wireFixture(directory: string, file = name, variant: WireVariant = "fault") {
  const targets: string[] = [];
  const calls: string[] = [];
  const bareFault =
    '<Fault><faultcode>Server</faultcode><faultstring x-faultstring-type="ui">Internal Server Error</faultstring></Fault>';
  const soap = (method: string, body = ""): Response =>
    new Response(
      `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response>${body}</${method}Response></soap:Body></soap:Envelope>`,
      {
        headers: {
          "content-type": "application/soap+xml",
          "set-cookie": "SessionID=private-cookie",
        },
      },
    );
  const config: ConnectionConfig = {
    name: "log-errors",
    baseUrl: "http://fixture.invalid/",
    username: "private-admin",
    password: "collide",
    runtimeDir: directory,
    timeoutMs: 1000,
    maxResponseBytes: 65536,
    outputLimitBytes: 1024,
    logBusyMs: 20,
    permissions: { write: false, execute: false },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const source = String(init?.body ?? "");
      const method = /<soap:Body><([A-Za-z0-9]+)/.exec(source)?.[1];
      calls.push(method ?? path);
      if (path === "/loggedoff.html") return new Response("");
      if (method === "OpenSession")
        return variant === "bootstrap"
          ? new Response(bareFault, { status: 500 })
          : soap(method, "<SessionID>41</SessionID>");
      if (method === "CloseSession") return soap(method);
      assert.equal(method, "CallMethod");
      const document = parseXml(source);
      const target = `${findXmlNode(document, "LibName")}.${findXmlNode(document, "MethodName")}`;
      targets.push(target);
      if (target === "tools_report.server_log_report")
        return soap(
          method,
          `<ResultData><Result VALUE-TYPE="string">${escapeXml(report(file))}</Result></ResultData>`,
        );
      assert.equal(target, "tools.load_url_data_server");
      if (variant === "auth") return new Response(bareFault, { status: 401 });
      if (variant === "permission") return new Response(bareFault, { status: 403 });
      if (variant === "protocol") return new Response("<not-valid", { status: 200 });
      if (variant === "lost-body")
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new TypeError("private lost body"));
            },
          }),
        );
      return new Response(bareFault, { status: 500, headers: { authorization: "private-header" } });
    },
  };
  return { config, calls, targets };
}
async function frontend(
  name: "sdk" | "cli" | "mcp",
  runtime: HcmRuntime,
  config: ConnectionConfig,
  file: string,
): Promise<OperationResult> {
  if (name === "sdk") return HcmClient.fromRuntime(runtime).readLog({ file, tailBytes: 512 });
  if (name === "mcp") {
    const response = await new HcmMcpTools(runtime).invoke("hcm_log_read", {
      file,
      tailBytes: 512,
    });
    assert.equal(response.isError, true);
    return mcpJson(response);
  }
  let stdout = "";
  let stderr = "";
  const unused = async (): Promise<never> => {
    throw new Error("No fixture file/artifact operation is allowed");
  };
  const io: CliIo = {
    writeOut: (value) => {
      stdout += value;
    },
    writeError: (value) => {
      stderr += value;
    },
    readStdin: unused,
    readFile: unused,
    writeFile: unused,
  };
  const exit = await runCli(["logs", "read", file, "--tail-bytes", "512"], io, {
    loadConfiguration: () => config,
    createRuntime: () => runtime,
    runMcp: unused,
  });
  assert.equal(exit, 1);
  assert.equal(stderr, "");
  return JSON.parse(stdout) as OperationResult;
}

test("SDK, CLI и MCP одинаково сообщают о логе, в чтении которого отказано, повторяют чтение один раз и не создают артефактов", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-log-errors-"));
  const file = "collide_2026-09-30.log";
  try {
    for (const surface of ["sdk", "cli", "mcp"] as const) {
      const f = wireFixture(directory, file);
      const runtime = new HcmRuntime(f.config);
      try {
        const result = await frontend(surface, runtime, f.config, file);
        assert.equal(result.ok, false);
        assert.equal(result.error?.code, "LOG_READ_UNAVAILABLE");
        assert.equal(result.error?.details, undefined);
        assert.equal(result.meta.resultId, undefined);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) <= f.config.outputLimitBytes);
        assert.doesNotMatch(
          JSON.stringify(result),
          /private-|Internal Server Error|faultCode|sharing/i,
        );
        assert.deepEqual(f.targets, [
          "tools_report.server_log_report",
          "tools.load_url_data_server",
          "tools_report.server_log_report",
          "tools.load_url_data_server",
        ]);
      } finally {
        await runtime.close();
      }
      assert.equal(f.calls.filter((call) => call === "CloseSession").length, 1);
    }
    assert.deepEqual(
      await readdir(directory),
      [],
      "failed reads create no context artifacts or fixture files",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("исходные ошибки авторизации, прав, неверного SOAP, потери тела ответа и bootstrap сохраняют свои категории платформы", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-log-errors-platform-"));
  const codes: Record<Exclude<WireVariant, "fault">, string> = {
    auth: "PLATFORM_AUTH",
    permission: "PLATFORM_PERMISSION",
    protocol: "PLATFORM_PROTOCOL",
    "lost-body": "PLATFORM_HTTP",
    bootstrap: "PLATFORM_SOAP-FAULT",
  };
  // 401 на открытой сессии: шлюз входит заново и отправляет запрос ещё раз.
  const targets: Record<Exclude<WireVariant, "fault">, number> = {
    auth: 3,
    permission: 2,
    protocol: 2,
    "lost-body": 2,
    bootstrap: 0,
  };
  try {
    for (const variant of Object.keys(codes) as Array<Exclude<WireVariant, "fault">>) {
      const f = wireFixture(directory, name, variant);
      const runtime = new HcmRuntime(f.config);
      try {
        const result = await HcmClient.fromRuntime(runtime).readLog({ file: name });
        assert.equal(result.ok, false);
        assert.equal(result.error?.code, codes[variant]);
        if (variant === "lost-body") assert.equal(result.error?.details?.status, undefined);
        assert.equal(f.targets.length, targets[variant]);
      } finally {
        await runtime.close();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("весь лог при повторе читается с тем размером, который он имеет после записи отказа", async () => {
  // Отказ в чтении добавляет строку в тот же лог: диапазон повтора идёт по новому размеру.
  const sizes = ["76", "140", "140"];
  const ranges: string[] = [];
  const gateway: LogGateway = {
    async call(_id, args) {
      if (String(args.target) === "tools_report.server_log_report")
        return {
          valueType: "string",
          lexicalValue: report().replace(`<t>${size}</t>`, `<t>${sizes.shift()}</t>`),
        };
      const range = (args.args as { lexicalValue: string }[])[1]!.lexicalValue;
      ranges.push(range);
      if (ranges.length === 1) throw fault();
      return { valueType: "string", lexicalValue: notice.replace("76", range) + "text" };
    },
  };
  const reader = new LogReader(gateway, { maxResponseBytes: 65536, logBusyMs: 20 });
  const read = await reader.read({ file: name, full: true });
  assert.deepEqual(ranges, ["76", "140"]);
  assert.equal(read.text, "text");
  assert.equal(read.sizeBytesBefore, "140");
});
