import test from "node:test";
import assert from "node:assert/strict";
import { checkServer, type CheckData } from "../src/self-check.js";
import { HcmClient } from "../src/sdk.js";
import { HcmRuntime } from "../src/runtime.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { HttpTransport } from "../src/protocol/transport.js";
import { DiagnosticsApi } from "../src/protocol/api.js";
import { runCli } from "../src/cli/run.js";
import type { CliIo } from "../src/cli/types.js";
import type { ConnectionConfig } from "../src/contracts.js";
const config: ConnectionConfig = {
  name: "check-fixture",
  baseUrl: "http://fixture.invalid/mounted/",
  timeoutMs: 1000,
  maxResponseBytes: 65536,
  outputLimitBytes: 1024,
  runtimeDir: ".unused",
  permissions: { write: false, execute: true },
};
const appInfo = {
  default_db_name: "sample",
  ui_lang_id: "en",
  databases: [{ id: "sample", catalogs: [{ id: "collaborators" }] }],
  shared_docs: [{ id: "custom_templates", url: "x-local://sample/custom.xml" }],
  config_entries: [
    { name: "ALLOW-SERVER-EVAL", value: "0" },
    { name: "URL-LOCKS", value: "1" },
    { name: "DATABASE", value: "private-database-string" },
  ],
};
const order = [
  "login",
  "version",
  "appInfo",
  "query",
  "document",
  "schema",
  "titles",
  "libraries",
  "logs",
  "portal",
  "execute",
];
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { id: string; args: Record<string, unknown> }[] = [];
  const values: Record<string, unknown> = {
    "native.session.open": { opened: true },
    "runtime.status": { version: "2025.2.synthetic" },
    "native.spxml2.getAppInfo": appInfo,
    "runtime.query": { items: [] },
    "objects.get": { data: {} },
    "schema.get": { fields: [{ origin: "own" }, { origin: "inherited:person" }] },
    "rpc.list": { source: "server" },
    "logs.list": [],
    "anonymous.diagnostics.portal": { status: 200 },
    "execute.script": { result: ["2"] },
    ...overrides,
  };
  return {
    calls,
    invoke: async (id: string, args: Record<string, unknown>) => {
      calls.push({ id, args });
      const value = values[id];
      if (value instanceof Error) throw value;
      return value;
    },
  };
}
test("все фиксированные пробы проходят по порядку, в том числе проба скрипта при отключённом eval на сервере", async () => {
  const f = fixture();
  const data = await checkServer(config, f.invoke);
  assert.deepEqual(
    data.checks,
    order.map((name) => ({ name, result: "ok" })),
  );
  assert.deepEqual(data.summary, { ok: 11, failed: 0, skipped: 0 });
  assert.equal(data.language, "en");
  assert.ok(!JSON.stringify(data).includes("private-database-string"));
  assert.deepEqual(
    f.calls.filter((c) => c.id === "objects.get").map((c) => c.args.url),
    ["x-local://sample/custom.xml", "x-local://lngs/english/const.xml"],
  );
  assert.deepEqual(f.calls.at(-1), { id: "execute.script", args: { code: "RESULT = [1 + 1];" } });
  assert.ok(Buffer.byteLength(JSON.stringify(data, null, 2)) < 3072);
});
test("одна отклонённая проба сохраняет последующие проверки и не включает текст ошибки сервера и подробности", async () => {
  const secret = "response-body\nCookie=session-secret C:\\server\\private user:password";
  const f = fixture({
    "runtime.query": new WsHcmApiError("soap-fault", secret, {
      status: 500,
      details: { body: secret },
    }),
  });
  const data = await checkServer(config, f.invoke);
  assert.deepEqual(data.summary, { ok: 10, failed: 1, skipped: 0 });
  assert.equal(data.checks[3]?.reason, "HTTP 500");
  assert.equal(data.checks.at(-1)?.result, "ok");
  assert.ok(!JSON.stringify(data).includes("session-secret"));
  assert.ok(data.checks.every((c) => !c.reason?.includes("\n")));
});
test("отключённый execute пропускается, а неудачный вход пропускает все оставшиеся пробы", async () => {
  const f = fixture();
  const readOnly = await checkServer(
    { ...config, permissions: { write: true, execute: false } },
    f.invoke,
  );
  assert.deepEqual(readOnly.summary, { ok: 10, failed: 0, skipped: 1 });
  assert.match(
    readOnly.checks.at(-1)!.reason!,
    /не разрешено подключением\. Право execute включает/,
  );
  assert.ok(!f.calls.some((c) => c.id === "execute.script"));
  const denied = fixture({ "native.session.open": new WsHcmApiError("auth", "secret") });
  const data = await checkServer(config, denied.invoke);
  assert.deepEqual(data.summary, { ok: 0, failed: 1, skipped: 10 });
  assert.equal(denied.calls.length, 1);
});
test("метаданные, наследование, исходный код библиотеки и статус портала проверяются независимо", async () => {
  const f = fixture({
    "native.spxml2.getAppInfo": { ...appInfo, databases: [{ id: "other", catalogs: [{}] }] },
    "schema.get": { fields: [{ origin: "own" }] },
    "rpc.list": { source: "built-in 2025.1.1171" },
    "anonymous.diagnostics.portal": { status: 503 },
    "execute.script": { result: ["3"] },
  });
  const data = await checkServer(config, f.invoke);
  assert.deepEqual(
    data.checks.filter((c) => c.result === "failed").map((c) => c.name),
    ["appInfo", "schema", "libraries", "portal", "execute"],
  );
});
test("зависшая проба сообщается по истечении срока, а последующие проверки всё равно выполняются", async () => {
  const f = fixture();
  const data = await checkServer({ ...config, timeoutMs: 20 }, (id, args) =>
    id === "runtime.query" ? new Promise(() => {}) : f.invoke(id, args),
  );
  assert.equal(data.checks[3]?.reason, "превышено время проверки");
  assert.equal(data.checks.at(-1)?.result, "ok");
});
test("портал использует один смонтированный ручной запрос, отменяет его тело и принимает перенаправления", async () => {
  let cancelled = 0;
  const transport = new HttpTransport({
    ...config,
    fetch: async (url, init) => {
      assert.equal(String(url), "http://fixture.invalid/mounted/loggedoff.html");
      assert.equal(init?.redirect, "manual");
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        { status: 302, headers: { location: "http://outside.invalid/" } },
      );
    },
  });
  assert.deepEqual(await new DiagnosticsApi(transport).portal(), { status: 302 });
  assert.equal(cancelled, 1);
  transport.dispose();
});
test("SDK и CLI сообщают о таймауте входа, сохраняют отчёт, завершаются с ненулевым кодом и не сохраняют проверки", async () => {
  const runtime = new HcmRuntime({
    ...config,
    timeoutMs: 20,
    fetch: (_, init) =>
      new Promise((_, reject) => {
        const signal = init!.signal!;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  });
  runtime.results.put = () => Promise.reject(new Error("check must not write results"));
  const result = await new HcmClient(runtime).check();
  assert.deepEqual((result.data as CheckData).summary, { ok: 0, failed: 1, skipped: 10 });
  const output = { text: "" };
  const io: CliIo = {
    writeOut: (s) => void (output.text += s),
    writeError: () => {},
    readFile: async () => "",
    readStdin: async () => "",
    writeFile: async () => {},
  };
  assert.equal(
    await runCli(["check"], io, {
      loadConfiguration: () => config,
      createRuntime: () => runtime,
      runMcp: async () => {},
    }),
    1,
  );
  assert.equal(JSON.parse(output.text).data.checks[0].reason, "превышено время проверки");
});
