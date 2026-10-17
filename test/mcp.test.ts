import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HcmMcpTools, createHcmMcpServer } from "../src/mcp/server.js";
import type { RuntimePort } from "../src/cli/types.js";
import type { OperationDefinition, OperationEffect, OperationResult } from "../src/contracts.js";
import { HcmError } from "../src/errors.js";
import { HcmRuntime } from "../src/runtime.js";
import type { ConnectionConfig } from "../src/contracts.js";
import { mcpJson } from "./mcp-json.js";
import { operationHelp } from "../src/operation-help.js";
import { scratchRuntimeDir } from "./fake-server.js";

function fixture() {
  const definitions: OperationDefinition[] = (
    ["read", "write", "execute", "unknown"] as OperationEffect[]
  ).map((effect) => ({
    id: `test.${effect}`,
    title: effect,
    description: "Synthetic contract",
    group: "test",
    effect,
    inputSchema: { type: "object", properties: { value: {} } },
  }));
  const calls: { id: string; args: Record<string, unknown> }[] = [];
  const filters: unknown[] = [];
  let closed = 0;
  const runtime: RuntimePort = {
    listOperations: (filter) => {
      filters.push(filter);
      return { operations: definitions, total: definitions.length };
    },
    describe: (id) => {
      const operation = definitions.find((item) => item.id === id);
      if (!operation) throw new HcmError("UNKNOWN_OPERATION", "Unknown operation.");
      return operation;
    },
    getOperationEffect: (id) => {
      const operation = definitions.find((item) => item.id === id);
      if (!operation) throw new HcmError("UNKNOWN_OPERATION", "Unknown operation.");
      return operation.effect;
    },
    call: async (id, args = {}) => {
      calls.push({ id, args });
      return {
        ok: true,
        data: { args },
        meta: { operationId: id, connection: "synthetic", durationMs: 1 },
      };
    },
    close: async () => {
      closed++;
    },
  };
  return {
    definitions,
    calls,
    filters,
    runtime,
    tools: new HcmMcpTools(runtime, { connectionName: "synthetic" }),
    closed: () => closed,
  };
}

function structured(value: unknown): OperationResult {
  const result = mcpJson(value);
  assert.equal((value as { isError?: boolean }).isError ?? false, !result.ok);
  return result;
}

test("все инструменты объявляют простые схемы ввода и осторожные аннотации", () => {
  const f = fixture();
  const names = f.tools.list().map((tool) => tool.name);
  assert.equal(new Set(names).size, 23);
  for (const tool of f.tools.list()) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.outputSchema, undefined, "the result shape is stated once in instructions");
    assert.equal(tool.annotations?.openWorldHint, true);
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean");
    // Комбинаторы и ограничения длины описаны словами: слабые модели и некоторые хосты обрабатывают их неправильно.
    assert.doesNotMatch(
      JSON.stringify(tool.inputSchema),
      /"(?:oneOf|anyOf|allOf|not|minLength|maxLength|maximum|minimum|const)":/,
      tool.name,
    );
    for (const property of Object.values(tool.inputSchema.properties ?? {}))
      assert.equal(typeof (property as { type?: unknown }).type, "string", tool.name);
  }
  for (const name of [
    "hcm_xquery",
    "hcm_script",
    "hcm_api_write",
    "hcm_api_execute",
    "hcm_object_create",
    "hcm_object_patch",
    "hcm_object_delete",
    "hcm_result_export",
  ]) {
    assert.equal(
      f.tools.list().find((tool) => tool.name === name)?.annotations?.readOnlyHint,
      false,
    );
  }
  const query = f.tools.list().find((tool) => tool.name === "hcm_query");
  assert.equal(
    query?.annotations?.readOnlyHint,
    true,
    "a catalog search must not prompt as a write",
  );
  assert.deepEqual(query?.inputSchema.required, ["catalog"]);
  assert.equal(
    f.tools.list().find((tool) => tool.name === "hcm_object_create")?.annotations?.destructiveHint,
    false,
  );
  assert.equal(
    f.tools.list().find((tool) => tool.name === "hcm_api_read")?.annotations?.idempotentHint,
    false,
    "generic native reads may consume a terminal asynchronous result",
  );
  assert.equal(
    f.tools.list().find((tool) => tool.name === "hcm_api_list")?.annotations?.idempotentHint,
    true,
  );
});

test("payload при запуске остаётся небольшим", () => {
  const f = fixture();
  const visible = f.tools
    .list()
    .map((tool) => tool.name + tool.description + JSON.stringify(tool.inputSchema))
    .join("");
  assert.ok(visible.length < 14_000, `model-visible tool text is ${visible.length} characters`);
  assert.ok(JSON.stringify(f.tools.list()).length < 19_000);
});

test("поиск операций без аргументов возвращает обзор по задачам и не делает вызовов", async () => {
  const f = fixture();
  const map = structured(await f.tools.invoke("hcm_api_list", {})).data as {
    topics: { topic: string; title: string; operations?: string[]; count?: number }[];
    total: number;
  };
  assert.equal(f.filters.length, 0);
  assert.equal(f.calls.length, 0);
  assert.ok(map.topics.some((topic) => topic.operations?.includes("rpc.list")));
  assert.ok(JSON.stringify(map).length < 3500);
});

test("инструменты обзора выдают описания операций и передают фильтры без сетевых вызовов", async () => {
  const f = fixture();
  const filter = { query: "synthetic", topic: "protocol", cursor: 1, limit: 2 };
  const page = structured(await f.tools.invoke("hcm_api_list", filter));
  assert.deepEqual(f.filters, [filter]);
  assert.equal(f.calls.length, 0);
  assert.equal((page.data as { total: number }).total, 4);
  assert.equal(
    (page.data as { operations: { inputSchema?: unknown }[] }).operations.every(
      (card) => card.inputSchema === undefined,
    ),
    true,
  );
  assert.deepEqual(
    structured(await f.tools.invoke("hcm_api_describe", { operationId: "test.read" })).data,
    operationHelp(f.definitions[0]!),
  );
  assert.equal(f.calls.length, 0);
});

test("общие инструменты применяют эффекты из реестра, а unknown — только через execute", async () => {
  for (const toolEffect of ["read", "write", "execute"] as const) {
    for (const effect of ["read", "write", "execute", "unknown"] as const) {
      const f = fixture();
      const allowed = effect === toolEffect || (effect === "unknown" && toolEffect === "execute");
      const result = structured(
        await f.tools.invoke(`hcm_api_${toolEffect}`, {
          operationId: `test.${effect}`,
          args: { value: "synthetic" },
        }),
      );
      assert.equal(result.ok, allowed, `${toolEffect}:${effect}`);
      assert.equal(f.calls.length, allowed ? 1 : 0);
      if (!allowed) assert.equal(result.error?.code, "mcp.effect_mismatch");
    }
  }
});

test("фактический эффект в runtime не пропускает TryLock и сырой запрос через инструменты чтения", async () => {
  let requests = 0;
  const config: ConnectionConfig = {
    name: "synthetic",
    baseUrl: "http://fixture.invalid",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    outputLimitBytes: 1024,
    runtimeDir: scratchRuntimeDir,
    permissions: { write: true, execute: true },
    fetch: async () => {
      requests++;
      throw new Error("unexpected-network");
    },
  };
  const runtime = new HcmRuntime(config);
  const tools = new HcmMcpTools(runtime);
  try {
    for (const args of [
      {
        operationId: "native.lds.loadDoc",
        args: { url: "x-local://wt_data/synthetic.xml", tryLock: true },
      },
      { operationId: "runtime.query", args: { query: "(1)" } },
      {
        operationId: "runtime.batch",
        args: {
          steps: [
            { id: "runtime.status", as: "policy" },
            {
              id: "native.lds.loadDoc",
              args: {
                url: "x-local://wt_data/synthetic.xml",
                tryLock: { $ref: "policy.data.permissions.write" },
              },
            },
          ],
        },
      },
      {
        operationId: "runtime.batch",
        args: {
          steps: [
            { id: "native.spxml2.getAppInfo", as: "metadata" },
            { id: "runtime.query", args: { $ref: "metadata.data.rawQueryArguments" } },
          ],
        },
      },
      {
        operationId: "runtime.batch",
        args: {
          steps: [
            { id: "native.spxml2.getAppInfo", as: "metadata" },
            { id: "native.lds.loadDoc", args: { $ref: "metadata.data.loadArguments" } },
          ],
        },
      },
    ]) {
      assert.equal(
        structured(await tools.invoke("hcm_api_read", args)).error?.code,
        "mcp.effect_mismatch",
      );
    }
    assert.equal(
      runtime.getOperationEffect("native.lds.loadDoc", { url: "x-local://wt_data/synthetic.xml" }),
      "read",
    );
    assert.equal(runtime.getOperationEffect("runtime.query", { catalog: "collaborators" }), "read");
    assert.equal(
      runtime.getOperationEffect("objects.patch", { type: "c", id: "1", patch: {}, preview: true }),
      "read",
    );
    assert.equal(requests, 0);
  } finally {
    await runtime.close();
  }
});

test("без прав чтение через rawRequest по GET, POST и getNewObjectId отклоняется без отправки", async () => {
  let requests = 0;
  const fetch = async () => (requests++, new Response("page"));
  const permissions = { write: false, execute: false };
  const base = {
    name: "synthetic",
    baseUrl: "http://fixture.invalid",
    runtimeDir: scratchRuntimeDir,
  };
  const runtime = new HcmRuntime({
    ...base,
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    outputLimitBytes: 1024,
    permissions,
    fetch,
  });
  const tools = new HcmMcpTools(runtime);
  const raw = (method: string) => ({
    operationId: "anonymous.experimental.rawRequest",
    args: { unsafe: true, path: "/page", method },
  });
  try {
    for (const method of ["GET", "head"])
      assert.equal(structured(await tools.invoke("hcm_api_read", raw(method))).ok, true);
    const post = raw("POST");
    const mismatch = structured(await tools.invoke("hcm_api_read", post));
    assert.equal(mismatch.error?.code, "mcp.effect_mismatch");
    assert.equal((await runtime.call(post.operationId, post.args)).error?.code, "WRITE_DISABLED");
    const id = await runtime.call("native.lds.getNewObjectId", { dbName: "wt_data" });
    assert.equal(id.error?.code, "WRITE_DISABLED");
    assert.equal(requests, 2);
  } finally {
    await runtime.close();
  }
});

const toolCases: { name: string; args: Record<string, unknown>; id: string }[] = [
  { name: "hcm_check", args: {}, id: "runtime.check" },
  { name: "hcm_status", args: {}, id: "runtime.status" },
  { name: "hcm_script", args: { code: "RESULT = [1];" }, id: "execute.script" },
  {
    name: "hcm_xquery",
    args: { query: "(1)", fields: ["id"], limit: 1, startPosition: 2 },
    id: "runtime.query",
  },
  {
    name: "hcm_query",
    args: { catalog: "collaborators", where: { code: "synthetic" }, fields: ["id"], limit: 20 },
    id: "runtime.query",
  },
  {
    name: "hcm_object_get",
    args: { type: "collaborator", id: "9007199254740993", fields: ["id", "name"] },
    id: "objects.get",
  },
  { name: "hcm_object_get", args: { url: "x-local://wt_data/synthetic.xml" }, id: "objects.get" },
  { name: "hcm_object_get", args: { id: "9007199254740993" }, id: "objects.get" },
  {
    name: "hcm_object_create",
    args: { type: "education_mode", data: { name: "Synthetic" } },
    id: "objects.create",
  },
  {
    name: "hcm_object_create",
    args: {
      type: "education_mode",
      data: { name: "Synthetic" },
      formUrl: "x-local://wtv/custom.xmd",
      dbName: "wt_data",
    },
    id: "objects.create",
  },
  {
    name: "hcm_object_patch",
    args: {
      type: "education_mode",
      id: "1",
      patch: { name: "Changed" },
      expectedFingerprint: "hash",
      preview: true,
    },
    id: "objects.patch",
  },
  {
    name: "hcm_object_delete",
    args: { type: "education_mode", id: "1", permanent: true },
    id: "objects.delete",
  },
  {
    name: "hcm_object_delete",
    args: { type: "education_mode", id: "1", permanent: true, catalog: "education_modes" },
    id: "objects.delete",
  },
  {
    name: "hcm_object_patch",
    args: { type: "education_mode", id: "1", patch: [{ op: "remove", path: "items[0]" }] },
    id: "objects.patch",
  },
  {
    name: "hcm_result_export",
    args: { resultId: "synthetic-result", path: "out.jsonl", format: "jsonl", overwrite: true },
    id: "results.export",
  },
  {
    name: "hcm_result_read",
    args: { resultId: "synthetic-result", offset: 0, limit: 100 },
    id: "results.read",
  },
  {
    name: "hcm_result_read",
    args: { resultId: "synthetic-result", format: "json" },
    id: "results.read",
  },
  {
    name: "hcm_result_read",
    args: { resultId: "synthetic-result", offset: 1000000 },
    id: "results.read",
  },
  {
    name: "hcm_schema",
    args: {
      type: "education_mode",
      search: "name",
      path: "doc_info",
      origin: ["inherited", "custom"],
      kind: "9007199254740993",
      include: ["methods"],
      language: "english",
      limit: 5,
      cursor: 2,
    },
    id: "schema.get",
  },
  { name: "hcm_types", args: { search: "collab", limit: 5, cursor: 2 }, id: "schema.types" },
  {
    name: "hcm_logs_list",
    args: {
      type: "xhttp",
      nameContains: "http",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      limit: 10,
    },
    id: "logs.list",
  },
  { name: "hcm_logs_read", args: { file: "xhttp_2026-09-30.log", full: true }, id: "logs.read" },
  {
    name: "hcm_logs_search",
    args: {
      file: "xhttp_2026-09-30.log",
      tailBytes: 1024,
      level: "error",
      text: "frame",
      context: "r2",
      limit: 10,
      expectedFingerprint: "synthetic",
    },
    id: "logs.search",
  },
  {
    name: "hcm_logs_follow",
    args: { file: "xhttp_2026-09-30.log", cursor: "opaque" },
    id: "logs.follow",
  },
];
for (const entry of toolCases)
  test(`${entry.name} передаёт общему runtime точные аргументы высокого уровня`, async () => {
    const f = fixture();
    assert.equal(structured(await f.tools.invoke(entry.name, entry.args)).ok, true);
    assert.deepEqual(f.calls, [{ id: entry.id, args: entry.args }]);
  });

test("hcm_script передаёт код больше 1 МиБ целиком", async () => {
  const f = fixture();
  const code = `RESULT = ["${"x".repeat(1024 * 1024)}"];`;
  assert.equal(structured(await f.tools.invoke("hcm_script", { code })).ok, true);
  assert.deepEqual(f.calls, [{ id: "execute.script", args: { code } }]);
});

test("hcm_script читает код из локального файла и передаёт params дальше", async () => {
  const f = fixture();
  const params = { ids: ["0x1"] };
  const file = fileURLToPath(new URL("../examples/script-params.js", import.meta.url));
  assert.equal(structured(await f.tools.invoke("hcm_script", { file, params })).ok, true);
  assert.deepEqual(f.calls, [
    { id: "execute.script", args: { code: readFileSync(file, "utf8"), params } },
  ]);
  const missing = structured(await f.tools.invoke("hcm_script", { file: `${file}.absent` }));
  assert.equal(missing.error?.code, "mcp.file_unreadable");
  assert.equal(f.calls.length, 1);
});

test("hcm_script не отправляет файл не в UTF-8, а BOM из файла убирает", async () => {
  const f = fixture();
  const directory = mkdtempSync(join(tmpdir(), "hcm-script-"));
  try {
    const file = join(directory, "code.js");
    // «Привет» в Windows-1251: такие байты не образуют UTF-8.
    const cp1251 = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    writeFileSync(file, Buffer.concat([Buffer.from("RESULT = ['"), cp1251, Buffer.from("'];")]));
    const refused = structured(await f.tools.invoke("hcm_script", { file }));
    assert.equal(refused.error?.code, "mcp.file_unreadable");
    assert.equal(refused.error?.message, "Файл с кодом должен быть текстом UTF-8.");
    assert.deepEqual(f.calls, []);
    writeFileSync(file, "﻿RESULT = ['Привет'];");
    assert.equal(structured(await f.tools.invoke("hcm_script", { file })).ok, true);
    assert.deepEqual(f.calls, [{ id: "execute.script", args: { code: "RESULT = ['Привет'];" } }]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("все неверные вводы отклоняются до runtime, с путями, по которым можно исправить, и без значений", async () => {
  const cases: [string, unknown][] = [
    ["hcm_api_list", { cursor: -1 }],
    ["hcm_api_list", { limit: 101 }],
    ["hcm_api_describe", {}],
    ["hcm_api_read", { operationId: "test.read", args: [] }],
    ["hcm_api_write", { operationId: 42 }],
    ["hcm_api_execute", []],
    ["hcm_status", { secret: "synthetic-private-value" }],
    ["hcm_query", {}],
    ["hcm_query", { query: "(1)", catalog: "c" }],
    ["hcm_query", { catalog: "c", limit: 1001 }],
    ["hcm_xquery", {}],
    ["hcm_xquery", { query: "(1)", catalog: "c" }],
    ["hcm_script", {}],
    ["hcm_script", { code: "RESULT = [];", file: "script.js" }],
    ["hcm_script", { code: "RESULT = [];", params: [1] }],
    ["hcm_object_patch", { type: "c", id: "1" }],
    ["hcm_object_patch", { patch: { name: "x" } }],
    ["hcm_object_patch", { id: "1", remove: "name" }],
    ["hcm_api_list", { group: "lds" }],
    ["hcm_object_get", { type: "collaborator", id: 9007199254740993 }],
    ["hcm_object_get", {}],
    ["hcm_object_create", { data: {} }],
    ["hcm_object_patch", { type: "c", id: "1", patch: [{ op: "invalid", path: "name" }] }],
    ["hcm_object_delete", { type: "c" }],
    ["hcm_object_delete", { type: "c", id: "1", permanent: false }],
    ["hcm_result_read", { resultId: "x", limit: 0 }],
    ["hcm_result_read", { resultId: "x", format: "xml" }],
    ["hcm_result_read", { resultId: "x", limit: 65537 }],
    ["hcm_schema", { type: 42 }],
    ["hcm_schema", {}],
    ["hcm_schema", { type: "collaborator", origin: ["other"] }],
    ["hcm_schema", { type: "collaborator", include: ["fields"] }],
    ["hcm_types", { limit: 0 }],
    ["hcm_logs_list", { limit: 1001 }],
    ["hcm_logs_read", {}],
    ["hcm_logs_read", { file: "x.log", full: true, tailBytes: 10 }],
    ["hcm_logs_search", { file: "x.log", level: "fatal" }],
    ["hcm_logs_search", { file: "x.log", full: true, tailBytes: 10 }],
    ["hcm_logs_follow", { file: "x.log", cursor: "x".repeat(8193) }],
    ["hcm_logs_follow", { file: "x.log", full: true, tailBytes: 10 }],
  ];
  for (const [name, args] of cases) {
    const f = fixture();
    const result = await f.tools.invoke(name, args);
    assert.equal(structured(result).error?.code, "mcp.invalid_arguments", name);
    assert.equal(f.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private-value/);
  }
  // Пустая строка названа так прямо, без строки про ID.
  const empty = structured(await fixture().tools.invoke("hcm_schema", { type: "x", search: "" }));
  assert.deepEqual(empty.error?.details, {
    validation: [
      {
        path: "search",
        code: "too_small",
        minimum: 1,
        message: "Пустая строка: убери аргумент.",
      },
    ],
  });
  assert.equal(empty.error?.hint, "Причины — в details.validation.");
  // Граница названа в самом сообщении.
  const big = structured(await fixture().tools.invoke("hcm_api_list", { limit: 1000 }));
  assert.deepEqual(
    [big.error?.message, big.error?.hint],
    [
      "Аргументы не подходят инструменту: limit — не больше 100.",
      "Причины — в details.validation. Остальное читается следующими страницами.",
    ],
  );
});

test("неизвестные инструменты и операции и неожиданные исключения остаются структурированными и безопасными", async () => {
  const f = fixture();
  assert.equal(structured(await f.tools.invoke("missing", {})).error?.code, "mcp.unknown_tool");
  assert.equal(
    structured(await f.tools.invoke("hcm_logs_raed", {})).error?.hint,
    "Похожие: hcm_logs_read. Получи список tools/list.",
  );
  assert.equal(
    structured(await f.tools.invoke("hcm_api_read", { operationId: "missing" })).error?.code,
    "UNKNOWN_OPERATION",
  );
  f.runtime.call = async () => {
    throw new Error("synthetic-private-error");
  };
  const result = await f.tools.invoke("hcm_status", {});
  assert.equal(structured(result).error?.code, "mcp.operation_failed");
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private-error/);
});

test("исход indeterminate доходит без изменений через структурированный и текстовый вывод", async () => {
  const f = fixture();
  f.runtime.call = async (id) => ({
    ok: false,
    error: {
      code: "INDETERMINATE",
      message: "Check state",
      mutationOutcome: "indeterminate",
      retryable: false,
    },
    meta: { operationId: id, connection: "synthetic", durationMs: 1 },
  });
  const result = structured(
    await f.tools.invoke("hcm_object_create", { type: "education_mode", data: {} }),
  );
  assert.equal(result.error?.mutationOutcome, "indeterminate");
  assert.equal(result.error?.retryable, false);
});

test("штатный MCP SDK: handshake, список и вызов возвращают один текстовый блок JSON", async () => {
  const f = fixture();
  const server = createHcmMcpServer(f.runtime, { connectionName: "synthetic", version: "0.1.0" });
  const client = new Client({ name: "synthetic-tests", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 23);
    const result = await client.callTool({ name: "hcm_status", arguments: {} });
    assert.equal(mcpJson(result).ok, true);
    const rejected = await client.callTool({
      name: "hcm_api_read",
      arguments: { operationId: "test.write" },
    });
    assert.equal(rejected.isError, true);
    assert.equal(f.calls.length, 1);
  } finally {
    await client.close();
    await server.close();
  }
  assert.equal(f.closed(), 0, "server does not close its borrowed runtime; CLI owns it");
});

test("обзор MCP на настоящем runtime компактен, а describe показывает независимый контракт ввода native", async () => {
  let networkCalls = 0;
  const config: ConnectionConfig = {
    name: "synthetic",
    baseUrl: "http://fixture.invalid",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    outputLimitBytes: 24000,
    runtimeDir: scratchRuntimeDir,
    permissions: { write: false, execute: false },
    fetch: async () => {
      networkCalls++;
      throw new Error("Unexpected network");
    },
  };
  const runtime = new HcmRuntime(config);
  const tools = new HcmMcpTools(runtime);
  try {
    const list = structured(await tools.invoke("hcm_api_list", { topic: "protocol", limit: 100 }));
    assert.ok(Buffer.byteLength(JSON.stringify(list)) < 16500);
    assert.equal(
      (list.data as { operations: { inputSchema?: unknown }[] }).operations.every(
        (item) => item.inputSchema === undefined,
      ),
      true,
    );
    const describe = structured(
      await tools.invoke("hcm_api_describe", { operationId: "native.lds.loadDoc" }),
    );
    const contract = describe.data as OperationDefinition;
    assert.equal(contract.effect, "read");
    assert.equal((describe.data as { topic: string }).topic, "documents");
    assert.equal("profile" in contract || "status" in contract || "group" in contract, false);
    assert.deepEqual(contract.inputSchema.required, ["url"]);
    const properties = contract.inputSchema.properties as Record<string, { type: string }>;
    assert.equal(properties.url?.type, "string");
    assert.equal(properties.tryLock?.type, "boolean");
    assert.equal(properties.useBinaryResponse?.type, "boolean");
    const rpcList = structured(
      await tools.invoke("hcm_api_read", {
        operationId: "rpc.list",
        args: { library: "tools", method: "get_version", builtIn: true },
      }),
    );
    assert.equal(rpcList.ok, true);
    const rpcPage = rpcList.data as {
      targets: { id: string; parameters: string[] }[];
      total: number;
      source: string;
    };
    assert.equal(rpcPage.total, 1);
    assert.equal(rpcPage.source, "built-in 2025.1.1171");
    assert.equal(rpcPage.targets[0]?.id, "tools.get_version");
    assert.deepEqual(rpcPage.targets[0]?.parameters, ["sTypeParam", "bDateFlag"]);
    const rpcDescribe = structured(
      await tools.invoke("hcm_api_read", {
        operationId: "rpc.describe",
        args: { targetId: "tools.get_version", builtIn: true, source: true },
      }),
    );
    assert.equal(rpcDescribe.ok, true);
    const rpcTarget = rpcDescribe.data as {
      source: string;
      code?: string;
    };
    assert.equal(rpcTarget.source, "built-in 2025.1.1171");
    assert.equal(rpcTarget.code, undefined);
    const unknown = structured(
      await tools.invoke("hcm_api_read", {
        operationId: "rpc.describe",
        args: { targetId: "tools.synthetic_missing", builtIn: true },
      }),
    );
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error?.code, "UNKNOWN_RPC_TARGET");
    assert.equal(networkCalls, 0);
  } finally {
    await runtime.close();
  }
});
